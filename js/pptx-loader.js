/**
 * PPTX loader — full slide preview via pptx-viewer, rasterized to JPEG for thumbnails.
 * Falls back to ZIP image extraction if the renderer fails.
 */

const RENDER_WIDTH = 1280;
const SLIDE_RENDER_TIMEOUT_MS = 15000;
const VIEWER_URL = new URL("./vendor/pptx-viewer.js", import.meta.url).href;

let viewerModule = null;

async function getViewer() {
  if (viewerModule) return viewerModule;
  try {
    viewerModule = await import(VIEWER_URL);
    return viewerModule;
  } catch (err) {
    throw new Error(`Nie udało się wczytać silnika PPTX: ${err.message}`);
  }
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

async function renderSlideToJpeg(presentation, index, width, height) {
  const { renderSlideToCanvas } = await getViewer();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  await withTimeout(
    renderSlideToCanvas(presentation, index, canvas),
    SLIDE_RENDER_TIMEOUT_MS,
    `Timeout renderu slajdu ${index + 1}`
  );

  return canvasToDataUrl(canvas);
}

async function renderWithViewer(presentation, onProgress) {
  const total = presentation.slides.length;
  if (!total) throw new Error("PPTX nie zawiera slajdów");

  const aspect = presentation.slideSize.height / presentation.slideSize.width;
  const width = RENDER_WIDTH;
  const height = Math.round(width * aspect);
  const slides = [];

  for (let i = 0; i < total; i++) {
    const preview = slidePreviewText(presentation.slides[i]);
    let dataUrl;
    try {
      dataUrl = await renderSlideToJpeg(presentation, i, width, height);
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

/* ── Legacy ZIP fallback (embedded images + text placeholder) ── */

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
  const m = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
  };
  return m[ext] || "image/png";
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
  const text = (previewText || "Podgląd niedostępny — użyj PDF lub ponów upload PPTX").slice(0, 280);
  wrapText(ctx, text, 80, 160, 1120, 32);

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
      images.push({
        path: target,
        dataUrl: await blobToDataUrl(blob, mime),
        size: blob.size,
      });
    } catch {
      /* skip */
    }
  }

  images.sort((a, b) => b.size - a.size);
  return images;
}

async function loadWithZip(arrayBuffer, onProgress) {
  const JSZ = await getJSZip();
  const zip = await JSZ.loadAsync(arrayBuffer);

  const presXml = await zip.file("ppt/presentation.xml")?.async("text");
  if (!presXml) throw new Error("Nieprawidłowy PPTX — brak presentation.xml");

  const presRelsXml = await zip.file("ppt/_rels/presentation.xml.rels")?.async("text");
  const presRels = parseRelTargets(presRelsXml);
  const slidePaths = extractSlideIds(presXml)
    .map((rid) => presRels[rid])
    .filter((p) => p && p.includes("slides/slide"));

  if (!slidePaths.length) throw new Error("Nie znaleziono slajdów w PPTX");

  const perSlideImages = [];
  const usage = new Map();

  for (const path of slidePaths) {
    const imgs = await slideImagesFromRels(zip, path);
    perSlideImages.push(imgs);
    for (const img of imgs) {
      usage.set(img.path, (usage.get(img.path) || 0) + 1);
    }
  }

  const slideCount = slidePaths.length;
  const sharedThreshold = Math.max(2, Math.ceil(slideCount * 0.35));

  const slides = [];
  for (let i = 0; i < slidePaths.length; i++) {
    const slideXml = await zip.file(slidePaths[i])?.async("text");
    const preview = extractTexts(slideXml);
    const candidates = perSlideImages[i].filter((img) => (usage.get(img.path) || 0) < sharedThreshold);
    const pick = candidates[0] || perSlideImages[i][0];

    slides.push({
      id: i + 1,
      dataUrl: pick ? pick.dataUrl : await renderPlaceholder(i + 1, preview),
      name: preview ? preview.slice(0, 80) : `Slide ${i + 1}`,
      preview,
    });
    onProgress?.(i + 1, slideCount);
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
  const buf = await file.arrayBuffer();
  return loadPptxBuffer(buf, onProgress);
}
