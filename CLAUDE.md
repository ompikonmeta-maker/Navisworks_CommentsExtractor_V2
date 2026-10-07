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
  Discipline is not a field in the source — it is extracted from the comment text.
  Raw statuses (e.g. `New`) are normalized to `Open` / `In Review` / `Closed`.
- `src/lib/detect.js` — the shared, data-driven **extraction engine** (v1.1) behind
  commenter, discipline **and comment-body** detection. A config is an ordered list of `rules`
  (modes: `delimiter` (text before), `after` (the rest after a delimiter), `brackets`,
  `keyword`, `word`, `list` (scan a set), `regex`) tried first-non-empty-wins, plus
  normalization (`strip`, `case`) and an optional `constrain` to an allowed list (→ `OTHER`).
  `DEFAULT_DETECT` has three configs: `commenter`, `discipline`, and `comment` (default
  `after` `:` — strips the leading `Name:` prefix). `parser.detectCommenter` / `inferDiscipline`
  / `cleanComment` are thin wrappers over `extract`. **Records keep the raw source text as
  `commentRaw`** (with the prefix) so all three detectors can re-run against it, while
  `commentText` holds the **cleaned** body shown & exported everywhere; `parser` sets both at
  import and `store.withCommenters` backfills `commentRaw` for older sessions. The Settings
  "Detection rules" editor (`components/DetectionEditor.jsx`, three tabs) edits these live (with
  a coverage preview reading `commentRaw`) and the store's `APPLY_DETECT` action re-runs
  extraction across records (fill-empty or overwrite) — for the `comment` config it writes
  `commentText` (empty extraction keeps the original). The configs persist in `settings.detect`.
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
- `src/lib/templateExcel.js` — **template-driven Excel export** (v1.1) via **zip/XML
  surgery** (JSZip), deliberately **not ExcelJS** (ExcelJS re-writes the whole workbook and
  stretches/loses the template's embedded logos). Opens a user-supplied `.xlsx`, edits ONLY the
  parts it must, and leaves styles/drawings/media byte-for-byte. Two zones: the **log sheet** (a
  repeating table — one record per row, columns located by a data-driven mapping: `by:'header'`
  default / `by:'name'` Defined-Name / `by:'column'`, so a layout change is a mapping edit not a
  code change) and **detail sheets** (one page per item, driven by the template's own
  `VLOOKUP(N2)` — the engine only sets `N2` and injects the before/after photos into the marked
  image cells as **oneCell** anchors at natural size, no stretch; extra items **clone a pattern
  sheet verbatim** with all OOXML bookkeeping). Optional `vlookupAutoRepair` rewrites the detail
  `VLOOKUP` column indexes to `MATCH(headerText,…)` so the sheet self-adjusts if log columns
  move. `DEFAULT_TEMPLATE_MAPPING` targets the shipped "3D Model Log Sheet" template; the mapping
  persists in `settings.templateExport`, the template bytes in IndexedDB
  (`persist.saveTemplate`/`loadTemplate`), and the UI is `components/TemplateExportPanel.jsx`
  under Settings › Export — a **fully configurable field editor** (all MD3 `Select`): add /
  remove / rename / reorder rows, plus header-row, data-start-row, item-column, detail-cell
  locators, import/export mapping JSON, and "+ add unmapped headers". Each field row is
  `{ id, label, source:{kind:'record'|'const'|'attr', key}, by, value, format?, map?, and for
  attr: default?, multiline? }` — **record** = a `parser` field (`RECORD_FIELDS`), **const** =
  an export constant (value in the Konstanta section, keyed by `cfg.constants`), **attr** = a
  custom per-comment attribute in `record.extra[key]`. The attr-kind rows ARE the custom
  attribute registry: `attrFields(mapping)` drives the detail drawer's "Custom fields" inputs
  (label / default / multiline), so one definition serves both the export column and the
  editor. Renaming an attr key migrates `record.extra` across records via the store's
  `RENAME_ATTR` action. `migrateMapping` upgrades the old `field:'@x'|'x.y'|'plain'` strings to
  the source model (run in `settings` load + on JSON import). The editor is **column-first**:
  on template load `buildFieldsFromHeaders` reads the log header row and makes one row per
  column, `autoMatchHeader` (exact, normalized) binds known headers to a parser field/constant,
  and unmatched columns become **`blank`** rows (skipped on export, template cell untouched)
  carrying a suggested `cf_`-prefixed key you can one-click "Define" into a custom field. The
  four source kinds are record / const / attr / blank. Long help uses the shared `InfoTip`
  (`components/ui.jsx`, styled by `.info-tip`/`.info-bubble`); dense in-table `Select`s use the
  `.dd-compact` variant so they don't overflow their column. Detail sheets are cloned by
  picking a worksheet-part number from the actual zip files (never from `workbook.xml`, which
  lists no part paths) so clones never clobber existing sheets. The pre-existing `lib/excel.js`
  quick export stays as-is.
- `src/lib/snapshot.js` — DOM→PNG via **html-to-image** (foreignObject → SVG → canvas;
  dynamically imported, bundled so it stays offline). It renders through the browser's own
  layout engine, so flex alignment, padded badges and the chart SVG come out exactly as on
  screen — html2canvas (a re-implemented rasteriser) mis-centred those, so don't switch back.
  `snapshotNode` downloads a card / whole-Overview PNG; `nodeToImage` returns a data URL, used
  to capture the dashboard charts for the Excel Overview sheet. Elements marked `data-nosnap`
  (the snapshot buttons) are filtered out of the capture.
- `src/store/store.jsx` — React context + `useReducer` in-memory store. `computeKpis` is the
  shared status aggregation. The `UPDATE_RECORD` reducer auto-stamps `closedAt` (ISO) when a
  record moves into `Closed` and clears it when it leaves — unless the patch sets `closedAt`
  itself (the detail drawer's manual editor). Persistence lives in `App.jsx` (autosave
  effect) + `lib/persist.js`.
- `src/store/settings.jsx` — **v1.1** app settings context (`useSettings`), persisted to
  IndexedDB (separate `settings` key) and independent of the session: theme mode
  (`system`/`light`/`dark`, applied via `applyThemeMode` — `system` removes `data-theme` and
  lets the media query decide), per-discipline colour overrides + custom disciplines, and a
  **commenter master list** (`customCommenters`: names the user adds on top of those detected
  in the data). The header theme toggle and the Settings page both write here; `DisciplineBadge`
  reads the colour map. Wrapped around the app in `main.jsx`, outside `StoreProvider`.
  On the V2 server, `bindRemote` (called by `App` when a review opens) swaps the shared keys
  for the server's copy — labels, detection, template mapping and statuses per **project**,
  `reviewTarget` per **review** — and syncs edits back; only `themeMode` stays per browser. A
  project with nothing saved starts from the admin/editor's browser settings. The template
  file follows the same rule (`persist.saveTemplate`/`loadTemplate` go to
  `/api/projects/{id}/template` in remote mode).
  Commenters are a **record field**, not an author mapping: `record.commenter` is the person
  who wrote the comment, auto-detected by `parser.detectCommenter` from the leading `Name:`
  token in the comment text (e.g. `CPY_Dito:`, `OPS(Teguh):`); `store.setData` backfills it for
  older sessions. The detail drawer has a Commenter dropdown (options = detected ∪
  `customCommenters`) to assign/override per comment; Viewpoints search and a dedicated Excel
  **Commenter** column use `record.commenter`. The Navisworks `User` code stays as the raw
  `authorCode` / Excel "Author" column.
- `src/lib/persist.js` — session persistence: a tiny IndexedDB key/value for the autosaved
  session, the stored folder handle, and the settings blob (`saveSettings`/`loadSettings`),
  plus File System Access helpers (`pickFolder`/`writeSessionToFolder`). `App.jsx` restores on
  startup and autosaves (debounced) on every change.
- `src/lib/motion.js` — MD3 Expressive motion. `mdSpring(bounce)` returns the single-overshoot
  spring easing `cubic-bezier(0.38, bounce, 0.22, 1)` (bounce = p1y), matching the repo's MD3
  reference — not a multi-oscillation `linear()` curve. Used for the sidebar collapse (660ms,
  overshoot 1.45; choreographed by the `.t-shell`/`.t-navitem`/`.t-ico`/`.t-lbl` rules in
  `index.css` — collapsed the nav becomes an **MD3 navigation rail** (icon over an
  always-visible micro label, active state a pill around the icon via the `.t-ico` wrapper +
  `[aria-current="page"]`); only the brand wordmark fades out), the **"FINO directional"** staggered card reveal
  (`revealCards`, via `components/Reveal.jsx`; modelled on
  `docs/material-design-3-project/claude/card-reveal-FINO-directional.html`): fade + scale
  0.94→1 + a 14px translateY on a settle spring `cubic-bezier(0.34, 1.73, 0.32, 1)`, 800ms,
  10ms stagger. **Direction follows navigation** — a module-level `setRevealDir(±1)` is set
  from nav clicks (sidebar route in `App.go`, Settings section rail) just before the cards
  mount: +1 (nav to a lower item, or first load) resolves the group bottom→top entering from
  above, −1 (nav up) top→bottom entering from below (`order`/`dy` flip). Each `Reveal` group
  animates its own children in this direction. And the two-stage circular
  theme transition (`animateThemeSwitch`: View Transitions API clip-path circle — 590ms to 55%,
  a 300ms still hold, then 250ms to full; no bounce). All honor `prefers-reduced-motion`.
- `src/App.jsx` — app shell (sidebar nav, session header, theme toggle) and a small
  route switch: Dashboard (Overview), Comments (Viewpoints — list + editable detail
  drawer), and Settings (`views/Settings.jsx`, v1.1 — a **two-pane** page: a category rail
  (Appearance · Labels · Detection · Export[soon] · About) beside one focused panel. **Labels**
  merges Disciplines (colours) + Commenters behind an inner segmented toggle; **Detection** hosts
  `DetectionEditor`. The panel is wrapped in `<Reveal deps={[section]}>` so the staggered card
  reveal re-plays on every section switch). Theme is
  driven by `useSettings` (the toggle animates via `animateThemeSwitch`); there is no longer a
  `lib/theme.js`. Import is a single action — the Overview Import button opens the file picker
  and calls `ingestFiles` — not its own route. The **Overview is a close-out cockpit** (`views/Dashboard.jsx`):
  all numbers come from the pure `lib/overview.js` (`computeOverview(records, statuses, {target})`
  — counts, pace = close-outs in the last 14 days from `closedAt`, needed pace and forecast vs
  the review target, log-sheet readiness = closed + after-photo + resolution, per-discipline
  scorecard/forecast/ages, pipeline, burn-up, weekly close-outs, "raised by" party from the
  commenter prefix). Charts are hand-drawn SVG in `components/OverviewCharts.jsx` (no chart
  library; colours are MD3/status CSS variables so themes switch without re-render): hero
  (progress · target verdict · log sheet), the **Forecast finish** comet runway, burn-up,
  weekly pace, pipeline, needs-attention tiles, discipline scorecard, backlog-age heatmap,
  raised by. Labels stay minimal — explanations live in `InfoTip`s and the shared chart
  tooltip (`TipProvider`/`useTipProps`). The review target is `settings.reviewTarget`
  ('YYYY-MM-DD', set from the Target chip). Pace/forecast need `closedAt`, so they fill in as
  comments are closed in Tabelin.
- `src/views/*` and `src/components/*` — screens and shared MD3-flavored primitives
  (`ui.jsx`), the editable `DetailPanel.jsx`, and the `Toast.jsx` notifier.

### Conventions that matter

- Tailwind color utilities map to MD3 role tokens (`bg-surface`, `text-on-surface`,
  `text-primary`, `status-open/review/closed`) defined in `tailwind.config.js` +
  `src/index.css`. Prefer these over hard-coded colors so theming stays consistent.
  The colours are wrapped in `color-mix(… calc(<alpha-value> * 100%) …)` in the config so
  opacity modifiers (`border-outline-variant/50`) actually generate.
- **Surfaces:** cool-grey canvas (`background`), white cards (`Card` → `.t-card`: shadow
  `--tabelin-elev-card`, no border; a hairline ring in dark). In-card fills use
  `surface-low/container/high`. The **sidebar keeps its original lavender look** — its tokens
  are re-pinned on `[data-rail]` / `.t-flyout` in `index.css`; don't restyle it unless asked.
- **Colour meaning:** statuses come from the registry (defaults Open orange, In Review violet,
  Closed green; old default colours auto-upgrade in `normalizeStatuses`). Verdicts and
  warnings use `--tabelin-good/warn/bad` — red only means late/behind. Disciplines are a
  colour dot + neutral text from the fixed `DISC_PALETTE` (`discColor`, by DISCIPLINES order;
  user overrides in Settings › Labels win).
- **Motion:** one easing (`--tabelin-ease`) for hover/press/focus on every control (base
  layer); `.t-pop` for menus/popovers (fade + spring scale), `.t-press` for press feedback.
  `InfoTip` renders its bubble in a fixed layer on `<body>`, clamped to the window, so tips
  never widen the page or get clipped by cards.
- **No overflow, little dead space:** content must stay inside its card at 390–1440px wide
  (wide tables scroll inside their own wrapper). Shorter cards in a row spread their content
  (`flex-1 justify-between`) instead of leaving a blank bottom. Explanations go in tooltips,
  not extra labels.
- Icons render via the embedded Material Symbols subset. `Icon` in `components/ui.jsx` maps
  each name to a **codepoint** (not a ligature) so the font subset stays ~4 KB. When you use
  a new icon, add its name→codepoint to `ICON_CODEPOINTS` **and** re-subset the font in
  `index.css` to include that codepoint (see the `@font-face` data URL there), otherwise it
  won't render offline.
- The record shape is defined in `parser.js` and mirrored by the Excel column map in
  `excel.js`. If you add or rename a record field, update **both**, plus any filters in
  `views/Comments.jsx`.
- `vite.config.js` sets `base: './'` for subpath/static hosting (e.g. GitHub Pages).
- **Follow the MD3 reference** (`docs/material-design-3-project/`) for every UI addition —
  dropdowns (the `Select`/`.dd` component), segmented controls, buttons, tooltips (`InfoTip`),
  shape/motion tokens. Don't hand-roll a control when a shared primitive exists.
- **Keep buttons calm.** When a screen shows several controls in a row or a dense table, at most
  one carries strong emphasis (filled/tonal); the rest are text/quiet or reveal on hover, and
  fields in dense editors sit borderless until hover/focus (see the column-mapping and
  custom-fields editors). Avoid a wall of boxed/outlined controls.
- Comment **statuses** are configurable (`lib/status.js` + `settings.statuses`): an ordered
  list of `{ label, color, role }` with a mandatory `open` (first) and `done` (last, stamps
  `closedAt`) plus editable middles. Read colours/labels from the registry (never the old fixed
  `status-open/review/closed` tokens) so a status looks the same in badges, drawer buttons,
  charts and the Excel Overview. Custom (`cf_`) fields are typed — `text`/`multiline`/`select`/
  `checkbox` via `attrType`; checkbox values are arrays joined by `joinAttrValue`.

## Reference material (not shipped in the build)

`docs/` holds the source spec and design reference:
- `docs/tabelin-dokumentasi.md` — the authoritative system spec (UI, Input, Process, Output).
  Follow it when extending behavior.
- `docs/material-design-3-project/` — the MD3 token/component reference the theme is based on.
- `docs/Sample/` — the original Navisworks report and viewpoint images (also copied into
  `src/sample/` where they are embedded into the bundle as the app's seed data).
