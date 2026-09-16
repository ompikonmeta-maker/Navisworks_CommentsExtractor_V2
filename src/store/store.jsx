// =====================================================================
// In-memory session store. All state lives in React memory only; there is
// no server call and no persistence — reloading returns to the sample data
// (per spec "Batasan sistem").
// =====================================================================
import { createContext, useContext, useReducer, useCallback, useMemo } from 'react';
import { detectCommenter } from '../lib/parser.js';
import { extract } from '../lib/detect.js';
import { useSettings } from './settings.jsx';
import { doneLabel as doneLabelOf, resolveStatus } from '../lib/status.js';
import { remoteState, syncRecord } from '../lib/server.js';

const StoreContext = createContext(null);

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
  const updateRecord = useCallback(
    (id, patch) => {
      dispatch({ type: 'UPDATE_RECORD', id, patch, doneLabel });
      // In remote mode, persist the same edit to the server. Mirror the
      // reducer's closedAt auto-stamp so the server stays consistent when a
      // status button (not the manual editor) closes/reopens a record.
      if (remoteState.active) {
        let sync = patch;
        if ('status' in patch && !('closedAt' in patch)) {
          sync = { ...patch, closedAt: patch.status === doneLabel ? new Date().toISOString() : '' };
        }
        syncRecord(id, sync).catch((e) => dispatch({
          type: 'TOAST',
          toast: { message: `Couldn’t save to server: ${e.message}`, kind: 'error', ts: Date.now() },
        }));
      }
    },
    [doneLabel]
  );
  const applyDetect = useCallback(
    (field, config, allowed, mode) => dispatch({ type: 'APPLY_DETECT', field, config, allowed, mode }),
    []
  );
  const renameAttr = useCallback((from, to) => dispatch({ type: 'RENAME_ATTR', from, to }), []);
  const remapStatus = useCallback((from, to) => dispatch({ type: 'REMAP_STATUS', from, to }), []);
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
    () => ({ ...state, setLoading, setError, setData, updateRecord, applyDetect, renameAttr, remapStatus, notify, clearToast }),
    [state, setLoading, setError, setData, updateRecord, applyDetect, renameAttr, remapStatus, notify, clearToast]
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
