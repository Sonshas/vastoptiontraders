import { beforeEach, describe, expect, it } from 'vitest';

import { applyTheme, readTheme, syncThemeClass, themeBootScript, THEME_STORAGE_KEY } from '@/lib/theme';

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  it('defaults to light when nothing is stored', () => {
    expect(readTheme()).toBe('light');
    syncThemeClass();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('stays light unless the stored value is exactly dark', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    expect(readTheme()).toBe('light');

    localStorage.setItem(THEME_STORAGE_KEY, 'system');
    expect(readTheme()).toBe('light');

    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    expect(readTheme()).toBe('dark');
  });

  it('toggles the class and persists the choice', () => {
    applyTheme('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(readTheme()).toBe('dark');

    applyTheme('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(readTheme()).toBe('light');
  });

  it('adds the dark class on first paint only when dark was stored', () => {
    expect(themeBootScript).toContain("localStorage.getItem('theme')==='dark'");
    expect(themeBootScript).not.toContain("!=='light'");

    const boot = () => {
      // The boot script is the same inline snippet injected in the document head.
      // eslint-disable-next-line no-eval
      eval(themeBootScript);
    };

    boot();
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    boot();
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    boot();
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    boot();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
