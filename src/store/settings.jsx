// =====================================================================
// App settings (v1.1) — customization that persists across reloads in
// IndexedDB, independent of the working session. Kept small and additive so
// older sessions load with sensible defaults.
// =====================================================================
import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { loadSettings, saveSettings } from '../lib/persist.js';
import { DEFAULT_DETECT } from '../lib/detect.js';
import { DEFAULT_TEMPLATE_MAPPING, migrateMapping } from '../lib/templateExcel.js';
import { DEFAULT_STATUSES, normalizeStatuses } from '../lib/status.js';

const slugKey = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'status';

const cloneDetect = (d) => ({
  commenter: { ...DEFAULT_DETECT.commenter, ...(d?.commenter || {}), rules: (d?.commenter?.rules || DEFAULT_DETECT.commenter.rules).map((r) => ({ ...r })) },
  discipline: { ...DEFAULT_DETECT.discipline, ...(d?.discipline || {}), rules: (d?.discipline?.rules || DEFAULT_DETECT.discipline.rules).map((r) => ({ ...r })) },
  comment: { ...DEFAULT_DETECT.comment, ...(d?.comment || {}), rules: (d?.comment?.rules || DEFAULT_DETECT.comment.rules).map((r) => ({ ...r })) },
});

const DEFAULTS = {
  version: 1,
  themeMode: 'system', // 'system' | 'light' | 'dark'
  // Per-discipline colour overrides, { [name]: '#rrggbb' }. Empty = defaults.
  disciplineColors: {},
  // User-added disciplines (beyond those inferred from the data).
  customDisciplines: [],
  // User-added commenter names (beyond those detected in comment text). The
  // dropdown options are these unioned with the commenters found in the data.
  customCommenters: [],
  // User-editable extraction rules for commenter + discipline detection.
  detect: DEFAULT_DETECT,
  // Template-driven Excel export mapping (constants + field → cell locators).
  templateExport: DEFAULT_TEMPLATE_MAPPING,
  // Configurable comment statuses (label + colour + role). Open and Closed
  // are mandatory; the middle ones are editable. See lib/status.js.
  statuses: DEFAULT_STATUSES,
  // Review close-out target date ('YYYY-MM-DD', '' = none). Drives the
  // Overview verdict, needed pace and the forecast finish line.
  reviewTarget: '',
};

const SettingsContext = createContext(null);

