// V2 remote mode: talk to the Tabelin server that serves this page.
//
// "Remote mode" is on only when the app is served BY the Go server (there is an
// /api/health on the same origin). Opened as a single file (file://) or from a
// plain static host, detectRemote() is false and the app stays fully offline —
// V1 behaviour is untouched.

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
    const e = new Error(t || res.statusText);
    e.code = res.status;
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
  importRecords: (rid, records) => req('POST', `/api/reviews/${rid}/records`, { records }),
  bulkPatchRecords: (rid, updates) => req('PATCH', `/api/reviews/${rid}/records`, { updates }),
  patchRecord: (id, patch) => req('PATCH', `/api/records/${id}`, patch),
  uploadImage: (id, kind, blob) => req('POST', `/api/records/${id}/images?kind=${kind}`, blob),
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

// Session-wide remote flag + the open Project › Review. Set by Root; read by
// App, the store, and the import path to branch behaviour without prop-drilling.
export const remoteState = { active: false, projectId: null, reviewId: null, user: null };

// Admins and editors write; viewers are read-only (the server enforces it too).
export const canWrite = (user = remoteState.user) => user?.role === 'admin' || user?.role === 'editor';

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
    const r = await fetch('/api/health', { credentials: 'same-origin' });
    _isRemote = r.ok;
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

function dataURLtoBlob(dataUrl) {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || '');
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

// Import parsed records (from ingestFiles) into a review: POST the metadata,
// then upload each linked "before" image. New rows are appended in array order,
// so the last N server records line up with the parsed ones. Returns the fresh
// mapped list for the store.
export async function importParsedRecords(rid, recs) {
  await api.importRecords(rid, recs);
  const server = await api.getRecords(rid);
  const start = Math.max(0, server.length - recs.length);
  for (let i = 0; i < recs.length; i += 1) {
    const src = recs[i];
    const dst = server[start + i];
    if (dst && typeof src.imageData === 'string' && src.imageData.startsWith('data:')) {
      const blob = dataURLtoBlob(src.imageData);
      if (blob) {
        try { await api.uploadImage(dst.id, 'before', blob); } catch { /* keep going */ }
      }
    }
  }
  const finalList = await api.getRecords(rid);
  return finalList.map(mapServerRecord);
}

// Persist one record edit to the server. Splits image uploads (which have their
// own endpoint) from ordinary field edits. Fire-and-forget; returns a promise
// callers may await when they need to refresh.
export async function syncRecord(id, patch) {
  if (!remoteState.active) return;
  const fieldKeys = ['commenter', 'discipline', 'resolution', 'status', 'closedAt', 'commentText', 'extra'];
  const fields = {};
  for (const k of fieldKeys) if (k in patch) fields[k] = patch[k];

  for (const [field, kind] of [['imageData', 'before'], ['afterImageData', 'after']]) {
    if (!(field in patch)) continue;
    const val = patch[field];
    if (typeof val === 'string' && val.startsWith('data:')) {
      const blob = dataURLtoBlob(val);
      if (blob) await api.uploadImage(id, kind, blob);
    }
    // Deleting an image from the UI is not synced yet (no delete endpoint).
  }
  if (Object.keys(fields).length) await api.patchRecord(id, fields);
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

// Exports embed photos from data URLs. Server records point at /api/files/…
// instead, so fetch those and return copies with the photos inlined. Records
// that already carry data URLs (offline mode) pass through untouched.
export async function inlineImages(records) {
  const blobToDataURL = (blob) =>
    new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  const fetchAsDataURL = async (url) => {
    try {
      const res = await fetch(url, { credentials: 'same-origin' });
      return res.ok ? await blobToDataURL(await res.blob()) : '';
    } catch {
      return '';
    }
  };
  const isRemote = (v) => typeof v === 'string' && v !== '' && !v.startsWith('data:');
  const out = records.slice();
  const jobs = [];
  out.forEach((r, i) => {
    for (const f of ['imageData', 'afterImageData']) if (isRemote(r[f])) jobs.push([i, f]);
  });
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const [i, f] = jobs[next++];
      const data = await fetchAsDataURL(out[i][f]);
      out[i] = { ...out[i], [f]: data };
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, jobs.length) }, worker));
  return out;
}

// True for a viewer on the server: edit controls are disabled or hidden.
export const isReadOnly = () => remoteState.active && !canWrite();
