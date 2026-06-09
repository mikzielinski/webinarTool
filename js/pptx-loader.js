/**
 * PPTX loader — full slide preview via pptx-viewer + html2canvas.
 * Inlines embedded images as data: URLs, then captures DOM (text + graphics + photos).
 */

const RENDER_WIDTH = 1280;
const SLIDE_RENDER_TIMEOUT_MS = 20000;
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
    return canvas.toDataURL("image/jpeg", 0.88);
  } catch {
    return canvas.toDataURL("image/png");
  }
}

/** Reject only truly blank captures (solid white or black), not dark-themed slides. */
function hasVisibleContent(canvas, minRatio = 0.003) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let interesting = 0;
  const total = width * height;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (r > 252 && g > 252 && b > 252) continue;
    if (r < 3 && g < 3 && b < 3) continue;
    interesting++;
  }
  return interesting / total > minRatio;
}

async function captureElementToCanvas(el, width, height, backgroundColor = null) {
  const html2canvas = await getHtml2Canvas();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  await new Promise((r) => setTimeout(r, 100));

  const raw = await html2canvas(el, {
    backgroundColor,
    scale: 1,
    useCORS: true,
    allowTaint: false,
    logging: false,
    onclone: (_doc, clone) => {
      clone.style.opacity = "1";
      clone.style.visibility = "visible";
    },
  });

  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d");
  if (backgroundColor) {
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(raw, 0, 0, width, height);
  return out;
}

async function renderSlideToJpeg(presentation, index, width, height) {
  const { renderSlideToElement } = await getViewer();

  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = [
    "position:fixed",
    "left:0",
    "top:0",
    `width:${width}px`,
    `height:${height}px`,
    "overflow:visible",
    "opacity:0.01",
    "pointer-events:none",
    "z-index:-1",
  ].join(";");
  document.body.appendChild(host);

  try {
    renderSlideToElement(presentation, index, host, { width, height });
    const svg = host.querySelector("svg");
    if (!svg) throw new Error("Brak SVG slajdu");
    await inlineAllSvgImages(svg);
    await waitForSvgImages(svg);

    // Capture live DOM (not SVG clone) — preserves text + graphics.
    let canvas = await captureElementToCanvas(host, width, height, null);
    if (!hasVisibleContent(canvas)) {
      canvas = await captureElementToCanvas(host, width, height, "#ffffff");
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
  if (href.startsWith("blob:")) {
    const res = await fetch(href);
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }
  const res = await fetch(href);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
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


async function renderWithViewer(presentation, onProgress) {
  const total = presentation.slides.length;
  if (!total) throw new Error("PPTX nie zawiera slajdów");

  const width = RENDER_WIDTH;
  const height = Math.round(width * (presentation.slideSize.height / presentation.slideSize.width));
  const slides = [];

  for (let i = 0; i < total; i++) {
    const preview = slidePreviewText(presentation.slides[i]);
    let dataUrl;
    try {
      dataUrl = await withTimeout(
        renderSlideToJpeg(presentation, i, width, height),
        SLIDE_RENDER_TIMEOUT_MS,
        `Timeout renderu slajdu ${i + 1}`
      );
    } catch (err) {
      console.warn(`Slide ${i + 1} render failed:`, err);
      dataUrl = await renderPlaceholder(i + 1, preview);
    }

    slides.push({
      id: i + 1,
      dataUrl,
      name: preview ? preview.slice(0, 80) : `Slide ${i + 1}`,
      preview,
    });
    onProgress?.(i + 1, total);
  }

  return slides;
}

async function loadWithViewer(source, onProgress) {
  const { loadPresentation } = await getViewer();
  const presentation = await loadPresentation(source);
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
    onProgress?.(i + 1, slidePaths.length);
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
  return loadPptxBuffer(await file.arrayBuffer(), onProgress);
}
