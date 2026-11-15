import { useState } from 'react';

export type PanelTheme = 'light' | 'dark';
const STORAGE_KEY = 'beautybarber-panel-theme';

function initialTheme(): PanelTheme {
  try { return window.localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light'; }
  catch { return 'light'; }
}

export function usePanelTheme() {
  const [theme, setTheme] = useState<PanelTheme>(initialTheme);

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* Navegação privada bloqueia armazenamento. */ }
  }

  return { theme, toggleTheme };
}
