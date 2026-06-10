/**
 * PPTX loader — full slide preview via pptx-viewer + html2canvas.
 * Inlines embedded images as data: URLs, then captures DOM (text + graphics + photos).
 */

export const PPTX_RENDER_VERSION = 6;

const RENDER_WIDTH = 960;
const SLIDE_RENDER_TIMEOUT_MS = 60000;
const SLIDE_PARALLEL = 4;
const OFFSCREEN_LEFT = -20000;

let imageInlineCache = null;
const VIEWER_URL = new URL("./vendor/pptx-viewer.js", import.meta.url).href;
const HTML2CANVAS_URL = new URL("./vendor/html2canvas.js", import.meta.url).href;

let viewerModule = null;
let html2canvasModule = null;

async function getViewer() {
  if (viewerModule) return viewerModule;
  viewerModule = await import(VIEWER_URL);
  return viewerModule;
}

async function getHtml2Canvas() {
  if (html2canvasModule) return html2canvasModule;
  html2canvasModule = (await import(HTML2CANVAS_URL)).default;
  return html2canvasModule;
}

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

function slidePreviewText(slide) {
  const parts = [];
  function walk(elements) {
    for (const el of elements || []) {
      if (el.type === "text" && el.text?.paragraphs) {
        for (const p of el.text.paragraphs) {
          for (const r of p.runs || []) {
            if (r.text?.trim()) parts.push(r.text.trim());
          }
        }
      }
      if (el.elements?.length) walk(el.elements);
      if (el.children?.length) walk(el.children);
    }
  }
  walk(slide?.elements);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function canvasToDataUrl(canvas) {
  try {
    return canvas.toDataURL("image/jpeg", 0.85);
  } catch {
    return canvas.toDataURL("image/png");
  }
}

/** Reject blank or flat-color captures (e.g. only the host backdrop). */
function hasVisibleContent(canvas, minRange = 12) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let minR = 255;
  let maxR = 0;
  let minG = 255;
  let maxG = 0;
  let minB = 255;
  let maxB = 0;
  const step = 64;
  for (let i = 0; i < data.length; i += step) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    minR = Math.min(minR, r);
    maxR = Math.max(maxR, r);
    minG = Math.min(minG, g);
    maxG = Math.max(maxG, g);
    minB = Math.min(minB, b);
    maxB = Math.max(maxB, b);
  }
  const range = Math.max(maxR - minR, maxG - minG, maxB - minB);
  return range > minRange;
}

function slideBackgroundFromSvg(svg) {
  let bestFill = null;
  let bestArea = 0;
  for (const rect of svg?.querySelectorAll("rect") || []) {
    const fill = rect.getAttribute("fill");
    if (!fill || fill === "none" || !fill.startsWith("#")) continue;
    const w = parseFloat(rect.getAttribute("width") || "0");
    const h = parseFloat(rect.getAttribute("height") || "0");
    const area = w * h;
    if (area > bestArea) {
      bestArea = area;
      bestFill = fill;
    }
  }
  const bg = bestFill || "#08162D";
  // html2canvas + foreignObject capture fails when the host background is white.
  const hex = bg.toUpperCase();
  if (hex === "#FFFFFF" || hex === "#FFF") return "#08162D";
  return bg;
}

let renderSandbox = null;

function getRenderSandbox() {
  if (!renderSandbox) {
    renderSandbox = document.createElement("div");
    renderSandbox.id = "pptx-render-sandbox";
    renderSandbox.setAttribute("aria-hidden", "true");
    renderSandbox.style.cssText = [
      "position:fixed",
      `left:${OFFSCREEN_LEFT}px`,
      "top:0",
      "width:1920px",
      "height:1080px",
      "overflow:hidden",
      "opacity:1",
      "pointer-events:none",
      "z-index:-1",
    ].join(";");
    document.body.appendChild(renderSandbox);
  }
  return renderSandbox;
}

