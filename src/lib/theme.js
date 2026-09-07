// Theme toggle — session-only (no persistence, honoring the in-memory
// spec). The toggle plays a two-stage circular reveal via the View
// Transitions API (see motion.js).
import { useState, useCallback, useEffect } from 'react';
import { animateThemeSwitch } from './motion.js';

function systemPrefersDark() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function useTheme() {
  const [theme, setThemeState] = useState(
    () => document.documentElement.getAttribute('data-theme') || (systemPrefersDark() ? 'dark' : 'light')
  );

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // `origin` is the element the reveal circle emanates from.
  const toggle = useCallback(
    (origin) => {
      const next = theme === 'dark' ? 'light' : 'dark';
      animateThemeSwitch(() => {
        // Apply synchronously so the View Transition captures the new state.
        document.documentElement.setAttribute('data-theme', next);
        setThemeState(next);
      }, origin);
    },
    [theme]
  );

  return { theme, toggle };
}
