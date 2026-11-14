// The Tabelin server's HTTP API, plus helpers built on it. Used by the server
// data source (data/serverSource.js) and the boot screens (sign-in, review
// picker, users); the rest of the app goes through src/data.
//
// "Remote mode" is on only when the app is served BY the Go server (its
// /api/health on the same origin answers JSON {"status":"ok"}). Opened as a
// single file (file://) or from a plain static host — including one with an SPA
// fallback that answers /api/health with index.html — detectRemote() is false and
// the app stays fully offline — V1 behaviour is untouched.

async function req(method, path, body) {
  // keepalive lets a small save finish even if the tab is closing.
  const init = { method, headers: {}, credentials: 'same-origin', keepalive: method === 'PATCH' && path.startsWith('/api/records/') };
  if (body instanceof Blob) {
    init.body = body;
    init.headers['Content-Type'] = body.type || 'application/octet-stream';
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(path, init);
  if (res.status === 401) {
    const e = new Error('unauthorized');
    e.code = 401;
    throw e;
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    let body = null;
    try { body = JSON.parse(t); } catch { /* not JSON */ }
    const e = new Error(body?.error || t || res.statusText);
    e.code = res.status;
    // 409 = the comment changed since this browser last saw it; the server
    // sends the current record along.
    if (body?.record) e.record = body.record;
    throw e;
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res;
}

export const api = {
  health: () => req('GET', '/api/health'),
  me: () => req('GET', '/api/me'),
  login: (username, pin) => req('POST', '/api/login', { username, pin }),
  logout: () => req('POST', '/api/logout'),
  listProjects: () => req('GET', '/api/projects'),
  createProject: (name) => req('POST', '/api/projects', { name }),
  renameProject: (pid, name) => req('PATCH', `/api/projects/${pid}`, { name }),
  listReviews: (pid) => req('GET', `/api/projects/${pid}/reviews`),
  createReview: (pid, name) => req('POST', `/api/projects/${pid}/reviews`, { name }),
  renameReview: (rid, name) => req('PATCH', `/api/reviews/${rid}`, { name }),
  getRecords: (rid) => req('GET', `/api/reviews/${rid}/records`),
  // ?since= (the light refresh) → { records: changed, ids: all ids, next }
  getChanges: (rid, since) => req('GET', `/api/reviews/${rid}/records?since=${encodeURIComponent(since || '')}`),
  getRecord: (id) => req('GET', `/api/records/${id}`),
  importRecords: (rid, records) => req('POST', `/api/reviews/${rid}/records`, { records }), // → { imported, ids }
  createRecord: (rid, record) => req('POST', `/api/reviews/${rid}/records/one`, record),
  bulkPatchRecords: (rid, updates) => req('PATCH', `/api/reviews/${rid}/records`, { updates }),
  patchRecord: (id, patch) => req('PATCH', `/api/records/${id}`, patch),
  uploadImage: (id, kind, blob) => req('POST', `/api/records/${id}/images?kind=${kind}`, blob),
  deleteImage: (id, kind) => req('DELETE', `/api/records/${id}/images?kind=${kind}`),
  recordHistory: (id) => req('GET', `/api/records/${id}/history`),
  deleteRecords: (rid, ids) => req('POST', `/api/reviews/${rid}/records/delete`, { ids }),
  deleteReview: (rid) => req('DELETE', `/api/reviews/${rid}`),
  deleteProject: (pid) => req('DELETE', `/api/projects/${pid}`),
  serverInfo: () => req('GET', '/api/server-info'),
  hasTemplate: (pid) => fetch(`/api/projects/${pid}/template`, { method: 'HEAD', credentials: 'same-origin' }).then((r) => r.ok).catch(() => false),
  listUsers: () => req('GET', '/api/users'),
  createUser: (username, displayName, role) => req('POST', '/api/users', { username, displayName, role }),
  updateUser: (id, patch) => req('PATCH', `/api/users/${id}`, patch),
  deleteUser: (id) => req('DELETE', `/api/users/${id}`),
  resetPin: (id) => req('POST', `/api/users/${id}/reset-pin`),
  getGlobalConfig: () => req('GET', '/api/config'),
  getProjectConfig: (pid) => req('GET', `/api/projects/${pid}/config`),
  putProjectConfig: (pid, key, json) => req('PUT', `/api/projects/${pid}/config`, { key, json }),
  getTemplate: (pid) => req('GET', `/api/projects/${pid}/template`),
  putTemplate: (pid, name, blob) => req('PUT', `/api/projects/${pid}/template?name=${encodeURIComponent(name)}`, blob),
  deleteTemplate: (pid) => req('DELETE', `/api/projects/${pid}/template`),
  getReviewConfig: (rid) => req('GET', `/api/reviews/${rid}/config`),
  putReviewConfig: (rid, key, json) => req('PUT', `/api/reviews/${rid}/config`, { key, json }),
  putGlobalConfig: (key, json) => req('PUT', '/api/config', { key, json }),
};

let _isRemote = null;
export async function detectRemote() {
  if (_isRemote !== null) return _isRemote;
  // A file:// build (the portable single file) is always offline — skip the
  // probe so the browser doesn't log an unsupported-scheme fetch error.
  if (typeof location !== 'undefined' && location.protocol === 'file:') {
    _isRemote = false;
    return _isRemote;
  }
  try {
    // `r.ok` alone is not enough: a static host with an SPA fallback answers
    // 200 text/html here. Only the Go server's JSON {"status":"ok"} counts.
    const r = await fetch('/api/health', { credentials: 'same-origin' });
    if (!r.ok) {
      _isRemote = false;
    } else {
      const body = await r.json();
      _isRemote = body?.status === 'ok';
    }
  } catch {
    _isRemote = false;
  }
  return _isRemote;
}

// Map a server record to the shape the existing UI/store expect (parser shape).
// Server ids become the record ID so edits can be synced back by that id, and
// stored image URLs stand in for the data-URL image fields (an <img> src works
// with either).
export function mapServerRecord(s) {
  return {
    ...s,
    ID: s.id,
    imageData: s.beforeUrl || '',
    afterImageData: s.afterUrl || '',
    rawStatus: s.status || '',
  };
}

// Load a review's records for the store.
export async function loadReviewRecords(rid) {
  const recs = await api.getRecords(rid);
  return recs.map(mapServerRecord);
}

export function dataURLtoBlob(dataUrl) {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || '');
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

// Upload a "before" photo held as a data URL. Returns the upload answer
// ({ url, version }) or null when there is nothing to upload or it failed.
async function uploadBefore(id, dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return null;
  const blob = dataURLtoBlob(dataUrl);
  if (!blob) return null;
  try { return await api.uploadImage(id, 'before', blob); } catch { return null; }
}

// Import parsed records (from ingestFiles) into a review: POST the metadata,
// then upload each linked "before" image to the id the server gave that
// record (answered in the order sent). Returns the fresh mapped list.
export async function importParsedRecords(rid, recs) {
  const { ids = [] } = await api.importRecords(rid, recs);
  for (let i = 0; i < recs.length; i += 1) {
    if (ids[i]) await uploadBefore(ids[i], recs[i].imageData);
  }
  return loadReviewRecords(rid);
}

// Create one comment typed in by hand (and its before-photo). Returns it
// mapped for the store, with the server's id and version.
export async function createRecordRemote(rid, rec) {
  const { imageData, afterImageData, ID, ...fields } = rec;
  const created = mapServerRecord(await api.createRecord(rid, fields));
  const up = await uploadBefore(created.ID, imageData);
  return up ? { ...created, imageData: up.url, version: up.version } : created;
}

// Persist one record edit to the server. Field edits go first and carry the
// version this browser last saw (`version`); photos (their own endpoint, never
// in conflict) follow. Resolves to { version } — the record's version after
// the save. If someone else changed the record meanwhile, the field edit is
// refused: the photos are still saved, then it throws an error with code 409
// and `record` = the current record (mapped).
export async function syncRecord(id, patch, version) {
  const fieldKeys = ['commenter', 'discipline', 'resolution', 'status', 'closedAt', 'commentText', 'extra'];
  const fields = {};
  for (const k of fieldKeys) if (k in patch) fields[k] = patch[k];

  let latest = version;
  let conflict = null;
  if (Object.keys(fields).length) {
    try {
      const res = await api.patchRecord(id, version != null ? { ...fields, version } : fields);
      latest = res?.record?.version ?? latest;
    } catch (e) {
      if (e.code !== 409) throw e;
      conflict = e;
    }
  }
  for (const [field, kind] of [['imageData', 'before'], ['afterImageData', 'after']]) {
    if (!(field in patch)) continue;
    const val = patch[field];
    let res = null;
    if (typeof val === 'string' && val.startsWith('data:')) {
      const blob = dataURLtoBlob(val);
      if (blob) res = await api.uploadImage(id, kind, blob);
    } else if (!val) {
      res = await api.deleteImage(id, kind); // photo removed in the drawer
    }
    if (res?.version) latest = res.version;
  }
  if (conflict) {
    let current = conflict.record;
    if (latest !== version) { try { current = await api.getRecord(id); } catch { /* keep the 409 copy */ } }
    conflict.record = current ? mapServerRecord(current) : null;
    throw conflict;
  }
  return { version: latest };
}

// The last opened Project › Review, remembered per browser so a reload goes
// straight back to it. Only ids + names; access is still checked by the server.
const LAST_KEY = 'tabelin.lastReview';
export function loadLastOpened() {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_KEY) || 'null');
    return v && v.project?.id ? v : null;
  } catch {
    return null;
  }
}
export function saveLastOpened(v) {
  try {
    if (v) localStorage.setItem(LAST_KEY, JSON.stringify(v));
    else localStorage.removeItem(LAST_KEY);
  } catch { /* storage blocked — just don't remember */ }
}

