// The data layer (src/data): both sources offer the same members, the
// offline one keeps everything in memory, the server one talks to the API —
// and nothing outside the layer and the boot code knows which one runs.
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createLocalSource } from '../src/data/localSource.js';
import { createServerSource } from '../src/data/serverSource.js';
import { data, openServerReview, openLocal } from '../src/data/index.js';
import { planMerge, MANUAL } from '../src/lib/merge.js';

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function fakeServer(routes) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET';
    const p = String(url).split('?')[0];
    let body = init.body;
    if (typeof body === 'string') body = JSON.parse(body);
    calls.push({ method, url: String(url), body });
    const h = routes[`${method} ${p}`];
    return h ? h(body, String(url)) : json(404, { error: `no route ${method} ${p}` });
  }));
  return calls;
}
afterEach(() => { vi.unstubAllGlobals(); openLocal(); });

const place = { project: { id: 3, name: 'P' }, review: { id: 9, name: 'R' } };
const srv = (role, extra = {}) => createServerSource({ ...place, user: { id: 1, username: 'boss', displayName: 'Boss', role }, ...extra });
const rec = (over) => ({ ID: 1, commentId: '1', viewpoint: 'V', commentRaw: 'A: x', commentText: 'x', status: 'Open', resolution: '', source: 'r.html', ...over });

const MEMBERS = ['kind', 'caps', 'place', 'user', 'scopeKey', 'loadRecords', 'persistSession', 'resetToSample', 'folder',
  'saveRecord', 'saveMany', 'addRecord', 'deleteRecords', 'changes', 'history', 'editStamp', 'isFreshImport', 'importMerge',
  'loadTemplate', 'saveTemplate', 'clearTemplate', 'hasTemplate', 'loadSharedSettings', 'saveSharedSetting', 'teamSize'];
const CAPS = ['canAdmin', 'canReview', 'hasHistory', 'shared', 'autosave', 'sessionFolder', 'sampleReset', 'refresh', 'sharedSettings', 'manageUsers'];

describe('both sources have the same shape', () => {
  it.each([['local', createLocalSource()], ['server', srv('admin')]])('%s', (_, s) => {
    for (const m of MEMBERS) expect(s, m).toHaveProperty(m);
    expect(Object.keys(s.caps).sort()).toEqual([...CAPS].sort());
  });
});

describe('localSource (offline)', () => {
  const s = createLocalSource();

  it('may do everything, alone, with no history or refresh', () => {
    expect(s.caps).toMatchObject({ canAdmin: true, canReview: true, hasHistory: false, shared: false, autosave: true, sampleReset: true, refresh: false, sharedSettings: false, manageUsers: false });
    expect(s).toMatchObject({ kind: 'local', place: null, user: null, scopeKey: 'local' });
    expect(s.editStamp()).toBeNull();
  });

  it('keeps edits in memory: saves are no-ops, adds get the next id', async () => {
    expect(await s.saveRecord(1, { status: 'Closed' }, undefined)).toEqual({ version: undefined });
    expect(await s.saveMany([{ id: 1, patch: {} }])).toEqual({ versions: {}, conflicts: [] });
    expect(await s.addRecord({ viewpoint: 'M' }, [rec({ ID: 4 }), rec({ ID: 9 })])).toMatchObject({ ID: 10, viewpoint: 'M' });
    expect(await s.addRecord({ viewpoint: 'M' }, [])).toMatchObject({ ID: 1 });
    expect(await s.changes('')).toBeNull();
    expect(await s.history(1)).toEqual([]);
    expect(await s.teamSize()).toBe(0);
    expect(await s.loadSharedSettings()).toBeNull();
  });

  it('replaces the sample on import and merges into real work, with undo', async () => {
    expect(s.isFreshImport([rec()], { source: 'sample' })).toBe(true);
    expect(s.isFreshImport([], { source: 'user' })).toBe(true);
    expect(s.isFreshImport([rec()], { source: 'user' })).toBe(false);

    const incoming = [rec({ commentId: '1', commentRaw: 'A: new', commentText: 'new' }), rec({ commentId: '2' })];
    const sample = [rec({ ID: 1, commentId: '1', status: 'Closed' })];
    const fromSample = await s.importMerge(planMerge([], incoming), { missingAction: 'keep', doneLabel: 'Closed' }, { records: sample, source: 'sample' });
    expect(fromSample.source).toBe('user');
    expect(fromSample.records.map((r) => r.commentId)).toEqual(['1', '2']);
    expect(await fromSample.undo()).toEqual({ records: sample, source: 'sample' });

    const mine = [rec({ ID: 1, commentId: '1', status: 'Closed', resolution: 'done' }), rec({ ID: 2, commentId: '3', source: MANUAL })];
    const merged = await s.importMerge(planMerge(mine, incoming), { missingAction: 'close', doneLabel: 'Closed' }, { records: mine, source: 'user' });
    expect(merged.records.map((r) => [r.ID, r.commentId, r.status, r.commentText])).toEqual([
      [1, '1', 'Closed', 'new'], [2, '3', 'Open', 'x'], [3, '2', 'Open', 'x'],
    ]);
    expect((await merged.undo()).records).toBe(mine);
  });
});

