# Tabelin — improvement plan (for a fresh Claude Code session)

This plan turns [`retrospective.md`](./retrospective.md) into work on the **existing code**.
It is not a rewrite: each phase is one session-sized change that leaves the tool working.

Read first, in this order: `CLAUDE.md` (architecture and conventions), `docs/retrospective.md`
(why), this file (what, in what order), `docs/ux-review.md` (UI notes).

## How to start a session

Paste this as the first message of the new session (it is in Indonesian because the owner
works in Indonesian):

> Baca `CLAUDE.md`, `docs/retrospective.md`, dan `docs/plan-v2.md`. Kerjakan **Fase N** dari
> `docs/plan-v2.md` saja (ganti N dengan nomor fase). Ikuti "Aturan tetap" di rencana itu.
> Mulai dari branch `claude/v2`. Setelah selesai, centang fase itu di `docs/plan-v2.md`,
> lalu laporkan hasil tesnya dalam Bahasa Indonesia yang sederhana.

One phase per session. Do them in order unless a phase says it is independent.

## Standing rules (Aturan tetap)

- **Owner:** non-technical, writes Indonesian. Reply in plain Indonesian; UI text stays English.
- **Base branch:** `claude/v2` holds all current work; `main` is behind it. Start from
  `claude/v2`. If the session is given its own branch name, branch it from `claude/v2`.
- **Commit and push often.** The cloud container can reset; unpushed work is lost.
- **Never start the GitHub "Build" workflow and never build an exe unless the owner says
  "build".** Pushing is fine (the workflow is manual-only).
- **UI changes: mockup first**, build only after the owner's go-ahead. Server/test/refactor
  work with no visible change needs no mockup.
- **Removing a feature needs the owner's yes**, even when this plan recommends it.
- **Desktop only.** No phone layout work.
- **Data stays on the office network**; no cloud services, no telemetry.
- Keep `CLAUDE.md` in step with every change that alters architecture or conventions.
- After a frontend change that should reach the server binary: `npm run build && cp dist/index.html server/web/index.html`.

## Environment notes

- Frontend: `npm install`, `npm run dev` (5173), `npm run build` → `dist/index.html`.
- Server: `cd server && go run .` — env `TABELIN_ADDR` (default `:8787`), `TABELIN_DATA`
  (default `./data`), `TABELIN_NO_BROWSER=1`. First sign-in as `admin` sets its PIN.
- Headless browser for checks: Chromium is pre-installed
  (`/opt/pw-browsers/…/headless_shell`); use `playwright-core` with `executablePath`.
  Do not run `playwright install`.
- Sample input: `src/sample/report.html` (+ `vp00*.jpg`); the company template is
  `docs/3D REVIEW LOG_MASTER_FORMAL_90_OFA.xlsx`.
- Tests: `npm test`, `cd server && go test ./...`, `npm run smoke` (see `CLAUDE.md` › Tests).

---

## Phase 0 — Housekeeping (small, do first) ☑

**Goal:** a clean, truthful starting point.

1. Remove the unused `recharts` dependency (`package.json`, lockfile); confirm `npm run build` passes.
2. Fix `CLAUDE.md`'s opening section: it still describes a browser-only app. Describe both
   modes (office server, offline file) in two short paragraphs.
3. Ask the owner whether to bring `main` up to date with `claude/v2` (a PR + merge). Do it
   only on a yes.

**Done when:** build passes; `CLAUDE.md` intro matches reality; owner answered the `main` question.

## Phase 1 — Safety net: automated tests ☑

**Goal:** the three risky areas can no longer break silently. No behaviour change.

**Frontend (Vitest + happy-dom or jsdom):** add `npm test`.
- `src/lib/parser.js` — parse `src/sample/report.html`: record count, a known comment's
  fields, status normalisation, commenter/discipline detection, raw vs cleaned text.
- `src/lib/merge.js` — `planMerge` / `applyMergeLocal`: matched keeps status/resolution/photos;
  new report text refreshes source fields only; added and missing counts; manual comments
  (`source: 'manual'`) never count as missing; "missing → close" stamps `closedAt`.
- `src/lib/overview.js` — `computeOverview` with a fixed `today`: counts, pace, forecast,
  lateness, Do-next numbers (`attention`), `fmtStamp`.
- `src/lib/templateExcel.js` — export the sample records into the company template; assert
  the log sheet has one row per record in the right columns and the workbook still opens
  (JSZip parse; media/drawing parts from the template are still present).

**Server (Go `testing` + `httptest`, temp data dir):** `cd server && go test ./...`
- Roles: as a reviewer, `POST import`, `DELETE record`, bulk delete, `PUT` project/review
  config, `PUT` template, `GET /api/users` → 403; `PATCH` status/resolution → 200;
  `PATCH` of a report field (`viewpoint`) → rejected. As admin, all allowed.
