// =====================================================================
// Session persistence — keeps the working session (records + edits +
// before/after images) so a reload restores it, and optionally mirrors it
// to a dedicated folder the user picks.
//
//   • Browser autosave  → IndexedDB (always on, restores with no clicks)
//   • Dedicated folder  → File System Access API writes tabelin-session.json
//
// Everything is inlined in the session object (images as data URLs) so a
// single JSON file is a self-contained, portable copy.
// =====================================================================
const DB_NAME = 'tabelin';
const STORE = 'kv';
const SESSION_KEY = 'session';
const SETTINGS_KEY = 'settings';
const HANDLE_KEY = 'folderHandle';
const TEMPLATE_KEY = 'excelTemplate';
const SESSION_FILE = 'tabelin-session.json';
const SCHEMA_VERSION = 1;

export const FS_SUPPORTED = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

// ---------- tiny IndexedDB key/value ----------
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbDel(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- Excel template (offline) ----------
// The bytes live in IndexedDB so they survive a reload. (On the server the
// template belongs to the project — see data/serverSource.js.)
export async function saveTemplateLocal(name, bytes) {
  try {
    const buffer = bytes instanceof ArrayBuffer ? bytes : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    await idbSet(TEMPLATE_KEY, { name, buffer, savedAt: Date.now() });
  } catch {
    /* ignore quota / private-mode errors */
  }
}
export async function loadTemplateLocal() {
  try {
    const t = await idbGet(TEMPLATE_KEY);
    if (!t) return null;
    return { name: t.name, bytes: new Uint8Array(t.buffer), savedAt: t.savedAt };
  } catch {
    return null;
  }
}
export async function clearTemplateLocal() {
  try { await idbDel(TEMPLATE_KEY); } catch { /* ignore */ }
}

// ---------- session object ----------
export function buildSession(records, source) {
  return { version: SCHEMA_VERSION, savedAt: new Date().toISOString(), source, records };
}

// ---------- browser autosave (IndexedDB) ----------
export async function saveSessionLocal(records, source) {
  try {
    await idbSet(SESSION_KEY, buildSession(records, source));
    return true;
  } catch {
    return false;
  }
}
export async function loadSessionLocal() {
  try {
    const s = await idbGet(SESSION_KEY);
    if (s && Array.isArray(s.records) && s.records.length) return s;
  } catch {
    /* ignore */
  }
  return null;
}
export async function clearSessionLocal() {
  try {
    await idbDel(SESSION_KEY);
  } catch {
    /* ignore */
  }
}
// ---------- app settings (IndexedDB) ----------
export async function saveSettings(settings) {
  try {
    await idbSet(SETTINGS_KEY, settings);
    return true;
  } catch {
    return false;
  }
}
export async function loadSettings() {
  try {
    return (await idbGet(SETTINGS_KEY)) || null;
  } catch {
    return null;
  }
}

export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
  } catch {
    /* ignore */
  }
}

// ---------- dedicated folder (File System Access API) ----------
export async function pickFolder() {
  const handle = await window.showDirectoryPicker({ id: 'tabelin-session', mode: 'readwrite' });
  await idbSet(HANDLE_KEY, handle);
  return handle;
}
export async function getStoredFolder() {
  try {
    return (await idbGet(HANDLE_KEY)) || null;
  } catch {
    return null;
  }
}
export async function forgetFolder() {
  try {
    await idbDel(HANDLE_KEY);
  } catch {
    /* ignore */
  }
}
export async function folderPermission(handle, request = false) {
  if (!handle?.queryPermission) return 'unsupported';
  const opts = { mode: 'readwrite' };
  let state = await handle.queryPermission(opts);
  if (state !== 'granted' && request) state = await handle.requestPermission(opts);
  return state;
}
export async function writeSessionToFolder(handle, records, source) {
  const fh = await handle.getFileHandle(SESSION_FILE, { create: true });
  const w = await fh.createWritable();
  await w.write(JSON.stringify(buildSession(records, source), null, 2));
  await w.close();
}
export async function readSessionFromFolder(handle) {
  try {
    const fh = await handle.getFileHandle(SESSION_FILE);
    const text = await (await fh.getFile()).text();
    const s = JSON.parse(text);
    if (s && Array.isArray(s.records)) return s;
  } catch {
    /* no file yet */
  }
  return null;
}
