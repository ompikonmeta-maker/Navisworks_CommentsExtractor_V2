# Retrospective: Tabelin, reviewed as if we could start over

Written 2026-11-14, after release v2.1.0. The action plan that follows from it is
[`plan-v2.md`](./plan-v2.md).

The tool works, and several parts are good, but its shape comes from the order in which
requests arrived, not from a design. **I would not build it this way again.**

Caveat: the UX scores in [`ux-review.md`](./ux-review.md) (6.2 → 8.0 → 9.2) are a judgement
from screenshots. No real reviewer was ever observed using the tool, so treat those numbers
as weak evidence.

Each major point uses: **Current approach → Problem → Better approach → Reason → Expected impact.**

---

## 1. What I would do first

Before any code, settle four things on paper.

**Who does the work, and what is one unit of work?**
- **Current approach:** an Overview dashboard was built first and redesigned four times.
- **Problem:** the job is "a reviewer closes one comment with a photo and a note, a few
  hundred times." That happens in the list and drawer, which got far less attention.
- **Better approach:** write that sentence down first and design the close-a-comment loop
  before any dashboard.
- **Reason:** the "Workbench" idea only appeared in the last mockup, and it is the right structure.
- **Expected impact:** very high; most of the Overview rework would not have happened.

**Where does the data live?**
- **Current approach:** browser-only single file, then a server bolted on once it was clear
  the data is sensitive and must stay on the office network.
- **Problem:** two modes now run through the whole codebase (section 4).
- **Better approach:** ask on day one "one person or a team, and where may the data be stored?"
- **Expected impact:** very high.

**What is the real input cycle?**
- **Current approach:** import was built as "load a report."
- **Problem:** Navisworks reports are re-exported repeatedly. Merge-by-comment-ID came late
  and had to be retrofitted.
- **Better approach:** treat "import again over existing work" as the primary import case.
- **Expected impact:** high.

**What is out of scope?**
- **Current approach:** nothing was ruled out up front.
- **Problem:** effort went into a phone layout that was not needed, and three roles were
  built before being reduced to two.
- **Better approach:** a short written scope list: desktop only, two roles, one company template.
- **Expected impact:** medium.

## 2. Primary objectives

In this order:
1. **Time to close one comment correctly** (status, after-photo, resolution).
2. **A log sheet the company accepts**, exported without hand-fixing.
3. **No lost work**: re-import, two people editing, a crashed browser.
4. **Zero install on an office PC, with data that never leaves the network.**

Dashboards, theming and animation serve these; they are not objectives.

## 3. What I would prioritise differently

- **The work loop over the Overview.** The Overview shows what to do, but the work itself
  still happens on another screen.
- **Data safety over features.** Nothing protects two people from overwriting each other;
  the last save wins.
- **Tests on the three risky parts**: report parsing and merge, role checks, template export.
  There are none. Every check so far was a throwaway browser script, lost whenever the
  container reset.
- **One real user session early.** Watching one reviewer for an hour would have replaced
  most of the self-assigned scoring.

## 4. What I would redesign

**Two modes in one codebase**
- **Current approach:** the app runs either offline or against the server, with a global
  `remoteState` flag checked across store, settings, persistence, import and views
  (about 50 references in 7 files).
- **Problem:** every feature is written twice, and bugs hide in one mode (the photo-removal
  bug existed only on the server).
- **Better approach:** one data interface with two implementations, local and server.
  Screens never know which one they have.
- **Reason:** the screens are identical; only storage differs.
- **Expected impact:** very high for maintainability.

**Record creation**
- **Current approach:** a manually added comment goes through the bulk import endpoint; the
  client then re-fetches the whole list and assumes the newest rows are the ones it sent.
- **Problem:** fragile if two people add or import at the same time.
- **Better approach:** a create endpoint that returns the new record with its ID.
- **Expected impact:** medium, but a correctness risk today.

**Concurrent editing**
- **Current approach:** last save wins; others see changes only after a reload.
- **Problem:** two reviewers on one comment silently lose work.
- **Better approach:** a version number per record. A save against a stale version is
  rejected and the user sees the newer values. Add a light refresh of the open list.
