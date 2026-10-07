import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from './store/store.jsx';
import { useSettings, applyThemeMode } from './store/settings.jsx';
import { loadSampleData } from './lib/sample.js';
import { SIDEBAR_SPRING, animateThemeSwitch, setRevealDir } from './lib/motion.js';
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
import { loadReviewRecords, canWrite } from './lib/server.js';
import Toast from './components/Toast.jsx';
import Dashboard from './views/Dashboard.jsx';
import Comments from './views/Comments.jsx';
import Settings, { SECTIONS } from './views/Settings.jsx';

const NAV = [
  { id: 'dashboard', label: 'Overview', icon: 'dashboard' },
  { id: 'comments', label: 'Viewpoints', icon: 'format_list_bulleted' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

function systemPrefersDark() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}
function effectiveTheme() {
  return document.documentElement.getAttribute('data-theme') || (systemPrefersDark() ? 'dark' : 'light');
}

const EXPANDED = 300;
const RAIL = 96;

export default function App({ remote = null, onExitProject, onSignOut } = {}) {
  const store = useStore();
  const { settings, update, ready: settingsReady, bindRemote, unbindRemote } = useSettings();
  const [effTheme, setEffTheme] = useState(effectiveTheme);
  const [route, setRoute] = useState('dashboard');
  const [detailId, setDetailId] = useState(null);
  const [commentsFilter, setCommentsFilter] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  const [settingsSection, setSettingsSection] = useState('template');
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Admins in remote mode get an extra "Users" settings section.
  const settingsSections = useMemo(
    () => (remote?.user?.role === 'admin' ? [...SECTIONS, { id: 'users', label: 'Users', icon: 'person' }] : SECTIONS),
    [remote],
  );
  const themeBtnRef = useRef(null);
  // The theme mode already reflected in the DOM. The animated toggle applies
  // the new mode itself (inside the View Transition), so this lets the sync
  // effect below skip re-applying it — a second applyThemeMode during the
  // transition window collapses the old/new snapshots and kills the reveal.
  const appliedMode = useRef(settings.themeMode);

  // Keep the toggle icon in sync with the saved theme mode (applied by the
  // SettingsProvider on load, or by the Settings page). Skips the mode the
  // animated header toggle has already applied.
  useEffect(() => {
    if (appliedMode.current === settings.themeMode) return;
    applyThemeMode(settings.themeMode);
    appliedMode.current = settings.themeMode;
    setEffTheme(effectiveTheme());
  }, [settings.themeMode]);

  // Header toggle: flip light↔dark, persist the choice, animate the reveal.
  const toggleTheme = useCallback((origin) => {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    appliedMode.current = next; // owned by the transition; keep the effect off it
    animateThemeSwitch(() => applyThemeMode(next), origin);
    setEffTheme(next);
    update({ themeMode: next });
  }, [update]);

  // Session persistence state
  const [folderName, setFolderName] = useState(null);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [saving, setSaving] = useState('idle'); // 'idle' | 'saving' | 'saved'
  const folderHandleRef = useRef(null);

  // On the server, use the open project's / review's shared settings.
  const reviewId = remote?.review.id;
  useEffect(() => {
    if (!remote || !settingsReady) return undefined;
    bindRemote({ projectId: remote.project.id, reviewId, canWrite: canWrite(remote.user) });
    return unbindRemote;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewId, settingsReady]);

  // Startup: restore the saved session (IndexedDB) if any, else the sample.
  // In remote mode, load the chosen review's records from the server instead —
  // no local session, no sample.
  useEffect(() => {
    let cancelled = false;
    store.setLoading();
    if (remote) {
      (async () => {
        try {
          const recs = await loadReviewRecords(remote.review.id);
          if (!cancelled) {
            store.setData(recs, `review:${remote.review.id}`, { comments: recs.length, html: 0, images: 0, linked: 0 });
          }
        } catch (e) {
          if (!cancelled) store.setError(e.message);
        }
      })();
      return () => { cancelled = true; };
    }
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
  // Skipped in remote mode — edits are saved to the server per change instead.
  useEffect(() => {
    if (remote) return undefined;
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
    // Reveal direction follows nav order: moving to a lower menu item reveals
    // bottom→top, moving up reveals top→bottom.
    setRoute((cur) => {
      const from = NAV.findIndex((n) => n.id === cur);
      const to = NAV.findIndex((n) => n.id === id);
      setRevealDir(to < from ? -1 : 1);
      return id;
    });
    if (id !== 'settings') setSettingsOpen(false); // fold the submenu when leaving
    setDetailId(null);
  }, []);

  // Tap the Settings parent: enter Settings and open the submenu; if already
  // on Settings, toggle the accordion open/closed.
  const toggleSettings = useCallback(() => {
    setRoute((cur) => {
      if (cur === 'settings') { setSettingsOpen((o) => !o); return cur; }
      setRevealDir(1);
      setSettingsOpen(true);
      return 'settings';
    });
    setDetailId(null);
  }, []);

  // Pick a Settings sub-section from the sidebar (accordion or flyout).
  const selectSettings = useCallback((sec) => {
    setSettingsSection((cur) => {
      setRevealDir(SECTIONS.findIndex((x) => x.id === sec) < SECTIONS.findIndex((x) => x.id === cur) ? -1 : 1);
      return sec;
    });
    setRoute('settings');
    setSettingsOpen(true);
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
    <div className="flex min-h-screen flex-col bg-background text-on-surface md:flex-row md:gap-5 md:p-3 lg:gap-7">
      {/* Floating sidebar panel */}
      <aside
        data-rail
        style={railStyle}
        className="t-panel shrink-0 border-b border-outline-variant/60 bg-surface-container md:sticky md:top-3 md:h-[calc(100vh_-_1.5rem)] md:overflow-hidden md:rounded-card md:border md:border-outline-variant/50"
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
              if (item.id === 'settings') {
                return (
                  <SettingsNav
                    key="settings"
                    item={item}
                    i={i}
                    collapsed={collapsed}
                    route={route}
                    section={settingsSection}
                    sections={settingsSections}
                    open={settingsOpen}
                    onToggle={toggleSettings}
                    onSelect={selectSettings}
                  />
                );
              }
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
                      : 'text-on-surface-variant'
                  }`}
                >
                  <span className="t-ico grid place-items-center"><Icon name={item.icon} className="shrink-0 text-[22px]" /></span>
                  <span className="t-lbl">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </aside>

      {/* Main column */}
      {/* Gutters: the canvas sits further from the sidebar than cards sit from
          each other (16px), and the right edge mirrors that gap so the work
          area reads balanced. */}
      <div className="flex min-w-0 flex-1 flex-col md:gap-3 md:pr-2 lg:pr-4">
        {/* Floating title over the canvas — no border/fill on desktop,
            aligned with the content column (.canvas-w) below. */}
        <header className="t-appbar sticky top-0 z-10 border-b border-outline-variant/60 px-5 py-3 backdrop-blur md:top-3 md:rounded-card md:border-0 md:px-4 md:py-2.5">
          <div className="canvas-w flex items-center justify-between gap-4">
            <h1 className={`${remote ? 'shrink-0' : 'truncate'} text-2xl font-bold tracking-tight md:text-3xl`}>
              {NAV.find((n) => n.id === route)?.label}
            </h1>
            <div className={`flex items-center gap-1 ${remote ? 'min-w-0' : 'shrink-0'}`}>
              {remote && (
                <button
                  onClick={onExitProject}
                  title="Switch review"
                  className="t-press t-card flex h-9 min-w-0 max-w-[24rem] items-center gap-1.5 rounded-full bg-surface pl-3 pr-4 text-[13px] text-on-surface-variant hover:text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <Icon name="folder_open" className="shrink-0 text-[18px]" />
                  <span className="hidden min-w-0 items-center gap-1 sm:flex">
                    <span className="truncate">{remote.project.name}</span>
                    <Icon name="chevron_right" className="shrink-0 text-[16px] opacity-60" />
                  </span>
                  <span className="truncate font-semibold text-on-surface">{remote.review.name}</span>
                </button>
              )}
              {!remote && FS_SUPPORTED &&
                (needsReconnect ? (
                  <Button variant="tonal" icon="folder_open" onClick={reconnectFolder}>Reconnect folder</Button>
                ) : folderName ? (
                  <Button variant="text" icon="folder_open" onClick={connectFolder}>{folderName}/</Button>
                ) : (
                  <Button variant="text" icon="folder_open" onClick={connectFolder}>Session folder</Button>
                ))}
              <button
                ref={themeBtnRef}
                onClick={() => toggleTheme(themeBtnRef.current)}
                aria-label={effTheme === 'dark' ? 'Light theme' : 'Dark theme'}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control text-on-surface-variant hover:bg-surface-high focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Icon name={effTheme === 'dark' ? 'light_mode' : 'dark_mode'} className="text-[22px]" />
              </button>
              {remote && <AccountMenu user={remote.user} onSwitch={onExitProject} onSignOut={onSignOut} />}
            </div>
          </div>
          <div className="canvas-w mt-1 flex items-center gap-2 text-xs text-on-surface-variant">
            <span
              className={`h-2 w-2 rounded-full ${saving === 'saving' ? 'bg-status-review' : 'bg-status-closed'}`}
              title={saving === 'saving' ? 'Saving…' : 'Saved'}
            />
            {remote ? (
              <span title="Shared review, saved on the Tabelin server">{saving === 'saving' ? 'Saving…' : canWrite(remote.user) ? 'Saved' : 'View only'}</span>
            ) : (
              <>
                <span>
                  Autosaving · browser{folderName ? ` + ${folderName}/` : ''}
                  {needsReconnect && folderName ? ' (folder paused)' : ''}
                </span>
                <button onClick={resetToSample} className="ml-auto inline-flex items-center gap-1 text-on-surface-variant hover:text-primary">
                  <Icon name="restart_alt" className="text-[15px]" /> Reset to sample
                </button>
              </>
            )}
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
            settingsSection={settingsSection}
            setSettingsSection={selectSettings}
            settingsSections={settingsSections}
            remoteUser={remote?.user || null}
          />
        </main>
      </div>

      <Toast />
    </div>
  );
}

// Settings item with its nested sub-sections: an accordion when the rail is
// expanded (children slide open below, indented under a guide line) and a
// portalled flyout when the rail is collapsed to icons (children float beside
// it). Matches the approved mock: emphasized-easing reveal + spring flyout.
// Account button (initials) with a small menu: who is signed in, switch
// review, sign out. Keeps Sign out out of the working toolbar.
function AccountMenu({ user, onSwitch, onSignOut }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const off = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', off);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc); };
  }, [open]);
  const name = user?.displayName || user?.username || '';
  const initials = name.replace(/^.*\\/, '').split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${name}`}
        title={name}
        className="t-press flex h-9 w-9 items-center justify-center rounded-full bg-primary-container text-[13px] font-bold text-on-primary-container focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {initials}
      </button>
      <div role="menu" className={`t-pop absolute right-0 top-11 z-40 w-60 rounded-[18px] bg-surface p-1.5 ${open ? 'show' : ''}`}>
        <div className="px-3 pb-2 pt-2">
          <div className="truncate text-sm font-semibold">{name}</div>
          <div className="text-xs capitalize text-on-surface-variant">{user?.role}</div>
        </div>
        <button role="menuitem" onClick={() => { setOpen(false); onSwitch(); }} className="t-menuitem"><Icon name="folder_open" className="text-[19px]" />Switch review</button>
        <button role="menuitem" onClick={() => { setOpen(false); onSignOut(); }} className="t-menuitem"><Icon name="logout" className="text-[19px]" />Sign out</button>
      </div>
    </div>
  );
}

function SettingsNav({ item, i, collapsed, route, section, sections = SECTIONS, open, onToggle, onSelect }) {
  const active = route === 'settings';
  const btnRef = useRef(null);
  const closeTimer = useRef(null);
  const [flyPos, setFlyPos] = useState(null);
  const [flyOpen, setFlyOpen] = useState(false);

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setFlyPos({ top: r.top - 4, left: r.right + 12 });
  }, []);
  const openFly = useCallback(() => { clearTimeout(closeTimer.current); place(); setFlyOpen(true); }, [place]);
  const scheduleClose = useCallback(() => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setFlyOpen(false), 140);
  }, []);

  useEffect(() => {
    if (!collapsed) { setFlyOpen(false); return undefined; }
    if (!flyOpen) return undefined;
    const on = () => place();
    window.addEventListener('scroll', on, true);
    window.addEventListener('resize', on);
    return () => { window.removeEventListener('scroll', on, true); window.removeEventListener('resize', on); };
  }, [collapsed, flyOpen, place]);

  return (
    <div
      className="t-setwrap"
      onMouseEnter={collapsed ? openFly : undefined}
      onMouseLeave={collapsed ? scheduleClose : undefined}
      onFocusCapture={collapsed ? openFly : undefined}
      onBlurCapture={collapsed ? scheduleClose : undefined}
    >
      <button
        ref={btnRef}
        onClick={onToggle}
        aria-current={active ? 'page' : undefined}
        aria-expanded={collapsed ? undefined : open}
        title={item.label}
        style={{ '--d': `${i * 15}ms` }}
        className={`t-navitem flex w-full items-center gap-3 rounded-full px-4 py-3 text-sm font-medium whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
          active ? 'bg-secondary-container text-on-secondary-container' : 'text-on-surface-variant'
        }`}
      >
        <span className="t-ico grid place-items-center"><Icon name={item.icon} className="shrink-0 text-[22px]" /></span>
        <span className="t-lbl">{item.label}</span>
        <Icon name="chevron_right" className={`t-subchev text-[20px] ${open ? 'open' : ''}`} />
      </button>

      {/* Accordion — expanded rail (CSS hides it when collapsed / on mobile) */}
      <div className={`t-subacc ${open ? 'show' : ''}`}>
        <div>
          <div className="t-subacc-inner">
            {sections.map((s, idx) => {
              const on = active && section === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => onSelect(s.id)}
                  aria-current={on ? 'page' : undefined}
                  style={{ '--d': `${idx * 45}ms` }}
                  className={`t-sub ${on ? 'on' : ''}`}
                >
                  <Icon name={s.icon} className="shrink-0 text-[19px]" />
                  <span>{s.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Flyout — collapsed rail; portalled so the aside's overflow can't clip it */}
      {collapsed && flyPos && createPortal(
        <div
          className={`t-flyout ${flyOpen ? 'show' : ''}`}
          style={{ top: flyPos.top, left: flyPos.left }}
          onMouseEnter={openFly}
          onMouseLeave={scheduleClose}
        >
          <div className="t-flyout-cap">Settings</div>
          {sections.map((s) => {
            const on = active && section === s.id;
            return (
              <button key={s.id} onClick={() => { onSelect(s.id); setFlyOpen(false); }} className={`t-sub ${on ? 'on' : ''}`}>
                <Icon name={s.icon} className="shrink-0 text-[19px]" />
                <span>{s.label}</span>
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}

function Screen({ route, detailId, setDetailId, openDetail, goComments, commentsFilter, settingsSection, setSettingsSection, settingsSections, remoteUser }) {
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
    case 'settings':
      return <Settings section={settingsSection} setSection={setSettingsSection} sections={settingsSections} remoteUser={remoteUser} />;
    default:
      return null;
  }
}
