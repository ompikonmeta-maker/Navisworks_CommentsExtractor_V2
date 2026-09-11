import { useState, useEffect, useCallback, useRef } from 'react';
import { useStore } from './store/store.jsx';
import { loadSampleData } from './lib/sample.js';
import { useTheme } from './lib/theme.js';
import { SIDEBAR_SPRING } from './lib/motion.js';
import {
  FS_SUPPORTED,
  requestPersistentStorage,
  loadSessionLocal,
  saveSessionLocal,
  clearSessionLocal,
  pickFolder,
  getStoredFolder,
  folderPermission,
  writeSessionToFolder,
} from './lib/persist.js';
import { Icon, Button } from './components/ui.jsx';
import Toast from './components/Toast.jsx';
import Dashboard from './views/Dashboard.jsx';
import Comments from './views/Comments.jsx';

const NAV = [
  { id: 'dashboard', label: 'Overview', icon: 'dashboard' },
  { id: 'comments', label: 'Viewpoints', icon: 'format_list_bulleted' },
];

const EXPANDED = 300;
const RAIL = 84;

export default function App() {
  const store = useStore();
  const { theme, toggle } = useTheme();
  const [route, setRoute] = useState('dashboard');
  const [detailId, setDetailId] = useState(null);
  const [commentsFilter, setCommentsFilter] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  const themeBtnRef = useRef(null);

  // Session persistence state
  const [folderName, setFolderName] = useState(null);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [saving, setSaving] = useState('idle'); // 'idle' | 'saving' | 'saved'
  const folderHandleRef = useRef(null);

  // Startup: restore the saved session (IndexedDB) if any, else the sample.
  useEffect(() => {
    let cancelled = false;
    store.setLoading();
    (async () => {
      await requestPersistentStorage();
      let restored = false;
      const saved = await loadSessionLocal();
      if (saved && !cancelled) {
        store.setData(saved.records, saved.source || 'user', {
          comments: saved.records.length,
          html: 0,
          images: 0,
          linked: 0,
        });
        restored = true;
      }
      if (!restored && !cancelled) {
        try {
          const { records, stats } = await loadSampleData();
          if (!cancelled) store.setData(records, 'sample', stats);
        } catch (e) {
          if (!cancelled) store.setError(e.message);
        }
      }
      // Reconnect a previously chosen session folder (needs a gesture to re-grant).
      if (FS_SUPPORTED) {
        const h = await getStoredFolder();
        if (h && !cancelled) {
          folderHandleRef.current = h;
          setFolderName(h.name);
          const perm = await folderPermission(h, false);
          setNeedsReconnect(perm !== 'granted');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autosave: browser (IndexedDB) always; mirror to the folder when granted.
  useEffect(() => {
    if (store.status !== 'ready') return undefined;
    const t = setTimeout(async () => {
      setSaving('saving');
      await saveSessionLocal(store.records, store.meta.source);
      const h = folderHandleRef.current;
      if (h && !needsReconnect) {
        try {
          await writeSessionToFolder(h, store.records, store.meta.source);
        } catch {
          setNeedsReconnect(true);
        }
      }
      setSaving('saved');
    }, 700);
    return () => clearTimeout(t);
  }, [store.records, store.meta.source, store.status, needsReconnect]);

  const connectFolder = useCallback(async () => {
    try {
      const h = await pickFolder();
      folderHandleRef.current = h;
      setFolderName(h.name);
      setNeedsReconnect(false);
      await writeSessionToFolder(h, store.records, store.meta.source);
      store.notify(`Session folder connected · ${h.name}/`, 'success');
    } catch (e) {
      if (e.name !== 'AbortError') store.notify(`Couldn’t open folder: ${e.message}`, 'error');
    }
  }, [store]);

  const reconnectFolder = useCallback(async () => {
    const h = folderHandleRef.current;
    if (!h) return;
    const perm = await folderPermission(h, true);
    if (perm === 'granted') {
      setNeedsReconnect(false);
      try {
        await writeSessionToFolder(h, store.records, store.meta.source);
      } catch {
        /* ignore */
      }
      store.notify('Session folder reconnected.', 'success');
    } else {
      store.notify('Folder permission denied.', 'error');
    }
  }, [store]);

  const resetToSample = useCallback(async () => {
    if (!window.confirm('Reset to the bundled sample? Your current edits and uploaded photos will be cleared.')) return;
    await clearSessionLocal();
    try {
      const { records, stats } = await loadSampleData();
      store.setData(records, 'sample', stats);
      store.notify('Reset to sample.', 'info');
    } catch (e) {
      store.notify(`Couldn’t load sample: ${e.message}`, 'error');
    }
  }, [store]);

  const openDetail = useCallback((id) => {
    setDetailId(id);
    setRoute('comments');
  }, []);
  const go = useCallback((id) => {
    setRoute(id);
    setDetailId(null);
  }, []);
  // Jump to Viewpoints with a preset filter (from an Overview KPI/discipline).
  // The nonce lets the same target re-apply on a repeat click.
  const goComments = useCallback((filter) => {
    setDetailId(null);
    setCommentsFilter(filter ? { ...filter, _n: Date.now() } : null);
    setRoute('comments');
  }, []);

  const railStyle = {
    '--rail-w': `${collapsed ? RAIL : EXPANDED}px`,
    transition: `width ${SIDEBAR_SPRING.duration}ms ${SIDEBAR_SPRING.easing}`,
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-on-surface md:flex-row md:gap-3 md:p-3">
      {/* Floating sidebar panel */}
      <aside
        data-rail
        style={railStyle}
        className="t-panel shrink-0 border-b border-outline-variant/60 bg-surface-container md:sticky md:top-3 md:h-[calc(100vh_-_1.5rem)] md:overflow-hidden md:rounded-card md:border md:border-outline-variant/50 md:shadow-md-2"
      >
        <div className={`t-shell w-full ${collapsed ? 'collapsed' : ''}`}>
          <div className="t-brand flex items-center gap-3 px-4 py-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-primary text-on-primary">
              <Icon name="table_view" className="text-[22px]" />
            </div>
            <span className="t-name text-lg font-semibold tracking-tight">Tabelin</span>
            <button
              onClick={() => setCollapsed((c) => !c)}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className={`hidden h-10 w-10 shrink-0 items-center justify-center rounded-control transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary md:inline-flex ${
                collapsed
                  ? 'ml-0 bg-primary text-on-primary shadow-md-1 hover:brightness-110'
                  : 'ml-auto text-on-surface-variant hover:bg-surface-high'
              }`}
            >
              {/* chevron points left to collapse; rotates to point right to expand */}
              <Icon name="chevron_right" className="t-chev text-[22px]" />
            </button>
          </div>

          <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible">
            {NAV.map((item, i) => {
              const active = route === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => go(item.id)}
                  aria-current={active ? 'page' : undefined}
                  title={item.label}
                  style={{ '--d': `${i * 15}ms` }}
                  className={`t-navitem flex items-center gap-3 rounded-full px-4 py-3 text-sm font-medium whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    active
                      ? 'bg-secondary-container text-on-secondary-container'
                      : 'text-on-surface-variant hover:bg-surface-high'
                  }`}
                >
                  <Icon name={item.icon} className="shrink-0 text-[22px]" />
                  <span className="t-lbl">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col md:gap-3">
        {/* Floating title over the canvas — no border/fill on desktop,
            aligned with the content column (max-w-6xl) below. */}
        <header className="t-appbar sticky top-0 z-10 border-b border-outline-variant/60 px-5 py-3 backdrop-blur md:top-3 md:rounded-card md:border-0 md:px-4 md:py-2.5">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4">
            <h1 className="truncate text-2xl font-bold tracking-tight md:text-3xl">
              {NAV.find((n) => n.id === route)?.label}
            </h1>
            <div className="flex shrink-0 items-center gap-1">
              {FS_SUPPORTED &&
                (needsReconnect ? (
                  <Button variant="tonal" icon="folder_open" onClick={reconnectFolder}>Reconnect folder</Button>
                ) : folderName ? (
                  <Button variant="text" icon="folder_open" onClick={connectFolder}>{folderName}/</Button>
                ) : (
                  <Button variant="text" icon="folder_open" onClick={connectFolder}>Session folder</Button>
                ))}
              <button
                ref={themeBtnRef}
                onClick={() => toggle(themeBtnRef.current)}
                aria-label={theme === 'dark' ? 'Light theme' : 'Dark theme'}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control text-on-surface-variant hover:bg-surface-high focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Icon name={theme === 'dark' ? 'light_mode' : 'dark_mode'} className="text-[22px]" />
              </button>
            </div>
          </div>
          <div className="mx-auto mt-1 flex w-full max-w-6xl items-center gap-2 text-xs text-on-surface-variant">
            <span
              className={`h-2 w-2 rounded-full ${saving === 'saving' ? 'bg-status-review' : 'bg-status-closed'}`}
              title={saving === 'saving' ? 'Saving…' : 'Saved'}
            />
            <span>
              Autosaving · browser{folderName ? ` + ${folderName}/` : ''}
              {needsReconnect && folderName ? ' (folder paused)' : ''}
            </span>
            <button onClick={resetToSample} className="ml-auto inline-flex items-center gap-1 text-on-surface-variant hover:text-primary">
              <Icon name="restart_alt" className="text-[15px]" /> Reset to sample
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 md:p-0">
          <Screen
            route={route}
            detailId={detailId}
            setDetailId={setDetailId}
            openDetail={openDetail}
            goComments={goComments}
            commentsFilter={commentsFilter}
          />
        </main>
      </div>

      <Toast />
    </div>
  );
}

function Screen({ route, detailId, setDetailId, openDetail, goComments, commentsFilter }) {
  const { status, error } = useStore();

  if (status === 'error') {
    return (
      <div className="rounded-card border border-error/40 bg-error-container p-6 text-on-error-container">
        <div className="flex items-center gap-2 font-medium">
          <Icon name="error" /> Couldn’t load sample data
        </div>
        <p className="mt-1 text-sm">{error}</p>
      </div>
    );
  }

  switch (route) {
    case 'dashboard':
      return <Dashboard openDetail={openDetail} goComments={goComments} />;
    case 'comments':
      return <Comments detailId={detailId} setDetailId={setDetailId} initialFilter={commentsFilter} />;
    default:
      return null;
  }
}
