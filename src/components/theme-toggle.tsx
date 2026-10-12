import { useLayoutEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { applyTheme, readTheme, type ThemeChoice } from '@/lib/theme';

export function ThemeToggle({ labeled = false }: { labeled?: boolean }) {
  const [theme, setTheme] = useState<ThemeChoice>('dark');

  useLayoutEffect(() => {
    const sync = () => setTheme(readTheme());
    sync();
    window.addEventListener('theme-change', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('theme-change', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const next: ThemeChoice = theme === 'dark' ? 'light' : 'dark';
  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';

  return (
    <Button
      type="button"
      variant="ghost"
      size={labeled ? 'default' : 'icon'}
      className={labeled ? 'theme-toggle justify-start' : 'theme-toggle'}
      aria-label={label}
      title={label}
      onClick={() => applyTheme(next)}
    >
      {theme === 'dark' ? <Sun /> : <Moon />}
      {labeled ? (theme === 'dark' ? 'Light mode' : 'Dark mode') : null}
    </Button>
  );
}
