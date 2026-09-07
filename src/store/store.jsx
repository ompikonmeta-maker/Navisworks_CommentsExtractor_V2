// =====================================================================
// In-memory session store. All state lives in React memory only; there is
// no server call and no persistence — reloading returns to the sample data
// (per spec "Batasan sistem").
// =====================================================================
import { createContext, useContext, useReducer, useCallback, useMemo } from 'react';

const StoreContext = createContext(null);

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
        records: action.records,
        meta: { source: action.source, stats: action.stats },
      };
    case 'UPDATE_RECORD':
      return {
        ...state,
        records: state.records.map((r) =>
          r.ID === action.id ? { ...r, ...action.patch } : r
        ),
      };
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
  // Named `notify` (not `toast`) so it doesn't collide with `state.toast`,
  // the current toast payload the provider also exposes.
  const notify = useCallback(
    (message, kind = 'success') => dispatch({ type: 'TOAST', toast: { message, kind, ts: Date.now() } }),
    []
  );
  const clearToast = useCallback(() => dispatch({ type: 'CLEAR_TOAST' }), []);

  const value = useMemo(
    () => ({ ...state, setLoading, setError, setData, updateRecord, notify, clearToast }),
    [state, setLoading, setError, setData, updateRecord, notify, clearToast]
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
