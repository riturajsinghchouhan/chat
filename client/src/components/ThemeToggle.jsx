import { Moon, Sun } from 'lucide-react';
import { useUI } from '../store/uiStore';

export default function ThemeToggle({ className = '' }) {
  const toggle = useUI((s) => s.toggleTheme);
  useUI((s) => s.theme); // re-render when the theme changes
  const dark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  return (
    <button type="button" className={`icon-btn neu-sm ${className}`} onClick={toggle} aria-label="Toggle theme" title="Toggle theme">
      {dark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
