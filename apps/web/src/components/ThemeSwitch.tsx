import type { PanelTheme } from '../hooks/usePanelTheme';

export function ThemeSwitch({ theme, onToggle }: { theme: PanelTheme; onToggle: () => void }) {
  return <label className="theme-switch">
    <span className="theme-switch__label">Modo escuro</span>
    <input type="checkbox" role="switch" checked={theme === 'dark'} onChange={onToggle} aria-label="Modo escuro do painel" />
    <span className="theme-switch__track" aria-hidden="true"><span className="theme-switch__thumb" /></span>
  </label>;
}