/** One html2canvas pass for all foreignObject text, composited over the SVG base. */
async function compositeSlideToCanvas(svg, width, height, backdrop) {
  const html2canvas = await getHtml2Canvas();
  const sandbox = getRenderSandbox();
  const foLayer = document.createElement("div");
  foLayer.style.cssText = `position:relative;width:${width}px;height:${height}px;background:transparent`;

  for (const fo of [...svg.querySelectorAll("foreignObject")]) {
    const w = parseFloat(fo.getAttribute("width") || "0");
    const h = parseFloat(fo.getAttribute("height") || "0");
    if (w < 2 || h < 2 || !fo.innerHTML.trim()) continue;
    const child = document.createElement("div");
    child.style.cssText = [
      "position:absolute",
      `left:${fo.getAttribute("x") || 0}px`,
      `top:${fo.getAttribute("y") || 0}px`,
      `width:${w}px`,
      `height:${h}px`,
      "overflow:hidden",
    ].join(";");
    child.innerHTML = fo.innerHTML;
    foLayer.appendChild(child);
    fo.remove();
  }

  let foCanvas = null;
  if (foLayer.childElementCount) {
    sandbox.appendChild(foLayer);
    try {
      foCanvas = await html2canvas(foLayer, {
        backgroundColor: null,
        scale: 1,
        useCORS: true,
        allowTaint: false,
        logging: false,
      });
    } finally {
      foLayer.remove();
    }
  }

  const base = await svgToCanvas(svg, width, height, backdrop);
  if (foCanvas) {
    base.getContext("2d").drawImage(foCanvas, 0, 0, width, height);
  }
  return base;
}

async function svgToCanvas(svg, width, height, backgroundColor = null) {
  const xml = new XMLSerializer().serializeToString(svg);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("SVG export failed"));
    img.src = url;
  });

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (backgroundColor) {
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(img, 0, 0, width, height);
  return canvas;
}

async function renderSlideToJpeg(presentation, index, width, height) {
  const { renderSlideToElement } = await getViewer();

  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = [
    "position:fixed",
    `left:${OFFSCREEN_LEFT}px`,
    "top:0",
    `width:${width}px`,
    `height:${height}px`,
    "overflow:hidden",
    "opacity:1",
    "pointer-events:none",
    "z-index:-1",
  ].join(";");
  getRenderSandbox().appendChild(host);

  try {
    renderSlideToElement(presentation, index, host, { width, height });
    const svg = host.querySelector("svg");
    if (!svg) throw new Error("Brak SVG slajdu");
    await inlineAllSvgImages(svg);
    await waitForSvgImages(svg);

    const backdrop = slideBackgroundFromSvg(svg);
    let canvas = await compositeSlideToCanvas(svg.cloneNode(true), width, height, backdrop);
    if (!hasVisibleContent(canvas)) {
      canvas = await compositeSlideToCanvas(svg.cloneNode(true), width, height, "#ffffff");
    }
    if (!hasVisibleContent(canvas)) {
      throw new Error("Pusty podgląd slajdu (blank capture)");
    }

    return canvasToDataUrl(canvas);
  } finally {
    host.remove();
  }
}

function svgImageHref(el) {
  return (
    el.getAttribute("href") ||
    el.getAttributeNS("http://www.w3.org/1999/xlink", "href") ||
    ""
  );
}

async function hrefToDataUrl(href) {
  if (!href || href.startsWith("data:")) return href;
  if (imageInlineCache?.has(href)) return imageInlineCache.get(href);

  let dataUrl;
  if (href.startsWith("blob:")) {
    const res = await fetch(href);
    const blob = await res.blob();
    dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  } else {
    const res = await fetch(href);
    const blob = await res.blob();
    dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }
  imageInlineCache?.set(href, dataUrl);
  return dataUrl;
}

/** Replace blob:/http refs in all SVG <image> nodes (including pattern fills). */
async function inlineAllSvgImages(svg) {
  const images = svg.querySelectorAll("image");
  for (const el of images) {
    const href = svgImageHref(el);
    if (!href || href.startsWith("data:")) continue;
    try {
      const dataUrl = await hrefToDataUrl(href);
      el.setAttribute("href", dataUrl);
      el.removeAttributeNS("http://www.w3.org/1999/xlink", "href");
    } catch (err) {
      console.warn("Could not inline SVG image:", err);
    }
  }
}

