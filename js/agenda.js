const STORAGE_KEY = "xelto-webinar-agenda";

export function createEmptyAgenda() {
  return {
    title: "Untitled Webinar",
    chapters: [],
  };
}

export function createChapter(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    title: "New chapter",
    durationMinutes: 5,
    notes: "",
    ...overrides,
  };
}

export function totalDurationMinutes(agenda) {
  return agenda.chapters.reduce((sum, ch) => sum + (Number(ch.durationMinutes) || 0), 0);
}

export function formatDuration(minutes) {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m} min`;
}

export function formatTimer(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

export function saveAgenda(agenda) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(agenda));
}

export function loadAgenda() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createEmptyAgenda();
    const parsed = JSON.parse(raw);
    if (!parsed.chapters) parsed.chapters = [];
    return parsed;
  } catch {
    return createEmptyAgenda();
  }
}

export function exportAgendaJson(agenda) {
  const blob = new Blob([JSON.stringify(agenda, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slugify(agenda.title || "webinar")}-agenda.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "webinar";
}

const TIME_PATTERN = /(\d+)\s*(?:min|mins|minutes|m|min\.?)?/i;

export function parseAgendaFile(content, filename = "") {
  const ext = filename.split(".").pop()?.toLowerCase();

  if (ext === "json") {
    const data = JSON.parse(content);
    return normalizeAgenda(data);
  }

  if (ext === "md" || ext === "markdown" || ext === "txt") {
    return parseMarkdownAgenda(content);
  }

  try {
    return normalizeAgenda(JSON.parse(content));
  } catch {
    return parseMarkdownAgenda(content);
  }
}

function normalizeAgenda(data) {
  const agenda = createEmptyAgenda();
  agenda.title = data.title || data.name || "Imported Webinar";

  const chapters = data.chapters || data.sections || data.items || [];
  agenda.chapters = chapters.map((ch, i) =>
    createChapter({
      id: ch.id || crypto.randomUUID(),
      title: ch.title || ch.name || `Chapter ${i + 1}`,
      durationMinutes: Number(ch.durationMinutes ?? ch.duration ?? ch.minutes ?? 5) || 5,
      notes: ch.notes || ch.content || ch.description || "",
    })
  );

  return agenda;
}

function parseMarkdownAgenda(content) {
  const agenda = createEmptyAgenda();
  const lines = content.split(/\r?\n/);
  let titleSet = false;
  let current = null;

  for (const line of lines) {
    const h1 = line.match(/^#\s+(.+)/);
    if (h1 && !titleSet) {
      agenda.title = h1[1].trim();
      titleSet = true;
      continue;
    }

    const h2 = line.match(/^##\s+(.+)/);
    if (h2) {
      if (current) agenda.chapters.push(current);
      const { title, minutes } = parseHeadingWithTime(h2[1]);
      current = createChapter({ title, durationMinutes: minutes });
      continue;
    }

    if (current && line.trim()) {
      current.notes += (current.notes ? "\n" : "") + line.trim();
    }
  }

  if (current) agenda.chapters.push(current);

  if (!titleSet && agenda.chapters.length === 0) {
    return parsePlainTextAgenda(content);
  }

  return agenda;
}

function parseHeadingWithTime(text) {
  const parenMatch = text.match(/^(.+?)\s*[\(\[\-–—]\s*(\d+)\s*(?:min|mins|minutes|m)?\s*[\)\]]?\s*$/i);
  if (parenMatch) {
    return { title: parenMatch[1].trim(), minutes: Number(parenMatch[2]) || 5 };
  }

  const dashMatch = text.match(/^(.+?)\s*[-–—]\s*(\d+)\s*(?:min|mins|minutes|m)?\s*$/i);
  if (dashMatch) {
    return { title: dashMatch[1].trim(), minutes: Number(dashMatch[2]) || 5 };
  }

  const timeOnly = text.match(/(\d+)\s*(?:min|mins|minutes|m)\b/i);
  if (timeOnly) {
    const title = text.replace(timeOnly[0], "").replace(/[\(\)\[\]\-–—]/g, "").trim();
    return { title: title || text.trim(), minutes: Number(timeOnly[1]) || 5 };
  }

  return { title: text.trim(), minutes: 5 };
}

function parsePlainTextAgenda(content) {
  const agenda = createEmptyAgenda();
  const blocks = content.split(/\n\s*\n/);

  blocks.forEach((block, i) => {
    const lines = block.trim().split(/\r?\n/);
    if (!lines[0]) return;

    const first = lines[0];
    const timeMatch = first.match(TIME_PATTERN);
    let title = first;
    let minutes = 5;

    if (timeMatch) {
      minutes = Number(timeMatch[1]) || 5;
      title = first.replace(timeMatch[0], "").replace(/[\(\)\[\]\-–—:]/g, "").trim();
    }

    const notes = lines.slice(1).join("\n").trim();
    agenda.chapters.push(createChapter({ title: title || `Point ${i + 1}`, durationMinutes: minutes, notes }));
  });

  return agenda;
}

export function sampleAgenda() {
  return {
    title: "Product Demo Webinar",
    chapters: [
      createChapter({
        title: "Intro & welcome",
        durationMinutes: 4,
        notes: "Welcome attendees.\nIntroduce yourself and today's agenda.\nMention recording is in progress.",
      }),
      createChapter({
        title: "Problem statement",
        durationMinutes: 6,
        notes: "Describe the business challenge.\nShare customer pain points.\nSet context for the solution.",
      }),
      createChapter({
        title: "Live demo — core features",
        durationMinutes: 15,
        notes: "Show dashboard overview.\nWalk through key workflow.\nHighlight integration points.",
      }),
      createChapter({
        title: "Q&A",
        durationMinutes: 10,
        notes: "Open floor for questions.\nHave backup slides ready for common topics.",
      }),
      createChapter({
        title: "Closing & next steps",
        durationMinutes: 3,
        notes: "Summarize key takeaways.\nShare contact info and follow-up resources.\nThank everyone!",
      }),
    ],
  };
}
