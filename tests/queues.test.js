// Work queues: each Do-next count opens exactly the comments it counts, in
// the Work list and from the Insights drill-downs.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { computeOverview } from '../src/lib/overview.js';
import { DEFAULT_STATUSES } from '../src/lib/status.js';
import { workQueues, filterRecords, queueFor, firstQueue, sameFilter, toFilter, baseFilter, chipTests } from '../src/lib/queues.js';

const DAY = 86400000;
const today = new Date(2025, 0, 31).getTime();
const rec = (over) => ({ status: 'Open', discipline: 'PIP', commenter: '', commentText: 'x', viewpoint: 'V', resolution: '', afterImageData: '', commentDate: '2025/1/20 08:00:00', ...over });

// Built to hit every edge: unassigned as OTHER and as empty, closed with and
// without evidence, the 90-day boundary on both sides, no date, done but old.
const records = [
  rec({ id: 1, discipline: 'OTHER' }),
  rec({ id: 2, discipline: '' , status: 'In Review' }),
  rec({ id: 3, discipline: 'OTHER', status: 'Closed' }), // unassigned but done → not in that queue (no photo, no resolution)
  rec({ id: 4, status: 'Closed', afterImageData: 'data:x', resolution: 'ok' }),
  rec({ id: 5, status: 'Closed' }), // no photo, no resolution
  rec({ id: 6, status: 'Closed', afterImageData: 'data:x' }), // no resolution
  rec({ id: 7, status: 'Closed', resolution: '  ' }), // no photo, blank resolution
  rec({ id: 8, status: 'In Review' }),
  rec({ id: 9, commentDate: '2024/11/2 23:59:00' }), // exactly 90 days → not old
  rec({ id: 10, commentDate: '2024/11/1 00:00:01' }), // 91 days → old
  rec({ id: 11, commentDate: '' }), // no date → never old
  rec({ id: 12, status: 'Closed', afterImageData: 'data:x', resolution: 'ok', commentDate: '2024/6/1 08:00:00' }), // old but done
  rec({ id: 13, status: 'In Review', commentDate: '2024/9/1 08:00:00', discipline: 'OTHER' }), // old, in review, unassigned
];
const ids = (list) => list.map((r) => r.id).sort((a, b) => a - b);

