import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type ThemeMode = 'auto' | 'light' | 'dark';
export type ThemePalette = 'default' | 'green';

interface ThemeContextValue {
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
  resolved: 'light' | 'dark';
  palette: ThemePalette;
  setPalette: (p: ThemePalette) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = 'sprouts_theme';
const PALETTE_STORAGE_KEY = 'sprouts_palette';

function readInitialMode(): ThemeMode {
  if (typeof window === 'undefined') return 'auto';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'auto') return stored;
  return 'auto';
}

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

function applyTheme(mode: ThemeMode) {
  const root = document.documentElement;
  if (mode === 'auto') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', mode);
  }
}

function readInitialPalette(): ThemePalette {
  if (typeof window === 'undefined') return 'green';
  const stored = window.localStorage.getItem(PALETTE_STORAGE_KEY);
  if (stored === 'default' || stored === 'green') return stored;
  return 'green';
}

function applyPalette(palette: ThemePalette) {
  const root = document.documentElement;
  if (palette === 'default') {
    root.removeAttribute('data-palette');
  } else {
    root.setAttribute('data-palette', palette);
  }
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setModeState] = useState<ThemeMode>(() => readInitialMode());
  const [palette, setPaletteState] = useState<ThemePalette>(() => readInitialPalette());
  const [systemDark, setSystemDark] = useState<boolean>(() => systemPrefersDark());

  useEffect(() => {
    applyTheme(mode);
  }, [mode]);

  useEffect(() => {
    applyPalette(palette);
  }, [palette]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mql.addEventListener?.('change', listener);
    return () => mql.removeEventListener?.('change', listener);
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    window.localStorage.setItem(STORAGE_KEY, next);
    setModeState(next);
  }, []);

  const setPalette = useCallback((next: ThemePalette) => {
    window.localStorage.setItem(PALETTE_STORAGE_KEY, next);
    setPaletteState(next);
  }, []);

  const resolved = useMemo<'light' | 'dark'>(() => {
    if (mode === 'auto') return systemDark ? 'dark' : 'light';
    return mode;
  }, [mode, systemDark]);

  const value = useMemo(
    () => ({ mode, setMode, resolved, palette, setPalette }),
    [mode, setMode, resolved, palette, setPalette],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
