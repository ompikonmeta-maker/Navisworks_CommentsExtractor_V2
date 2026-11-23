// What a Navisworks import brought in, as plain numbers — shown before the
// first import is saved (ImportSummary.jsx) and kept with the review so it can
// be opened again later (source.imports()). Pure: no DOM, no store.
import { parseTs, partyOf } from './overview.js';

const isUnassigned = (d) => !d || String(d).toUpperCase() === 'OTHER';
const pad = (n) => String(n).padStart(2, '0');
const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const monthKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const DAY = 86400000;
const SESSION_GAP_DAYS = 7; // days without comments that start a new review session

function countBy(list, keyOf) {
  const m = new Map();
  for (const x of list) { const k = keyOf(x); m.set(k, (m.get(k) || 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
}

/**
 * @param {object[]} records   the parsed comments of this import
 * @param {object}   o         { fileName, stats (ingest), plan (merge plan), by, at }
 */
export function summarizeImport(records, { fileName = '', stats = {}, plan = null, by = '', at = new Date().toISOString() } = {}) {
  const viewpoints = new Map(); // viewpoint → has a photo
  for (const r of records) {
    const vp = r.viewpoint || '';
    viewpoints.set(vp, viewpoints.get(vp) || !!r.imageData);
  }
  const vpWithPhoto = [...viewpoints.values()].filter(Boolean).length;

  const times = records.map((r) => parseTs(r.commentDate)).filter(Boolean).sort((a, b) => a - b);
  const days = countBy(times, dayKey);
  const months = new Map();
  for (const t of times) months.set(monthKey(t), (months.get(monthKey(t)) || 0) + 1);
  // Fill the empty months between first and last so the chart reads as a timeline.
  const monthRows = [];
  if (times.length) {
    const d = new Date(times[0]); d.setDate(1);
    const end = monthKey(times[times.length - 1]);
    for (let i = 0; i < 120; i++) {
      const k = monthKey(d.getTime());
      monthRows.push([k, months.get(k) || 0]);
      if (k === end) break;
      d.setMonth(d.getMonth() + 1);
    }
  }
  const uniqDays = [...new Set(times.map((t) => dayKey(t)))].sort();
  let sessions = uniqDays.length ? 1 : 0;
  for (let i = 1; i < uniqDays.length; i++) {
    if ((Date.parse(uniqDays[i]) - Date.parse(uniqDays[i - 1])) / DAY > SESSION_GAP_DAYS) sessions++;
  }

  const named = records.filter((r) => String(r.commenter || '').trim());
  const people = countBy(named, (r) => r.commenter);
  const parties = countBy(records, (r) => partyOf(r.commenter) || '');

  const ids = records.map((r) => r.commentId).filter(Boolean);
  const dupIds = ids.length - new Set(ids).size;

  return {
    id: `imp-${Date.parse(at) || Date.now()}`,
    at,
    by,
    file: fileName,
    images: stats.images || 0,
    comments: records.length,
    viewpoints: viewpoints.size,
    vpWithPhoto,
    commenters: people.length,
    from: times.length ? dayKey(times[0]) : '',
    to: times.length ? dayKey(times[times.length - 1]) : '',
    sessions,
    busiestDay: days[0] ? { day: days[0][0], n: days[0][1] } : null,
    statuses: countBy(records, (r) => r.status || ''),
    disciplines: countBy(records, (r) => (isUnassigned(r.discipline) ? 'OTHER' : r.discipline)),
    parties, // [party, n]; '' = no name
    people: people.slice(0, 5),
    months: monthRows,
    checks: {
      unassigned: records.filter((r) => isUnassigned(r.discipline)).length,
      vpNoPhoto: viewpoints.size - vpWithPhoto,
      noCommenter: records.length - named.length,
      dupIds,
      empty: records.filter((r) => !String(r.commentText || '').trim()).length,
    },
    merge: plan && plan.matched?.length
      ? { added: plan.added.length, matched: plan.matched.length, changed: plan.changed || 0, missing: plan.missing.length }
      : null,
    undone: false,
  };
}

/** Keep the newest `max` imports, newest first. */
export const IMPORT_LOG_MAX = 50;
export function addToLog(log, summary) {
  return [summary, ...(Array.isArray(log) ? log : []).filter((x) => x && x.id !== summary.id)].slice(0, IMPORT_LOG_MAX);
}
export function markUndone(log, id) {
  return (Array.isArray(log) ? log : []).map((x) => (x.id === id ? { ...x, undone: true } : x));
}