/** Ensure embedded data: images are decoded before canvas export. */
async function waitForSvgImages(svg) {
  const tasks = [...svg.querySelectorAll("image")].map((el) => {
    const href = svgImageHref(el);
    if (!href?.startsWith("data:")) return Promise.resolve();
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = img.onerror = () => resolve();
      img.src = href;
    });
  });
  await Promise.all(tasks);
}


async function renderOneSlide(presentation, index, width, height) {
  const preview = slidePreviewText(presentation.slides[index]);
  try {
    const dataUrl = await withTimeout(
      renderSlideToJpeg(presentation, index, width, height),
      SLIDE_RENDER_TIMEOUT_MS,
      `Timeout renderu slajdu ${index + 1}`
    );
    return {
      id: index + 1,
      dataUrl,
      name: preview ? preview.slice(0, 80) : `Slide ${index + 1}`,
      preview,
      placeholder: false,
    };
  } catch (err) {
    console.warn(`Slide ${index + 1} render failed:`, err);
    return {
      id: index + 1,
      dataUrl: await renderPlaceholder(index + 1, preview),
      name: preview ? preview.slice(0, 80) : `Slide ${index + 1}`,
      preview,
      placeholder: true,
    };
  }
}

async function renderWithViewer(presentation, onProgress) {
  const total = presentation.slides.length;
  if (!total) throw new Error("PPTX nie zawiera slajdów");

  imageInlineCache = new Map();
  if (document.fonts?.ready) await document.fonts.ready;

  const width = RENDER_WIDTH;
  const height = Math.round(width * (presentation.slideSize.height / presentation.slideSize.width));
  const slides = new Array(total);
  let done = 0;

  for (let batch = 0; batch < total; batch += SLIDE_PARALLEL) {
    const batchIndices = [];
    for (let i = batch; i < Math.min(batch + SLIDE_PARALLEL, total); i++) batchIndices.push(i);

    const batchSlides = await Promise.all(
      batchIndices.map((i) => renderOneSlide(presentation, i, width, height))
    );
    for (let j = 0; j < batchIndices.length; j++) {
      slides[batchIndices[j]] = batchSlides[j];
      done++;
      onProgress?.({ phase: "render", done, total, partial: slides.filter(Boolean) });
    }
  }

  imageInlineCache = null;
  return slides;
}

async function loadWithViewer(source, onProgress) {
  onProgress?.({ phase: "parse", done: 0, total: 1 });
  const { loadPresentation } = await getViewer();
  const presentation = await loadPresentation(source);
  onProgress?.({ phase: "parse", done: 1, total: 1 });
  try {
    return await renderWithViewer(presentation, onProgress);
  } finally {
    presentation.cleanup?.();
  }
}

/* ── Legacy ZIP fallback ── */

let JSZip = null;

async function getJSZip() {
  if (JSZip) return JSZip;
  JSZip = (await import(new URL("./vendor/jszip.js", import.meta.url).href)).default;
  return JSZip;
}

function parseRelTargets(relsXml) {
  const map = {};
  if (!relsXml) return map;
  const re = /Id="([^"]+)"[^>]*Target="([^"]+)"/g;
  let m;
  while ((m = re.exec(relsXml))) {
    map[m[1]] = m[2].replace(/^\.\.\//, "ppt/");
  }
  return map;
}

function extractSlideIds(presentationXml) {
  const ids = [];
  const re = /<p:sldId[^>]*r:id="([^"]+)"/g;
  let m;
  while ((m = re.exec(presentationXml))) ids.push(m[1]);
  return ids;
}

function extractTexts(slideXml) {
  const parts = [];
  const re = /<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/g;
  let m;
  while ((m = re.exec(slideXml))) {
    const t = m[1].trim();
    if (t) parts.push(t);
  }
  return parts.join(" ");
}

async function blobToDataUrl(blob, mime) {
  const buffer = await blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(new Blob([buffer], { type: mime }));
  });
}

function guessMime(path) {
  const ext = path.split(".").pop()?.toLowerCase();
  return { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" }[ext] || "image/png";
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(/\s+/);
  let line = "";
  let cy = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, cy);
      line = word;
      cy += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, cy);
}

