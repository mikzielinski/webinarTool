import { savePresentation, loadPresentation, clearPresentation } from "./slide-store.js";

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
    this.slides = []; // { id, dataUrl, name }
    this.slideIndex = 0;
    this.fileName = "";
    this.syncWithChapters = true;
    this.showSlides = true;
    this.onChange = () => {};
  }

  async loadFromStorage() {
    const data = await loadPresentation();
    if (!data?.slides?.length) {
      this.slides = [];
      return false;
    }
    this.slides = data.slides;
    this.fileName = data.fileName || "";
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
    });
  }

  async loadFiles(fileList) {
    const files = sortByName([...fileList]);
    if (!files.length) return;

    const first = files[0];
    const ext = first.name.split(".").pop()?.toLowerCase();

    if (ext === "pdf") {
      await this._loadPdf(first);
    } else {
      await this._loadImages(files.filter((f) => /\.(png|jpe?g|webp|gif)$/i.test(f.name)));
    }

    this.slideIndex = 0;
    await this.persist();
    this.onChange();
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

  get count() {
    return this.slides.length;
  }

  get current() {
    return this.slides[this.slideIndex] ?? null;
  }

  get next() {
    return this.slides[this.slideIndex + 1] ?? null;
  }

  goTo(index) {
    if (!this.slides.length) return;
    this.slideIndex = Math.max(0, Math.min(index, this.slides.length - 1));
    this.onChange();
  }

  nextSlide() {
    this.goTo(this.slideIndex + 1);
  }

  prevSlide() {
    this.goTo(this.slideIndex - 1);
  }

  syncToChapter(chapterIndex) {
    if (!this.syncWithChapters || !this.slides.length) return;
    const idx = Math.min(chapterIndex, this.slides.length - 1);
    if (this.slideIndex !== idx) {
      this.slideIndex = idx;
      this.onChange();
    }
  }

  async clear() {
    this.slides = [];
    this.slideIndex = 0;
    this.fileName = "";
    await clearPresentation();
    this.onChange();
  }
}
