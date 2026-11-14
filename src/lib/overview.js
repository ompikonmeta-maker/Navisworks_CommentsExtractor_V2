// =====================================================================
// Overview analytics — pure functions over the record list, so the page
// renders whatever data is loaded (sample, import, or the shared server).
//
// Pace and forecasts come from `closedAt` (stamped when a comment is closed
// in Tabelin). Comments closed elsewhere carry no close date, so the pace is
// "unknown" until close-outs are recorded here.
// =====================================================================
import { doneLabel, openLabel } from './status.js';

const DAY = 86400000;
const PACE_WINDOW = 14; // days of close-outs that set the current pace
export const AGE_BUCKETS = [
  { key: 'a', label: '< 2 wk', long: 'under 2 weeks', max: 14 },
  { key: 'b', label: '2–4 wk', long: '2–4 weeks', max: 30 },
  { key: 'c', label: '1–3 mo', long: '1–3 months', max: 90 },
  { key: 'd', label: '> 3 mo', long: 'over 3 months', max: Infinity },
];

// Navisworks dates like "2024/12/9 04:0:23", or ISO → epoch ms (0 if unparseable).
export function parseTs(s) {
  if (!s) return 0;
  const m = /(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2}):?(\d{1,2})?)?/.exec(s);
  if (!m) { const t = Date.parse(s); return Number.isNaN(t) ? 0 : t; }
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4] || 0, +m[5] || 0, +m[6] || 0).getTime();
}

