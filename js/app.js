import {
  createChapter,
  createEmptyAgenda,
  exportAgendaJson,
  formatDuration,
  loadAgenda,
  parseAgendaFile,
  testAgenda,
  demoAgenda,
  saveAgenda,
  totalDurationMinutes,
} from "./agenda.js";
import { PrompterEngine } from "./prompter.js";
import { NotesScroller, loadScrollMode, saveScrollMode, loadPrompterSettings, savePrompterSettings } from "./notes-scroll.js";
import { SlideDeck } from "./slides.js";
import { formatSlideRange, resolveChapterSlideRange } from "./chapter-slides.js";

const state = {
  agenda: loadAgenda(),
  view: "editor",
  dragIndex: null,
  lastChapterIndex: -1,
  pickingSlideForChapter: null,
};

const slideDeck = new SlideDeck();
slideDeck.onChange = () => {
  renderSlides();
  renderSlideDeckInfo();
  renderSlidePicker();
};
function setPptxLoadProgress({ phase, done, total }) {
  const overlay = $("#pptx-render-overlay");
  const label = $("#pptx-render-label");
  const hint = $("#pptx-render-hint");
  const deckInfo = $("#slide-deck-info");
  const messages = {
    read: "Wczytywanie pliku…",
    parse: "Parsowanie PPTX…",
    render: total ? `Renderowanie slajdów… ${done}/${total}` : "Renderowanie slajdów…",
  };
  const hints = {
    read: "Odczyt pliku z dysku",
    parse: "Analiza struktury prezentacji — to może potrwać ok. minutę",
    render: "Generowanie miniaturek — ok. kilka sekund na slajd",
  };
  const text = messages[phase] || "Przygotowanie prezentacji…";
  overlay?.classList.add("active");
  if (label) label.textContent = text;
  if (hint) hint.textContent = hints[phase] || "";
  if (deckInfo) deckInfo.textContent = text;
}

slideDeck.onProgress = (progress) => setPptxLoadProgress(progress);

const notesScroller = new NotesScroller(() => [
  $("#notes-scroll-panel"),
  $("#fs-notes-scroll-panel"),
]);

const prompterSettings = loadPrompterSettings();
slideDeck.showSlides = prompterSettings.showSlides !== false;
slideDeck.syncWithChapters = prompterSettings.syncSlidesChapters !== false;
notesScroller.setMode(loadScrollMode());

const engine = new PrompterEngine({
  autoAdvance: true,
  advanceDelaySec: 3,
  onTick: renderPrompter,
  onChapterEnd: (idx) => showToast(`Chapter "${state.agenda.chapters[idx]?.title}" time's up`),
  onComplete: () => showToast("Webinar agenda complete!"),
});

