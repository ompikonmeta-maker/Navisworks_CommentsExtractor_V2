# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Tabelin** turns Autodesk Navisworks review-comment HTML reports into a searchable,
filterable review workspace where comments are closed out (status, after-photo, resolution)
and exported to Excel (`.xlsx`). It is one React app that runs in two modes:

**Office server (team use).** A single Go binary (`server/`, SQLite + a `data/` folder) serves
the same app plus a JSON API on the office network (default `:8787`). People sign in with a
username + PIN; roles are `admin` and `reviewer`. Comments, photos, settings, the Excel
template and change history live on the server, organised as Project › Review. Data stays on
the office network — no cloud services.

**Offline file (single user).** The same build is one self-contained `dist/index.html` that
opens by double-click. Reports are parsed in the browser and never uploaded; the session
(records, edits, photos) is autosaved to the browser (IndexedDB) and can be mirrored to a
user-chosen folder (`tabelin-session.json`). "Reset to sample" returns to the bundled sample.

The app picks the mode at startup: if the server API answers (`detectRemote` in
`src/lib/server.js`) it runs against the server, otherwise offline. "Answers" means
`/api/health` is OK **and** JSON with `status: "ok"` — a static host whose SPA fallback
returns `index.html` (200 text/html) for unknown paths stays offline; `file://` skips the probe.
The screens are shared; everything that differs per mode lives in the **data layer**
(`src/data/`): one interface, two sources (`localSource`, `serverSource`). `Root.jsx` (boot)
picks the source; the store and the screens only call `data()` / `useData()` and read
`source.caps` — they never ask which mode runs.

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