describe('Do-next queues', () => {
  const ov = computeOverview(records, DEFAULT_STATUSES, { today });
  const q = workQueues(ov, DEFAULT_STATUSES);

  it('are the five blockers in rank order, then All and Closed', () => {
    expect(q.doNext.map((x) => x.id)).toEqual(['unassigned', 'noPhoto', 'verify', 'noRes', 'old']);
    expect(q.rest.map((x) => x.id)).toEqual(['all', 'done']);
    expect(q.all).toHaveLength(7);
  });

  it('each opens exactly the rows it counts', () => {
    for (const x of q.all) {
      const rows = filterRecords(records, x.filter, DEFAULT_STATUSES, today);
      expect(rows.length, x.id).toBe(x.n);
    }
  });

  it('selects the right comments', () => {
    const rows = (id) => ids(filterRecords(records, q.all.find((x) => x.id === id).filter, DEFAULT_STATUSES, today));
    expect(rows('unassigned')).toEqual([1, 2, 13]);
    expect(rows('noPhoto')).toEqual([3, 5, 7]);
    expect(rows('verify')).toEqual([2, 8, 13]);
    expect(rows('noRes')).toEqual([3, 5, 6, 7]);
    expect(rows('old')).toEqual([10, 13]);
    expect(rows('all')).toHaveLength(13);
    expect(rows('done')).toEqual([3, 4, 5, 6, 7, 12]);
  });

  it('count every middle status when there are several', () => {
    const statuses = [DEFAULT_STATUSES[0], { key: 'fix', label: 'Fixed', color: '#123', role: 'middle' }, DEFAULT_STATUSES[1], DEFAULT_STATUSES[2]];
    const recs = [rec({ id: 1, status: 'Fixed' }), rec({ id: 2, status: 'In Review' }), rec({ id: 3 })];
    const o = computeOverview(recs, statuses, { today });
    const v = workQueues(o, statuses).doNext.find((x) => x.id === 'verify');
    expect(v.n).toBe(2);
    expect(ids(filterRecords(recs, v.filter, statuses, today))).toEqual([1, 2]);
    expect(v.short).toBe('Verify the fixed ones');
  });

  it('match the sample report too', () => {
    // parse-free: a quick synthetic copy of the sample's spread
    const big = Array.from({ length: 300 }, (_, i) => rec({
      id: i, discipline: i % 4 ? 'STR' : 'OTHER', status: ['Open', 'In Review', 'Closed'][i % 3],
      afterImageData: i % 5 ? '' : 'data:x', resolution: i % 7 ? '' : 'done', commentDate: new Date(today - (i % 200) * DAY).toISOString(),
    }));
    const o = computeOverview(big, DEFAULT_STATUSES, { today });
    for (const x of workQueues(o, DEFAULT_STATUSES).all) expect(filterRecords(big, x.filter, DEFAULT_STATUSES, today).length, x.id).toBe(x.n);
  });

  it('start Work on the first queue with work, else All', () => {
    expect(firstQueue(q).id).toBe('unassigned');
    const clean = computeOverview([rec({ status: 'Closed', afterImageData: 'd', resolution: 'r' })], DEFAULT_STATUSES, { today });
    expect(firstQueue(workQueues(clean, DEFAULT_STATUSES)).id).toBe('all');
  });

  it('a filter handed in names its queue, or none', () => {
    expect(queueFor(q, { status: 'Closed', noPhoto: true }).id).toBe('noPhoto');
    expect(queueFor(q, {}).id).toBe('all');
    expect(queueFor(q, { status: 'Closed', discipline: 'STR' })).toBeNull();
  });
});

describe('the filter', () => {
  it('normalises and compares', () => {
    expect(toFilter({ status: 'Open', junk: 1 })).toEqual({ query: '', discipline: 'all', status: 'Open', commenter: 'all', noPhoto: false, noRes: false, old: false });
    expect(sameFilter({}, { status: 'all' })).toBe(true);
    expect(sameFilter({ noPhoto: true }, {})).toBe(false);
  });

  it('searches text, viewpoint, author, commenter, resolution and id', () => {
    const r = [rec({ id: 1, commentText: 'Valve access', viewpoint: 'TV 1' }), rec({ id: 2, resolution: 'moved the VALVE' }), rec({ id: 3, commentId: '228' }), rec({ id: 4, commenter: 'CPY_Dito' })];
    expect(ids(filterRecords(r, { query: 'valve' }, DEFAULT_STATUSES, today))).toEqual([1, 2]);
    expect(ids(filterRecords(r, { query: '228' }, DEFAULT_STATUSES, today))).toEqual([3]);
    expect(ids(filterRecords(r, { query: 'dito' }, DEFAULT_STATUSES, today))).toEqual([4]);
    expect(ids(filterRecords(r, { commenter: 'CPY_Dito' }, DEFAULT_STATUSES, today))).toEqual([4]);
  });

  it('the evidence chips widen each other; chips count on top of the base', () => {
    expect(ids(filterRecords(records, { status: 'Closed', noPhoto: true, noRes: true }, DEFAULT_STATUSES, today))).toEqual([3, 5, 6, 7]);
    const base = baseFilter(records, { status: 'Closed' }, DEFAULT_STATUSES);
    const t = chipTests(DEFAULT_STATUSES, today);
    expect(base.filter(t.noPhoto).length).toBe(3); // 3, 5, 7
    expect(base.filter(t.old).length).toBe(0);
  });
});

it('the Overview and the Work screen read the same queue definitions', () => {
  // the Do-next card and the drill-downs must not keep their own copies
  const dash = fs.readFileSync('src/views/Dashboard.jsx', 'utf8');
  expect(dash).toMatch(/workQueues/);
  expect(dash).not.toMatch(/goComments\(\{ discipline: 'OTHER', status: '!done' \}\)/);
});
