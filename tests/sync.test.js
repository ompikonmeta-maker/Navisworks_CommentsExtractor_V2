// Client side of saving to the office server: versions, conflicts, create,
// import ids (lib/server.js) and merging server records into the store.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { syncRecord, importParsedRecords, createRecordRemote, remoteState } from '../src/lib/server.js';
import { reducer } from '../src/store/store.jsx';
import { DEFAULT_STATUSES } from '../src/lib/status.js';

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

// A fake server: routes are "METHOD path" → (body, url) => Response. Every call is recorded.
function fakeServer(routes) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET';
    const p = String(url).split('?')[0];
    let body = init.body;
    if (typeof body === 'string') body = JSON.parse(body);
    calls.push({ method, url: String(url), body });
    const h = routes[`${method} ${p}`];
    if (!h) return json(404, { error: `no route ${method} ${p}` });
    return h(body, String(url));
  }));
  return calls;
}

const srvRec = (over) => ({ id: 7, reviewId: 1, viewpoint: 'VP', commentRaw: 'A: x', commentText: 'x', status: 'Open', resolution: '', discipline: 'PIP', commenter: 'A', extra: {}, version: 1, ...over });

beforeEach(() => { remoteState.active = true; remoteState.reviewId = 1; });
afterEach(() => { vi.unstubAllGlobals(); remoteState.active = false; remoteState.reviewId = null; });

describe('syncRecord', () => {
  it('sends the version it last saw and returns the new one', async () => {
    const calls = fakeServer({ 'PATCH /api/records/7': (b) => json(200, { ok: true, record: srvRec({ ...b, version: 4 }) }) });
    expect(await syncRecord(7, { status: 'Closed', resolution: 'done' }, 3)).toEqual({ version: 4 });
    expect(calls[0].body).toEqual({ status: 'Closed', resolution: 'done', version: 3 });
  });

  it('sends only editable fields, and no version when it has none', async () => {
    const calls = fakeServer({ 'PATCH /api/records/7': () => json(200, { ok: true, record: srvRec({ version: 2 }) }) });
    await syncRecord(7, { status: 'Closed', changedBy: 'me', changedAt: 'now', viewpoint: 'x' }, undefined);
    expect(calls[0].body).toEqual({ status: 'Closed' });
  });

  it('on a conflict throws 409 with the current record, mapped for the store', async () => {
    fakeServer({ 'PATCH /api/records/7': () => json(409, { error: 'changed by someone else', record: srvRec({ status: 'In Review', version: 5, afterUrl: '/api/files/a.png' }) }) });
    const err = await syncRecord(7, { resolution: 'mine' }, 3).catch((e) => e);
    expect(err.code).toBe(409);
    expect(err.record).toMatchObject({ ID: 7, status: 'In Review', version: 5, afterImageData: '/api/files/a.png' });
  });

  it('still saves a photo when the field edit conflicts, then reports the latest record', async () => {
    const calls = fakeServer({
      'PATCH /api/records/7': () => json(409, { error: 'x', record: srvRec({ version: 5 }) }),
      'POST /api/records/7/images': () => json(201, { url: '/api/files/n.png', version: 6 }),
      'GET /api/records/7': () => json(200, srvRec({ version: 6, afterUrl: '/api/files/n.png' })),
    });
    const err = await syncRecord(7, { resolution: 'mine', afterImageData: PNG }, 3).catch((e) => e);
    expect(err.code).toBe(409);
    expect(err.record).toMatchObject({ version: 6, afterImageData: '/api/files/n.png' });
    expect(calls.map((c) => `${c.method} ${c.url.split('?')[0]}`)).toEqual(['PATCH /api/records/7', 'POST /api/records/7/images', 'GET /api/records/7']);
  });

  it('photo-only saves take the version from the photo answer', async () => {
    fakeServer({ 'DELETE /api/records/7/images': () => json(200, { ok: true, version: 9 }) });
    expect(await syncRecord(7, { afterImageData: '' }, 8)).toEqual({ version: 9 });
  });

  it('passes other errors through unchanged', async () => {
    fakeServer({ 'PATCH /api/records/7': () => json(403, { error: 'cannot edit record' }) });
    const err = await syncRecord(7, { status: 'Closed' }, 1).catch((e) => e);
    expect(err.code).toBe(403);
    expect(err.record).toBeUndefined();
  });

  it('does nothing offline', async () => {
    remoteState.active = false;
    const calls = fakeServer({});
    expect(await syncRecord(7, { status: 'Closed' }, 2)).toEqual({ version: 2 });
    expect(calls).toHaveLength(0);
  });
});

