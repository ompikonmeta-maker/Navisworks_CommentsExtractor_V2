# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Tabelin** — a browser-only web app that converts Autodesk Navisworks review-comment
HTML reports into a searchable, filterable review workspace with Excel (`.xlsx`) export.
Everything runs client-side: files are parsed in the browser, held in memory for the
session, and never uploaded. Reloading the page returns to the bundled sample dataset.

Stack: **React 18 + Vite 5 + Tailwind CSS 3**. UI follows a Material Design 3 teal scheme
(seed `#006A6A`) implemented as CSS custom properties, so light/dark switch without a rebuild.

## Commands

```bash
npm install        # install dependencies
npm run dev        # Vite dev server (HMR) at http://localhost:5173
npm run build      # production build to dist/
npm run preview    # serve the production build (default port 4173)
```

There is no test runner or linter configured yet. Verification during development was done
with a headless Chromium smoke script (`playwright-core` driving the pre-installed browser
against `npm run preview`) — not committed. If you add automated tests, wire them into
`package.json` scripts and document the single-test command here.

## Architecture

Data flows in one direction: **files → parser → in-memory store → views**.

- `src/lib/parser.js` — the heart of the app. Navisworks "Viewpoints" exports are a flat
  list of `div.viewpoint` blocks; a viewpoint with review comments carries a nested
  `div.comments > div.comment`. Each comment holds `Status`, `User`, `Text` name/value spans
  plus a trailing text node with the date. Only viewpoints **with** comments become records.
  Discipline is not a field in the source — it is inferred from the comment text
  (`inferDiscipline`: leading `PIP:`/`STR:`… token, else whole-word scan, else `OTHER`).
  Raw statuses (e.g. `New`) are normalized to `Open` / `In Review` / `Closed`.
- `src/lib/ingest.js` — turns a user file selection into records: loose `.html` + images, or
  a `.zip` (via JSZip). Images are read to data URLs and linked to `imageRef`
  case-insensitively. Unsupported formats are ignored; a corrupt ZIP or a comment-less HTML
  is reported, not fatal.
- `src/lib/sample.js` — parses the bundled report in `public/sample/` and links the few
  shipped viewpoint images. This is the seed dataset loaded on every startup.
- `src/lib/excel.js` — `.xlsx` export (Comments + Summary sheets) via SheetJS. **SheetJS is
  dynamically imported** so its ~430 KB stays out of the initial bundle; `exportToExcel` is
  therefore `async`.
- `src/store/store.jsx` — React context + `useReducer` in-memory store. No persistence by
  design. `computeKpis` is the shared status aggregation.
- `src/App.jsx` — app shell (sidebar nav, session header, theme toggle) and a small
  route switch: Dashboard, Comments (list + editable detail drawer), Analytics, Import.
  **Analytics is `React.lazy`** because it pulls in Recharts.
- `src/views/*` and `src/components/*` — screens and shared MD3-flavored primitives
  (`ui.jsx`), the editable `DetailPanel.jsx`, and the `Toast.jsx` notifier.

### Conventions that matter

- Tailwind color utilities map to MD3 role tokens (`bg-surface`, `text-on-surface`,
  `text-primary`, `status-open/review/closed`) defined in `tailwind.config.js` +
  `src/index.css`. Prefer these over hard-coded colors so theming stays consistent.
- The record shape is defined in `parser.js` and mirrored by the Excel column map in
  `excel.js`. If you add or rename a record field, update **both**, plus any filters in
  `views/Comments.jsx`.
- `vite.config.js` sets `base: './'` for subpath/static hosting (e.g. GitHub Pages).

## Reference material (not shipped in the build)

`docs/` holds the source spec and design reference:
- `docs/tabelin-dokumentasi.md` — the authoritative system spec (UI, Input, Process, Output).
  Follow it when extending behavior.
- `docs/material-design-3-project/` — the MD3 token/component reference the theme is based on.
- `docs/Sample/` — the original Navisworks report and viewpoint images (also copied into
  `public/sample/` as the app's seed data).
