import { describe, it, expect } from 'vitest';
import { planMerge, applyMergeLocal, recordKey, MANUAL, SOURCE_FIELDS } from '../src/lib/merge.js';

const rec = (over) => ({
  ID: 0, commentId: '', viewpoint: 'VP', commentRaw: 'A: text', commentText: 'text', commentDate: '2025/1/1 08:00:00',
  authorCode: 'U1', cameraPosition: '1, 2, 3', imageRef: 'vp1.jpg', imageData: '', afterImageData: '',
  status: 'Open', closedAt: null, resolution: '', discipline: 'PIP', commenter: 'A', extra: {}, source: 'old.html',
  ...over,
});

// Existing review: work already done in Tabelin on #1 and #2.
const existing = () => [
  rec({ ID: 1, commentId: '101', status: 'Closed', closedAt: '2025-01-10T03:00:00.000Z', resolution: 'Rerouted', afterImageData: 'data:after1', imageData: 'data:before1', discipline: 'STR', commenter: 'Budi', extra: { cf_x: 'kept' } }),
  rec({ ID: 2, commentId: '102', status: 'In Review', resolution: 'Checking' }),
  rec({ ID: 3, commentId: '103' }),
  rec({ ID: 4, commentId: '', viewpoint: 'Manual VP', commentRaw: 'typed by hand', commentText: 'typed by hand', source: MANUAL }),
];
// Newer report: 101 unchanged, 102 re-worded and moved, 103 gone, 104 new.
const incoming = () => [
  rec({ ID: 1, commentId: '101', imageData: 'data:newer-before', status: 'Open', discipline: 'OTHER', commenter: '' }),
  rec({ ID: 2, commentId: '102', commentRaw: 'A: new wording', commentText: 'new wording', viewpoint: 'VP moved', imageData: 'data:before2', status: 'Open' }),
  rec({ ID: 3, commentId: '104', commentRaw: 'B: brand new', commentText: 'brand new', source: 'new.html' }),
];

describe('merge — planMerge', () => {
  it('counts matched, added, missing and changed', () => {
    const plan = planMerge(existing(), incoming());
    expect(plan.matched.map((m) => m.old.commentId)).toEqual(['101', '102']);
    expect(plan.added.map((r) => r.commentId)).toEqual(['104']);
    expect(plan.missing.map((r) => r.commentId)).toEqual(['103']);
    expect(plan.changed).toBe(1); // only 102 has new report text
  });

  it('never lists a manual comment as missing', () => {
    const plan = planMerge(existing(), incoming());
    expect(plan.missing.some((r) => r.source === MANUAL)).toBe(false);
  });

  it('refreshes only the report fields of a matched comment', () => {
    const plan = planMerge(existing(), incoming());
    const p102 = plan.matched[1].patch;
    expect(p102).toEqual({ commentRaw: 'A: new wording', commentText: 'new wording', viewpoint: 'VP moved', imageData: 'data:before2' });
    const workFields = ['status', 'closedAt', 'resolution', 'discipline', 'commenter', 'extra', 'afterImageData'];
    for (const m of plan.matched) for (const f of workFields) expect(m.patch).not.toHaveProperty(f);
    for (const m of plan.matched) {
      for (const f of Object.keys(m.patch)) expect([...SOURCE_FIELDS, 'commentText', 'imageData']).toContain(f);
    }
  });

  it('fills a before-photo only when it was missing', () => {
    const plan = planMerge(existing(), incoming());
    expect(plan.matched[0].patch).toEqual({}); // 101 already has a before-photo
    expect(plan.matched[1].patch.imageData).toBe('data:before2');
  });

  it('matches by viewpoint + raw text when the report has no comment IDs', () => {
    const old = [rec({ ID: 1, viewpoint: 'V1', commentRaw: 'same text', status: 'Closed' })];
    const inc = [rec({ viewpoint: 'V1', commentRaw: ' same text ' }), rec({ viewpoint: 'V2', commentRaw: 'same text' })];
    const plan = planMerge(old, inc);
    expect(plan.matched).toHaveLength(1);
    expect(plan.added).toHaveLength(1);
    expect(plan.missing).toHaveLength(0);
    expect(recordKey(old[0])).toBe('vp:V1|same text');
  });

  it('treats a repeated comment ID in the new report as one match plus an addition', () => {
    const plan = planMerge([rec({ ID: 1, commentId: '5' })], [rec({ commentId: '5' }), rec({ commentId: '5' })]);
    expect(plan.matched).toHaveLength(1);
    expect(plan.added).toHaveLength(1);
  });
});

describe('merge — applyMergeLocal', () => {
  it('keeps status, resolution, photos and custom fields of matched comments', () => {
    const ex = existing();
    const out = applyMergeLocal(ex, planMerge(ex, incoming()), { missingAction: 'keep', doneLabel: 'Closed' });
    const r1 = out.find((r) => r.commentId === '101');
    expect(r1).toEqual(ex[0]);
    const r2 = out.find((r) => r.commentId === '102');
    expect(r2).toMatchObject({
      ID: 2, status: 'In Review', resolution: 'Checking', discipline: 'PIP', commenter: 'A',
      commentRaw: 'A: new wording', commentText: 'new wording', viewpoint: 'VP moved', imageData: 'data:before2',
    });
  });

  it('adds new comments with fresh IDs after the existing ones', () => {
    const ex = existing();
    const out = applyMergeLocal(ex, planMerge(ex, incoming()), { missingAction: 'keep', doneLabel: 'Closed' });
    expect(out).toHaveLength(5);
    expect(out.map((r) => r.ID)).toEqual([1, 2, 3, 4, 5]);
    expect(out[4]).toMatchObject({ commentId: '104', commentText: 'brand new', status: 'Open' });
  });

  it('"keep" leaves missing comments untouched', () => {
    const ex = existing();
    const out = applyMergeLocal(ex, planMerge(ex, incoming()), { missingAction: 'keep', doneLabel: 'Closed' });
    expect(out.find((r) => r.commentId === '103')).toEqual(ex[2]);
  });

  it('"close" moves missing comments to the done status and stamps closedAt', () => {
    const ex = existing();
    const before = Date.now();
    const out = applyMergeLocal(ex, planMerge(ex, incoming()), { missingAction: 'close', doneLabel: 'Closed' });
    const r3 = out.find((r) => r.commentId === '103');
    expect(r3.status).toBe('Closed');
    expect(Date.parse(r3.closedAt)).toBeGreaterThanOrEqual(before - 1000);
    // the manual comment and the matched ones are not closed by this
    expect(out.find((r) => r.source === MANUAL).status).toBe('Open');
    expect(out.find((r) => r.commentId === '102').status).toBe('In Review');
    expect(out.find((r) => r.commentId === '101').closedAt).toBe('2025-01-10T03:00:00.000Z');
  });

  it('does not change the input list', () => {
    const ex = existing();
    const copy = JSON.parse(JSON.stringify(ex));
    applyMergeLocal(ex, planMerge(ex, incoming()), { missingAction: 'close', doneLabel: 'Closed' });
    expect(ex).toEqual(copy);
  });
});