engine.onAdvanceCountdown = (sec) => {
  const overlay = $("#advance-overlay");
  const count = $("#advance-count");
  if (sec > 0) {
    overlay.classList.add("active");
    count.textContent = sec;
  } else {
    overlay.classList.remove("active");
  }
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

async function init() {
  notesScroller.attach();
  await slideDeck.loadFromStorage();
  if (slideDeck.cacheStale) {
    showToast("Wgraj ponownie PPTX (Ctrl+Shift+R, potem Clear slides + upload)");
  }
  bindNavigation();
  bindEditor();
  bindPrompter();
  bindKeyboard();
  applyPrompterSettingsUI();
  renderEditor();
  renderSlideDeckInfo();
  renderSlidePicker();
  renderSlides();
  renderPrompter();
}

function bindNavigation() {
  $$(".nav-tab").forEach((tab) => {
    tab.addEventListener("click", () => switchView(tab.dataset.view));
  });
}

function switchView(view) {
  state.view = view;
  $$(".nav-tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === `${view}-view`));

  if (view === "prompter") {
    document.body.classList.add("prompter-theme");
    state.lastChapterIndex = -1;
    engine.load(state.agenda);
    slideDeck.syncToChapter(engine.chapterIndex, state.agenda.chapters);
    notesScroller.resetScroll();
    renderPrompter();
  } else {
    document.body.classList.remove("prompter-theme");
    engine.stop();
    notesScroller.setRunning(false);
  }
}

function persist() {
  saveAgenda(state.agenda);
}

function showToast(msg) {
  const toast = $("#toast");
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove("show"), 3000);
}

function applyPrompterSettingsUI() {
  $("#notes-scroll-mode").value = notesScroller.mode;
  $("#show-slides").checked = slideDeck.showSlides;
  $("#sync-slides-chapters").checked = slideDeck.syncWithChapters;
  updateSlidesVisibility();
}

function updateSlidesVisibility() {
  const hidden = !slideDeck.showSlides || !slideDeck.count;
  document.querySelector(".prompter-main")?.classList.toggle("slides-hidden", hidden);
  document.querySelector(".fs-body-grid")?.classList.toggle("slides-hidden", hidden);
}

function onChapterChanged(idx) {
  notesScroller.resetScroll();
  slideDeck.syncToChapter(idx, state.agenda.chapters);
  state.lastChapterIndex = idx;
}

/* ── Editor ── */

function bindEditor() {
  $("#webinar-title").addEventListener("input", (e) => {
    state.agenda.title = e.target.value;
    persist();
  });

  $("#btn-add-chapter").addEventListener("click", () => {
    state.agenda.chapters.push(createChapter());
    persist();
    renderEditor();
  });

  $("#btn-load-sample").addEventListener("click", () => {
    state.agenda = testAgenda();
    persist();
    renderEditor();
    showToast("Test agenda loaded (~10 min, 1 min chapters)");
  });

  $("#btn-load-demo").addEventListener("click", () => {
    state.agenda = demoAgenda();
    persist();
    renderEditor();
    showToast("Full demo agenda loaded (~38 min)");
  });

  $("#btn-export").addEventListener("click", () => exportAgendaJson(state.agenda));

  $("#btn-start-prompter").addEventListener("click", () => {
    if (!state.agenda.chapters.length) {
      showToast("Add at least one chapter first");
      return;
    }
    switchView("prompter");
    $$(".nav-tab").forEach((t) => t.classList.toggle("active", t.dataset.view === "prompter"));
  });

  const zone = $("#upload-zone");
  const input = $("#file-input");
  input.addEventListener("change", (e) => {
    handleAgendaFiles(e.target.files);
    e.target.value = "";
  });
  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("dragover");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("dragover");
    handleAgendaFiles(e.dataTransfer.files);
  });

  const slideZone = $("#slide-upload-zone");
  const slideInput = $("#slide-input");
  slideInput.addEventListener("change", (e) => {
    handleSlideFiles(e.target.files);
    e.target.value = "";
  });
  slideZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    slideZone.classList.add("dragover");
  });
  slideZone.addEventListener("dragleave", () => slideZone.classList.remove("dragover"));
  slideZone.addEventListener("drop", (e) => {
    e.preventDefault();
    slideZone.classList.remove("dragover");
    handleSlideFiles(e.dataTransfer.files);
  });

  $("#btn-clear-slides").addEventListener("click", async () => {
    await slideDeck.clear();
    state.pickingSlideForChapter = null;
    renderSlidePicker();
    showToast("Presentation cleared");
  });

  $("#btn-slide-picker-cancel").addEventListener("click", () => {
    state.pickingSlideForChapter = null;
    updatePickingSlideUI();
    renderSlidePicker();
    showToast("Anulowano przypisywanie slajdu");
  });
}

function getChapterSlideRangeHint(i) {
  const ch = state.agenda.chapters[i];
  if (!ch) return "";
  if (slideDeck.count && (ch.slideStart || ch.slideEnd)) {
    const { start, end } = resolveChapterSlideRange(state.agenda.chapters, i, slideDeck.count);
    return `→ ${formatSlideRange(start, end)}`;
  }
  if (ch.slideStart) return `${ch.slideStart}+`;
  return slideDeck.count ? "auto = nr chapteru" : "brak decku";
}

function updateChapterSlideHint(i) {
  const hint = document.querySelector(`.chapter-card[data-index="${i}"] .field-hint-inline`);
  if (hint) hint.textContent = getChapterSlideRangeHint(i);
}

function updateChapterSlideInputs(i) {
  const ch = state.agenda.chapters[i];
  const card = document.querySelector(`.chapter-card[data-index="${i}"]`);
  if (!ch || !card) return;
  const startInput = card.querySelector('[data-field="slideStart"]');
  const endInput = card.querySelector('[data-field="slideEnd"]');
  if (startInput && document.activeElement !== startInput) startInput.value = ch.slideStart ?? "";
  if (endInput && document.activeElement !== endInput) endInput.value = ch.slideEnd ?? "";
  updateChapterSlideHint(i);
}

