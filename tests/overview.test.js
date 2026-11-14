import { describe, it, expect } from 'vitest';
import { computeOverview, fmtStamp, parseTs, partyOf } from '../src/lib/overview.js';
import { DEFAULT_STATUSES } from '../src/lib/status.js';

const DAY = 86400000;
const today = new Date(2025, 0, 31).getTime(); // 31 Jan 2025, start of day
const target = today + 10 * DAY;

const rec = (over) => ({ status: 'Open', discipline: 'PIP', commenter: '', commentDate: '', closedAt: null, afterImageData: '', resolution: '', ...over });
const records = [
  rec({ id: 'r1', commentDate: '2025/1/20 08:00:00', commenter: 'CPY_Dito' }), // 11 days old
  rec({ id: 'r2', discipline: 'OTHER', commentDate: '2024/10/1 08:00:00', commenter: 'OPS(Teguh)' }), // 122 days old, unassigned
  rec({ id: 'r3', status: 'In Review', discipline: 'STR', commentDate: '2025/1/10 08:00:00', commenter: 'CPY_Sari' }),
  rec({ id: 'r4', status: 'Closed', closedAt: '2025-01-25T10:00:00', afterImageData: 'data:x', resolution: 'done', commentDate: '2025/1/2 08:00:00' }), // log-sheet ready
  rec({ id: 'r5', status: 'Closed', closedAt: '2025-01-28T10:00:00', resolution: 'ok', commentDate: '2025/1/3 08:00:00' }), // no after-photo
  rec({ id: 'r6', status: 'Closed', discipline: 'STR', closedAt: '2024-12-01T10:00:00', afterImageData: 'data:x', resolution: '  ', commentDate: '2024/11/1 08:00:00' }), // no resolution, closed long ago
  rec({ id: 'r7', status: 'Closed', discipline: 'ELE', commentDate: '2024/11/5 08:00:00' }), // closed elsewhere: no date, no evidence
];

describe('overview — computeOverview', () => {
  const o = computeOverview(records, DEFAULT_STATUSES, { today, target });

  it('counts by status', () => {
    expect(o.total).toBe(7);
    expect(o.counts).toEqual({ Open: 2, 'In Review': 1, Closed: 4 });
    expect(o).toMatchObject({ done: 4, open: 2, middle: 1, remaining: 3, pct: 57 });
  });

  it('takes the pace from close-outs in the last 14 days', () => {
    expect(o.recent).toBe(2); // r4, r5 — r6 is too old, r7 has no close date
    expect(o.pace).toBeCloseTo(2 / 14);
    expect(o.hasCloseDates).toBe(true);
  });

  it('forecasts the finish and how late it is against the target', () => {
    expect(o.daysLeft).toBe(10);
    expect(o.needed).toBeCloseTo(0.3);
    expect(o.forecast).toBe(today + 21 * DAY); // 3 left at 1 per 7 days
    expect(o.late).toBe(11);
    expect(o.verdict).toBe('risk');
  });

  it('counts log-sheet readiness', () => {
    expect(o).toMatchObject({ ready: 1, noPhoto: 2, noRes: 2, missingEvidence: 3 });
  });

  it('gives the Do-next numbers', () => {
    expect(o.attention).toMatchObject({ unassignedOpen: 1, over90: 1, middle: 1, missingEvidence: 3, noPhoto: 2, noRes: 2 });
    expect(o.attention.oldest.record.id).toBe('r2');
    expect(o.attention.oldest.age).toBe(122);
  });

  it('summarises each discipline', () => {
    const d = Object.fromEntries(o.disciplines.map((x) => [x.key, x]));
    expect(d.PIP).toMatchObject({ total: 3, done: 2, remaining: 1, pct: 67, recent: 2, oldest: 11 });
    expect(d.STR).toMatchObject({ total: 2, done: 1, remaining: 1, verdict: 'unknown' }); // nothing closed lately → no forecast
    expect(d.ELE).toMatchObject({ total: 1, remaining: 0, verdict: 'done' });
    expect(d.OTHER).toMatchObject({ unassigned: true, remaining: 1, verdict: 'triage' });
    expect(o.ageTotals).toEqual([1, 1, 0, 1]);
  });

  it('groups who raised the comments by party', () => {
    const p = Object.fromEntries(o.parties.map((x) => [x.party, x]));
    expect(p.CPY.total).toBe(2);
    expect(p.OPS.total).toBe(1);
    expect(p.Unknown).toMatchObject({ total: 4, done: 4, pct: 100 });
  });

  it('is on time when the pace is enough, and done when nothing is left', () => {
    const far = computeOverview(records, DEFAULT_STATUSES, { today, target: today + 30 * DAY });
    expect(far.late).toBe(-9);
    expect(far.verdict).toBe('ok');
    const allClosed = records.map((r) => ({ ...r, status: 'Closed' }));
    const fin = computeOverview(allClosed, DEFAULT_STATUSES, { today, target });
    expect(fin).toMatchObject({ remaining: 0, forecast: today, verdict: 'done' });
  });

  it('has no forecast without a target or without recent close-outs', () => {
    const noTarget = computeOverview(records, DEFAULT_STATUSES, { today });
    expect(noTarget).toMatchObject({ daysLeft: null, needed: null, late: null, verdict: null });
    const noPace = computeOverview(records.map((r) => ({ ...r, closedAt: null })), DEFAULT_STATUSES, { today, target });
    expect(noPace).toMatchObject({ pace: 0, forecast: null, late: null, verdict: 'unknown', hasCloseDates: false });
  });

  it('copes with an empty review', () => {
    const e = computeOverview([], DEFAULT_STATUSES, { today, target });
    expect(e).toMatchObject({ total: 0, pct: 0, remaining: 0, verdict: 'done' });
    expect(e.burnup).toEqual([]);
  });
});

describe('overview — dates and names', () => {
  it('formats Navisworks dates for reading', () => {
    expect(fmtStamp('2024/12/9 07:25:10')).toBe('9 Dec 2024, 07:25');
    expect(fmtStamp('2024/12/9 04:0:23')).toBe('9 Dec 2024, 04:00');
    expect(fmtStamp('2024/12/9')).toBe('9 Dec 2024');
    expect(fmtStamp('not a date')).toBe('not a date');
    expect(fmtStamp('')).toBe('');
    expect(fmtStamp(null)).toBe('');
  });

  it('parses Navisworks and ISO dates', () => {
    expect(parseTs('2024/12/9 04:0:23')).toBe(new Date(2024, 11, 9, 4, 0, 23).getTime());
    expect(parseTs('2025-01-25T10:00:00')).toBe(new Date(2025, 0, 25, 10, 0, 0).getTime());
    expect(parseTs('')).toBe(0);
    expect(parseTs('rubbish')).toBe(0);
  });

  it('reads the party from the commenter prefix', () => {
    expect(partyOf('CPY_Dito')).toBe('CPY');
    expect(partyOf('OPS(Teguh)')).toBe('OPS');
    expect(partyOf('pip')).toBe('PIP');
    expect(partyOf('')).toBe('');
  });
});