- History: a patch, a bulk patch, a photo add/remove and an import each write a
  `record_events` row; `GET /api/records/{id}/history` returns them newest first.
- Migration: a database with `editor`/`viewer` users opens with those users as `reviewer`.
- Delete rules: a project with reviews cannot be deleted; deleting a review removes its records.

**Also:** commit one smoke script (`scripts/smoke.mjs`, `playwright-core`) that starts the
built app, imports the sample, opens a comment, changes status, and fails on any page error.
Add `npm run smoke`. Document all three commands in `CLAUDE.md`.

**Done when:** `npm test`, `go test ./...` and `npm run smoke` pass locally; nothing else changed.

## Phase 2 — Server correctness: create, versions, refresh ☑

**Goal:** no silent lost work between two users. Mostly invisible; one small UI message.

1. **Create endpoint.** `POST /api/reviews/{rid}/records/one` (admin) inserts one record and
   returns it (with `id`). Switch `store.addRecord` (manual comments) to it and stop relying on
   "the last N rows of a re-fetch" for single adds. Keep bulk import for reports; make
   `importParsedRecords` use IDs returned by the import response (return `ids` in order)
   instead of positional matching.
2. **Record versions.** Add `version INTEGER NOT NULL DEFAULT 1` to `records` (schema +
   an `ALTER TABLE` step in `db.Open` for existing databases — `CREATE TABLE IF NOT EXISTS`
   does not add columns). Every successful patch increments it. `PATCH /api/records/{id}`
   accepts `version`; if it is present and stale → `409` with the current record. Bulk patch:
   per-row version optional; stale rows are skipped and reported.
3. **Client.** Records carry `version`; `syncRecord` sends it. On `409`, replace the local
   record with the server's and show a toast: "Someone else changed this comment — showing
   the latest." Never drop the user's typed resolution silently: if only `resolution`
   conflicted, keep their text in the field and say so.
4. **Light refresh.** `GET /api/reviews/{rid}/records?since=<iso>` returns records changed
   after that time. Poll every 30 s and on window focus while a review is open; merge into
   the store without disturbing a field the user is typing in.
5. Tests for all of the above (extend Phase 1 suites).

**Done when:** two browser sessions editing the same comment produce a visible conflict
message instead of a silent overwrite; the other session's changes appear within ~30 s
without a reload; tests pass.

## Phase 3 — One data layer instead of the mode flag ☑

**Goal:** screens stop knowing whether they are offline or on the server. No visible change.
Do this only after Phases 1–2 (the tests are the safety net).

- Today `remoteState` is read in ~50 places across `store/store.jsx`, `lib/server.js`,
  `lib/persist.js`, `Root.jsx`, `views/Dashboard.jsx`, `components/DetailPanel.jsx`, `views/Help.jsx`.
