import { formatTimer } from "./agenda.js";

export class PrompterEngine {
  constructor(options = {}) {
    this.onTick = options.onTick || (() => {});
    this.onChapterEnd = options.onChapterEnd || (() => {});
    this.onComplete = options.onComplete || (() => {});
    this.autoAdvance = options.autoAdvance ?? true;
    this.advanceDelaySec = options.advanceDelaySec ?? 3;

    this.agenda = null;
    this.chapterIndex = 0;
    this.remainingSec = 0;
    this.chapterDurationSec = 0;
    this.running = false;
    this.paused = false;
    this.intervalId = null;
    this.advanceTimeoutId = null;
    this.advanceCountdownIntervalId = null;
    this.advanceRemaining = 0;
  }

  load(agenda, startIndex = 0) {
    this.stop();
    this.agenda = agenda;
    this.chapterIndex = Math.min(startIndex, Math.max(0, agenda.chapters.length - 1));
    this.resetChapterTimer();
  }

  get currentChapter() {
    return this.agenda?.chapters[this.chapterIndex] ?? null;
  }

  get chapterProgress() {
    if (!this.chapterDurationSec) return 0;
    const elapsed = this.chapterDurationSec - this.remainingSec;
    return Math.min(1, Math.max(0, elapsed / this.chapterDurationSec));
  }

  get overallProgress() {
    if (!this.agenda?.chapters.length) return 0;
    const chapters = this.agenda.chapters;
    let totalSec = 0;
    let elapsedSec = 0;

    chapters.forEach((ch, i) => {
      const dur = (Number(ch.durationMinutes) || 0) * 60;
      totalSec += dur;
      if (i < this.chapterIndex) elapsedSec += dur;
      else if (i === this.chapterIndex) elapsedSec += dur - this.remainingSec;
    });

    return totalSec ? Math.min(1, elapsedSec / totalSec) : 0;
  }

  get isLastChapter() {
    return this.chapterIndex >= (this.agenda?.chapters.length ?? 0) - 1;
  }

  get isFinished() {
    return this.isLastChapter && this.remainingSec <= 0 && !this.running;
  }

  resetChapterTimer() {
    const ch = this.currentChapter;
    this.chapterDurationSec = (Number(ch?.durationMinutes) || 0) * 60;
    this.remainingSec = this.chapterDurationSec;
    this.emitTick();
  }

  start() {
    if (!this.agenda?.chapters.length) return;
    if (this.remainingSec <= 0 && !this.isLastChapter) {
      this.next();
      return;
    }
    if (this.remainingSec <= 0 && this.isLastChapter) {
      this.resetChapterTimer();
    }
    this.running = true;
    this.paused = false;
    this.tickLoop();
  }

  pause() {
    this.running = false;
    this.paused = true;
    this.clearInterval();
  }

  toggle() {
    if (this.running) this.pause();
    else this.start();
  }

  stop() {
    this.running = false;
    this.paused = false;
    this.clearInterval();
    this.clearAdvanceTimers();
  }

  next() {
    this.clearAdvanceTimers();
    if (!this.agenda) return false;
    if (this.chapterIndex < this.agenda.chapters.length - 1) {
      this.chapterIndex++;
      this.resetChapterTimer();
      if (this.running) this.tickLoop();
      else this.emitTick();
      return true;
    }
    this.running = false;
    this.clearInterval();
    this.remainingSec = 0;
    this.emitTick();
    this.onComplete();
    return false;
  }

  prev() {
    this.clearAdvanceTimers();
    if (this.chapterIndex > 0) {
      this.chapterIndex--;
      this.resetChapterTimer();
      if (this.running) this.tickLoop();
      else this.emitTick();
      return true;
    }
    return false;
  }

  goTo(index) {
    this.clearAdvanceTimers();
    if (!this.agenda || index < 0 || index >= this.agenda.chapters.length) return;
    this.chapterIndex = index;
    this.resetChapterTimer();
  }

  addTime(seconds) {
    this.remainingSec = Math.max(0, this.remainingSec + seconds);
    this.emitTick();
  }

  tickLoop() {
    this.clearInterval();
    this.intervalId = setInterval(() => this.tick(), 1000);
  }

  tick() {
    if (this.remainingSec > 0) {
      this.remainingSec--;
      this.emitTick();
      if (this.remainingSec <= 0) {
        this.onChapterEnd(this.chapterIndex);
        if (this.autoAdvance && !this.isLastChapter) {
          this.scheduleAdvance();
        } else {
          this.running = false;
          this.clearInterval();
          if (this.isLastChapter) this.onComplete();
        }
      }
    }
  }

  scheduleAdvance() {
    this.running = false;
    this.clearInterval();
    this.advanceRemaining = this.advanceDelaySec;
    this.onAdvanceCountdown?.(this.advanceRemaining);

    this.advanceCountdownIntervalId = setInterval(() => {
      this.advanceRemaining--;
      this.onAdvanceCountdown?.(this.advanceRemaining);
      if (this.advanceRemaining <= 0) {
        clearInterval(this.advanceCountdownIntervalId);
        this.advanceCountdownIntervalId = null;
      }
    }, 1000);

    this.advanceTimeoutId = setTimeout(() => {
      this.clearAdvanceTimers();
      this.next();
      this.start();
    }, this.advanceDelaySec * 1000);
  }

  cancelAdvance() {
    this.clearAdvanceTimers();
    this.emitTick();
  }

  clearAdvanceTimers() {
    if (this.advanceTimeoutId) {
      clearTimeout(this.advanceTimeoutId);
      this.advanceTimeoutId = null;
    }
    if (this.advanceCountdownIntervalId) {
      clearInterval(this.advanceCountdownIntervalId);
      this.advanceCountdownIntervalId = null;
    }
    this.advanceRemaining = 0;
    this.onAdvanceCountdown?.(0);
  }

  clearInterval() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  emitTick() {
    this.onTick({
      chapterIndex: this.chapterIndex,
      chapter: this.currentChapter,
      remainingSec: this.remainingSec,
      chapterDurationSec: this.chapterDurationSec,
      chapterProgress: this.chapterProgress,
      overallProgress: this.overallProgress,
      running: this.running,
      paused: this.paused,
      timerLabel: formatTimer(this.remainingSec),
      isLastChapter: this.isLastChapter,
      isFinished: this.isFinished,
    });
  }

  getState() {
    return {
      chapterIndex: this.chapterIndex,
      remainingSec: this.remainingSec,
      running: this.running,
      paused: this.paused,
      chapterProgress: this.chapterProgress,
      overallProgress: this.overallProgress,
    };
  }
}