describe('serverSource', () => {
  it('takes the roles from the user', () => {
    expect(srv('admin').caps).toMatchObject({ canAdmin: true, canReview: true, manageUsers: true, shared: true, hasHistory: true, refresh: true, autosave: false, sessionFolder: false, sampleReset: false });
    expect(srv('reviewer').caps).toMatchObject({ canAdmin: false, canReview: true, manageUsers: false });
    expect(srv('viewer').caps).toMatchObject({ canAdmin: false, canReview: false, manageUsers: false });
    const s = srv('reviewer');
    expect(s).toMatchObject({ kind: 'server', place, scopeKey: '9' });
    expect(s.isFreshImport([], { source: 'review:9' })).toBe(true);
    expect(s.isFreshImport([rec()], { source: 'review:9' })).toBe(false);
  });

  it('stamps edits with the user', () => {
    const st = srv('reviewer').editStamp();
    expect(st.changedBy).toBe('Boss');
    expect(Date.parse(st.changedAt)).not.toBeNaN();
  });

  it('loads the review and maps records for the store', async () => {
    fakeServer({ 'GET /api/reviews/9/records': () => json(200, [{ id: 5, status: 'Open', version: 2, beforeUrl: '/api/files/b.jpg' }]) });
    const out = await srv('reviewer').loadRecords();
    expect(out.source).toBe('review:9');
    expect(out.records[0]).toMatchObject({ ID: 5, version: 2, imageData: '/api/files/b.jpg' });
  });

  it('bulk saves, refresh and history go to this review', async () => {
    const calls = fakeServer({
      'PATCH /api/reviews/9/records': () => json(200, { updated: 1, versions: { 5: 3 }, conflicts: [{ id: 6, status: 'Closed', version: 4 }] }),
      'GET /api/reviews/9/records': () => json(200, { records: [{ id: 7, version: 1 }], ids: [5, 6, 7], next: 'T' }),
      'GET /api/records/5/history': () => json(200, [{ action: 'edit' }]),
      'POST /api/reviews/9/records/delete': () => json(200, { deleted: 1 }),
    });
    const s = srv('admin');
    const saved = await s.saveMany([{ id: 5, version: 2, patch: { status: 'Closed' } }]);
    expect(saved.versions).toEqual({ 5: 3 });
    expect(saved.conflicts[0]).toMatchObject({ ID: 6, version: 4 });
    const ch = await s.changes('');
    expect(ch).toMatchObject({ ids: [5, 6, 7], next: 'T' });
    expect(ch.records[0]).toMatchObject({ ID: 7 });
    expect(calls[1].url).toContain('/api/reviews/9/records?since=');
    expect(await s.history(5)).toEqual([{ action: 'edit' }]);
    await s.deleteRecords([5]);
    expect(calls[3].body).toEqual({ ids: [5] });
  });

  it('imports with merge on the server, and undoes it', async () => {
    const calls = fakeServer({
      'POST /api/reviews/9/records': () => json(201, { imported: 1, ids: [12] }),
      'GET /api/reviews/9/records': () => json(200, [{ id: 11 }, { id: 12 }]),
      'PUT /api/reviews/9/config': () => json(200, { ok: true }),
      'POST /api/reviews/9/records/delete': () => json(200, { deleted: 1 }),
    });
    const s = srv('admin');
    const existing = [rec({ ID: 11, commentId: '1' })];
    const res = await s.importMerge(planMerge(existing, [rec({ commentId: '1' }), rec({ commentId: '2' })]), { missingAction: 'keep', doneLabel: 'Closed' }, { records: existing, source: 'review:9' });
    expect(res.source).toBe('review:9');
    expect(res.records.map((r) => r.ID)).toEqual([11, 12]);
    const lastImport = calls.find((c) => c.method === 'PUT').body;
    expect(lastImport).toMatchObject({ key: 'lastImport', json: { added: [12] } });
    const back = await res.undo();
    expect(back.source).toBe('review:9');
    expect(calls.find((c) => c.url.endsWith('/records/delete')).body).toEqual({ ids: [12] });
  });

  it('shares settings per project and per review', async () => {
    const calls = fakeServer({
      'GET /api/projects/3/config': () => json(200, { statuses: [1] }),
      'GET /api/reviews/9/config': () => json(200, { reviewTarget: '2025-03-01' }),
      'PUT /api/projects/3/config': () => json(200, { ok: true }),
      'PUT /api/reviews/9/config': () => json(200, { ok: true }),
      'GET /api/users': () => json(200, [{ id: 1 }, { id: 2 }, { id: 3 }]),
    });
    const s = srv('admin');
    expect(await s.loadSharedSettings()).toEqual({ project: { statuses: [1] }, review: { reviewTarget: '2025-03-01' } });
    await s.saveSharedSetting('project', 'detect', { a: 1 });
    await s.saveSharedSetting('review', 'reviewTarget', '2025-04-01');
    expect(calls.filter((c) => c.method === 'PUT').map((c) => [c.url, c.body.key])).toEqual([['/api/projects/3/config', 'detect'], ['/api/reviews/9/config', 'reviewTarget']]);
    expect(await s.teamSize()).toBe(2); // everyone but the user
    expect(await srv('reviewer').teamSize()).toBe(0);
  });

  it('reads the project template, and has none when the server has none', async () => {
    const bytes = new Uint8Array([80, 75, 3, 4]);
    fakeServer({ 'GET /api/projects/3/template': () => new Response(bytes, { status: 200, headers: { 'X-Template-Name': encodeURIComponent('log sheet.xlsx') } }) });
    const t = await srv('reviewer').loadTemplate();
    expect(t.name).toBe('log sheet.xlsx');
    expect([...t.bytes]).toEqual([80, 75, 3, 4]);
    fakeServer({});
    expect(await srv('reviewer').loadTemplate()).toBeNull();
  });
});