- Introduce `src/data/` with one interface and two implementations:
  `localSource` (IndexedDB + optional session folder; wraps today's `persist.js`) and
  `serverSource` (wraps today's `server.js` API). Methods cover: load records, update one,
  bulk update, add, delete, set/remove photo, import+merge (with undo), template
  load/save, settings load/save, history, capabilities (`canAdmin`, `canReview`, `hasHistory`).
- The store and views call only the interface. Role checks come from `capabilities`.
- Move step by step (records → photos → import/merge → settings/template), running the
  tests after each step. Delete each `remoteState` branch as it becomes unused.

**Done when:** `remoteState` is referenced only inside `src/data/` and the boot code;
all tests and the smoke script pass in both modes; behaviour is unchanged.

## Phase 4 — Workbench screen (needs the owner's choice first) ☑

**Goal:** the work happens on one screen.

- Mockups: https://claude.ai/artifact/7xeXKxNyLqoY64abSTkwMi (A Focus, B Command Center,
  C Workbench). The retrospective recommends **C, with A's headline sentence**. The owner
  has **not chosen yet** — ask, and build nothing until they do.
- If C: queues (the Do-next groups, plus All and Closed) on the left, the list in the
  middle, the detail on the right (today's drawer content, split into smaller components:
  photos, status, fields, history). Progress and target become a strip on top. Charts move
  to an "Insights" page. Keep every keyboard shortcut. Keep roles.
- Before the screen: define the token set (type scale, spacing, colour roles, one motion
  scale) and the ~10 primitives, and build the new screen only from those.
- Re-capture or replace Help screenshots (see Phase 6).

**Done when:** owner approved the built screen; all drill-downs still open exactly the
counted rows; tests and smoke pass.

## Phase 5 — Access and recovery ☐ (independent of 3–4; can follow Phase 2)

Each item is separate; confirm the list with the owner before starting.

1. **PIN attempt limit:** after 5 wrong PINs for an account, lock sign-in for that account
   for 5 minutes (server-side); clear on success; admin "Reset PIN" also clears it.
2. **Soft delete:** deleted comments and reviews go to a Trash for 30 days (admin can
   restore or delete for good). Needs a small UI — mockup first.
3. **Backup:** an admin "Download backup" (zip of the database + photos) and a documented
   restore (replace the `data` folder). Test a restore once.
4. **Per-project access (ask first):** only if the owner wants it — which users may open
   which project.

**Done when:** each accepted item has tests and the owner has tried it.

## Phase 6 — Simplify (every item needs the owner's yes) ☐

Recommendations from the retrospective; ask one by one, with a one-line consequence each:

- Exports write "Unassigned" (or blank) instead of `OTHER`.
- Quick Excel: drop the Overview sheet and chart images; keep the comment list.
- Help: replace embedded screenshots with short text + in-place hints; one language.
- Settings: hide the detection rule editor and status editor behind "Advanced", or remove.
- Template mapping editor: reduce to what the company template needs.
- Remove the four "More insights" charts, or keep only those the owner uses.

**Done when:** the owner decided each item and the accepted ones are implemented with tests updated.

## Phase 7 — Pilot ☐

Not code. Two or three real reviewers use the tool for a week on a real review. Collect:
where they hesitated, what they asked, time to close ten comments, any lost work. Record
findings in `docs/ux-review.md` and turn them into the next plan.

---

## Definition of done for the whole plan

- A new reviewer closes ten comments without help.
- A re-import loses nothing.
- Two people editing the same comment never lose work silently.
- The exported log sheet is accepted unchanged.
- Parsing, merge, permissions and export are covered by tests that run before every release.
- Restoring from a backup has been tried once.

## Progress log

Tick the phase box above and add one line here per finished phase (date, branch, what changed).

- 2026-11-14 — Phase 0, branch `claude/v2`: removed the unused `recharts` dependency (build
  output byte-identical); rewrote the `CLAUDE.md` intro to describe both modes (office server,
  offline file). Owner said yes: `main` brought up to date with `claude/v2` (PR #1, merged).
- 2026-11-14 — Phase 1, branch `claude/v2`: `npm test` (Vitest: parser, merge, overview,
  template export — 44 tests), `go test ./...` (sign-in, roles, history, migration, delete
  rules), `npm run smoke` (offline file in headless Chromium). No app code changed. Found, not
  fixed: served from a static host that answers every path with `index.html` (e.g.
  `vite preview`), the app thinks it is on the office server and crashes on start.
- 2026-11-14 — Phase 2, branch `claude/v2`: create-one endpoint (manual comments), import
  returns ids, record `version` + 409 on stale saves (single and bulk), conflict toast with
  "Save mine" for a typed resolution, `?since=` refresh every 30 s / on focus, `GET` one record.
  Help › Limits text updated (no longer "last save wins"). New: `sync.test.js`,
  `phase2_test.go`, `npm run smoke:server` (two browsers on the real server).
- 2026-11-14 — Phase 3, branch `claude/v2`: `src/data/` (one interface, `localSource` +
  `serverSource`, `caps`); store, settings, App and all screens use it; `remoteState` removed
  entirely (boot code picks the source). Guards in `data.test.js`. Both smoke scripts extended
  (roles, shared target, history, template, merge + undo, add/delete, reset) and run green on
  the code before and after the change — no visible change.
- 2026-11-14 — Phase 4 built (approved by the owner 2026-11-15), branch
  `claude/v2`: owner chose C (Workbench) with A's headline sentence. Work screen (queues ·
  list · docked detail, headline strip) replaces Overview + Viewpoints; charts stay on
  Insights. Tokens + primitives in `index.css` / `components/primitives.jsx`; shared queue
  filters (`lib/queues.js`), headline (`lib/headline.js`), import (`ImportAction.jsx`); detail
  split into StatusPicker / CustomFields / History. Help text and 4 screenshots updated
  (`scripts/help-shots.mjs`). Kept the app's own colours and sidebar, not the mockup's.
- 2026-11-15 — Phase 5 in progress, branch `claude/v2`: owner accepted all four items.
  Done and tested: wrong-PIN limit (server + sign-in message). Server done and tested, UI to
  come after the mockup is approved: Trash (soft delete, restore, purge, 30-day expiry),
  per-project access (unrestricted by default, guards on every scoped route), backup download
  with a tested restore. Mockups: design canvas, row "Fase 5".