function updatePickingSlideUI() {
  document.querySelectorAll(".chapter-card").forEach((card) => {
    const i = Number(card.dataset.index);
    card.classList.toggle("picking-slide", state.pickingSlideForChapter === i);
  });
}

async function handleSlideFiles(files) {
  if (!files?.length) return;
  const ext = files[0].name.split(".").pop()?.toLowerCase();
  try {
    if (ext === "pptx") {
      setPptxLoadProgress({ phase: "read", done: 0, total: 1 });
    } else {
      showToast("Loading presentation…");
    }
    await slideDeck.loadFiles(files);
    $("#pptx-render-overlay")?.classList.remove("active");
    const typeLabel = slideDeck.fileType === "pptx" ? "PPTX" : slideDeck.fileType.toUpperCase();
    if (slideDeck.placeholderCount > 0) {
      showToast(
        `Uwaga: ${slideDeck.placeholderCount}/${slideDeck.count} slajdów — podgląd tekstowy. Odśwież stronę (Ctrl+Shift+R) i wgraj ponownie.`
      );
    } else {
      showToast(`${typeLabel}: ${slideDeck.count} slides from "${slideDeck.fileName}"`);
    }
    renderSlideDeckInfo();
    renderSlidePicker();
    updateSlidesVisibility();
  } catch (err) {
    console.error("Slide load failed:", err);
    showToast("Błąd wczytywania: " + (err.message || err));
    const el = $("#slide-deck-info");
    if (el) el.textContent = "Błąd: " + (err.message || "nieznany");
  } finally {
    $("#pptx-render-overlay")?.classList.remove("active");
  }
}

function renderSlideDeckInfo() {
  const el = $("#slide-deck-info");
  if (!el) return;
  if (!slideDeck.count) {
    el.textContent = "No presentation loaded";
    return;
  }
  el.textContent = `${slideDeck.count} slides · ${slideDeck.fileName} (${slideDeck.fileType || "file"})`;
}

