/** Chapter ↔ slide mapping helpers (1-based slide numbers in UI, 0-based internally) */

export function parseSlideNum(val) {
  if (val === null || val === undefined || val === "") return null;
  const n = Number(val);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null;
}

export function resolveChapterSlideRange(chapters, chapterIndex, slideCount) {
  if (!slideCount) return { start: 0, end: 0 };

  const ch = chapters[chapterIndex] ?? {};
  const start1 = parseSlideNum(ch.slideStart);
  let start = start1 !== null ? start1 - 1 : chapterIndex;

  let end;
  const end1 = parseSlideNum(ch.slideEnd);
  if (end1 !== null) {
    end = end1 - 1;
  } else {
    end = slideCount - 1;
    for (let j = chapterIndex + 1; j < chapters.length; j++) {
      const nextStart = parseSlideNum(chapters[j].slideStart);
      if (nextStart !== null) {
        end = nextStart - 2;
        break;
      }
    }
  }

  start = Math.max(0, Math.min(start, slideCount - 1));
  end = Math.max(start, Math.min(end, slideCount - 1));
  return { start, end };
}

export function chapterUsesExplicitSlides(chapters, chapterIndex) {
  const ch = chapters[chapterIndex];
  return parseSlideNum(ch?.slideStart) !== null || parseSlideNum(ch?.slideEnd) !== null;
}

export function anyChapterHasSlideMap(chapters) {
  return chapters.some((ch) => parseSlideNum(ch.slideStart) !== null || parseSlideNum(ch.slideEnd) !== null);
}

export function formatSlideRange(start, end) {
  if (start === end) return `${start + 1}`;
  return `${start + 1}–${end + 1}`;
}