- **Expected impact:** high for team use.

**Screen structure**
- **Current approach:** Overview and Viewpoints are separate screens, with a drawer that
  covers the list.
- **Problem:** users go back and forth; the drawer is long enough that History sits below the fold.
- **Better approach:** three panes (queues, list, detail) with the progress strip on top.
  Charts move to an Insights page.
- **Expected impact:** high.

**Visual system**
- **Current approach:** styling grew by accretion: a 1,607-line stylesheet of hand-written
  classes on top of Tailwind, three visual passes, plus a sweep to remove sub-12px text.
- **Problem:** each redesign touched everything.
- **Better approach:** fix a small token set (type scale, spacing, colour roles, motion) and
  about ten primitives before building screens.
- **Expected impact:** medium-high.

**Large files**
- **Current approach:** the drawer is 638 lines, the app shell 597, the Overview 596.
- **Problem:** the drawer alone mixes photos, cropping, keyboard handling, status, custom
  fields and history.
- **Better approach:** split by responsibility.
- **Expected impact:** medium.

**Animation**
- **Current approach:** added piece by piece: card reveal, sidebar spring, theme circle, popovers.
- **Problem:** no shared rule for what moves and why.
- **Better approach:** motion only where it explains a change (list to detail, queue switch,
  save confirmation), with one duration scale.
- **Expected impact:** low-medium.

## 5. What I would simplify or remove

- **Detection rule engine (seven rule modes, live editor).** Built for a hypothetical other
  project. One good default plus a simple "prefix before the colon" option covers the real data.
- **Configurable statuses.** Open / In Review / Closed never changed in practice; the
  flexibility touches badges, charts, keys and export.
- **Template mapping editor.** Keep the export engine; shrink the editor. It serves one
  company template but is built as a general tool.
- **Quick Excel with an Overview sheet and chart images.** Duplicates the log sheet. Keep a
  plain list export.
- **Four "More insights" charts** (forecast runway, pipeline, backlog-age heatmap, raised by).
  Hidden by default now, which suggests they were not needed.
- **Embedded Help screenshots.** They go stale with every UI change.
- **Bilingual Help in an English-only UI.** Pick one language for everything.
- **The stored value `OTHER`.** Shown as "Unassigned" on screen but still written as `OTHER`
  in exports. Store "unassigned" as empty.
- **Leftovers.** An unused chart library (`recharts`) is still a dependency.

## 6. What I would keep exactly as it is

- **Single Go binary + SQLite, double-click to run.** Fits "no admin rights, data stays in
  the office"; updating means replacing one file.
- **Template export by editing the Excel file's internals directly.** The company's logos
  and layout survive untouched.
- **Keeping the raw comment text alongside the cleaned text.** Made re-detection and
  re-import possible later.
- **Merge by comment ID with a preview and undo.** Matches how reports actually arrive.
- **"Do next": each blocker counted once, each opening exactly its list.**
- **Keyboard flow in the drawer**: status keys, next comment, paste a snapshot.
- **Roles enforced on the server**, not only by hiding buttons.
- **Manual-only release workflow** producing the exe and the offline file.
- **Mockup first, build after the owner's go-ahead.** Skipping it cost the most.

## 7. What I would never do again

1. Build a dashboard before the work screen.
2. Add a second runtime mode by branching on a global flag.
3. Ship changes with no automated tests, relying on scripts kept in a temporary folder.
4. Score my own design and treat the score as progress.
5. Build configurability (rules, statuses, mapping) ahead of a second real case.
6. Leave uncommitted work in a container that can reset (work was lost once this way).
7. Let builds run on every push for weeks without telling the owner.
8. Let documentation drift (project notes still opened by calling this a browser-only app).

## 8. What we discovered too late

| Discovery | When it should have shaped things |
|---|---|
| Data is sensitive and must stay on the office network | Before choosing browser-only |
| Reports are re-imported over existing work | Before designing import |
| Desktop only | Before any responsive work |
| Two roles are enough | Before building three |
| The reviewer's loop is the product | Before the first Overview |
| Issues also come from outside Navisworks (manual comments) | In the data model |
| People want to know who changed what | In the data model, not as a late table |
| Office login (Windows account) was the original identity plan | Never built; PIN login was a stopgap that stayed |

