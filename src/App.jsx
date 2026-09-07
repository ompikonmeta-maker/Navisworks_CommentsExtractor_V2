import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { useStore } from './store/store.jsx';
import { loadSampleData } from './lib/sample.js';
import { useTheme } from './lib/theme.js';
import { Icon } from './components/ui.jsx';
import Toast from './components/Toast.jsx';
import Dashboard from './views/Dashboard.jsx';
import Comments from './views/Comments.jsx';
import ImportView from './views/ImportView.jsx';

// Analytics pulls in Recharts — load it only when that route is opened.
const Analytics = lazy(() => import('./views/Analytics.jsx'));

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'comments', label: 'Viewpoints', icon: 'format_list_bulleted' },
  { id: 'analytics', label: 'Analytics', icon: 'insights' },
  { id: 'import', label: 'Import', icon: 'upload_file' },
];

export default function App() {
  const store = useStore();
  const { theme, toggle } = useTheme();
  const [route, setRoute] = useState('dashboard');
  const [detailId, setDetailId] = useState(null);

  // Seed the workspace from the bundled sample on first mount.
  useEffect(() => {
    let cancelled = false;
    store.setLoading();
    loadSampleData()
      .then(({ records, stats }) => {
        if (!cancelled) store.setData(records, 'sample', stats);
      })
      .catch((e) => {
        if (!cancelled) store.setError(e.message);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openDetail = useCallback((id) => {
    setDetailId(id);
    setRoute('comments');
  }, []);

  const go = useCallback((id) => {
    setRoute(id);
    setDetailId(null);
  }, []);

  return (
    <div className="flex min-h-screen flex-col md:flex-row bg-background text-on-surface">
      {/* Sidebar / rail */}
      <aside className="md:sticky md:top-0 md:h-screen md:w-64 shrink-0 border-b md:border-b-0 md:border-r border-outline-variant/60 bg-surface-low">
        <div className="flex items-center gap-3 px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-on-primary">
            <Icon name="table_view" className="text-[22px]" />
          </div>
          <div className="leading-tight">
            <div className="text-base font-semibold tracking-tight">Tabelin</div>
            <div className="text-[11px] text-on-surface-variant">Navisworks Comments</div>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible">
          {NAV.map((item) => {
            const active = route === item.id;
            return (
              <button
                key={item.id}
                onClick={() => go(item.id)}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-full px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  active
                    ? 'bg-secondary-container text-on-secondary-container'
                    : 'text-on-surface-variant hover:bg-surface-container'
                }`}
              >
                <Icon name={item.icon} className="text-[20px]" />
                {item.label}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-outline-variant/60 bg-background/85 px-5 py-3 backdrop-blur">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold capitalize">
              {NAV.find((n) => n.id === route)?.label}
            </h1>
            <p className="truncate text-xs text-on-surface-variant">
              {store.meta.source === 'sample'
                ? 'Sumber: sample bawaan · sesi in-memory'
                : `Sumber: impor pengguna · ${store.records.length} komentar`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-surface-container px-3 py-1 text-xs text-on-surface-variant">
              <Icon name="memory" className="text-[16px]" /> in-memory
            </span>
            <button
              onClick={toggle}
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              className="flex h-10 w-10 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Icon name={theme === 'dark' ? 'light_mode' : 'dark_mode'} className="text-[22px]" />
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6">
          <Screen route={route} detailId={detailId} setDetailId={setDetailId} openDetail={openDetail} go={go} />
        </main>
      </div>

      <Toast />
    </div>
  );
}

function Screen({ route, detailId, setDetailId, openDetail, go }) {
  const { status, error } = useStore();

  if (status === 'error') {
    return (
      <div className="rounded-lg border border-error/40 bg-error-container p-6 text-on-error-container">
        <div className="flex items-center gap-2 font-medium">
          <Icon name="error" /> Gagal memuat data sample
        </div>
        <p className="mt-1 text-sm">{error}</p>
      </div>
    );
  }

  switch (route) {
    case 'dashboard':
      return <Dashboard openDetail={openDetail} go={go} />;
    case 'comments':
      return <Comments detailId={detailId} setDetailId={setDetailId} />;
    case 'analytics':
      return (
        <Suspense fallback={<div className="skeleton mx-auto h-64 max-w-6xl rounded-lg" />}>
          <Analytics />
        </Suspense>
      );
    case 'import':
      return <ImportView go={go} />;
    default:
      return null;
  }
}
