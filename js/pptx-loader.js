/**
 * PPTX loader — full slide rendering via pptx-viewer (text, shapes, backgrounds, images).
 * Replaces the old approach that only picked the largest embedded image (often the logo).
 */

import {
  loadPresentation,
  renderSlideToCanvas,
} from "https://cdn.jsdelivr.net/npm/pptx-viewer@0.2.2/dist/pptx-viewer.js";

const RENDER_WIDTH = 1280;

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

  walk(slide.elements);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

async function renderPresentationSlides(presentation, onProgress) {
  const total = presentation.slides.length;
  if (!total) throw new Error("PPTX nie zawiera slajdów");

  const aspect = presentation.slideSize.height / presentation.slideSize.width;
  const width = RENDER_WIDTH;
  const height = Math.round(width * aspect);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const slides = [];
  for (let i = 0; i < total; i++) {
    await renderSlideToCanvas(presentation, i, canvas);
    const preview = slidePreviewText(presentation.slides[i]);
    slides.push({
      id: i + 1,
      dataUrl: canvas.toDataURL("image/jpeg", 0.88),
      name: preview ? preview.slice(0, 80) : `Slide ${i + 1}`,
      preview,
    });
    onProgress?.(i + 1, total);
  }

  return slides;
}

export async function loadPptxSlides(arrayBuffer, onProgress) {
  const presentation = await loadPresentation(arrayBuffer);
  try {
    return await renderPresentationSlides(presentation, onProgress);
  } finally {
    presentation.cleanup?.();
  }
}

export async function loadPptxFromFile(file, onProgress) {
  const presentation = await loadPresentation(file);
  try {
    return await renderPresentationSlides(presentation, onProgress);
  } finally {
    presentation.cleanup?.();
  }
}
