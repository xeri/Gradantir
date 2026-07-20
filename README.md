# GRADE·EXCHANGE

A trading terminal for your grades. Subjects are listed like tickers; every exam,
test, assignment, and quiz is a print on the tape. Built for students who want an
unsentimental readout of where every subject is heading — and exactly what the next
result needs to be.

Static, single-page, no backend: all data lives in your browser's localStorage.
Opens with a seeded demo book so every panel works immediately; clear it from the
banner to trade your own subjects.

## The desk

- **Ticker tape** — every subject's latest score and move, plus the GX Composite, on loop.
- **Overview** — composite index with term history, top riser / under pressure, position cards with sparklines, and the **Wire**: auto-generated headlines that score each new result against the estimate that stood before it (`MATH 84.0 — BEATS EST 79.5 (+4.5)`), print all-time highs, flag volatility and target gaps.
- **Charts** — every subject on one board, grouped by assessment/month/term/semester/year, filterable by type, with 3-result smoothing, dashed trend-line forecasts, target lines, and a composite overlay. Switch to **Candles** for open/high/low/close per period, one subject at a time.
- **Compare** — radar overlay of any term vs any other, with a per-subject delta list.
- **Screener** — the whole book in one sortable table: last, change, term average, spread (σ), estimate ±, target gap, distance from all-time high, alpha vs class, print count.
- **Blotter** — every result, filterable, editable, with per-entry alpha.
- **Quote drawer** — click any subject: sparkline, spread, ATH, forecast, and the *what do I need?* calculator — pick a desired term average and the type of your next assessment, get the exact score required (weights included).
- **Weighted assessments** — exams can count more than quizzes (defaults: Exam ×3, Test ×2, Assignment ×1.5, Quiz ×1; fully configurable, or switch weighting off).
- **Alpha vs class** — optionally log the class average with any result to track your edge.
- **Import/export** — versioned JSON backup with validation and replace-or-merge import.
- **Command palette** — `Ctrl+K`. Tabs on `1–5`, new result on `N`.

## Run it

```sh
npm install
npm run dev        # dev server
npm test           # unit tests (all calculation libs)
npm run build      # type-check + production build → dist/
npm run preview    # serve the production build locally
```

## Deploy

The build uses relative asset paths (`base: "./"`), so `dist/` works from any
static host, including subpaths.

**GitHub Pages** — push to `main` with Pages set to "GitHub Actions" in the repo
settings; [.github/workflows/deploy.yml](.github/workflows/deploy.yml) tests,
builds, and deploys automatically.

**Cloudflare Pages** — create a Pages project from the repo with build command
`npm run build` and output directory `dist`. (Or `npx wrangler pages deploy dist`.)

Any other static host: upload `dist/`.

## Data

Everything is stored under the localStorage key `grade-exchange:v2`. Exports are a
versioned envelope:

```json
{
  "app": "grade-exchange",
  "version": 2,
  "exportedAt": "…",
  "data": {
    "subjects": [{ "id", "name", "ticker", "color", "target" }],
    "entries": [{ "id", "subjectId", "date", "type", "score", "title", "classAvg" }],
    "settings": { "weights": { "Exam": 3, "Test": 2, "Assignment": 1.5, "Quiz": 1 }, "weighted": true }
  }
}
```

Imports are validated field-by-field (bad rows are skipped and counted) and can
replace the current book or merge into it (dedupe by id, incoming wins).

## Architecture

```
src/
├── lib/          pure calculation layer — no React, fully unit-tested
│   ├── periods   term/semester/month bucketing
│   ├── regression, weights, grouping, ohlc, composite, stats
│   ├── headlines wire-feed generation
│   ├── sample    seeded demo book
│   └── io, storage
├── components/   terminal chrome: tape, status bar, drawer, palette, modals, ui atoms
└── views/        Overview · Charts · Compare · Screener · Blotter
```

New features slot in as a pure lib module (with tests) plus a view that consumes
precomputed `SubjectStat`s — the UI never does its own math.

Terms follow calendar quarters (T1 = Jan–Mar … T4 = Oct–Dec). Scores are 0–100.
Forecasts are least-squares trend lines over the last 10 results with an honest
±σ band — a guide, not a promise.