// system → let the media query decide (no attribute); else force it.
export function applyThemeMode(mode) {
  const root = document.documentElement;
  if (mode === 'light' || mode === 'dark') root.setAttribute('data-theme', mode);
  else root.removeAttribute('data-theme');
}

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULTS);
  const [ready, setReady] = useState(false);
  const loaded = useRef(false);

  // Load once on startup, then apply the saved theme.
  useEffect(() => {
    (async () => {
      const saved = await loadSettings();
      if (saved) setSettings({ ...DEFAULTS, ...saved, disciplineColors: { ...saved.disciplineColors }, customCommenters: [...(saved.customCommenters || [])], detect: cloneDetect(saved.detect), templateExport: migrateMapping({ ...DEFAULT_TEMPLATE_MAPPING, ...(saved.templateExport || {}) }), statuses: normalizeStatuses(saved.statuses) });
      applyThemeMode(saved?.themeMode || DEFAULTS.themeMode);
      loaded.current = true;
      setReady(true);
    })();
  }, []);

  // Persist (debounced) on every change once loaded.
  useEffect(() => {
    if (!loaded.current) return undefined;
    const t = setTimeout(() => saveSettings(settings), 400);
    return () => clearTimeout(t);
  }, [settings]);

  const update = useCallback((patch) => setSettings((s) => ({ ...s, ...patch })), []);
  const setThemeMode = useCallback((mode) => {
    applyThemeMode(mode);
    setSettings((s) => ({ ...s, themeMode: mode }));
  }, []);
  const setDisciplineColor = useCallback((name, color) => {
    setSettings((s) => {
      const next = { ...s.disciplineColors };
      if (color) next[name] = color;
      else delete next[name];
      return { ...s, disciplineColors: next };
    });
  }, []);
  const addDiscipline = useCallback((name) => {
    const clean = String(name || '').trim().toUpperCase();
    if (!clean) return;
    setSettings((s) => (s.customDisciplines.includes(clean) ? s : { ...s, customDisciplines: [...s.customDisciplines, clean] }));
  }, []);
  const removeDiscipline = useCallback((name) => {
    setSettings((s) => {
      const colors = { ...s.disciplineColors };
      delete colors[name];
      return { ...s, customDisciplines: s.customDisciplines.filter((d) => d !== name), disciplineColors: colors };
    });
  }, []);
  const addCommenter = useCallback((name) => {
    const clean = String(name || '').trim();
    if (!clean) return;
    setSettings((s) => (s.customCommenters.includes(clean) ? s : { ...s, customCommenters: [...s.customCommenters, clean] }));
  }, []);
  const removeCommenter = useCallback((name) => {
    setSettings((s) => ({ ...s, customCommenters: s.customCommenters.filter((c) => c !== name) }));
  }, []);
  const setDetect = useCallback((kind, config) => {
    setSettings((s) => ({ ...s, detect: { ...s.detect, [kind]: config } }));
  }, []);
  const setTemplateExport = useCallback((patch) => {
    setSettings((s) => ({ ...s, templateExport: typeof patch === 'function' ? patch(s.templateExport) : { ...s.templateExport, ...patch } }));
  }, []);
  // ---- statuses (Open/Closed mandatory; middles editable) ----
  const addStatus = useCallback((label) => {
    const clean = String(label || '').trim() || 'New status';
    setSettings((s) => {
      const list = s.statuses;
      const keys = new Set(list.map((x) => x.key));
      let key = slugKey(clean);
      while (keys.has(key)) key += '_1';
      const doneIdx = list.findIndex((x) => x.role === 'done');
      const at = doneIdx < 0 ? list.length : doneIdx;
      const next = [...list];
      next.splice(at, 0, { key, label: clean, color: '#5b5f77', role: 'middle' });
      return { ...s, statuses: next };
    });
  }, []);
  const updateStatus = useCallback((key, patch) => {
    setSettings((s) => ({ ...s, statuses: s.statuses.map((x) => (x.key === key ? { ...x, ...patch } : x)) }));
  }, []);
  const removeStatus = useCallback((key) => {
    setSettings((s) => {
      const t = s.statuses.find((x) => x.key === key);
      if (!t || t.role !== 'middle') return s; // never remove Open/Closed
      return { ...s, statuses: s.statuses.filter((x) => x.key !== key) };
    });
  }, []);
  const moveStatus = useCallback((key, dir) => {
    setSettings((s) => {
      const list = s.statuses;
      const i = list.findIndex((x) => x.key === key);
      const j = i + dir;
      // Only middles reorder, and they stay between Open (0) and Closed (last).
      if (i < 1 || j < 1 || j > list.length - 2) return s;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return { ...s, statuses: next };
    });
  }, []);
  const resetSettings = useCallback(() => {
    applyThemeMode(DEFAULTS.themeMode);
    setSettings({ ...DEFAULTS, disciplineColors: {}, customCommenters: [], detect: cloneDetect(), statuses: DEFAULT_STATUSES.map((x) => ({ ...x })) });
  }, []);

  const value = useMemo(
    () => ({ settings, ready, update, setThemeMode, setDisciplineColor, addDiscipline, removeDiscipline, addCommenter, removeCommenter, setDetect, setTemplateExport, addStatus, updateStatus, removeStatus, moveStatus, resetSettings }),
    [settings, ready, update, setThemeMode, setDisciplineColor, addDiscipline, removeDiscipline, addCommenter, removeCommenter, setDetect, setTemplateExport, addStatus, updateStatus, removeStatus, moveStatus, resetSettings]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
