// Theme toggle — session-only (no persistence, honoring the in-memory spec).
import { useState, useCallback, useEffect } from 'react';

function systemPrefersDark() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function useTheme() {
  const [theme, setThemeState] = useState(() =>
    document.documentElement.getAttribute('data-theme') || (systemPrefersDark() ? 'dark' : 'light')
  );

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setThemeState((t) => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  return { theme, toggle };
}