// ---------- import (merge) + undo on the server ----------
// Applies a planMerge() result: refreshes matched comments, optionally closes
// the ones missing from the new report, adds the new ones (with their before
// photos), and stores what it did as the review's "lastImport" so it can be
// undone later — from the toast or the review's menu.
export async function applyMergeRemote(rid, plan, { missingAction, doneLabel }) {
  const updates = [];
  const restore = [];
  const newBefore = [];
  for (const { old, patch } of plan.matched) {
    const { imageData, ...fields } = patch;
    if (Object.keys(fields).length) {
      updates.push({ id: old.ID, patch: fields });
      restore.push({ id: old.ID, patch: Object.fromEntries(Object.keys(fields).map((f) => [f, old[f] ?? ''])) });
    }
    if (imageData) newBefore.push([old.ID, imageData]);
  }
  if (missingAction === 'close') {
    const now = new Date().toISOString();
    for (const r of plan.missing) {
      if (r.status === doneLabel) continue;
      updates.push({ id: r.ID, patch: { status: doneLabel, closedAt: now } });
      restore.push({ id: r.ID, patch: { status: r.status, closedAt: r.closedAt || '' } });
    }
  }
  if (updates.length) await api.bulkPatchRecords(rid, updates);
  for (const [id, data] of newBefore) {
    const blob = dataURLtoBlob(data);
    if (blob) { try { await api.uploadImage(id, 'before', blob); } catch { /* keep going */ } }
  }
  const existingIds = new Set([...plan.matched.map((m) => m.old.ID), ...plan.missing.map((r) => r.ID)]);
  const records = plan.added.length ? await importParsedRecords(rid, plan.added) : (await api.getRecords(rid)).map(mapServerRecord);
  const undo = {
    at: new Date().toISOString(),
    added: records.filter((r) => !existingIds.has(r.ID)).map((r) => r.ID),
    restore,
    removeBefore: newBefore.map(([id]) => id),
  };
  try { await api.putReviewConfig(rid, 'lastImport', undo); } catch { /* undo then only from the toast */ }
  return { records, undo };
}

export async function undoImportRemote(rid, undo) {
  if (undo?.added?.length) await api.deleteRecords(rid, undo.added);
  if (undo?.restore?.length) await api.bulkPatchRecords(rid, undo.restore);
  for (const id of undo?.removeBefore || []) { try { await api.deleteImage(id, 'before'); } catch { /* already gone */ } }
  try { await api.putReviewConfig(rid, 'lastImport', null); } catch { /* ignore */ }
  return (await api.getRecords(rid)).map(mapServerRecord);
}
