# Xelto Webinar Prompter

Przeglądarkowy **teleprompter do webinarów** — edytor agendy z rozdziałami, notatkami prelegenta i licznikiem na żywo z auto-przejściem do kolejnego punktu.

**Demo (GitHub Pages):** [https://mikzielinski.github.io/webinarTool/](https://mikzielinski.github.io/webinarTool/)

> Aplikacja działa w całości w przeglądarce — bez serwera i bez wysyłania danych na zewnątrz.

## Funkcje

- **Edytor agendy** — rozdziały z tytułem, czasem (minuty) i notatkami
- **Import plików** — JSON, Markdown lub zwykły tekst
- **Szablony do pobrania** — przyciski „Szablon MD ↓” i „Szablon JSON ↓” w edytorze
- **Live prompter** — duży timer, pasek postępu rozdziału i całego webinaru
- **Auto-advance** — po upływie czasu rozdziału odliczanie i przejście dalej
- **Tryb pełnoekranowy** — widok pod nagrywanie
- **Skróty klawiszowe** — Space, strzałki, PgUp/PgDn, R, F (szczegóły w aplikacji)

### Slajdy (eksperymentalne)

Można wgrywać **PPTX**, PDF lub obrazy i przypisywać zakresy slajdów do rozdziałów.

**Uwaga:** obsługa slajdów (szczególnie PPTX) jest wciąż **eksperymentalna** — renderowanie może być wolne, a podgląd nie zawsze odwzorowuje oryginał 1:1. Do stabilnej pracy wystarczy sama agenda i notatki; slajdy traktuj jako dodatek.

## Prywatność i wiele osób naraz

Strona jest statyczna (GitHub Pages) — **nie ma backendu**. Agenda, ustawienia i slajdy zapisują się tylko lokalnie w Twojej przeglądarce.

Każda **karta przeglądarki** dostaje własny identyfikator sesji (`Sesja` w nagłówku). Dzięki temu kilka osób może korzystać z tej samej strony jednocześnie — **nie widzą nawzajem swoich agend ani prezentacji**. Dane jednej karty nie mieszają się z drugą.

Przycisk **„Nowa sesja”** odłącza bieżącą kartę od dotychczasowej agendy i zaczyna od pustego stanu (stare dane pozostają w przeglądarce pod starym ID, ale ta karta ich nie odczyta).

## Szybki start

### Online

Wejdź na [https://mikzielinski.github.io/webinarTool/](https://mikzielinski.github.io/webinarTool/)

### Lokalnie

Moduły ES wymagają serwera HTTP:

```bash
python3 scripts/dev-server.py
```

Otwórz [http://localhost:8080](http://localhost:8080)

### Przygotowanie agendy

1. Pobierz **szablon MD** lub **JSON** z paska narzędzi (albo skorzystaj z plików w `templates/`).
2. Uzupełnij tytuł webinaru, rozdziały i notatki.
3. Wgraj plik przez **„Wgraj agendę”** lub użyj **Test agenda** / **Full demo**.
4. Kliknij **Start prompter →** i uruchom licznik.

## Format importu

### Markdown

```markdown
# Mój webinar

## Wprowadzenie — 4 min
Powitanie uczestników...

## Główny temat — 10 min
Kluczowe punkty do omówienia.
```

Nagłówki `## Tytuł — X min` (myślnik lub myślnik półpauza). Notatki pod nagłówkiem.

### JSON

```json
{
  "title": "Mój webinar",
  "chapters": [
    {
      "title": "Wprowadzenie",
      "durationMinutes": 4,
      "notes": "Powitanie...",
      "slideStart": null,
      "slideEnd": null
    }
  ]
}
```

## GitHub Pages

Wdrożenie odbywa się automatycznie z gałęzi `main` (workflow `.github/workflows/pages.yml`).

W repozytorium włącz **Settings → Pages → Source: GitHub Actions**, jeśli jeszcze nie jest aktywne.

## Struktura projektu

```
index.html              Aplikacja
css/                    Style (Xelto + layout)
js/
  agenda.js             Model agendy, import/export, szablony
  workspace.js          Izolacja sesji per karta
  prompter.js           Silnik timera
  slides.js             Deck slajdów
  pptx-loader.js        Render PPTX (eksperymentalny)
  app.js                UI
templates/              Szablony agendy MD i JSON
brand/                  Logo i tokeny marki (do Pages)
sample-agenda.md        Przykładowa agenda
```

## Licencja

Projekt wewnętrzny Xelto — dostosuj licencję według potrzeb organizacji.
