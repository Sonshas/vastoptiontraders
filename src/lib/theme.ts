export const THEME_STORAGE_KEY = 'theme';

export type ThemeChoice = 'dark' | 'light';

export function readTheme(): ThemeChoice {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function applyTheme(theme: ThemeChoice) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* Storage can be unavailable in private browsing. The class still updates. */
  }
  window.dispatchEvent(new Event('theme-change'));
}

export function syncThemeClass() {
  document.documentElement.classList.toggle('dark', readTheme() === 'dark');
}

export const themeBootScript = `(function(){try{document.documentElement.classList.toggle('dark',localStorage.getItem('${THEME_STORAGE_KEY}')!=='light');}catch(e){}})();`;
