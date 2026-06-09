import {
  createChapter,
  createEmptyAgenda,
  exportAgendaJson,
  formatDuration,
  loadAgenda,
  parseAgendaFile,
  sampleAgenda,
  saveAgenda,
  totalDurationMinutes,
} from "./agenda.js";
import { PrompterEngine } from "./prompter.js";

const state = {
  agenda: loadAgenda(),
  view: "editor",
  dragIndex: null,
};

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

function init() {
  bindNavigation();
  bindEditor();
  bindPrompter();
  bindKeyboard();
  renderEditor();
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
    engine.load(state.agenda);
    renderPrompter();
  } else {
    document.body.classList.remove("prompter-theme");
    engine.stop();
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
    state.agenda = sampleAgenda();
    persist();
    renderEditor();
    showToast("Sample agenda loaded");
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

  zone.addEventListener("click", () => input.click());
  input.addEventListener("change", (e) => handleFiles(e.target.files));

  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("dragover");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("dragover");
    handleFiles(e.dataTransfer.files);
  });
}

function handleFiles(files) {
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
    .map(
      (ch, i) => `
    <div class="chapter-card" draggable="true" data-index="${i}">
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
      </div>
      <div class="chapter-actions">
        <button class="btn btn-ghost btn-icon btn-duplicate" data-index="${i}" title="Duplicate">⧉</button>
        <button class="btn btn-ghost btn-icon btn-delete" data-index="${i}" title="Delete">✕</button>
      </div>
    </div>`
    )
    .join("");

  list.querySelectorAll(".chapter-title-input, .chapter-min-input, .chapter-notes-input").forEach((el) => {
    el.addEventListener("input", onChapterFieldChange);
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
      const copy = { ...state.agenda.chapters[i], id: crypto.randomUUID() };
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
  if (field === "durationMinutes") val = Math.max(1, Number(val) || 1);
  state.agenda.chapters[i][field] = val;
  persist();
  if (field === "durationMinutes") {
    $("#total-time-value").textContent = formatDuration(totalDurationMinutes(state.agenda));
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

/* ── Prompter ── */

function bindPrompter() {
  $("#btn-play-pause").addEventListener("click", () => {
    engine.toggle();
    updatePlayButton();
  });

  $("#btn-next").addEventListener("click", () => {
    engine.cancelAdvance();
    engine.next();
    updatePlayButton();
  });

  $("#btn-prev").addEventListener("click", () => {
    engine.cancelAdvance();
    engine.prev();
    updatePlayButton();
  });

  $("#btn-reset-chapter").addEventListener("click", () => {
    engine.cancelAdvance();
    engine.resetChapterTimer();
    engine.pause();
    updatePlayButton();
  });

  $("#btn-add-minute").addEventListener("click", () => engine.addTime(60));
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
    updatePlayButton();
  });
}

function updatePlayButton() {
  const btn = $("#btn-play-pause");
  const { running } = engine.getState();
  btn.textContent = running ? "Pause" : "Start";
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

  const notesEl = $("#notes-content");
  if (ch?.notes?.trim()) {
    notesEl.textContent = ch.notes;
    notesEl.classList.remove("empty");
  } else {
    notesEl.textContent = "No notes for this chapter.";
    notesEl.classList.add("empty");
  }

  renderOutline(idx);
  updatePlayButton();

  const fs = $("#prompter-fullscreen");
  if (fs.classList.contains("active")) {
    $("#fs-chapter-title").textContent = ch?.title ?? "";
    $("#fs-timer").textContent = formatTimerDisplay(remaining);
    $("#fs-notes").textContent = ch?.notes?.trim() || "No notes.";
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
        <span class="time">${ch.durationMinutes}m</span>
        <span class="title">${esc(ch.title)}</span>
        ${i < currentIdx ? '<span class="badge badge-done">✓</span>' : i === currentIdx ? '<span class="badge badge-active">NOW</span>' : ""}
      </div>`;
    })
    .join("");

  outline.querySelectorAll("[data-goto]").forEach((el) => {
    el.addEventListener("click", () => {
      engine.cancelAdvance();
      engine.goTo(Number(el.dataset.goto));
      renderPrompter();
    });
  });
}

function toggleFullscreen() {
  const fs = $("#prompter-fullscreen");
  setFullscreen(!fs.classList.contains("active"));
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
        updatePlayButton();
        break;
      case "ArrowRight":
        engine.cancelAdvance();
        engine.next();
        updatePlayButton();
        break;
      case "ArrowLeft":
        engine.cancelAdvance();
        engine.prev();
        updatePlayButton();
        break;
      case "KeyR":
        engine.resetChapterTimer();
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
