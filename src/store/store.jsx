// =====================================================================
// Session store: the records of the open dataset, in React memory.
// Offline, App.jsx autosaves them to the browser. On the office server every
// edit is saved per record with the version this browser last saw (a stale
// save comes back 409 and the newer values are shown instead), and a light
// refresh merges other people's changes every 30 s and on window focus.
// =====================================================================
import { createContext, useContext, useReducer, useCallback, useMemo, useRef, useEffect } from 'react';
import { detectCommenter } from '../lib/parser.js';
import { extract } from '../lib/detect.js';
import { useSettings } from './settings.jsx';
import { doneLabel as doneLabelOf, resolveStatus } from '../lib/status.js';
import { api, remoteState, syncRecord, createRecordRemote, mapServerRecord } from '../lib/server.js';

const StoreContext = createContext(null);

// Record fields a bulk change can touch.
const BULK_KEYS = ['commenter', 'discipline', 'commentText', 'status', 'closedAt', 'extra'];

// Fields typed into a text box — their server saves are batched.
const TEXT_KEYS = new Set(['resolution', 'commentText', 'extra']);

// How often the open review asks the server for other people's changes.
export const REFRESH_MS = 30000;

export const CONFLICT_MESSAGE = 'Someone else changed this comment — showing the latest.';
export const CONFLICT_KEPT_MESSAGE = 'Someone else changed this comment — showing the latest. Your resolution text is still in the field but not saved.';

function saveErrorMessage(e) {
  if (e?.code === 403) return 'You have view-only access, so this change wasn’t saved.';
  if (e?.code === 401) return 'You were signed out. Sign in again to save changes.';
  return 'Couldn’t reach the Tabelin server, so this change wasn’t saved.';
}

// Backfill fields for records loaded from an older session: the raw comment
// source (`commentRaw`, kept so detection can re-run against the un-cleaned
// text) and the auto-detected commenter. Neither overrides an existing value.
function withCommenters(records) {
  return records.map((r) => {
    const commentRaw = r.commentRaw ?? r.commentText;
    const commenter = r.commenter === undefined ? detectCommenter(commentRaw) : r.commenter;
    return { ...r, commentRaw, commenter };
  });
}

const initialState = {
  status: 'loading', // 'loading' | 'ready' | 'error'
  error: null,
  records: [],
  meta: { source: 'sample', stats: null }, // provenance of current dataset
  toast: null, // { kind: 'success'|'error'|'info', message }
};

