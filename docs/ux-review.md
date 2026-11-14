# UI/UX review notes

Running notes from the UI/UX reviews the owner asked for. Scores are a design judgement
from screenshots of the running app, not a measurement.

## Scope

- **Desktop only.** The owner does not need a phone layout; phone issues are not scored and
  not worked on unless asked.
- Light-mode sidebar stays lavender (owner's choice) — not counted as a flaw.

## History

| Review | Visual | Workflow (effective / efficient) | Overall |
|---|:-:|:-:|:-:|
| 1st — "looks pale" | 6.2 | — | — |
| 2nd — admin workflow | — | 7 / 5 | — |
| 3rd — after visual + workflow fixes (2026-10-11) | 8.0 | 8.5 / 8.0 | ≈ 8.0 desktop |
| 4th — after the 9.2 plan was built (2026-10-11) | 9.0 | 9.0 / 9.0 | ≈ 9.2 desktop |

Target set by the owner: **9.2**.

## Findings from the 3rd review (all addressed in the 4th, see below)

1. **Overview is too dense.** Nine cards; the same number repeats across cards (e.g. the
   172 comments without a discipline appear in Forecast, Pipeline, Needs attention,
   Disciplines and Backlog age). Lots of red makes everything read as urgent.
2. **Inconsistent wording and dates.** Viewpoints says `OTHER`, Overview says
   `No discipline` / `No disc.`. The drawer shows the raw date (`2024/12/9 04:0:23`) while the
   list shows `9 Dec 2024`.
3. **List row noise.** A "no photo" placeholder icon on every row when almost no row has a
   photo (746 of 747).
4. **Backlog age** says little when nearly everything sits in "> 3 months".
5. **Small text.** Many 10–11 px labels in charts and captions; hard to read on a laptop.
6. Phone layout issues (top nav clipped, sideways-scrolling table) — **out of scope**.

## Path to 9.2 (built)

| Change | Expected gain |
|---|:-:|
| Calmer Overview: one clear "what to do next" area, remove repeated numbers, merge or drop low-information cards, red only for real lateness | +0.4 |
| One vocabulary and one date format everywhere | +0.2 |
| Readability: minimum 12 px text, stronger contrast for secondary text | +0.3 |
| Quieter list: show a thumbnail only when a photo exists | +0.1 |
| Faster drawer work: status keys (1/2/3), save resolution and move on in one key | +0.2 |
| Per-comment history (who changed what, when) instead of last change only | +0.2 |

Owner's usual process: show a mockup first, build only after a go-ahead.
Mockup: https://claude.ai/artifact/SKHHib6ECyYJXx4zi4LmWz

## Still open after the 4th review

- "Closed per week" uses a red badge/bar for a pace drop — arguably lateness, but loud.
- The drawer is long: History sits below the fold on a 900 px-tall screen.
- Quick Excel / log-sheet exports still write the stored `OTHER`, not "Unassigned".
