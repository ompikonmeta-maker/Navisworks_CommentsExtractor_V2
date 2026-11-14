// =====================================================================
// Work queues and the comment filter — shared by the Work screen and the
// Insights drill-downs, so a count always opens exactly the rows it counts.
//
// A filter is a plain object (every key optional):
//   { query, discipline, status, commenter, noPhoto, noRes, old }
//   discipline: 'all' | a discipline | 'OTHER' (= unassigned: OTHER or empty)
//   status:     'all' | a label | '!done' (not done) | '~middle' (any middle status)
//   commenter:  'all' | a name
//   noPhoto / noRes: missing an after-photo / a resolution (together: either)
//   old:        not done and raised more than 90 days ago
// The Do-next queues are the five blockers of overview.attention, in rank
// order, each with the filter that selects exactly the counted comments.
// =====================================================================
import { doneLabel, openLabel } from './status.js';
import { parseTs, startOfDay } from './overview.js';

const DAY = 86400000;
export const OLD_DAYS = 90;

export const EMPTY_FILTER = Object.freeze({ query: '', discipline: 'all', status: 'all', commenter: 'all', noPhoto: false, noRes: false, old: false });

const isUnassigned = (d) => !d || String(d).toUpperCase() === 'OTHER';
const lacksPhoto = (r) => !r.afterImageData;
const lacksRes = (r) => !String(r.resolution || '').trim();

// Same age rule as computeOverview: whole days between the start of the
// comment's day and the start of today.
function ageDays(r, today) {
  const t = parseTs(r.commentDate);
  return t ? Math.max(0, Math.floor((today - startOfDay(t)) / DAY)) : null;
}

/** Normalise a partial filter (unknown keys dropped, defaults filled in). */
export function toFilter(f = {}) {
  const out = { ...EMPTY_FILTER };
  for (const k of Object.keys(EMPTY_FILTER)) if (f[k] !== undefined && f[k] !== null) out[k] = f[k];
  return out;
}

/** True when two filters select the same rows (after normalising). */
export function sameFilter(a, b) {
  const x = toFilter(a);
  const y = toFilter(b);
  return Object.keys(EMPTY_FILTER).every((k) => x[k] === y[k]);
}

/**
 * The search + dropdown part of a filter (no evidence/age chips). Exported so a
 * screen can count what each chip would add on top of it.
 */
export function baseFilter(records, filter, statuses) {
  const f = toFilter(filter);
  const doneL = doneLabel(statuses);
  const openL = openLabel(statuses);
  const q = String(f.query || '').trim().toLowerCase();
  return records.filter((r) => {
    if (f.discipline !== 'all' && (f.discipline === 'OTHER' ? !isUnassigned(r.discipline) : r.discipline !== f.discipline)) return false;
    if (f.status === '!done') { if (r.status === doneL) return false; }
    else if (f.status === '~middle') { if (r.status === doneL || r.status === openL) return false; }
    else if (f.status !== 'all' && r.status !== f.status) return false;
    if (f.commenter !== 'all' && (r.commenter || '') !== f.commenter) return false;
    if (q) {
      const hay = `${r.commentText} ${r.viewpoint} ${r.authorCode} ${r.commenter || ''} ${r.resolution} ${r.commentId}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** Predicates for the chips, for counting. */
export function chipTests(statuses, today = startOfDay(Date.now())) {
  const doneL = doneLabel(statuses);
  return {
    noPhoto: lacksPhoto,
    noRes: lacksRes,
    old: (r) => r.status !== doneL && (ageDays(r, today) ?? 0) > OLD_DAYS,
  };
}

/** Apply a whole filter. */
export function filterRecords(records, filter, statuses, today = startOfDay(Date.now())) {
  const f = toFilter(filter);
  const t = chipTests(statuses, today);
  return baseFilter(records, f, statuses).filter((r) => {
    // the two evidence chips widen each other: missing either one
    if ((f.noPhoto || f.noRes) && !((f.noPhoto && t.noPhoto(r)) || (f.noRes && t.noRes(r)))) return false;
    if (f.old && !t.old(r)) return false;
    return true;
  });
}

/**
 * The Work queues: the five Do-next blockers (ranked, each counted once in
 * overview.attention) plus All and the done status.
 * @param ov  computeOverview(...) result
 */
export function workQueues(ov, statuses) {
  const a = ov.attention;
  const mid = statuses.filter((s) => s.role === 'middle');
  const midName = mid.length === 1 ? mid[0].label.toLowerCase() : 'in review';
  const doNext = [
    { id: 'unassigned', icon: 'person_off', short: 'Give a discipline', title: 'Give these comments a discipline', why: 'No owner and no forecast yet. Pick a discipline and move on.', n: a.unassignedOpen, filter: { discipline: 'OTHER', status: '!done' } },
    { id: 'noPhoto', icon: 'no_photography', short: 'Add the after-photo', title: 'Add the after-photo', why: 'Closed, but can’t go on the log sheet without evidence.', n: a.noPhoto, filter: { status: ov.doneL, noPhoto: true } },
    { id: 'verify', icon: 'pending', short: mid.length === 1 ? `Verify ${midName}` : 'Verify the fixed ones', title: mid.length === 1 ? `Verify what is ${midName}` : 'Verify the fixed comments', why: 'Fixed and waiting for a reviewer to close.', n: a.middle, filter: { status: '~middle' } },
    { id: 'noRes', icon: 'description', short: 'Write the resolution', title: 'Write the resolution', why: 'Closed without a note on what was done.', n: a.noRes, filter: { status: ov.doneL, noRes: true } },
    { id: 'old', icon: 'hourglass_bottom', short: 'Chase the old ones', title: 'Chase the old ones', why: `Raised more than 3 months ago and still not ${ov.doneL.toLowerCase()}.`, n: a.over90, filter: { old: true } },
  ];
  const rest = [
    { id: 'all', icon: 'format_list_bulleted', short: 'All comments', title: 'All comments', why: 'Every comment in this review.', n: ov.total, filter: {} },
    { id: 'done', icon: 'check_circle', short: ov.doneL, title: `${ov.doneL} comments`, why: `Comments set to ${ov.doneL}.`, n: ov.done, filter: { status: ov.doneL } },
  ];
  return { doNext, rest, all: [...doNext, ...rest] };
}

/** The queue whose filter matches `filter` exactly, or null (a custom filter). */
export function queueFor(queues, filter) {
  return queues.all.find((q) => sameFilter(q.filter, filter)) || null;
}

/** Where Work starts: the first Do-next queue with work in it, else All. */
export function firstQueue(queues) {
  return queues.doNext.find((q) => q.n > 0) || queues.rest[0];
}
