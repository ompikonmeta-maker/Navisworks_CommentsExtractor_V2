import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { useStore } from './store/store.jsx';
import { loadSampleData } from './lib/sample.js';
import { useTheme } from './lib/theme.js';
import { SIDEBAR_SPRING } from './lib/motion.js';
import { Icon } from './components/ui.jsx';
import Toast from './components/Toast.jsx';
import Dashboard from './views/Dashboard.jsx';
import Comments from './views/Comments.jsx';
import ImportView from './views/ImportView.jsx';

// Analytics pulls in Recharts — load it only when that route is opened.
const Analytics = lazy(() => import('./views/Analytics.jsx'));

const NAV = [
  { id: 'dashboard', label: 'Overview', icon: 'dashboard' },
  { id: 'comments', label: 'Viewpoints', icon: 'format_list_bulleted' },
  { id: 'analytics', label: 'Analytics', icon: 'insights' },
  { id: 'import', label: 'Import', icon: 'upload_file' },
];

const EXPANDED = 300;
const RAIL = 84;

export default function App() {
  const store = useStore();
  const { theme, toggle } = useTheme();
  const [route, setRoute] = useState('dashboard');
  const [detailId, setDetailId] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  const themeBtnRef = useRef(null);

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

  const railStyle = {
    '--rail-w': `${collapsed ? RAIL : EXPANDED}px`,
    transition: `width ${SIDEBAR_SPRING.duration}ms ${SIDEBAR_SPRING.easing}`,
  };

  return (
    <div className="flex min-h-screen flex-col md:flex-row bg-background text-on-surface">
      {/* Sidebar / rail */}
      <aside
        data-rail
        style={railStyle}
        className="md:sticky md:top-0 md:h-screen shrink-0 border-b md:border-b-0 md:border-r border-outline-variant/60 bg-surface-low md:overflow-hidden"
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
              className="ml-auto hidden h-9 w-9 shrink-0 items-center justify-center rounded-control text-on-surface-variant hover:bg-surface-container md:inline-flex"
            >
              {/* chevron points left to collapse, rotates to point right to expand */}
              <Icon name="chevron_right" className="t-chev rotate-180 text-[22px]" />
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
                      : 'text-on-surface-variant hover:bg-surface-container'
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
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-outline-variant/60 bg-background/85 px-5 py-3 backdrop-blur">
          <h1 className="truncate text-xl font-semibold">{NAV.find((n) => n.id === route)?.label}</h1>
          <button
            ref={themeBtnRef}
            onClick={() => toggle(themeBtnRef.current)}
            aria-label={theme === 'dark' ? 'Light theme' : 'Dark theme'}
            className="flex h-10 w-10 items-center justify-center rounded-control text-on-surface-variant hover:bg-surface-container focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Icon name={theme === 'dark' ? 'light_mode' : 'dark_mode'} className="text-[22px]" />
          </button>
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
      return <Dashboard openDetail={openDetail} go={go} />;
    case 'comments':
      return <Comments detailId={detailId} setDetailId={setDetailId} />;
    case 'analytics':
      return (
        <Suspense fallback={<div className="skeleton mx-auto h-64 max-w-6xl rounded-card" />}>
          <Analytics />
        </Suspense>
      );
    case 'import':
      return <ImportView go={go} />;
    default:
      return null;
  }
}
