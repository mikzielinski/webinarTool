import { savePresentation, loadPresentation, clearPresentation } from "./slide-store.js";
import { loadPptxFromFile } from "./pptx-loader.js";
import { resolveChapterSlideRange } from "./chapter-slides.js";

const PDFJS_VERSION = "4.4.168";
let pdfjsLib = null;

async function getPdfJs() {
  if (pdfjsLib) return pdfjsLib;
  pdfjsLib = await import(
    `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.mjs`
  );
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;
  return pdfjsLib;
}

function sortByName(files) {
  return [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function renderPdfPage(pdf, pageNum, scale = 2) {
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  return canvas.toDataURL("image/jpeg", 0.85);
}

export class SlideDeck {
  constructor() {
    this.slides = [];
    this.slideIndex = 0;
    this.fileName = "";
    this.fileType = "";
    this.syncWithChapters = true;
    this.showSlides = true;
    this.chapterRange = { start: 0, end: 0 };
    this.chapters = [];
    this.chapterIndex = 0;
    this.onChange = () => {};
    this.onProgress = null;
    this.cacheStale = false;
  }

  async loadFromStorage() {
    const data = await loadPresentation();
    this.cacheStale = false;
    if (!data?.slides?.length) {
      this.slides = [];
      return false;
    }
    // Old SVG thumbnails don't render in <img> — force re-upload
    if (data.slides.some((s) => s.dataUrl?.startsWith("data:image/svg+xml"))) {
      await clearPresentation();
      this.slides = [];
      this.fileName = "";
      this.fileType = "";
      this.cacheStale = true;
      return false;
    }
    this.slides = data.slides;
    this.fileName = data.fileName || "";
    this.fileType = data.fileType || "";
    this.slideIndex = 0;
    return true;
  }

  async persist() {
    if (!this.slides.length) {
      await clearPresentation();
      return;
    }
    await savePresentation({
      slides: this.slides,
      fileName: this.fileName,
      fileType: this.fileType,
    });
  }

  async loadFiles(fileList) {
    const files = sortByName([...fileList]);
    if (!files.length) return;

    const first = files[0];
    const ext = first.name.split(".").pop()?.toLowerCase();

    if (ext === "pdf") {
      await this._loadPdf(first);
      this.fileType = "pdf";
    } else if (ext === "pptx") {
      await this._loadPptx(first);
      this.fileType = "pptx";
    } else {
      await this._loadImages(files.filter((f) => /\.(png|jpe?g|webp|gif)$/i.test(f.name)));
      this.fileType = "images";
    }

    this.slideIndex = 0;
    this._updateRange();
    await this.persist();
    this.onChange();
  }

  async _loadPptx(file) {
    this.fileName = file.name;
    this.slides = await loadPptxFromFile(file, (done, total) => {
      this.onProgress?.({ done, total, phase: "render" });
    });
    if (!this.slides.length) throw new Error("PPTX nie zawiera slajdów");
  }

  async _loadPdf(file) {
    const pdfjs = await getPdfJs();
    const buf = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buf }).promise;
    this.fileName = file.name;
    this.slides = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const dataUrl = await renderPdfPage(pdf, i);
      this.slides.push({ id: i, dataUrl, name: `Slide ${i}` });
    }
  }

  async _loadImages(files) {
    if (!files.length) throw new Error("No image files found");
    this.fileName = files.length === 1 ? files[0].name : `${files.length} images`;
    this.slides = [];
    for (let i = 0; i < files.length; i++) {
      const dataUrl = await fileToDataUrl(files[i]);
      this.slides.push({ id: i + 1, dataUrl, name: files[i].name });
    }
  }

  _updateRange() {
    if (!this.chapters.length || !this.slides.length) {
      this.chapterRange = { start: 0, end: Math.max(0, this.slides.length - 1) };
      return;
    }
    if (this.syncWithChapters || this.chapters.some((c) => c.slideStart != null && c.slideStart !== "")) {
      this.chapterRange = resolveChapterSlideRange(this.chapters, this.chapterIndex, this.slides.length);
    } else {
      this.chapterRange = { start: 0, end: this.slides.length - 1 };
    }
    this.slideIndex = Math.max(this.chapterRange.start, Math.min(this.slideIndex, this.chapterRange.end));
  }

  get count() {
    return this.slides.length;
  }

  get current() {
    return this.slides[this.slideIndex] ?? null;
  }

  get next() {
    const { end } = this.chapterRange;
    if (this.slideIndex < end) return this.slides[this.slideIndex + 1] ?? null;
    return this.slides[this.slideIndex + 1] ?? null;
  }

  /** Next slide within chapter range, or null if at end */
  get nextInChapter() {
    const { end } = this.chapterRange;
    if (this.slideIndex < end) return this.slides[this.slideIndex + 1];
    return null;
  }

  goTo(index) {
    if (!this.slides.length) return;
    const { start, end } = this.chapterRange;
    const clamped = Math.max(start, Math.min(index, end));
    if (this.slideIndex !== clamped) {
      this.slideIndex = clamped;
      this.onChange();
    }
  }

  goToAbsolute(index) {
    if (!this.slides.length) return;
    const i = Math.max(0, Math.min(index, this.slides.length - 1));
    if (this.slideIndex !== i) {
      this.slideIndex = i;
      this.onChange();
    }
  }

  nextSlide() {
    const { end } = this.chapterRange;
    if (this.slideIndex < end) this.goToAbsolute(this.slideIndex + 1);
  }

  prevSlide() {
    const { start } = this.chapterRange;
    if (this.slideIndex > start) this.goToAbsolute(this.slideIndex - 1);
  }

  syncToChapter(chapterIndex, chapters) {
    if (!this.slides.length) return;
    this.chapters = chapters || this.chapters;
    this.chapterIndex = chapterIndex;
    this._updateRange();

    const { start } = this.chapterRange;
    const ch = chapters?.[chapterIndex];
    const useExplicit = ch && ch.slideStart != null && ch.slideStart !== "";

    if (useExplicit || this.syncWithChapters) {
      if (this.slideIndex !== start) {
        this.slideIndex = start;
        this.onChange();
      }
    }
  }

  setContext(chapters, chapterIndex) {
    this.chapters = chapters;
    this.chapterIndex = chapterIndex;
    this._updateRange();
  }

  async clear() {
    this.slides = [];
    this.slideIndex = 0;
    this.fileName = "";
    this.fileType = "";
    this.chapterRange = { start: 0, end: 0 };
    await clearPresentation();
    this.onChange();
  }
}