describe('create and import', () => {
  it('creates one comment and uploads its before-photo to the new id', async () => {
    const calls = fakeServer({
      'POST /api/reviews/1/records/one': (b) => json(201, srvRec({ ...b, id: 42, version: 1 })),
      'POST /api/records/42/images': () => json(201, { url: '/api/files/b.png', version: 2 }),
    });
    const rec = await createRecordRemote(1, { ID: 0, viewpoint: 'Manual', commentText: 't', source: 'manual', imageData: PNG, afterImageData: '' });
    expect(rec).toMatchObject({ ID: 42, viewpoint: 'Manual', source: 'manual', imageData: '/api/files/b.png', version: 2 });
    expect(calls[0].body).not.toHaveProperty('imageData');
    expect(calls[0].body).not.toHaveProperty('ID');
    expect(calls[1].url).toContain('/api/records/42/images?kind=before');
  });

  it('import uploads each before-photo to the id the server returned for it', async () => {
    const calls = fakeServer({
      'POST /api/reviews/1/records': () => json(201, { imported: 3, ids: [31, 32, 33] }),
      'POST /api/records/31/images': () => json(201, { version: 2 }),
      'POST /api/records/33/images': () => json(201, { version: 2 }),
      // the list comes back with other people's rows mixed in — no longer matters
      'GET /api/reviews/1/records': () => json(200, [srvRec({ id: 5 }), srvRec({ id: 31 }), srvRec({ id: 99 }), srvRec({ id: 32 }), srvRec({ id: 33 })]),
    });
    const list = await importParsedRecords(1, [{ viewpoint: 'a', imageData: PNG }, { viewpoint: 'b', imageData: '' }, { viewpoint: 'c', imageData: PNG }]);
    const uploads = calls.filter((c) => c.url.includes('/images')).map((c) => c.url.split('?')[0]);
    expect(uploads).toEqual(['/api/records/31/images', '/api/records/33/images']);
    expect(list.map((r) => r.ID)).toEqual([5, 31, 99, 32, 33]);
  });
});

describe('store — merging server records', () => {
  const local = (over) => ({ ID: 1, status: 'Open', resolution: '', version: 1, commentRaw: 'x', commentText: 'x', commenter: '', ...over });
  const state = (records) => ({ records, status: 'ready', meta: {}, toast: null });
  const merge = (records, opts) => reducer(state(records), { type: 'MERGE_SERVER', statuses: DEFAULT_STATUSES, ...opts });

  it('replaces a record only when the server has a newer version', () => {
    const s = merge([local({ ID: 1, version: 2 }), local({ ID: 2, version: 1 })], {
      records: [local({ ID: 1, version: 2, status: 'Closed' }), local({ ID: 2, version: 3, status: 'Closed' })],
    });
    expect(s.records.map((r) => [r.ID, r.status])).toEqual([[1, 'Open'], [2, 'Closed']]);
  });

  it('leaves records that are being edited here alone', () => {
    const s = merge([local({ ID: 1, resolution: 'typing…' })], { records: [local({ ID: 1, version: 5, resolution: 'theirs' })], skip: new Set([1]) });
    expect(s.records[0].resolution).toBe('typing…');
  });

  it('adds new comments and drops deleted ones (refresh with ids)', () => {
    const s = merge([local({ ID: 1 }), local({ ID: 2 }), local({ ID: 3 })], {
      records: [local({ ID: 4, version: 1 })], ids: [1, 3, 4], dropFrom: new Set([1, 2, 3]),
    });
    expect(s.records.map((r) => r.ID)).toEqual([1, 3, 4]);
  });

  it('keeps a comment added here after the refresh started', () => {
    const s = merge([local({ ID: 1 }), local({ ID: 50 })], { records: [], ids: [1], dropFrom: new Set([1]) });
    expect(s.records.map((r) => r.ID)).toEqual([1, 50]);
  });

  it('a conflict forces the server copy, can keep the typed resolution, and never adds rows', () => {
    const s = merge([local({ ID: 1, version: 3, status: 'Closed', resolution: 'mine' })], {
      records: [local({ ID: 1, version: 3, status: 'In Review', resolution: 'theirs' }), local({ ID: 9 })],
      force: true, patch: { 1: { resolution: 'mine' } },
    });
    expect(s.records).toHaveLength(1);
    expect(s.records[0]).toMatchObject({ status: 'In Review', resolution: 'mine', version: 3 });
  });

  it('returns the same state when nothing changed (no re-render)', () => {
    const st = state([local({ ID: 1, version: 2 })]);
    expect(reducer(st, { type: 'MERGE_SERVER', records: [local({ ID: 1, version: 2 })], ids: [1], statuses: DEFAULT_STATUSES })).toBe(st);
  });
});