function reducer(state, action) {
  switch (action.type) {
    case 'LOADING':
      return { ...state, status: 'loading', error: null };
    case 'LOAD_ERROR':
      return { ...state, status: 'error', error: action.error };
    case 'SET_DATA': {
      const list = action.statuses;
      const records = withCommenters(action.records).map((r) =>
        (list && list.length ? { ...r, status: resolveStatus(r.status, list) } : r));
      return {
        ...state,
        status: 'ready',
        error: null,
        records,
        meta: { source: action.source, stats: action.stats },
      };
    }
    case 'UPDATE_RECORD':
      return {
        ...state,
        records: state.records.map((r) => {
          if (r.ID !== action.id) return r;
          const next = { ...r, ...action.patch };
          // Auto-stamp the close-out time when a comment moves into the "done"
          // status, and clear it when it leaves — unless the patch sets closedAt
          // explicitly (a manual edit in the detail drawer). The done label is
          // configurable, so it comes in on the action.
          if ('status' in action.patch && !('closedAt' in action.patch)) {
            const done = action.doneLabel || 'Closed';
            const wasClosed = r.status === done;
            const nowClosed = next.status === done;
            if (nowClosed && !wasClosed) next.closedAt = new Date().toISOString();
            else if (!nowClosed && wasClosed) next.closedAt = null;
          }
          return next;
        }),
      };
    case 'APPLY_DETECT': {
      // Re-run extraction for `field` ('commenter' | 'discipline' | 'comment')
      // across all records, always reading the RAW source text. mode 'fill'
      // keeps existing values; 'overwrite' replaces every one.
      const { field, config, allowed, mode } = action;
      return {
        ...state,
        records: state.records.map((r) => {
          const src = r.commentRaw ?? r.commentText;
          if (field === 'comment') {
            // Result targets commentText; empty extraction → keep the original.
            const cleaned = extract(src, config, allowed).val || src;
            if (mode === 'fill' && r.commentText && r.commentText !== src) return r; // already cleaned
            return { ...r, commentText: cleaned };
          }
          if (mode === 'fill' && r[field] && !(field === 'discipline' && r[field] === 'OTHER')) return r;
          return { ...r, [field]: extract(src, config, allowed).val };
        }),
      };
    }
    case 'REMAP_STATUS': {
      // Move every record whose status === from to `to` (a status was renamed,
      // or a middle status was deleted and its comments reassigned to Open).
      const { from, to } = action;
      if (!from || !to || from === to) return state;
      return {
        ...state,
        records: state.records.map((r) => (r.status === from ? { ...r, status: to } : r)),
      };
    }
    case 'RENAME_ATTR': {
      // Move record.extra[from] → [to] across all records (template custom
      // attribute renamed in the Export mapping).
      const { from, to } = action;
      if (!from || !to || from === to) return state;
      return {
        ...state,
        records: state.records.map((r) => {
          if (!r.extra || !(from in r.extra)) return r;
          const extra = { ...r.extra };
          extra[to] = extra[from];
          delete extra[from];
          return { ...r, extra };
        }),
      };
    }
    case 'BULK_UPDATE': {
      // Same patch on many records (Viewpoints bulk bar), with the closedAt
      // stamp rules of UPDATE_RECORD.
      const ids = new Set(action.ids);
      const done = action.doneLabel || 'Closed';
      const now = new Date().toISOString();
      return {
        ...state,
        records: state.records.map((r) => {
          if (!ids.has(r.ID)) return r;
          const next = { ...r, ...action.patch };
          if ('status' in action.patch) {
            if (next.status === done && r.status !== done) next.closedAt = now;
            else if (next.status !== done && r.status === done) next.closedAt = null;
          }
          return next;
        }),
      };
    }
    case 'MERGE_SERVER': {
      // Records from the server (mapped). A record replaces the local copy when
      // its version is newer — or always with `force` (a save conflict). Ids in
      // `skip` (being edited/saved here) are left alone. With `ids` (the full
      // id list from a refresh), local records that were in `dropFrom` and are
      // no longer on the server are removed; unknown server records are added.
      // `patch` ({ id: fields }) is laid over a replaced record.
      const list = action.statuses;
      const norm = (r) => {
        const [x] = withCommenters([r]);
        return list && list.length ? { ...x, status: resolveStatus(x.status, list) } : x;
      };
      const incoming = new Map(action.records.map((r) => [r.ID, r]));
      const keep = action.ids ? new Set(action.ids) : null;
      const skip = action.skip || new Set();
      const dropFrom = action.dropFrom || null;
      let changed = false;
      const seen = new Set();
      const out = [];
      for (const r of state.records) {
        if (keep && !keep.has(r.ID) && !skip.has(r.ID) && (!dropFrom || dropFrom.has(r.ID))) { changed = true; continue; }
        const srv = incoming.get(r.ID);
        if (srv) {
          seen.add(r.ID);
          if (!skip.has(r.ID) && (action.force || (srv.version || 0) > (r.version || 0))) {
            out.push({ ...norm(srv), ...(action.patch?.[r.ID] || {}) });
            changed = true;
            continue;
          }
        }
        out.push(r);
      }
      for (const srv of incoming.values()) {
        if (seen.has(srv.ID) || (keep && !keep.has(srv.ID))) continue;
        if (action.force) continue; // a conflict never adds a record
        out.push(norm(srv));
        changed = true;
      }
      return changed ? { ...state, records: out } : state;
    }
    case 'ADD_RECORD':
      return { ...state, records: [...state.records, action.record] };
    case 'REMOVE_RECORDS': {
      const ids = new Set(action.ids);
      return { ...state, records: state.records.filter((r) => !ids.has(r.ID)) };
    }
    case 'RESTORE_RECORDS': {
      // Put removed records back at their old positions (a failed delete).
      const next = [...state.records];
      for (const { index, record } of [...action.items].sort((a, b) => a.index - b.index)) next.splice(index, 0, record);
      return { ...state, records: next };
    }
    case 'REPLACE_RECORDS': {
      // Put back specific records (by ID) — used to undo a failed bulk save.
      const { byId } = action;
      return { ...state, records: state.records.map((r) => byId.get(r.ID) || r) };
    }
    case 'TOAST':
      return { ...state, toast: action.toast };
    case 'CLEAR_TOAST':
      return { ...state, toast: null };
    default:
      return state;
  }
}

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { settings } = useSettings();
  const doneLabel = doneLabelOf(settings.statuses);

  const setLoading = useCallback(() => dispatch({ type: 'LOADING' }), []);
  const setError = useCallback((error) => dispatch({ type: 'LOAD_ERROR', error }), []);
  // Latest version per record id as answered by the server — ahead of the
  // rendered state right after a save. `gen` changes whenever the whole list
  // is replaced, so a refresh that started before is thrown away.
  const versions = useRef(new Map());
  const gen = useRef(0);
  const setData = useCallback(
    (records, source, stats) => {
      versions.current.clear();
      gen.current += 1;
      dispatch({ type: 'SET_DATA', records, source, stats, statuses: settings.statuses });
    },
    [settings.statuses]
  );
  const statusesRef = useRef(settings.statuses);
  statusesRef.current = settings.statuses;
  // ---- server sync (remote mode) ----
  // Edits are saved per record. Typing in a text field is batched into one save
  // after a short pause; any other change saves at once. If a save fails, the
  // record goes back to what the server has and the user is told why.
  const recordsRef = useRef(state.records);
  recordsRef.current = state.records;
  const pending = useRef(new Map()); // id → { fields, before, timer }
  const inflight = useRef(new Map()); // id → promise of the save being sent

  const versionOf = useCallback((id) => {
    if (versions.current.has(id)) return versions.current.get(id);
    return recordsRef.current.find((r) => r.ID === id)?.version;
  }, []);

  // Someone else saved this comment first. Show their version; if this save
  // carried a resolution, keep the user's text in the field (not saved) and
  // offer to save it over theirs.
  const onConflict = useCallback((id, fields, server) => {
    if (!server) return;
    versions.current.set(id, server.version);
    const p = pending.current.get(id);
    if (p) { clearTimeout(p.timer); pending.current.delete(id); }
    const local = recordsRef.current.find((r) => r.ID === id);
    const typed = local?.resolution ?? fields.resolution ?? '';
    const keepText = 'resolution' in fields && typed !== (server.resolution ?? '');
    dispatch({
      type: 'MERGE_SERVER', records: [server], force: true, statuses: statusesRef.current,
      patch: keepText ? { [id]: { resolution: typed } } : undefined,
    });
    const toast = keepText
      ? { message: CONFLICT_KEPT_MESSAGE, kind: 'info', ts: Date.now(), action: { label: 'Save mine', onClick: () => saveRef.current?.(id, { resolution: typed }) } }
      : { message: CONFLICT_MESSAGE, kind: 'info', ts: Date.now() };
    dispatch({ type: 'TOAST', toast });
  }, []);

  // Saves of one record go out one after another, each with the version the
  // previous one returned — so this browser never conflicts with itself.
  const flush = useCallback((id) => {
    const p = pending.current.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    pending.current.delete(id);
    const prev = inflight.current.get(id) || Promise.resolve();
    const run = prev.then(async () => {
      try {
        const { version } = await syncRecord(id, p.fields, versionOf(id));
        if (version != null && version !== versionOf(id)) {
          versions.current.set(id, version);
          dispatch({ type: 'UPDATE_RECORD', id, patch: { version } });
        }
      } catch (e) {
        if (e?.code === 409) { onConflict(id, p.fields, e.record); return; }
        dispatch({ type: 'UPDATE_RECORD', id, patch: p.before });
        dispatch({ type: 'TOAST', toast: { message: saveErrorMessage(e), kind: 'error', ts: Date.now() } });
      }
    });
    inflight.current.set(id, run);
    run.finally(() => { if (inflight.current.get(id) === run) inflight.current.delete(id); });
  }, [versionOf, onConflict]);
  const saveRef = useRef(null);

  useEffect(() => {
    const flushAll = () => [...pending.current.keys()].forEach(flush);
    window.addEventListener('pagehide', flushAll);
    return () => window.removeEventListener('pagehide', flushAll);
  }, [flush]);

  const updateRecord = useCallback(
    (id, patch) => {
      // On the server, stamp the edit locally too so "Changed by" is current
      // without a reload (the server records the same on save).
      const stamp = remoteState.active
        ? { changedBy: remoteState.user?.displayName || remoteState.user?.username || '', changedAt: new Date().toISOString() }
        : null;
      dispatch({ type: 'UPDATE_RECORD', id, patch: stamp ? { ...patch, ...stamp } : patch, doneLabel });
      if (!remoteState.active) return;
      // Mirror the reducer's closedAt auto-stamp so the server stays consistent
      // when a status button (not the manual editor) closes/reopens a record.
      let sync = patch;
      if ('status' in patch && !('closedAt' in patch)) {
        sync = { ...patch, closedAt: patch.status === doneLabel ? new Date().toISOString() : '' };
      }
      const rec = recordsRef.current.find((r) => r.ID === id) || {};
      const p = pending.current.get(id) || { fields: {}, before: {}, timer: null };
      for (const k of Object.keys(sync)) if (!(k in p.before)) p.before[k] = rec[k] ?? '';
      Object.assign(p.fields, sync);
      pending.current.set(id, p);
      clearTimeout(p.timer);
      // A removed photo waits out the drawer's Undo (5 s) before the server
      // deletes it; an Undo puts the old URL back into the pending patch,
      // which then saves as a no-op.
      const removesPhoto = Object.keys(sync).some((k) => (k === 'imageData' || k === 'afterImageData') && !sync[k]);
      if (removesPhoto) p.timer = setTimeout(() => flush(id), 6000);
      else if (Object.keys(sync).every((k) => TEXT_KEYS.has(k))) p.timer = setTimeout(() => flush(id), 700);
      else flush(id);
    },
    [doneLabel, flush]
  );
  saveRef.current = updateRecord;
  // Changes that touch many records at once. On the server, the records that
  // actually changed are saved in one request; if it fails they're put back.
  const bulk = useCallback((action) => {
    const prev = recordsRef.current;
    dispatch(action);
    if (!remoteState.active) return;
    const next = reducer({ records: prev }, action).records;
    const updates = [];
    const old = new Map();
    next.forEach((r, i) => {
      const o = prev[i];
      if (r === o) return;
      const patch = {};
      for (const k of BULK_KEYS) if (JSON.stringify(r[k]) !== JSON.stringify(o[k])) patch[k] = r[k];
      if (Object.keys(patch).length) {
        const version = versionOf(r.ID);
        updates.push(version != null ? { id: r.ID, version, patch } : { id: r.ID, patch });
        old.set(r.ID, o);
      }
    });
    if (!updates.length) return;
    api.bulkPatchRecords(remoteState.reviewId, updates).then((res) => {
      for (const [id, v] of Object.entries(res?.versions || {})) {
        versions.current.set(Number(id), v);
        dispatch({ type: 'UPDATE_RECORD', id: Number(id), patch: { version: v } });
      }
      const conflicts = (res?.conflicts || []).map(mapServerRecord);
      if (conflicts.length) {
        for (const c of conflicts) versions.current.set(c.ID, c.version);
        dispatch({ type: 'MERGE_SERVER', records: conflicts, force: true, statuses: statusesRef.current });
        const n = conflicts.length;
        dispatch({ type: 'TOAST', toast: {
          message: n === 1 ? CONFLICT_MESSAGE : `Someone else changed ${n} of these comments — showing the latest for those.`,
          kind: 'info', ts: Date.now(),
        } });
      }
    }).catch((e) => {
      dispatch({ type: 'REPLACE_RECORDS', byId: old });
      dispatch({ type: 'TOAST', toast: { message: saveErrorMessage(e), kind: 'error', ts: Date.now() } });
    });
  }, [versionOf]);
  // Delete comments (and their photos). On the server a failed delete puts
  // them back where they were.
  const removeRecords = useCallback((ids) => {
    const set = new Set(ids);
    const items = recordsRef.current.map((record, index) => ({ record, index })).filter((x) => set.has(x.record.ID));
    dispatch({ type: 'REMOVE_RECORDS', ids });
    if (!remoteState.active) return Promise.resolve();
    return api.deleteRecords(remoteState.reviewId, ids).catch((e) => {
      dispatch({ type: 'RESTORE_RECORDS', items });
      dispatch({ type: 'TOAST', toast: { message: saveErrorMessage(e), kind: 'error', ts: Date.now() } });
      throw e;
    });
  }, []);
  // Add one comment typed in by hand (not from a Navisworks report). On the
  // server it is created first so it carries the server's ID. Resolves to it.
  const addRecord = useCallback(async (rec) => {
    let record;
    if (remoteState.active) {
      record = await createRecordRemote(remoteState.reviewId, rec);
      versions.current.set(record.ID, record.version);
    } else {
      const max = recordsRef.current.reduce((m, r) => Math.max(m, Number(r.ID) || 0), 0);
      record = { ...rec, ID: max + 1 };
    }
    dispatch({ type: 'ADD_RECORD', record });
    return record;
  }, []);
  // ---- light refresh (server) ----
  // While a review is open, ask for what changed since the last ask: every
  // REFRESH_MS, when the window gets focus and when the tab becomes visible.
  // Records being edited or saved here are skipped (their save will either go
  // through or come back as a conflict); newer versions replace the rest,
  // new comments are added and deleted ones removed.
  const refreshNow = useRef(null);
  const reviewSource = state.status === 'ready' && remoteState.active && String(state.meta.source || '').startsWith('review:')
    ? state.meta.source : null;
  useEffect(() => {
    if (!reviewSource) return undefined;
    const rid = remoteState.reviewId;
    let since = '';
    let busy = false;
    let stopped = false;
    const refresh = async () => {
      if (busy || stopped || (typeof document !== 'undefined' && document.hidden)) return;
      busy = true;
      const myGen = gen.current;
      const startIds = new Set(recordsRef.current.map((r) => r.ID));
      try {
        const res = await api.getChanges(rid, since);
        if (stopped || myGen !== gen.current) return;
        since = res.next || since;
        const skip = new Set([...pending.current.keys(), ...inflight.current.keys()]);
        const records = (res.records || []).map(mapServerRecord);
        for (const r of records) {
          const known = versionOf(r.ID);
          if (!skip.has(r.ID) && (known == null || r.version > known)) versions.current.set(r.ID, r.version);
        }
        dispatch({ type: 'MERGE_SERVER', records, ids: res.ids, skip, dropFrom: startIds, statuses: statusesRef.current });
      } catch {
        // offline for a moment or signed out — the next refresh tries again
      } finally {
        busy = false;
      }
    };
    refreshNow.current = refresh;
    const timer = setInterval(refresh, REFRESH_MS);
    const onVisible = () => { if (!document.hidden) refresh(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      refreshNow.current = null;
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [reviewSource, versionOf]);

  const applyDetect = useCallback(
    (field, config, allowed, mode) => bulk({ type: 'APPLY_DETECT', field, config, allowed, mode }),
    [bulk]
  );
  const renameAttr = useCallback((from, to) => bulk({ type: 'RENAME_ATTR', from, to }), [bulk]);
  const bulkUpdate = useCallback((ids, patch) => bulk({ type: 'BULK_UPDATE', ids, patch, doneLabel }), [bulk, doneLabel]);
  const remapStatus = useCallback((from, to) => bulk({ type: 'REMAP_STATUS', from, to }), [bulk]);
  // Named `notify` (not `toast`) so it doesn't collide with `state.toast`,
  // the current toast payload the provider also exposes.
  // `action` (optional): { label, onClick } renders a button in the toast —
  // used for Undo. The onClick lives only in memory, never persisted.
  const notify = useCallback(
    (message, kind = 'success', action = null) =>
      dispatch({ type: 'TOAST', toast: { message, kind, action, ts: Date.now() } }),
    []
  );
  const clearToast = useCallback(() => dispatch({ type: 'CLEAR_TOAST' }), []);

  const value = useMemo(
    () => ({ ...state, setLoading, setError, setData, updateRecord, addRecord, removeRecords, bulkUpdate, applyDetect, renameAttr, remapStatus, notify, clearToast }),
    [state, setLoading, setError, setData, updateRecord, addRecord, removeRecords, bulkUpdate, applyDetect, renameAttr, remapStatus, notify, clearToast]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}

// Derived KPI aggregation, memo-friendly pure helper. `labels` seeds the known
// statuses so each shows a 0 even when no comment uses it yet.
export function computeKpis(records, labels = []) {
  const kpi = { total: records.length };
  for (const l of labels) kpi[l] = 0;
  for (const r of records) kpi[r.status] = (kpi[r.status] || 0) + 1;
  return kpi;
}