// "2024/12/9 07:25:10" → "9 Dec 2024, 07:25" (the raw text when unparseable).
export function fmtStamp(raw) {
  const t = parseTs(raw);
  if (!t) return raw || '';
  const d = new Date(t);
  const day = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const hasTime = /\d{1,2}:\d{1,2}/.test(String(raw));
  return hasTime ? `${day}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : day;
}

export const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const parseDay = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : null; };

const isUnassigned = (d) => !d || String(d).toUpperCase() === 'OTHER';

// Commenter "CPY_Dito" / "OPS(Teguh)" / "PIP" → party "CPY" / "OPS" / "PIP".
export function partyOf(commenter) {
  const t = String(commenter || '').trim();
  if (!t) return '';
  return t.split(/[_(\s:]/)[0].toUpperCase();
}

function verdictOf(late, remaining) {
  if (remaining === 0) return 'done';
  if (late == null) return 'unknown';
  if (late <= 0) return 'ok';
  if (late <= 14) return 'risk';
  return 'bad';
}

/**
 * @param {object[]} records
 * @param {object[]} statuses  settings.statuses registry
 * @param {{ today?: number, target?: number|null }} opts  epoch ms (start of day)
 */
export function computeOverview(records, statuses, { today = startOfDay(Date.now()), target = null } = {}) {
  const doneL = doneLabel(statuses);
  const openL = openLabel(statuses);
  const total = records.length;
  const counts = Object.fromEntries(statuses.map((s) => [s.label, 0]));
  for (const r of records) counts[r.status] = (counts[r.status] || 0) + 1;
  const done = counts[doneL] || 0;
  const open = counts[openL] || 0;
  const middle = total - done - open;
  const remaining = total - done;

  const windowStart = today - PACE_WINDOW * DAY;
  const ageOf = (r) => { const t = parseTs(r.commentDate); return t ? Math.max(0, Math.floor((today - startOfDay(t)) / DAY)) : null; };
  const closedAtOf = (r) => (r.status === doneL && r.closedAt ? parseTs(r.closedAt) : 0);
  const isReady = (r) => r.status === doneL && !!r.afterImageData && !!String(r.resolution || '').trim();

  // ---- overall pace / forecast / target ----
  let recent = 0;
  for (const r of records) { const c = closedAtOf(r); if (c && c > windowStart && c <= today + DAY) recent += 1; }
  const pace = recent / PACE_WINDOW; // per day
  const daysLeft = target != null ? Math.round((target - today) / DAY) : null;
  const needed = daysLeft != null && daysLeft > 0 ? remaining / daysLeft : null;
  const forecast = remaining === 0 ? today : pace > 0 ? today + Math.ceil(remaining / pace) * DAY : null;
  const late = forecast != null && target != null ? Math.round((forecast - target) / DAY) : null;
  const verdict = target == null ? (remaining === 0 ? 'done' : null) : verdictOf(late, remaining);

  // ---- evidence / log-sheet readiness ----
  let ready = 0, noPhoto = 0, noRes = 0;
  for (const r of records) {
    if (r.status !== doneL) continue;
    if (isReady(r)) ready += 1;
    if (!r.afterImageData) noPhoto += 1;
    if (!String(r.resolution || '').trim()) noRes += 1;
  }

  // ---- disciplines ----
  const dmap = new Map();
  for (const r of records) {
    const key = isUnassigned(r.discipline) ? 'OTHER' : r.discipline;
    let d = dmap.get(key);
    if (!d) { d = { key, unassigned: key === 'OTHER', counts: Object.fromEntries(statuses.map((s) => [s.label, 0])), total: 0, done: 0, recent: 0, oldest: null, ages: [0, 0, 0, 0] }; dmap.set(key, d); }
    d.total += 1;
    d.counts[r.status] = (d.counts[r.status] || 0) + 1;
    if (r.status === doneL) {
      d.done += 1;
      const c = closedAtOf(r); if (c && c > windowStart && c <= today + DAY) d.recent += 1;
    } else {
      const a = ageOf(r);
      if (a != null) {
        d.oldest = Math.max(d.oldest ?? 0, a);
        const bi = AGE_BUCKETS.findIndex((b) => a < b.max);
        d.ages[bi] += 1;
      }
    }
  }
  const disciplines = [...dmap.values()].map((d) => {
    const rem = d.total - d.done;
    const p = d.recent / PACE_WINDOW;
    const f = rem === 0 ? today : p > 0 ? today + Math.ceil(rem / p) * DAY : null;
    const lt = f != null && target != null ? Math.round((f - target) / DAY) : null;
    return {
      ...d, remaining: rem, pace: p,
      needed: daysLeft != null && daysLeft > 0 ? rem / daysLeft : null,
      pct: d.total ? Math.round((d.done / d.total) * 100) : 0,
      forecast: f, late: lt,
      verdict: d.unassigned && rem > 0 ? 'triage' : target == null ? (rem === 0 ? 'done' : null) : verdictOf(lt, rem),
    };
  });
  const riskRank = { triage: 0, bad: 1, unknown: 2, risk: 3, ok: 4, done: 5 };
  const byRisk = [...disciplines].sort((a, b) => (riskRank[a.verdict] ?? 2) - (riskRank[b.verdict] ?? 2) || b.remaining - a.remaining);
  const byForecast = [...disciplines].filter((d) => d.remaining > 0).sort((a, b) => (a.forecast ?? Infinity) - (b.forecast ?? Infinity) || b.remaining - a.remaining);

  // ---- pipeline ----
  const unassignedAll = disciplines.filter((d) => d.unassigned).reduce((s, d) => s + d.total, 0);
  const pipeline = [
    { key: 'raised', label: 'Raised', value: total },
    { key: 'owned', label: 'Has a discipline', value: total - unassignedAll, drop: 'no discipline' },
    { key: 'actioned', label: 'Actioned', value: total - open, drop: 'not actioned yet' },
    { key: 'closed', label: doneL, value: done, drop: 'waiting for verification' },
    { key: 'ready', label: 'Log-sheet ready', value: ready, drop: 'without evidence' },
  ];

  // ---- burn-up (weekly samples) + weekly close-outs ----
  const raisedTs = records.map((r) => parseTs(r.commentDate)).filter(Boolean).sort((a, b) => a - b);
  const closedTs = records.map(closedAtOf).filter(Boolean).sort((a, b) => a - b);
  let burnup = [];
  if (raisedTs.length) {
    const start = startOfDay(Math.min(raisedTs[0], closedTs[0] ?? Infinity));
    const step = Math.max(7, Math.ceil((today - start) / DAY / 90)) * DAY; // ≤ ~90 points
    let ri = 0, ci = 0;
    for (let t = start; ; t += step) {
      const at = Math.min(t, today);
      while (ri < raisedTs.length && raisedTs[ri] <= at + DAY - 1) ri += 1;
      while (ci < closedTs.length && closedTs[ci] <= at + DAY - 1) ci += 1;
      burnup.push({ t: at, raised: ri, closed: ci });
      if (at >= today) break;
    }
    // records without a parseable date still count in the scope at "today"
    burnup[burnup.length - 1].raised = Math.max(burnup[burnup.length - 1].raised, total);
  }
  const weeks = [];
  for (let k = 7; k >= 0; k -= 1) {
    const end = today + DAY - k * 7 * DAY, beg = end - 7 * DAY;
    weeks.push({ end: end - DAY, value: closedTs.filter((c) => c >= beg && c < end).length });
  }

  // ---- needs attention ----
  const notDone = records.filter((r) => r.status !== doneL);
  const unassignedOpen = notDone.filter((r) => isUnassigned(r.discipline)).length;
  const over90 = notDone.filter((r) => (ageOf(r) ?? 0) > 90).length;
  let oldest = null;
  for (const r of notDone) { const a = ageOf(r); if (a != null && (!oldest || a > oldest.age)) oldest = { record: r, age: a }; }

  // ---- raised by (party from the commenter prefix) ----
  const pmap = new Map();
  for (const r of records) {
    const p = partyOf(r.commenter) || 'Unknown';
    const e = pmap.get(p) || { party: p, total: 0, done: 0, names: new Set() };
    e.total += 1; if (r.status === doneL) e.done += 1; if (r.commenter) e.names.add(r.commenter);
    pmap.set(p, e);
  }
  let parties = [...pmap.values()].sort((a, b) => b.total - a.total);
  if (parties.length > 5) {
    const rest = parties.slice(4);
    parties = [...parties.slice(0, 4), { party: 'Other', total: rest.reduce((s, x) => s + x.total, 0), done: rest.reduce((s, x) => s + x.done, 0), names: new Set(rest.map((x) => x.party)) }];
  }
  parties = parties.map((p) => ({ ...p, names: [...p.names], pct: p.total ? Math.round((p.done / p.total) * 100) : 0 }));

  const ageTotals = [0, 0, 0, 0];
  disciplines.forEach((d) => d.ages.forEach((n, i) => { ageTotals[i] += n; }));

  return {
    today, target, total, counts, done, open, middle, remaining, doneL, openL,
    pct: total ? Math.round((done / total) * 100) : 0,
    recent, pace, daysLeft, needed, forecast, late, verdict,
    ready, missingEvidence: done - ready, noPhoto, noRes,
    disciplines, byRisk, byForecast, pipeline, burnup, weeks,
    attention: { unassignedOpen, over90, middle, missingEvidence: done - ready, noPhoto, noRes, oldest },
    parties, ageTotals, hasCloseDates: closedTs.length > 0,
  };
}
