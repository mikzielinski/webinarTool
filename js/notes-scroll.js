/** Auto-scroll speaker notes — manual wheel + timer-sync or fixed speed */
export class NotesScroller {
  constructor(getContainers) {
    this.getContainers = getContainers;
    this.mode = "timer"; // off | timer | slow | medium | fast
    this.running = false;
    this.userScrolled = false;
    this.rafId = null;
    this.lastTs = 0;
    this.speedPxSec = { slow: 28, medium: 52, fast: 88 };
    this._onWheel = this._onWheel.bind(this);
  }

  attach() {
    this.getContainers().forEach((el) => {
      if (el && !el.dataset.scrollBound) {
        el.dataset.scrollBound = "1";
        el.addEventListener("wheel", this._onWheel, { passive: true });
        el.addEventListener("touchmove", this._onWheel, { passive: true });
      }
    });
  }

  _onWheel() {
    if (this.mode !== "off") this.userScrolled = true;
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === "off") this.stopLoop();
    this.userScrolled = false;
  }

  setRunning(running) {
    this.running = running;
    if (!running) this.stopLoop();
    else if (this.mode !== "off" && this.mode !== "timer") this.startLoop();
  }

  resetScroll() {
    this.userScrolled = false;
    this.getContainers().forEach((el) => {
      if (el) el.scrollTop = 0;
    });
  }

  /** Sync scroll position to chapter timer progress 0–1 */
  syncToProgress(progress) {
    if (this.mode !== "timer" || this.userScrolled) return;
    this.getContainers().forEach((el) => {
      if (!el) return;
      const max = Math.max(0, el.scrollHeight - el.clientHeight);
      el.scrollTop = max * Math.min(1, Math.max(0, progress));
    });
  }

  scrollBy(delta) {
    this.userScrolled = true;
    this.getContainers().forEach((el) => {
      if (el) el.scrollTop += delta;
    });
  }

  startLoop() {
    this.stopLoop();
    this.lastTs = performance.now();
    const tick = (ts) => {
      if (!this.running || this.userScrolled || this.mode === "off" || this.mode === "timer") {
        this.rafId = null;
        return;
      }
      const dt = (ts - this.lastTs) / 1000;
      this.lastTs = ts;
      const px = (this.speedPxSec[this.mode] ?? 52) * dt;
      this.getContainers().forEach((el) => {
        if (!el) return;
        const max = el.scrollHeight - el.clientHeight;
        if (el.scrollTop < max) el.scrollTop = Math.min(max, el.scrollTop + px);
      });
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stopLoop() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}

import { storageKey } from "./workspace.js";

function scrollModeKey() {
  return storageKey("notes-scroll-mode");
}

function prompterSettingsKey() {
  return storageKey("prompter-settings");
}

export function loadScrollMode() {
  return localStorage.getItem(scrollModeKey()) || "timer";
}

export function saveScrollMode(mode) {
  localStorage.setItem(scrollModeKey(), mode);
}

export function loadPrompterSettings() {
  try {
    return JSON.parse(localStorage.getItem(prompterSettingsKey()) || "{}");
  } catch {
    return {};
  }
}

export function savePrompterSettings(partial) {
  const cur = loadPrompterSettings();
  localStorage.setItem(prompterSettingsKey(), JSON.stringify({ ...cur, ...partial }));
}
