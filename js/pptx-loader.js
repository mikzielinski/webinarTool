/**
 * Browser PPTX loader — extracts slides as images via JSZip.
 * Uses embedded media per slide; falls back to text placeholder canvas.
 */

let JSZip = null;

async function getJSZip() {
  if (JSZip) return JSZip;
  JSZip = (await import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm")).default;
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
  const m = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", emf: "image/emf", wmf: "image/wmf" };
  return m[ext] || "image/png";
}

async function renderPlaceholder(slideNum, previewText) {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#08162D";
  ctx.fillRect(0, 0, 1280, 720);

  const grad = ctx.createLinearGradient(0, 0, 1280, 720);
  grad.addColorStop(0, "#E30613");
  grad.addColorStop(1, "#2C2760");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 680, 1280, 40);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 48px 'Segoe UI', sans-serif";
  ctx.fillText(`Slide ${slideNum}`, 80, 120);

  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font="28px 'Segoe UI', sans-serif";
  const text = (previewText || "PPTX — brak podglądu grafiki").slice(0, 200);
  wrapText(ctx, text, 80, 200, 1120, 36);

  return canvas.toDataURL("image/jpeg", 0.88);
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
    const size = blob.size;
    if (size < 800) continue; // skip tiny icons
    const mime = guessMime(target);
    if (mime.includes("emf") || mime.includes("wmf")) continue;
    try {
      const dataUrl = await blobToDataUrl(blob, mime);
      images.push({ dataUrl, size, name: target.split("/").pop() });
    } catch {
      /* skip bad blob */
    }
  }

  images.sort((a, b) => b.size - a.size);
  return images;
}

export async function loadPptxSlides(arrayBuffer) {
  const JSZ = await getJSZip();
  const zip = await JSZ.loadAsync(arrayBuffer);

  const presXml = await zip.file("ppt/presentation.xml")?.async("text");
  if (!presXml) throw new Error("Invalid PPTX — brak presentation.xml");

  const presRelsXml = await zip.file("ppt/_rels/presentation.xml.rels")?.async("text");
  const presRels = parseRelTargets(presRelsXml);
  const sldIds = extractSlideIds(presXml);

  const slidePaths = sldIds
    .map((rid) => presRels[rid])
    .filter((p) => p && p.includes("slides/slide"));

  if (!slidePaths.length) throw new Error("Nie znaleziono slajdów w PPTX");

  const slides = [];
  for (let i = 0; i < slidePaths.length; i++) {
    const path = slidePaths[i];
    const slideXml = await zip.file(path)?.async("text");
    const preview = extractTexts(slideXml);
    const images = await slideImagesFromRels(zip, path);

    let dataUrl;
    if (images.length) {
      dataUrl = images[0].dataUrl;
    } else {
      dataUrl = await renderPlaceholder(i + 1, preview);
    }

    slides.push({
      id: i + 1,
      dataUrl,
      name: preview ? preview.slice(0, 60) : `Slide ${i + 1}`,
      preview,
    });
  }

  return slides;
}

export async function loadPptxFromFile(file) {
  const buf = await file.arrayBuffer();
  return loadPptxSlides(buf);
}
