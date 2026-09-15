// =====================================================================
// In-memory session store. All state lives in React memory only; there is
// no server call and no persistence — reloading returns to the sample data
// (per spec "Batasan sistem").
// =====================================================================
import { createContext, useContext, useReducer, useCallback, useMemo } from 'react';
import { detectCommenter } from '../lib/parser.js';
import { extract } from '../lib/detect.js';

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
    case 'SET_DATA':
      return {
        ...state,
        status: 'ready',
        error: null,
        records: withCommenters(action.records),
        meta: { source: action.source, stats: action.stats },
      };
    case 'UPDATE_RECORD':
      return {
        ...state,
        records: state.records.map((r) => {
          if (r.ID !== action.id) return r;
          const next = { ...r, ...action.patch };
          // Auto-stamp the close-out time when a comment moves into Closed, and
          // clear it when it leaves — unless the patch sets closedAt explicitly
          // (a manual edit in the detail drawer).
          if ('status' in action.patch && !('closedAt' in action.patch)) {
            const wasClosed = r.status === 'Closed';
            const nowClosed = next.status === 'Closed';
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

  const setLoading = useCallback(() => dispatch({ type: 'LOADING' }), []);
  const setError = useCallback((error) => dispatch({ type: 'LOAD_ERROR', error }), []);
  const setData = useCallback(
    (records, source, stats) => dispatch({ type: 'SET_DATA', records, source, stats }),
    []
  );
  const updateRecord = useCallback(
    (id, patch) => dispatch({ type: 'UPDATE_RECORD', id, patch }),
    []
  );
  const applyDetect = useCallback(
    (field, config, allowed, mode) => dispatch({ type: 'APPLY_DETECT', field, config, allowed, mode }),
    []
  );
  const renameAttr = useCallback((from, to) => dispatch({ type: 'RENAME_ATTR', from, to }), []);
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
    () => ({ ...state, setLoading, setError, setData, updateRecord, applyDetect, renameAttr, notify, clearToast }),
    [state, setLoading, setError, setData, updateRecord, applyDetect, renameAttr, notify, clearToast]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}

// Derived KPI aggregation, memo-friendly pure helper.
export function computeKpis(records) {
  const kpi = { total: records.length, Open: 0, 'In Review': 0, Closed: 0 };
  for (const r of records) kpi[r.status] = (kpi[r.status] || 0) + 1;
  return kpi;
}