cd server && go run .   # office server on :8787, data in ./data (see server/README.md)
```

### Tests

```bash
npm test                              # frontend unit tests (Vitest), ~2 s
npx vitest run tests/merge.test.js    # one test file
npx vitest run -t "fills a before-photo"   # tests whose name matches
cd server && go test ./...            # server tests (temp data folder each run)
cd server && go test ./internal/api -run TestDeleteRules   # one server test
npm run smoke                         # build, then drive the offline app in headless Chromium (~15 s)
npm run smoke:server                  # build, copy into server/web, two browsers on the real server (~60 s)
```

- `tests/*.test.js` cover `parser.js` (the bundled sample report), `merge.js`, `overview.js`
  (fixed `today`, `TZ=UTC` set in `vitest.config.js`) and `templateExcel.js` (sample
  records into `docs/3D REVIEW LOG_MASTER_FORMAL_90_OFA.xlsx`, read back from the zip).
  `server.test.js` covers `detectRemote` with a mocked `fetch` (`vi.resetModules()` + dynamic
  import per case, since the answer is cached at module level). `sync.test.js` covers
  versioned saves / 409 conflicts / create / import ids in `lib/server.js` (fake `fetch`) and
  the store's `MERGE_SERVER` reducer (exported as `reducer`). `data.test.js` covers both data
  sources (same members and caps, offline import/undo/ids, server calls with a fake `fetch`)
  and **architecture guards**: no `remoteState` anywhere; only `src/data/`, `Root.jsx` and the
  server-only screens (`Login`, `ProjectPicker`, `UsersEditor`) import `lib/server.js`; only
  `src/data/` and `store/settings.jsx` import `lib/persist.js`. `queues.test.js` checks each
  Work queue opens exactly its count and that Insights uses the same definitions;
  `headline.test.js` covers the Work sentence.
  Files that need `DOMParser` start with `// @vitest-environment jsdom`.
- `server/internal/api/api_test.go` runs the real routes and sign-in on `httptest` with a
  temp SQLite database: role checks (reviewer vs admin), history rows, delete rules;
  `phase2_test.go` covers create-one, import ids, versions/409, bulk conflicts and `?since=`;
  `phase5_test.go` the wrong-PIN lock (fake `clock`), Trash (restore, purge, 30-day expiry),
  restricted projects (404 on every scoped route) and backup → restore into a fresh folder.
  `server/internal/db/db_test.go` covers the `editor`/`viewer` → `reviewer` migration and
  adding `version`/`modified_at` to an older database.
- `scripts/smoke-server.mjs` builds the Go server into a temp folder, starts it on a temp data
  dir, and drives two signed-in browsers on one comment: a stale save is refused (409), the
  newer values show, the typed resolution stays and "Save mine" saves it; the other browser
  sees the change within 30 s without reload. Then roles and shared data: the review target
  comes from the server, a reviewer has no Import/Delete, the admin sees history, uploads the
  template, imports the sample (merge + Undo) and adds a comment; then the Trash (delete →
  Undo, restore from the Trash page, delete for good), Settings › Backup download, and "Who can
  open…" hiding the project from the reviewer and giving it back. Expected failed requests
  (409 PATCH; 404 on `…/template` while the project has none; 404 on a hidden project's
  `…/reviews`) are allowed; any other failed request or page error fails it.
- `scripts/smoke.mjs` opens `dist/index.html` over `file://` (as the offline user does),
  imports the full sample, clicks every Work queue (and Insights › Do next) and checks the list
  holds exactly the count, opens a comment, sets it Closed and checks it survives a reload,
  adds and deletes a comment, re-imports (merge + Undo), sets the target from the Work strip,
  checks Help › About and resets to the sample; any page error fails it. It uses `playwright-core` with the pre-installed Chromium
  (`/opt/pw-browsers/chromium`, or `CHROME_PATH`) — never run `playwright install`.
- Run all of them before a release and after any change to parsing, merge, roles or export.

The server embeds `server/web/index.html`. After a frontend change that should reach the
server binary: `npm run build && cp dist/index.html server/web/index.html`.

### Portable single-file build

`npm run build` emits **one self-contained `dist/index.html`** (~2.4 MB) via
`vite-plugin-singlefile` — all JS/CSS inlined, the sample report + images embedded as
data URLs, and a subset of the Material Symbols icon font embedded too. It has **no runtime
dependencies**: open it by double-click (`file://`), copy it to a USB stick, or host it
anywhere static. In this offline mode: no server, no install, no admin rights. The
`build.assetsInlineLimit` in `vite.config.js` is set very high specifically so nothing is
emitted as a separate fetched asset.

There is no linter configured.

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
  persists in `settings.templateExport`, the template bytes through the data source
  (`source.loadTemplate`/`saveTemplate`/`clearTemplate`: IndexedDB offline, the project on the
  server), and the UI is `components/TemplateExportPanel.jsx`
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
  itself (the detail drawer's manual editor). Every change is handed to the current data
  source (`data().saveRecord / saveMany / addRecord / deleteRecords`): offline these are
  no-ops and `App.jsx` autosaves the session (`source.persistSession`); **on the server** (see
  "Saving and refresh" below) edits save per record with versions, and a refresh
  (`source.changes`, only when `caps.refresh`) merges other people's changes.
- `src/store/settings.jsx` — **v1.1** app settings context (`useSettings`), persisted to
  IndexedDB (separate `settings` key) and independent of the session: theme mode
  (`system`/`light`/`dark`, applied via `applyThemeMode` — `system` removes `data-theme` and
  lets the media query decide), per-discipline colour overrides + custom disciplines, and a
  **commenter master list** (`customCommenters`: names the user adds on top of those detected
  in the data). The header theme toggle and the Settings page both write here; `DisciplineBadge`
  reads the colour map. Wrapped around the app in `main.jsx`, outside `StoreProvider`.
  With a source that has `caps.sharedSettings` (a server review), `bindShared(source)` (called
  by `App`) swaps the shared keys for the source's copy (`source.loadSharedSettings`) — labels,
  detection, template mapping and statuses per **project**, `reviewTarget` per **review** — and
  syncs edits back (`source.saveSharedSetting`); only `themeMode` stays per browser. A project
  with nothing saved starts from the admin's browser settings. The template file follows the
  same rule (`serverSource.loadTemplate` falls back to an admin's local template once).
  Commenters are a **record field**, not an author mapping: `record.commenter` is the person
  who wrote the comment, auto-detected by `parser.detectCommenter` from the leading `Name:`
  token in the comment text (e.g. `CPY_Dito:`, `OPS(Teguh):`); `store.setData` backfills it for
  older sessions. The detail drawer has a Commenter dropdown (options = detected ∪
  `customCommenters`) to assign/override per comment; Viewpoints search and a dedicated Excel
  **Commenter** column use `record.commenter`. The Navisworks `User` code stays as the raw
  `authorCode` / Excel "Author" column.
- `src/data/` — **the data layer** (Phase 3). `index.js` holds the current source:
  `data()` (plain modules, callbacks) / `useData()` (components; stable per mount, since the
  source only changes while no review screen is mounted), `openServerReview({project, review,
  user})` / `openLocal()` (called by `Root.jsx` only). `localSource.js` documents the shared
  interface — `loadRecords`, `persistSession`, `resetToSample`, `folder`, `saveRecord`,
  `saveMany`, `addRecord`, `deleteRecords`, `changes`, `history`, `editStamp`,
  `isFreshImport`, `importMerge` (returns `undo`), template load/save/clear/has, shared
  settings load/save, `teamSize`, `trash` / `restore` / `purge` / `restoreRecord`,
  `backupUrl` — plus `caps` (`canAdmin`, `canReview`, `hasHistory`,
  `shared`, `autosave`, `sessionFolder`, `sampleReset`, `refresh`, `sharedSettings`,
  `manageUsers`, `trash`, `backup`), `place`, `user`, `scopeKey` ('local' or the review id, for per-review
  localStorage keys). `serverSource.js` wraps `lib/server.js`; roles come from the user
  (`isAdminUser` / `isReviewerUser`). Screens read capabilities, never the mode: e.g.
  `readOnly = !caps.canAdmin`, history only with `caps.hasHistory`. A new feature that
  stores something adds a method to **both** sources (and to `MEMBERS` in `data.test.js`).
- `src/lib/persist.js` — browser storage only (used by `localSource` and the settings store):
  a tiny IndexedDB key/value for the autosaved session, the stored folder handle, the
  settings blob (`saveSettings`/`loadSettings`) and the offline template
  (`saveTemplateLocal`/`loadTemplateLocal`/`clearTemplateLocal`), plus File System Access
  helpers (`pickFolder`/`writeSessionToFolder`).
- `src/lib/photos.js` — `inlineImages(records)`: turns server photo URLs into data URLs for the
  Excel exports (data URLs pass through).
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
  route switch: **Work** (`views/Work.jsx`, the default), **Insights** (`views/Dashboard.jsx`,
  the former Overview), **Trash** (admins on the server), Help, and Settings (`views/Settings.jsx`, v1.1 — a **two-pane** page: a category rail
  (Template · Labels · Detection · Appearance, plus Users for admins on the server; "Restore defaults" sits in Appearance) beside one focused panel. **Labels**
  merges Disciplines (colours) + Commenters behind an inner segmented toggle; **Detection** hosts
  `DetectionEditor`. The panel is wrapped in `<Reveal deps={[section]}>` so the staggered card
  reveal re-plays on every section switch). Theme is
  driven by `useSettings` (the toggle animates via `animateThemeSwitch`); there is no longer a
  `lib/theme.js`. Import is a single action (`components/ImportAction.jsx` → `useImport()`:
  hidden file input + merge dialog + Undo toast, shared by Work and Insights) — not its own
  route. While it runs, `ImportProgress` (fixed card, `role="status"`) shows two steps: reading
  the files (`ingestFiles(files, onProgress)`) and saving (`source.importMerge(…, {onProgress})` →
  `applyMergeRemote` / `importParsedRecords` report saving, photo uploads, reloading). The app
  header sits at `z-30` so the account menu opens above the Work strip (`z-20`). On Work, below 1500 px window width the sidebar folds to its rail on the way in.
  `goComments(filter)` (from Insights) and `openDetail(id)` jump to Work with that filter.
- `src/views/Work.jsx` — **the Work screen** (Phase 4; mockup option C with option A's
  sentence). Strip on top: the headline sentence (`lib/headline.js`: "37 days behind. Close
  7.3 a day to finish on time.", "On track.", "Over a year behind." past 365 days, …),
  % closed + `StatusBar`, the `TargetChip` (exported from Dashboard) and Import. Three panes:
  **queues** (`lib/queues.js` `workQueues`: the five Do-next blockers ranked as in
  `overview.attention` — unassigned, no after-photo, verify (`status: '~middle'` = any middle
  status), no resolution, old > 90 days — then All and the done status), the **list** of the
  chosen queue (`filterRecords`; search, discipline / status / commenter dropdowns, Add,
  quiet ExportButton for the shown comments, row checkboxes → `.t-bulk` bar), and the
  **detail** (`DetailPanel docked`). A queue is just a named filter: `queueFor(filter)` finds
  it, a hand-tuned filter shows "Filtered comments". Work starts on `firstQueue` (first
  Do-next queue with work, else All) and starts over whenever the dataset is replaced (store
  `meta` changes: load, import, Undo, reset — a server refresh keeps `meta`). The docked
  detail always shows a comment: the first of a picked queue; a comment that leaves the queue
  while open (e.g. just closed in "Verify") stays shown and next/previous continue from its
  old place (`anchor`). Under 1100 px of Work width the queues become a scrolling row and the
  detail is the old drawer. On wide screens the list/detail widths are resizable: two
  `ColumnHandle` separators (drag, arrow keys ±16, double-click resets) drive `useColumns`
  (localStorage `tabelin.workCols`; the list never gets narrower than 320 px). Pane bodies and
  `.wb-scroll` hide their scrollbar until hover/focus. Keys: J/K, 1–9, Ctrl/⌘+Enter, Ctrl+V (DetailPanel).
- `src/components/DetailPanel.jsx` — one comment: photos (crop, paste, drop, inline Undo),
  text, status, discipline/commenter (the comment number, date, camera and Navisworks user are
  only in the title's tooltip), close date, resolution, custom fields, history, footer
  (Next after closing, delete, **Next comment** = the one strong action). `docked` renders it
  as the Work pane (no slide/close/click-outside); otherwise a drawer. `nav` may carry
  `hasPrev`/`hasNext`. Split out: `detail/StatusPicker.jsx`, `detail/CustomFields.jsx`,
  `detail/History.jsx`.
- `src/views/Dashboard.jsx` — **Insights**, the close-out cockpit:
  all numbers come from the pure `lib/overview.js` (`computeOverview(records, statuses, {target})`
  — counts, pace = close-outs in the last 14 days from `closedAt`, needed pace and forecast vs
  the review target, log-sheet readiness = closed + after-photo + resolution, per-discipline
  scorecard/forecast/ages, pipeline, burn-up, weekly close-outs, "raised by" party from the
  commenter prefix). Charts are hand-drawn SVG in `components/OverviewCharts.jsx` (no chart
  library; colours are MD3/status CSS variables so themes switch without re-render). Layout
  (top to bottom): hero (progress · target sentence "At today's pace you finish … — N days
  late" · log-sheet ready), **Do next** (each blocker counted once — unassigned, no
  after-photo, in review, no resolution, open > 3 months — ranked, each "Open list" drilling
  into exactly those rows), **Disciplines** (one table: closed, left, pace now/needed,
  forecast finish, oldest, verdict; replaces the separate forecast/backlog cards), burn-up +
  closed per week, and **More insights** (forecast runway, pipeline, backlog age, raised by —
  collapsed, choice in localStorage `tabelin.ovMore`). Red only means late/behind. Labels stay minimal — explanations live in `InfoTip`s and the shared chart
  tooltip (`TipProvider`/`useTipProps`). The review target is `settings.reviewTarget`
  ('YYYY-MM-DD', set from the Target chip). Pace/forecast need `closedAt`, so they fill in as
  comments are closed in Tabelin.
- `src/views/*` and `src/components/*` — screens and shared MD3-flavored primitives
  (`ui.jsx`), the editable `DetailPanel.jsx`, and the `Toast.jsx` notifier.

### Review workflow (V2)

- **Roles** are `admin` and `reviewer` (older `editor`/`viewer` accounts are migrated to
  reviewer in `db.Open`). Server: `isAdminRole` / `canReviewRole` in `api/api.go`; a reviewer
  may PATCH only `commenter, discipline, resolution, status, closedAt, extra` (`buildPatch`
  `admin` flag) and upload/remove photos; import, add/delete comments, config, template,
  projects, reviews and users are admin-only. Client: `source.caps.canAdmin` = setup (admin;
  always true offline), `caps.canReview` = editing comments (`serverSource`: `isAdminUser` /
  `isReviewerUser`).

- **Re-import merges** (`lib/merge.js`): importing into a review that already has comments
  opens `ImportDialog` with `planMerge(existing, incoming)` — matched by Navisworks comment ID
  (`recordKey`; viewpoint + raw text when a report has no IDs). Matched comments get only the
  Navisworks fields (`SOURCE_FIELDS`) refreshed; status, resolution, photos and custom fields
  stay. Missing comments are kept or moved to the done status. `useImport` calls
  `source.importMerge(plan, …)`: offline `applyMergeLocal` (over the sample it replaces —
  `source.isFreshImport`); on the server `server.applyMergeRemote`, which stores an undo record
  in the review config key `lastImport` (`undoImportRemote`; also in the review ⋯ menu).
- **Delete**: `DELETE /api/reviews/{rid}` and `/api/projects/{pid}` (admin; a project must be
  empty first), `POST /api/reviews/{rid}/records/delete` (bulk), `DELETE /api/records/{id}/images`
  (photo removal — `syncRecord` sends it when an image field becomes empty; the store delays
  the removal 6 s so the Undo toast can cancel it). Confirmations use the shared `Dialog`
  (`components/ui.jsx`); reviews with comments need the name typed.
- **Export**: `components/ExportButton.jsx` is a split button — "Export log sheet"
  (`lib/logsheet.js`, the template export; no template → toast linking to Settings › Template)
  with Quick Excel in its menu (`quiet` = tonal, for the Work list). Used on Insights (whole
  review + Overview sheet) and Work (the comments shown).
- **Work queues and drill-downs**: every count (Work queues, Insights Do next) opens exactly
  the rows it counts — both use `lib/queues.js` (`tests/queues.test.js` checks each queue's
  filter against `overview.attention`, the smoke clicks every queue). Row checkboxes open the
  `.t-bulk` bar (discipline / status / commenter → store `bulkUpdate`).
  The detail has prev/next (J/K), keys **1–9** = status (registry order), **Ctrl/⌘+Enter** =
  next comment, "Next after closing" (localStorage `tabelin.autoNext`), delete (admin), and a
  **History** section on the server: `record_events` rows written by patch / bulk patch /
  photo add-remove / import, read via `GET /api/records/{id}/history` (newest first; the
  drawer folds repeats by the same person within 10 min). The catch-all discipline `OTHER`
  (or empty) is shown as **"Unassigned"** everywhere (`discLabel`/`discOptions` in `ui.jsx`);
  the stored value stays `OTHER`. Dates read "9 Dec 2024, 07:25" (`overview.fmtStamp`).
  No UI text below 12 px.
- **Manual comments**: Work › Add (`components/AddCommentDialog.jsx`, writers only) →
  store `addRecord` (server: `POST /api/reviews/{rid}/records/one` → the new record with its
  id and version; `createRecordRemote`). They
  carry `source: 'manual'` (`merge.MANUAL`), so a re-import never lists them as missing.
  Blank discipline/commenter follow the text (`inferDiscipline`/`detectCommenter`); a chosen
  commenter is prefixed into `commentRaw`. A pasted/dropped snapshot becomes the before photo.
- **Saving and refresh (server).** `records.version` goes +1 on every change (edit, bulk
  edit, photo add/remove); `records.modified_at` (fixed-width UTC text) stamps every change
  incl. the insert. Both columns are added to older databases by `db.addRecordColumns`.
  `PATCH /api/records/{id}` takes an optional `version`; stale → **409** with the current
  record, success → `{ ok, record }`. Bulk patch takes an optional per-row `version`; stale
  rows are skipped and returned in `conflicts`, new versions in `versions`. Photo upload /
  removal answer the new `version` (photos never conflict). Import answers `ids` in the order
  sent (`importParsedRecords` uploads before-photos by those ids). `GET /api/records/{id}`
  returns one record. Client: the store keeps the latest known version per id (`versions`
  ref), sends saves of one record **one after another** (`inflight` chain) so a browser never
  conflicts with itself, and on 409 shows the server's record with the toast "Someone else
  changed this comment — showing the latest." If the refused save carried a resolution that
  differs from the server's, the typed text stays in the field (unsaved) and the toast offers
  **Save mine**. Light refresh: `GET /api/reviews/{rid}/records?since=<time>` →
  `{ records: changed, ids: all, next }` (`next` starts 10 s back, `refreshOverlap`, so a save
  landing mid-refresh is not missed); the store polls every `REFRESH_MS` (30 s), on window
  focus and when the tab becomes visible, and merges with `MERGE_SERVER` — newer versions
  replace, new ids are added, deleted ones dropped, and records with a pending or in-flight
  save here are skipped (their save goes through or comes back as a conflict).
- **Access and recovery (Phase 5, server).** *Wrong PINs:* 5 wrong in a row lock the account
  for 5 minutes (`pin_attempts`; 429 + `Retry-After`; cleared by a correct PIN or admin Reset
  PIN; `Login.jsx` shows the server's message). A forgotten PIN (e.g. the only admin's):
  `tabelin-server.exe -reset-pin <account>` (`api.ResetPIN`, run with the server closed) clears
  it and quits. *Per-project access:* `projects.restricted` +
  `project_members`; unrestricted by default; admins always see all. Every route that names
  a project / review / record / file is wrapped in `a.guard(scope, h)` in `api.Routes()`
  (`access.go`) → 404 when the caller may not open it **or it is in the Trash**; a new scoped
  route must be wrapped too. `GET/PUT /api/projects/{pid}/access`. *Trash:* deleting a
  comment or review sets `deleted_at/deleted_by` (`trash.go`); lists and counts filter
  `deleted_at=''`; `GET /api/trash`, `POST /api/trash/restore|purge` (admin); purged after
  `TrashDays` (30) at startup and on listing; a project with reviews in the Trash can't be
  deleted; Undo import deletes for good (`deleteRecords(rid, ids, true)` → `?forGood=1`).
  *Backup:* `GET /api/backup` (admin) → zip of a `VACUUM INTO` copy of `tabelin.db` + `files/`
  + `RESTORE.txt`; restore steps in `server/README.md`, tested by `TestBackupRestores`.
  Columns are added to older databases by `db.addRecordColumns` (generic `addColumns`).
  *UI:* **Trash** is its own sidebar item for admins on the server (`NAV` entry with
  `cap: 'trash'`; `views/Trash.jsx`: Comments / Reviews, Restore, Delete for good, bulk; a
  comment of the open review comes back via store `putBack`). Deleting a comment in Work says
  "Move to Trash" and the toast offers **Undo** (`putBack` → `source.restoreRecord`).
  **Settings › Backup** (`components/BackupCard.jsx`, `source.backupUrl`). **Who can open…** in
  the project list's ⋯ menu (`ProjectPicker` `AccessDialog`; lock chip "N people" from
  `listProjects` `restricted`/`members`). Offline nothing changes: `caps.trash/backup` false,
  delete stays final.
- **Paste a snapshot (Ctrl+V)** in the drawer goes to the photo slot last hovered/focused
  (After by default; the `.ba-kbd` "Ctrl V" chip marks it) and opens the crop dialog. On
  Windows the After slot also has **Snip** (`ms-screenclip:` link → Snipping Tool's clip mode);
  back in the tab the clip is read from the clipboard automatically only in a secure context
  (localhost / file://), otherwise the hint asks for Ctrl+V.
- **Releases**: `.github/workflows/build.yml` runs only by hand (Actions → Build → Run workflow,
  inputs `version`, `release`). It builds the web app, the Windows `tabelin-server.exe`
  (`main.version` set via `-ldflags -X`) and attaches both exe and `tabelin-offline.html` to a
  GitHub Release tagged `v<version>`. Never push-triggered: don't start it until the user says "build".
- **Help** (`views/Help.jsx`, last sidebar item): "How to use" (flow infographic + one card per
  step with a real screenshot) and "Roles & limits" (role cards, permission matrix, safety nets,
  limits) and "About" (version, run mode, where each record field comes from), in EN / ID (`localStorage tabelin.helpLang`, default from the browser language).
  Screenshots are WebP files in `src/assets/help/`, inlined at build time so Help works
  offline — re-capture them when a pictured screen changes (`node scripts/help-shots.mjs`
  after `npm run build` redoes overview/list/drawer/bulk from the offline build; needs Pillow). Keep the matrix in sync with the
  server's role checks (`isAdminRole` / `canReviewRole` / `requireAdmin`).
- **Insights setup checklist** (import · target · template · invite team), dismissible per
  review in localStorage `tabelin.setupDone.<reviewId|local>`. **Settings › Users** shows an
  invite card with the LAN address from `GET /api/server-info` and a copyable message.

### Conventions that matter

- Tailwind color utilities map to MD3 role tokens (`bg-surface`, `text-on-surface`,
  `text-primary`, `status-open/review/closed`) defined in `tailwind.config.js` +
  `src/index.css`. Prefer these over hard-coded colors so theming stays consistent.
  The colours are wrapped in `color-mix(… calc(<alpha-value> * 100%) …)` in the config so
  opacity modifiers (`border-outline-variant/50`) actually generate.
- **Surfaces:** cool-grey canvas (`background`), white cards (`Card` → `.t-card`: shadow
  `--tabelin-elev-card`, no border; a hairline ring in dark). In-card fills use
  `surface-low/container/high`. The **sidebar has its own pinned tokens** on `[data-rail]` /
  `.t-flyout` in `index.css`: the original lavender look in light mode; in dark mode the card
  surface (no outline, card shadow) with a solid blue active item and a soft blue tint for the
  active Settings sub-item. Don't restyle it unless asked.
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
  `excel.js`. If you add or rename a record field, update **both**, plus the search in
  `lib/queues.js` (`baseFilter`).
- `vite.config.js` sets `base: './'` for subpath/static hosting (e.g. GitHub Pages).
- **Workbench tokens and primitives** (Phase 4, end of `index.css`): type scale
  `--wb-text-xs…3xl` (12/13/14/16/20/26/34 px), spacing `--wb-space-1…8` (4-px steps), one
  motion scale `--wb-dur-fast/base/slow` (120/200/320 ms) with `--tabelin-ease` and
  `--wb-ease-enter`, colours = the MD3 roles. The ten primitives: Button, Field, Select,
  Dialog, Menu (ExportButton), Chip (StatusBadge/DisciplineBadge), ListRow (`.wb-row`,
  QueueItem), Pane (+PaneHeader), Toast, Tooltip (InfoTip) — `components/primitives.jsx` adds
  Pane, PaneHeader, QueueItem, Kbd, Field. Build Work UI from these only; no one-off classes.
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
- `docs/retrospective.md` — a critical review of the whole build (what to keep, redesign,
  remove) and `docs/plan-v2.md` — the phased improvement plan that follows from it. **Start a
  new work session from `plan-v2.md`**: one phase per session, standing rules included.
- `docs/ux-review.md` — running UI/UX review notes: scores, open findings, the owner's 9.2
  target, and scope (**desktop only** — the owner doesn't need a phone layout).
- `docs/Sample/` — the original Navisworks report and viewpoint images (also copied into
  `src/sample/` where they are embedded into the bundle as the app's seed data).