## 9. What is holding the tool back now, ranked

1. **No tests**: every change risks the merge, roles or export.
2. **Silent overwrite between users** and no live refresh.
3. **Two-mode code paths**: slow and error-prone to extend.
4. **Work split across two screens** (the Workbench problem).
5. **Weak access control**: PIN with no attempt limit; everyone sees every project.
6. **Fragile record creation** through the import endpoint.
7. **Deletes are permanent** and there is no built-in backup.
8. **Over-general settings** that few people will touch.
9. **Styling debt** that makes each redesign a full sweep.
10. **Unverified UX**: no real usage data.

## 10. Ideal build sequence (from scratch)

1. **Foundation:** scope sentence, data model (project, review, comment, photo, event,
   version), one data interface, tokens and primitives.
2. **Core loop:** import, merge, three-pane work screen, close with photo and note. Tests
   for parse and merge.
3. **Deliverable:** log-sheet export against the real template, with a test comparing output
   to a known-good file.
4. **Team:** server, login, two roles, version checks, history. Tests for permissions.
5. **Steering:** progress strip, Do next queues, one Insights page.
6. **Hardening:** backup and restore, attempt limits, soft delete, release pipeline.
7. **Pilot** with two or three reviewers, then adjust.

---

# Blueprint for a Version 2.0 built today

**Product philosophy:** a workbench for closing review comments; everything else is secondary.

**Core objectives:** fast correct close-out; an accepted log sheet; no lost work; zero
install on-premises.

**Architecture:**
- Server-first: Go binary + SQLite, with the web app embedded.
- One data interface. The offline file is the same app with a local implementation behind it.
- Records carry a version; all changes write an event.

**UX philosophy:** one screen for the work; one primary action visible at a time; keyboard
for repetition; every number leads to its list.

**UI and visual direction:** light, quiet, high contrast; one accent colour; red only for
lateness; 12px minimum text; desktop only. Structure from mockup option C (Workbench), with
the headline sentence from option A (Focus) —
https://claude.ai/artifact/7xeXKxNyLqoY64abSTkwMi.

**Component strategy:** about ten primitives (button, field, select, dialog, menu, chip,
table row, pane, toast, tooltip). Screens are composed from them, with no one-off classes.

**Data and state strategy:** the server is the source of truth; the client keeps a cache
with optimistic edits and version checks. Settings live per project on the server. Browser
storage holds only personal preferences.

**Performance strategy:** paginate or virtualise the list; load photos on demand as files,
not embedded text; keep the single-file build for offline use.

**Features to keep:** import and merge with preview and undo, Do next, drawer shortcuts and
paste, bulk edit, manual comments, history, log-sheet export, roles, setup checklist,
release workflow.

**Features to redesign:** screen structure, record creation, the two-mode plumbing, the
template mapping editor, Help, login.

**Features to remove:** rule-engine editor, configurable statuses, the Overview sheet in
Excel, hidden insight charts, embedded screenshots, the phone layout.

**Things to avoid:** dashboards before the work screen; configurability without a second
case; self-scored progress; untested merge or permission code.

**Definition of done:**
- A new reviewer closes ten comments without help.
- A re-import loses nothing.
- Two people editing the same comment never lose work silently.
- The exported log sheet is accepted unchanged.
- Parsing, merge, permissions and export are covered by tests that run before every release.
- Restoring from a backup has been tried once.

---

## The 10 decisions I would make differently, highest impact first

1. Design the close-a-comment work screen first, and the dashboard last.
2. Ask where the data may live on day one, and build server-first.
3. Put one data interface between screens and storage instead of a mode flag.
4. Write tests for parsing, merge, permissions and export from the first week.
5. Treat re-import over existing work as the main import case from the start.
6. Add record versions and change events to the data model at the beginning.
7. Fix scope in writing: desktop only, two roles, one template.
8. Define tokens and primitives before any screen, so a restyle is not a sweep.
9. Hold back configurability (rules, statuses, mapping) until a second real case exists.
10. Validate with a real reviewer early instead of scoring my own work.
