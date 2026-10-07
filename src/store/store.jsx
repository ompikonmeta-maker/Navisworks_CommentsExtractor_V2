// =====================================================================
// In-memory session store. All state lives in React memory only; there is
// no server call and no persistence — reloading returns to the sample data
// (per spec "Batasan sistem").
// =====================================================================
import { createContext, useContext, useReducer, useCallback, useMemo, useRef, useEffect } from 'react';
import { detectCommenter } from '../lib/parser.js';
import { extract } from '../lib/detect.js';
import { useSettings } from './settings.jsx';
import { doneLabel as doneLabelOf, resolveStatus } from '../lib/status.js';
import { api, remoteState, syncRecord } from '../lib/server.js';

const StoreContext = createContext(null);

// Record fields a bulk change can touch.
const BULK_KEYS = ['commenter', 'discipline', 'commentText', 'status', 'closedAt', 'extra'];

// Fields typed into a text box — their server saves are batched.
const TEXT_KEYS = new Set(['resolution', 'commentText', 'extra']);

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
  const setData = useCallback(
    (records, source, stats) => dispatch({ type: 'SET_DATA', records, source, stats, statuses: settings.statuses }),
    [settings.statuses]
  );
  // ---- server sync (remote mode) ----
  // Edits are saved per record. Typing in a text field is batched into one save
  // after a short pause; any other change saves at once. If a save fails, the
  // record goes back to what the server has and the user is told why.
  const recordsRef = useRef(state.records);
  recordsRef.current = state.records;
  const pending = useRef(new Map()); // id → { fields, before, timer }

  const flush = useCallback((id) => {
    const p = pending.current.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    pending.current.delete(id);
    syncRecord(id, p.fields).catch((e) => {
      dispatch({ type: 'UPDATE_RECORD', id, patch: p.before });
      dispatch({ type: 'TOAST', toast: { message: saveErrorMessage(e), kind: 'error', ts: Date.now() } });
    });
  }, []);

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
        updates.push({ id: r.ID, patch });
        old.set(r.ID, o);
      }
    });
    if (!updates.length) return;
    api.bulkPatchRecords(remoteState.reviewId, updates).catch((e) => {
      dispatch({ type: 'REPLACE_RECORDS', byId: old });
      dispatch({ type: 'TOAST', toast: { message: saveErrorMessage(e), kind: 'error', ts: Date.now() } });
    });
  }, []);
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
    () => ({ ...state, setLoading, setError, setData, updateRecord, removeRecords, bulkUpdate, applyDetect, renameAttr, remapStatus, notify, clearToast }),
    [state, setLoading, setError, setData, updateRecord, removeRecords, bulkUpdate, applyDetect, renameAttr, remapStatus, notify, clearToast]
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