describe('the current source', () => {
  it('is offline until the boot code opens a server review', () => {
    expect(data().kind).toBe('local');
    const s = openServerReview({ ...place, user: { id: 1, role: 'reviewer' } });
    expect(data()).toBe(s);
    expect(data().scopeKey).toBe('9');
    openLocal();
    expect(data().kind).toBe('local');
  });
});

// The rule of Phase 3: screens and the store don't know how the app runs.
describe('architecture', () => {
  const SRC = path.resolve('src');
  const files = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(jsx?|mjs)$/.test(e.name)) files.push(path.relative(SRC, p).split(path.sep).join('/'));
  });
  walk(SRC);
  const src = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

  it('has no global mode flag left', () => {
    for (const f of files) expect(src(f), f).not.toMatch(/remoteState/);
  });

  it('only the data layer, the boot code and server-only screens use the server API', () => {
    const allowed = ['Root.jsx', 'components/Login.jsx', 'components/ProjectPicker.jsx', 'components/UsersEditor.jsx', 'lib/server.js'];
    const users = files.filter((f) => /from '[./]*\/?(lib\/)?server\.js'/.test(src(f)) || /from '\.\/server\.js'/.test(src(f)));
    expect(users.filter((f) => !f.startsWith('data/') && !allowed.includes(f))).toEqual([]);
  });

  it('only the data layer and the settings store use browser persistence', () => {
    const users = files.filter((f) => /persist\.js'/.test(src(f)));
    expect(users.filter((f) => !f.startsWith('data/') && f !== 'store/settings.jsx')).toEqual([]);
  });
});