function renderSlidePicker() {
  const panel = $("#slide-picker-panel");
  const grid = $("#slide-picker-grid");
  const hint = $("#slide-picker-hint");
  if (!panel || !grid) return;

  if (!slideDeck.count) {
    panel.hidden = true;
    return;
  }

  panel.hidden = false;
  const pickIdx = state.pickingSlideForChapter;
  panel.classList.toggle("picking-open", pickIdx !== null);
  hint.textContent = pickIdx !== null
    ? `Wybierz slajd START dla chapteru ${pickIdx + 1} („${state.agenda.chapters[pickIdx]?.title}”)`
    : "Kliknij „Przypisz” przy chapterze, potem miniaturę tutaj";

  grid.innerHTML = slideDeck.slides
    .map(
      (s, i) => `
    <button type="button" class="slide-picker-thumb ${pickIdx !== null ? "picking-active" : ""}" data-slide="${i + 1}" title="${esc(s.name)}">
      <img src="${s.dataUrl}" alt="Slide ${i + 1}" loading="lazy" />
      <span>${i + 1}</span>
    </button>`
    )
    .join("");

  grid.querySelectorAll("[data-slide]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const slideNum = Number(btn.dataset.slide);
      if (state.pickingSlideForChapter === null) {
        showToast("Najpierw kliknij „Przypisz” przy wybranym chapterze");
        return;
      }
      const i = state.pickingSlideForChapter;
      state.agenda.chapters[i].slideStart = slideNum;
      if (state.agenda.chapters[i].slideEnd != null && state.agenda.chapters[i].slideEnd < slideNum) {
        state.agenda.chapters[i].slideEnd = null;
      }
      persist();
      state.pickingSlideForChapter = null;
      updateChapterSlideInputs(i);
      updatePickingSlideUI();
      renderSlidePicker();
      showToast(`Chapter ${i + 1} → slajd ${slideNum}`);
      document.querySelector(`.chapter-card[data-index="${i}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  });
}

function handleAgendaFiles(files) {
  if (!files?.length) return;
  const file = files[0];
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      state.agenda = parseAgendaFile(e.target.result, file.name);
      persist();
      renderEditor();
      showToast(`Imported "${file.name}"`);
    } catch (err) {
      showToast("Could not parse file: " + err.message);
    }
  };
  reader.readAsText(file);
}

function renderEditor() {
  $("#webinar-title").value = state.agenda.title;
  $("#total-time-value").textContent = formatDuration(totalDurationMinutes(state.agenda));

  const list = $("#chapters-list");
  if (!state.agenda.chapters.length) {
    list.innerHTML = `
      <div class="empty-state card card-body">
        <h3>No chapters yet</h3>
        <p>Add chapters manually, upload an agenda file, or load the sample.</p>
      </div>`;
    return;
  }

  list.innerHTML = state.agenda.chapters
    .map((ch, i) => {
      const hintText = getChapterSlideRangeHint(i);
      const picking = state.pickingSlideForChapter === i ? " picking-slide" : "";
      return `
    <div class="chapter-card${picking}" draggable="true" data-index="${i}">
      <div class="chapter-drag" title="Drag to reorder">
        <span class="chapter-index">${String(i + 1).padStart(2, "0")}</span>
        <span aria-hidden="true">⠿</span>
      </div>
      <div class="chapter-fields">
        <div>
          <label class="label">Chapter title</label>
          <input class="input chapter-title-input" data-field="title" data-index="${i}" value="${esc(ch.title)}" />
        </div>
        <div>
          <label class="label">Minutes</label>
          <input class="input chapter-min-input" type="number" min="1" max="180" data-field="durationMinutes" data-index="${i}" value="${ch.durationMinutes}" />
        </div>
        <div class="notes-field">
          <label class="label">Speaker notes</label>
          <textarea class="textarea chapter-notes-input" data-field="notes" data-index="${i}" rows="3">${esc(ch.notes)}</textarea>
        </div>
        <div class="slide-map-fields">
          <div>
            <label class="label">Slajd od</label>
            <input class="input chapter-slide-input" type="number" min="1" max="999" placeholder="Auto" data-field="slideStart" data-index="${i}" value="${ch.slideStart ?? ""}" />
          </div>
          <div>
            <label class="label">Slajd do</label>
            <input class="input chapter-slide-input" type="number" min="1" max="999" placeholder="Auto" data-field="slideEnd" data-index="${i}" value="${ch.slideEnd ?? ""}" />
          </div>
          <span class="field-hint-inline">${hintText}</span>
          <button type="button" class="btn btn-secondary btn-pick-slide" data-index="${i}" ${slideDeck.count ? "" : "disabled"}>Przypisz</button>
        </div>
      </div>
      <div class="chapter-actions">
        <button class="btn btn-ghost btn-icon btn-duplicate" data-index="${i}" title="Duplicate">⧉</button>
        <button class="btn btn-ghost btn-icon btn-delete" data-index="${i}" title="Delete">✕</button>
      </div>
    </div>`;
    })
    .join("");

  list.querySelectorAll(".chapter-title-input, .chapter-min-input, .chapter-notes-input, .chapter-slide-input").forEach((el) => {
    el.addEventListener("input", onChapterFieldChange);
  });

  list.querySelectorAll(".btn-pick-slide").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!slideDeck.count) {
        showToast("Najpierw wgraj prezentację (PPTX / PDF)");
        return;
      }
      const idx = Number(btn.dataset.index);
      state.pickingSlideForChapter = state.pickingSlideForChapter === idx ? null : idx;
      updatePickingSlideUI();
      renderSlidePicker();
      if (state.pickingSlideForChapter !== null) {
        const panel = $("#slide-picker-panel");
        panel?.scrollIntoView({ behavior: "smooth", block: "start" });
        showToast(`Chapter ${idx + 1}: wybierz miniaturę slajdu poniżej`);
      }
    });
  });

  list.querySelectorAll(".btn-delete").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.index);
      state.agenda.chapters.splice(i, 1);
      persist();
      renderEditor();
    });
  });

  list.querySelectorAll(".btn-duplicate").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.index);
      const src = state.agenda.chapters[i];
      const copy = {
        ...src,
        id: crypto.randomUUID(),
        slideStart: src.slideStart,
        slideEnd: src.slideEnd,
      };
      state.agenda.chapters.splice(i + 1, 0, copy);
      persist();
      renderEditor();
    });
  });

  bindDragReorder(list);
}

function onChapterFieldChange(e) {
  const i = Number(e.target.dataset.index);
  const field = e.target.dataset.field;
  let val = e.target.value;
  if (field === "durationMinutes") {
    val = Math.max(1, Number(val) || 1);
  } else if (field === "slideStart" || field === "slideEnd") {
    val = val === "" ? null : Math.max(1, Number(val) || 1);
  }
  state.agenda.chapters[i][field] = val;
  persist();
  if (field === "durationMinutes") {
    $("#total-time-value").textContent = formatDuration(totalDurationMinutes(state.agenda));
  }
  if (field === "slideStart" || field === "slideEnd") {
    updateChapterSlideHint(i);
  }
}

function bindDragReorder(list) {
  list.querySelectorAll(".chapter-card").forEach((card) => {
    card.addEventListener("dragstart", (e) => {
      state.dragIndex = Number(card.dataset.index);
      card.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      state.dragIndex = null;
    });
    card.addEventListener("dragover", (e) => {
      e.preventDefault();
      const target = Number(card.dataset.index);
      if (state.dragIndex === null || state.dragIndex === target) return;
      const chapters = state.agenda.chapters;
      const [moved] = chapters.splice(state.dragIndex, 1);
      chapters.splice(target, 0, moved);
      state.dragIndex = target;
      persist();
      renderEditor();
    });
  });
}

/* ── Slides ── */

function setSlideCounter(el, current1, total, range) {
  if (!el) return;
  if (!total || current1 == null) {
    el.textContent = "—";
    return;
  }
  let html = `<span class="slide-num-current">${current1}</span><span class="slide-num-sep"> / </span><span class="slide-num-total">${total}</span>`;
  if (range) {
    html += `<span class="slide-num-range"> · ${formatSlideRange(range.start, range.end)}</span>`;
  }
  el.innerHTML = html;
}

function setSlideImage(imgId, emptyId, slide) {
  const img = document.getElementById(imgId);
  if (!img) return;
  const empty = emptyId ? document.getElementById(emptyId) : null;

  if (slide) {
    img.src = slide.dataUrl;
    img.hidden = false;
    if (empty) empty.hidden = true;
  } else {
    img.removeAttribute("src");
    img.hidden = true;
    if (empty) {
      empty.hidden = false;
      if (emptyId === "slide-current-empty") {
        empty.textContent = slideDeck.count
          ? "—"
          : "No presentation — upload PDF or images in Agenda setup";
      }
    }
  }
}

function renderSlides() {
  const total = slideDeck.count;
  const i = slideDeck.slideIndex;
  const nextSlide = slideDeck.nextInChapter ?? slideDeck.next;
  const range = slideDeck.chapterRange;

  setSlideImage("slide-current", "slide-current-empty", slideDeck.current);
  setSlideCounter(
    document.getElementById("slide-current-num"),
    total ? i + 1 : null,
    total,
    range
  );
  setSlideImage("slide-next", "slide-next-empty", nextSlide);
  setSlideCounter(
    document.getElementById("slide-next-num"),
    nextSlide ? slideDeck.slides.indexOf(nextSlide) + 1 : null,
    total,
    null
  );
  setSlideImage("fs-slide-current", null, slideDeck.current);
  setSlideImage("fs-slide-next", null, nextSlide);

  updateSlidesVisibility();
}

/* ── Prompter ── */

function bindPrompter() {
  const playPause = () => {
    engine.toggle();
    notesScroller.setRunning(engine.running);
    if (engine.running && notesScroller.mode !== "off" && notesScroller.mode !== "timer") {
      notesScroller.startLoop();
    }
    updatePlayButton();
  };
  const next = () => {
    engine.cancelAdvance();
    engine.next();
    updatePlayButton();
  };
  const prev = () => {
    engine.cancelAdvance();
    engine.prev();
    updatePlayButton();
  };
  const reset = () => {
    engine.cancelAdvance();
    engine.resetChapterTimer();
    engine.pause();
    notesScroller.resetScroll();
    notesScroller.setRunning(false);
    updatePlayButton();
  };

  $("#btn-play-pause").addEventListener("click", playPause);
  $("#fs-btn-play-pause").addEventListener("click", playPause);
  $("#btn-next").addEventListener("click", next);
  $("#fs-btn-next").addEventListener("click", next);
  $("#btn-prev").addEventListener("click", prev);
  $("#fs-btn-prev").addEventListener("click", prev);
  $("#btn-reset-chapter").addEventListener("click", reset);
  $("#fs-btn-reset").addEventListener("click", reset);
  $("#btn-add-minute").addEventListener("click", () => engine.addTime(60));
  $("#fs-btn-add-minute").addEventListener("click", () => engine.addTime(60));

  $("#btn-slide-prev").addEventListener("click", () => slideDeck.prevSlide());
  $("#btn-slide-next").addEventListener("click", () => slideDeck.nextSlide());

  const scrollNotes = (delta) => notesScroller.scrollBy(delta);
  $("#btn-notes-up").addEventListener("click", () => scrollNotes(-120));
  $("#btn-notes-down").addEventListener("click", () => scrollNotes(120));
  $("#fs-btn-notes-up").addEventListener("click", () => scrollNotes(-120));
  $("#fs-btn-notes-down").addEventListener("click", () => scrollNotes(120));

  $("#btn-notes-scroll-reset").addEventListener("click", () => {
    notesScroller.resetScroll();
    showToast("Notes scroll reset");
  });

  $("#notes-scroll-mode").addEventListener("change", (e) => {
    notesScroller.setMode(e.target.value);
    saveScrollMode(e.target.value);
    if (engine.running && e.target.value !== "off" && e.target.value !== "timer") {
      notesScroller.startLoop();
    }
  });

  $("#show-slides").addEventListener("change", (e) => {
    slideDeck.showSlides = e.target.checked;
    savePrompterSettings({ showSlides: e.target.checked });
    updateSlidesVisibility();
  });

  $("#sync-slides-chapters").addEventListener("change", (e) => {
    slideDeck.syncWithChapters = e.target.checked;
    savePrompterSettings({ syncSlidesChapters: e.target.checked });
    if (e.target.checked) slideDeck.syncToChapter(engine.chapterIndex, state.agenda.chapters);
  });

  $("#btn-fullscreen").addEventListener("click", toggleFullscreen);
  $("#btn-exit-fullscreen").addEventListener("click", () => setFullscreen(false));

  $("#auto-advance").addEventListener("change", (e) => {
    engine.autoAdvance = e.target.checked;
  });

  $("#advance-delay").addEventListener("change", (e) => {
    engine.advanceDelaySec = Number(e.target.value) || 3;
  });

  $("#advance-cancel").addEventListener("click", () => {
    engine.cancelAdvance();
    engine.pause();
    notesScroller.setRunning(false);
    updatePlayButton();
  });
}

function updatePlayButton() {
  const label = engine.getState().running ? "Pause" : "Start";
  document.querySelectorAll(".btn-play-pause, #btn-play-pause, #fs-btn-play-pause").forEach((btn) => {
    btn.textContent = label;
  });
}

function renderPrompter() {
  const tick = engine.getState();
  const ch = engine.currentChapter;
  const chapters = state.agenda.chapters;

  if (!chapters.length) {
    $("#prompter-empty").style.display = "block";
    $("#prompter-content").style.display = "none";
    return;
  }

  $("#prompter-empty").style.display = "none";
  $("#prompter-content").style.display = "grid";

  const idx = tick.chapterIndex ?? engine.chapterIndex;
  if (idx !== state.lastChapterIndex) onChapterChanged(idx);

  const remaining = engine.remainingSec;
  const duration = engine.chapterDurationSec;
  const chapterProg = engine.chapterProgress;
  const overallProg = engine.overallProgress;

  $("#prompter-webinar-title").textContent = state.agenda.title;
  $("#chapter-number").textContent = `Chapter ${idx + 1} of ${chapters.length}`;
  $("#chapter-title-display").textContent = ch?.title ?? "—";

  const timerEl = $("#timer-display");
  timerEl.textContent = formatTimerDisplay(remaining);
  timerEl.classList.toggle("warning", remaining > 0 && remaining <= 60);
  timerEl.classList.toggle("critical", remaining > 0 && remaining <= 15);

  $("#timer-planned").textContent = `/ ${formatTimerDisplay(duration)} planned`;

  $("#chapter-progress-fill").style.width = `${chapterProg * 100}%`;
  $("#overall-progress-fill").style.width = `${overallProg * 100}%`;
  $("#chapter-progress-label").textContent = `${Math.round(chapterProg * 100)}%`;
  $("#overall-progress-label").textContent = `${Math.round(overallProg * 100)}%`;

  const notesText = ch?.notes?.trim() || "No notes for this chapter.";
  const notesEl = $("#notes-content");
  notesEl.textContent = notesText;
  notesEl.classList.toggle("empty", !ch?.notes?.trim());

  notesScroller.syncToProgress(chapterProg);
  notesScroller.setRunning(engine.running);

  const running = engine.getState().running;
  document.body.classList.toggle("progress-running", running);
  $("#prompter-content")?.classList.toggle("progress-running", running);
  $("#prompter-fullscreen")?.classList.toggle("progress-running", running);

  if (engine.running && notesScroller.mode !== "off" && notesScroller.mode !== "timer") {
    notesScroller.startLoop();
  }

  renderOutline(idx);
  slideDeck.setContext(state.agenda.chapters, idx);
  renderSlides();
  updatePlayButton();

  const fs = $("#prompter-fullscreen");
  if (fs.classList.contains("active")) {
    $("#fs-chapter-number").textContent = `Chapter ${idx + 1} of ${chapters.length}`;
    $("#fs-chapter-title").textContent = ch?.title ?? "";
    const fsTimer = $("#fs-timer");
    fsTimer.textContent = formatTimerDisplay(remaining);
    fsTimer.classList.toggle("warning", remaining > 0 && remaining <= 60);
    fsTimer.classList.toggle("critical", remaining > 0 && remaining <= 15);
    const fsNotes = $("#fs-notes");
    fsNotes.textContent = notesText;
    fsNotes.classList.toggle("empty", !ch?.notes?.trim());
    $("#fs-progress-fill").style.width = `${chapterProg * 100}%`;
  }
}

function formatTimerDisplay(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function renderOutline(currentIdx) {
  const outline = $("#agenda-outline");
  outline.innerHTML = state.agenda.chapters
    .map((ch, i) => {
      let cls = "outline-item";
      if (i === currentIdx) cls += " current";
      else if (i < currentIdx) cls += " done";
      return `
      <div class="${cls}" data-goto="${i}">
        <span class="outline-num">${String(i + 1).padStart(2, "0")}</span>
        <span class="title">${esc(ch.title)}</span>
        <span class="time">${ch.durationMinutes}m</span>
        ${i < currentIdx ? '<span class="badge badge-done">✓</span>' : i === currentIdx ? '<span class="badge badge-active">NOW</span>' : ""}
      </div>`;
    })
    .join("");

  outline.querySelectorAll("[data-goto]").forEach((el) => {
    el.addEventListener("click", () => {
      engine.cancelAdvance();
      engine.goTo(Number(el.dataset.goto));
      state.lastChapterIndex = -1;
      renderPrompter();
    });
  });
}

function toggleFullscreen() {
  setFullscreen(!$("#prompter-fullscreen").classList.contains("active"));
}

function setFullscreen(on) {
  const fs = $("#prompter-fullscreen");
  fs.classList.toggle("active", on);
  if (on) renderPrompter();
}

function bindKeyboard() {
  document.addEventListener("keydown", (e) => {
    if (state.view !== "prompter") return;
    if (e.target.matches("input, textarea, select")) return;

    switch (e.code) {
      case "Space":
        e.preventDefault();
        engine.toggle();
        notesScroller.setRunning(engine.running);
        if (engine.running && notesScroller.mode !== "off" && notesScroller.mode !== "timer") {
          notesScroller.startLoop();
        }
        updatePlayButton();
        break;
      case "ArrowRight":
        if (e.shiftKey) {
          slideDeck.nextSlide();
        } else {
          engine.cancelAdvance();
          engine.next();
          updatePlayButton();
        }
        break;
      case "ArrowLeft":
        if (e.shiftKey) {
          slideDeck.prevSlide();
        } else {
          engine.cancelAdvance();
          engine.prev();
          updatePlayButton();
        }
        break;
      case "PageDown":
        e.preventDefault();
        slideDeck.nextSlide();
        break;
      case "PageUp":
        e.preventDefault();
        slideDeck.prevSlide();
        break;
      case "ArrowDown":
        e.preventDefault();
        notesScroller.scrollBy(80);
        break;
      case "ArrowUp":
        e.preventDefault();
        notesScroller.scrollBy(-80);
        break;
      case "KeyR":
        engine.resetChapterTimer();
        notesScroller.resetScroll();
        break;
      case "KeyF":
        toggleFullscreen();
        break;
      case "Escape":
        setFullscreen(false);
        engine.cancelAdvance();
        break;
    }
  });
}

function esc(str) {
  const d = document.createElement("div");
  d.textContent = str ?? "";
  return d.innerHTML;
}

document.addEventListener("DOMContentLoaded", init);
