# Xelto Webinar Prompter

A browser-based **webinar teleprompter** for recording sessions. Plan your agenda with timed chapters, speaker notes, and a live countdown that auto-advances to the next point.

Built with the **Xelto design system** (navy + orange palette, clean enterprise UI).

## Features

- **Agenda editor** — add chapters with title, duration (minutes), and speaker notes
- **File import** — upload `.json`, `.md`, or `.txt` agendas
- **Live prompter** — large countdown timer, chapter progress bar, overall webinar progress
- **Auto-advance** — when a chapter timer ends, countdown then moves to the next point
- **Fullscreen mode** — distraction-free view for recording
- **Keyboard shortcuts** — Space (play/pause), ←/→ (prev/next), R (reset), F (fullscreen)
- **Persistence** — agenda saved automatically in browser localStorage

## Quick start

Serve the folder locally (ES modules require HTTP):

```bash
python3 -m http.server 8080
```

Open [http://localhost:8080](http://localhost:8080)

Or open `index.html` via any static file server.

1. Click **Load sample** or upload `sample-agenda.md`
2. Edit chapters and times as needed
3. Click **Start prompter** and hit **Start** to begin the countdown

## Import formats

### Markdown

```markdown
# My Webinar

## Intro - 4 min
Welcome everyone...

## Main topic - 10 min
Key talking points here.
```

### JSON

```json
{
  "title": "My Webinar",
  "chapters": [
    { "title": "Intro", "durationMinutes": 4, "notes": "Welcome..." }
  ]
}
```

## Customizing Xelto brand tokens

Edit CSS variables in `css/xelto.css` to match your official brand guide (e.g. from Xelto Docs). Replace `--xelto-orange-500`, `--xelto-navy-800`, etc.

## Project structure

```
index.html          Main app
css/xelto.css       Design system tokens & components
css/app.css         Layout & prompter styles
js/agenda.js        Agenda model, import/export, parsing
js/prompter.js      Timer engine & auto-advance logic
js/app.js           UI controller
sample-agenda.md    Example agenda file
```
