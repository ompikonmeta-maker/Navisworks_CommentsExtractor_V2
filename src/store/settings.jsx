// =====================================================================
// App settings (v1.1) — customization that persists across reloads in
// IndexedDB, independent of the working session. Kept small and additive so
// older sessions load with sensible defaults.
// =====================================================================
import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { loadSettings, saveSettings } from '../lib/persist.js';

const DEFAULTS = {
  version: 1,
  themeMode: 'system', // 'system' | 'light' | 'dark'
  // Per-discipline colour overrides, { [name]: '#rrggbb' }. Empty = defaults.
  disciplineColors: {},
  // User-added disciplines (beyond those inferred from the data).
  customDisciplines: [],
  // Commenter registry: author code → human-readable name, { [code]: 'Name' }.
  commenterNames: {},
};

// Resolve an author code to its display name (falls back to the code).
export function commenterLabel(code, names) {
  const n = names?.[code];
  return n && n.trim() ? n.trim() : code;
}

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
      if (saved) setSettings({ ...DEFAULTS, ...saved, disciplineColors: { ...saved.disciplineColors }, commenterNames: { ...saved.commenterNames } });
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
  const setCommenterName = useCallback((code, name) => {
    setSettings((s) => {
      const next = { ...s.commenterNames };
      if (name && name.trim()) next[code] = name.trim();
      else delete next[code];
      return { ...s, commenterNames: next };
    });
  }, []);
  const resetSettings = useCallback(() => {
    applyThemeMode(DEFAULTS.themeMode);
    setSettings({ ...DEFAULTS, disciplineColors: {}, commenterNames: {} });
  }, []);

  const value = useMemo(
    () => ({ settings, ready, update, setThemeMode, setDisciplineColor, addDiscipline, removeDiscipline, setCommenterName, resetSettings }),
    [settings, ready, update, setThemeMode, setDisciplineColor, addDiscipline, removeDiscipline, setCommenterName, resetSettings]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