async function renderPlaceholder(slideNum, previewText) {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#08162D";
  ctx.fillRect(0, 0, 1280, 720);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 42px 'Segoe UI', system-ui, sans-serif";
  ctx.fillText(`Slajd ${slideNum}`, 80, 100);
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.font = "24px 'Segoe UI', system-ui, sans-serif";
  wrapText(ctx, (previewText || "Podgląd niedostępny").slice(0, 280), 80, 160, 1120, 32);
  return canvasToDataUrl(canvas);
}

async function slideImagesFromRels(zip, slidePath) {
  const base = slidePath.split("/").pop();
  const relsPath = `ppt/slides/_rels/${base}.rels`;
  const relsXml = await zip.file(relsPath)?.async("text");
  const rels = parseRelTargets(relsXml);
  const images = [];
  for (const target of Object.values(rels)) {
    if (!target.includes("/media/")) continue;
    const file = zip.file(target);
    if (!file) continue;
    const blob = await file.async("blob");
    if (blob.size < 800) continue;
    const mime = guessMime(target);
    if (mime.includes("emf") || mime.includes("wmf")) continue;
    try {
      images.push({ path: target, dataUrl: await blobToDataUrl(blob, mime), size: blob.size });
    } catch { /* skip */ }
  }
  images.sort((a, b) => b.size - a.size);
  return images;
}

async function loadWithZip(arrayBuffer, onProgress) {
  const JSZ = await getJSZip();
  const zip = await JSZ.loadAsync(arrayBuffer);
  const presXml = await zip.file("ppt/presentation.xml")?.async("text");
  if (!presXml) throw new Error("Nieprawidłowy PPTX — brak presentation.xml");
  const presRels = parseRelTargets(await zip.file("ppt/_rels/presentation.xml.rels")?.async("text"));
  const slidePaths = extractSlideIds(presXml).map((rid) => presRels[rid]).filter((p) => p?.includes("slides/slide"));
  if (!slidePaths.length) throw new Error("Nie znaleziono slajdów w PPTX");

  const perSlideImages = [];
  const usage = new Map();
  for (const path of slidePaths) {
    const imgs = await slideImagesFromRels(zip, path);
    perSlideImages.push(imgs);
    for (const img of imgs) usage.set(img.path, (usage.get(img.path) || 0) + 1);
  }

  const sharedThreshold = Math.max(2, Math.ceil(slidePaths.length * 0.35));
  const slides = [];
  for (let i = 0; i < slidePaths.length; i++) {
    const preview = extractTexts(await zip.file(slidePaths[i])?.async("text"));
    const candidates = perSlideImages[i].filter((img) => (usage.get(img.path) || 0) < sharedThreshold);
    const pick = candidates[0] || perSlideImages[i][0];
    slides.push({
      id: i + 1,
      dataUrl: pick ? pick.dataUrl : await renderPlaceholder(i + 1, preview),
      name: preview ? preview.slice(0, 80) : `Slide ${i + 1}`,
      preview,
    });
    onProgress?.({ phase: "render", done: i + 1, total: slidePaths.length });
  }
  return slides;
}

async function loadPptxBuffer(arrayBuffer, onProgress) {
  try {
    return await loadWithViewer(arrayBuffer, onProgress);
  } catch (viewerErr) {
    console.warn("PPTX viewer failed, using ZIP fallback:", viewerErr);
    try {
      return await loadWithZip(arrayBuffer, onProgress);
    } catch (zipErr) {
      throw new Error(`${viewerErr.message} (fallback: ${zipErr.message})`);
    }
  }
}

export async function loadPptxSlides(arrayBuffer, onProgress) {
  return loadPptxBuffer(arrayBuffer, onProgress);
}

export async function loadPptxFromFile(file, onProgress) {
  onProgress?.({ phase: "read", done: 0, total: 1 });
  const buffer = await file.arrayBuffer();
  onProgress?.({ phase: "read", done: 1, total: 1 });
  return loadPptxBuffer(buffer, onProgress);
}
