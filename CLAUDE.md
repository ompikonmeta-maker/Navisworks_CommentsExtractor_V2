# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Tabelin** — a browser-only web app that converts Autodesk Navisworks review-comment
HTML reports into a searchable, filterable review workspace with Excel (`.xlsx`) export.
Everything runs client-side: files are parsed in the browser and never uploaded. The
working session (records, edits, and before/after images) is **autosaved to the browser
(IndexedDB)** so a reload restores it, and can also be mirrored to a user-chosen
**dedicated folder** (File System Access API → `tabelin-session.json`). "Reset to sample"
clears the session and returns to the bundled sample dataset (`src/lib/persist.js`).

Stack: **React 18 + Vite 5 + Tailwind CSS 3**. UI follows a Material Design 3 scheme
seeded from `#1768f7` (generated with the `docs/material-design-3-project` dynamic-color
engine), implemented as CSS custom properties so light/dark switch without a rebuild. Shape
tokens `--tabelin-radius-card` (26px) and `--tabelin-radius-control` (15px) map to Tailwind
`rounded-card` / `rounded-control`.

## Commands

```bash
npm install        # install dependencies
npm run dev        # Vite dev server (HMR) at http://localhost:5173
npm run build      # production build → a single self-contained dist/index.html
npm run preview    # serve the production build (default port 4173)
```

### Portable single-file build

`npm run build` emits **one self-contained `dist/index.html`** (~2.4 MB) via
`vite-plugin-singlefile` — all JS/CSS inlined, the sample report + images embedded as
data URLs, and a subset of the Material Symbols icon font embedded too. It has **no runtime
dependencies**: open it by double-click (`file://`), copy it to a USB stick, or host it
anywhere static. No server, no install, no admin rights, works fully offline. The
`build.assetsInlineLimit` in `vite.config.js` is set very high specifically so nothing is
emitted as a separate fetched asset.

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
- `src/lib/sample.js` — parses the bundled report and links the few shipped viewpoint
  images. Both are **embedded at build time** (report via `?raw`, images as inlined asset
  imports) — nothing is fetched, so the seed dataset loads even from `file://` offline.
  This is the data loaded on every startup.
- `src/lib/excel.js` — `.xlsx` export via SheetJS (dynamically imported). Writes a
  **Comments** sheet and, when the Overview passes its data, an **Overview** sheet (KPI /
  coverage / by-discipline / over-time / needs-attention tables). SheetJS (community) can't
  write pictures, so after it writes the workbook the file (a zip) is re-opened with JSZip and
  drawings are injected per sheet — the before/after **photos** on Comments, and the rendered
  **chart images** on Overview (`embedDrawings` handles multiple sheets/drawings).
- `src/lib/snapshot.js` — DOM→PNG via **html-to-image** (foreignObject → SVG → canvas;
  dynamically imported, bundled so it stays offline). It renders through the browser's own
  layout engine, so flex alignment, padded badges and the Recharts SVG come out exactly as on
  screen — html2canvas (a re-implemented rasteriser) mis-centred those, so don't switch back.
  `snapshotNode` downloads a card / whole-Overview PNG; `nodeToImage` returns a data URL, used
  to capture the dashboard charts for the Excel Overview sheet. Elements marked `data-nosnap`
  (the snapshot buttons) are filtered out of the capture.
- `src/store/store.jsx` — React context + `useReducer` in-memory store. `computeKpis` is the
  shared status aggregation. Persistence lives in `App.jsx` (autosave effect) + `lib/persist.js`.
- `src/store/settings.jsx` — **v1.1** app settings context (`useSettings`), persisted to
  IndexedDB (separate `settings` key) and independent of the session: theme mode
  (`system`/`light`/`dark`, applied via `applyThemeMode` — `system` removes `data-theme` and
  lets the media query decide) and per-discipline colour overrides + custom disciplines. The
  header theme toggle and the Settings page both write here; `DisciplineBadge` reads the colour
  map. Wrapped around the app in `main.jsx`, outside `StoreProvider`.
- `src/lib/persist.js` — session persistence: a tiny IndexedDB key/value for the autosaved
  session, the stored folder handle, and the settings blob (`saveSettings`/`loadSettings`),
  plus File System Access helpers (`pickFolder`/`writeSessionToFolder`). `App.jsx` restores on
  startup and autosaves (debounced) on every change.
- `src/lib/motion.js` — MD3 Expressive motion. `mdSpring(bounce)` returns the single-overshoot
  spring easing `cubic-bezier(0.38, bounce, 0.22, 1)` (bounce = p1y), matching the repo's MD3
  reference — not a multi-oscillation `linear()` curve. Used for the sidebar collapse (660ms,
  overshoot 1.45; label fade + stagger choreographed by the `.t-shell`/`.t-navitem`/`.t-lbl`
  rules in `index.css`), the staggered card reveal (`revealCards`: fade + scale 0.88→1 with
  overshoot 1.75, 700ms, 15ms stagger, via `components/Reveal.jsx`), and the two-stage circular
  theme transition (`animateThemeSwitch`: View Transitions API clip-path circle — 590ms to 55%,
  a 300ms still hold, then 250ms to full; no bounce). All honor `prefers-reduced-motion`.
- `src/App.jsx` — app shell (sidebar nav, session header, theme toggle) and a small
  route switch: Dashboard (Overview), Comments (Viewpoints — list + editable detail
  drawer), and Settings (`views/Settings.jsx`, v1.1 — Appearance + Disciplines). Theme is
  driven by `useSettings` (the toggle animates via `animateThemeSwitch`); there is no longer a
  `lib/theme.js`. Import is a single action — the Overview Import button opens the file picker
  and calls `ingestFiles` — not its own route. The **Overview carries all the analytics**
  (KPIs + Recharts: a status-stacked "By discipline" bar, a Status donut, and an "Over time"
  line) plus a Recent list; there is no separate Analytics route, so `Dashboard.jsx` pulls in
  Recharts on initial load.
- `src/views/*` and `src/components/*` — screens and shared MD3-flavored primitives
  (`ui.jsx`), the editable `DetailPanel.jsx`, and the `Toast.jsx` notifier.

### Conventions that matter

- Tailwind color utilities map to MD3 role tokens (`bg-surface`, `text-on-surface`,
  `text-primary`, `status-open/review/closed`) defined in `tailwind.config.js` +
  `src/index.css`. Prefer these over hard-coded colors so theming stays consistent.
- Icons render via the embedded Material Symbols subset. `Icon` in `components/ui.jsx` maps
  each name to a **codepoint** (not a ligature) so the font subset stays ~4 KB. When you use
  a new icon, add its name→codepoint to `ICON_CODEPOINTS` **and** re-subset the font in
  `index.css` to include that codepoint (see the `@font-face` data URL there), otherwise it
  won't render offline.
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
  `src/sample/` where they are embedded into the bundle as the app's seed data).
