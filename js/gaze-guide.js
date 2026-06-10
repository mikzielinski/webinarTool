import { loadPrompterSettings, savePrompterSettings } from "./notes-scroll.js";

const DEFAULTS = {
  gazeGuideEnabled: false,
  gazeGuideX: 50,
  gazeGuideY: 18,
  gazeGuideSize: 36,
  gazeGuideOpacity: 0.72,
};

let adjustMode = false;
let dragging = false;
let dragOffset = { x: 0, y: 0 };

export function getGazeGuideSettings() {
  const s = loadPrompterSettings();
  return {
    enabled: s.gazeGuideEnabled === true,
    x: clampNum(s.gazeGuideX, DEFAULTS.gazeGuideX, 2, 98),
    y: clampNum(s.gazeGuideY, DEFAULTS.gazeGuideY, 2, 98),
    size: clampNum(s.gazeGuideSize, DEFAULTS.gazeGuideSize, 20, 72),
    opacity: clampNum(s.gazeGuideOpacity, DEFAULTS.gazeGuideOpacity, 0.2, 1),
  };
}

export function saveGazeGuideSettings(partial) {
  savePrompterSettings(partial);
}

export function isGazeAdjustMode() {
  return adjustMode;
}

export function setGazeAdjustMode(on) {
  adjustMode = !!on;
  const el = document.getElementById("gaze-guide");
  el?.classList.toggle("gaze-guide--adjust", adjustMode);
  document.body.classList.toggle("gaze-adjust-mode", adjustMode);
}

export function applyGazeGuideUI() {
  const s = getGazeGuideSettings();
  const el = document.getElementById("gaze-guide");
  if (!el) return;

  el.hidden = !s.enabled;
  el.style.setProperty("--gaze-x", `${s.x}%`);
  el.style.setProperty("--gaze-y", `${s.y}%`);
  el.style.setProperty("--gaze-size", `${s.size}px`);
  el.style.setProperty("--gaze-opacity", String(s.opacity));

  const enabled = document.getElementById("gaze-guide-enabled");
  const size = document.getElementById("gaze-guide-size");
  const opacity = document.getElementById("gaze-guide-opacity");
  const xVal = document.getElementById("gaze-guide-x-val");
  const yVal = document.getElementById("gaze-guide-y-val");
  const adjustBtn = document.getElementById("btn-gaze-adjust");

  if (enabled) enabled.checked = s.enabled;
  if (size) size.value = String(s.size);
  if (opacity) opacity.value = String(Math.round(s.opacity * 100));
  if (xVal) xVal.textContent = `${Math.round(s.x)}%`;
  if (yVal) yVal.textContent = `${Math.round(s.y)}%`;
  if (adjustBtn) {
    adjustBtn.classList.toggle("active", adjustMode);
    adjustBtn.setAttribute("aria-pressed", adjustMode ? "true" : "false");
  }

  el.classList.toggle("gaze-guide--adjust", adjustMode);
  document.body.classList.toggle("gaze-adjust-mode", adjustMode);
}

export function bindGazeGuide({ onToast }) {
  const el = document.getElementById("gaze-guide");
  if (!el) return;

  document.getElementById("gaze-guide-enabled")?.addEventListener("change", (e) => {
    saveGazeGuideSettings({ gazeGuideEnabled: e.target.checked });
    applyGazeGuideUI();
    onToast?.(e.target.checked ? "Celownik włączony" : "Celownik wyłączony");
  });

  document.getElementById("gaze-guide-size")?.addEventListener("input", (e) => {
    saveGazeGuideSettings({ gazeGuideSize: Number(e.target.value) });
    applyGazeGuideUI();
  });

  document.getElementById("gaze-guide-opacity")?.addEventListener("input", (e) => {
    saveGazeGuideSettings({ gazeGuideOpacity: Number(e.target.value) / 100 });
    applyGazeGuideUI();
  });

  document.getElementById("btn-gaze-adjust")?.addEventListener("click", () => {
    const s = getGazeGuideSettings();
    if (!s.enabled) {
      saveGazeGuideSettings({ gazeGuideEnabled: true });
      applyGazeGuideUI();
    }
    setGazeAdjustMode(!adjustMode);
    applyGazeGuideUI();
    onToast?.(
      adjustMode
        ? "Przeciągnij celownik lub użyj strzałek — Esc kończy"
        : "Tryb ustawiania wyłączony"
    );
  });

  document.getElementById("btn-gaze-reset")?.addEventListener("click", () => {
    saveGazeGuideSettings({
      gazeGuideX: DEFAULTS.gazeGuideX,
      gazeGuideY: DEFAULTS.gazeGuideY,
      gazeGuideSize: DEFAULTS.gazeGuideSize,
      gazeGuideOpacity: DEFAULTS.gazeGuideOpacity,
    });
    applyGazeGuideUI();
    onToast?.("Przywrócono domyślną pozycję celownika");
  });

  el.addEventListener("pointerdown", (e) => {
    if (!adjustMode) return;
    dragging = true;
    const rect = el.getBoundingClientRect();
    dragOffset.x = e.clientX - (rect.left + rect.width / 2);
    dragOffset.y = e.clientY - (rect.top + rect.height / 2);
    el.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  el.addEventListener("pointermove", (e) => {
    if (!adjustMode || !dragging) return;
    setPositionFromClient(e.clientX - dragOffset.x, e.clientY - dragOffset.y);
  });

  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    try {
      el.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };
  el.addEventListener("pointerup", endDrag);
  el.addEventListener("pointercancel", endDrag);

  document.addEventListener("keydown", (e) => {
    if (!adjustMode || e.target.matches("input, textarea, select")) return;
    const step = e.shiftKey ? 2 : 0.5;
    const s = getGazeGuideSettings();
    let { x, y } = s;
    let moved = false;
    switch (e.code) {
      case "ArrowLeft":
        x -= step;
        moved = true;
        break;
      case "ArrowRight":
        x += step;
        moved = true;
        break;
      case "ArrowUp":
        y -= step;
        moved = true;
        break;
      case "ArrowDown":
        y += step;
        moved = true;
        break;
      case "Escape":
        setGazeAdjustMode(false);
        applyGazeGuideUI();
        onToast?.("Tryb ustawiania wyłączony");
        return;
      default:
        return;
    }
    if (moved) {
      e.preventDefault();
      saveGazeGuideSettings({
        gazeGuideX: clampNum(x, DEFAULTS.gazeGuideX, 2, 98),
        gazeGuideY: clampNum(y, DEFAULTS.gazeGuideY, 2, 98),
      });
      applyGazeGuideUI();
    }
  });
}

function setPositionFromClient(cx, cy) {
  const x = clampNum((cx / window.innerWidth) * 100, 50, 2, 98);
  const y = clampNum((cy / window.innerHeight) * 100, 50, 2, 98);
  saveGazeGuideSettings({ gazeGuideX: x, gazeGuideY: y });
  applyGazeGuideUI();
}

function clampNum(val, fallback, min, max) {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
