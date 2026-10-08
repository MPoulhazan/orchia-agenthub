import { useEffect, useState } from 'react';
import type { ITheme } from '@xterm/xterm';
import { storage } from './storage';

export type ThemePref = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const KEY = 'agenthub.theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(() => (storage.get(KEY) as ThemePref) ?? 'system');
  const [systemDark, setSystemDark] = useState(media.matches);

  useEffect(() => {
    const onChange = () => setSystemDark(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const resolved: ResolvedTheme = pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);

  const update = (next: ThemePref) => {
    setPref(next);
    storage.set(KEY, next);
  };

  return { pref, resolved, setPref: update };
}

// Terminal palettes match the panel background of each UI theme.
export const terminalThemes: Record<ResolvedTheme, ITheme> = {
  dark: {
    background: '#0f1012',
    foreground: '#d9dbe0',
    cursor: '#d9dbe0',
    cursorAccent: '#0f1012',
    selectionBackground: '#3a3f4b',
    black: '#1b1d21',
    red: '#e5726f',
    green: '#7cc38b',
    yellow: '#e2b86b',
    blue: '#76a5e8',
    magenta: '#c49be3',
    cyan: '#6cc3c9',
    white: '#c9ccd3',
    brightBlack: '#5c616b',
    brightRed: '#f08b88',
    brightGreen: '#97d6a4',
    brightYellow: '#efcb86',
    brightBlue: '#93b9ef',
    brightMagenta: '#d4b3ec',
    brightCyan: '#89d3d8',
    brightWhite: '#f1f2f4',
  },
  light: {
    background: '#ffffff',
    foreground: '#24262b',
    cursor: '#24262b',
    cursorAccent: '#ffffff',
    selectionBackground: '#cfd8e6',
    black: '#24262b',
    red: '#c4403c',
    green: '#2f8a46',
    yellow: '#9a6a12',
    blue: '#2c62c0',
    magenta: '#8a4bb8',
    cyan: '#1f7f86',
    white: '#8a8f98',
    brightBlack: '#6b707a',
    brightRed: '#d9534f',
    brightGreen: '#3a9e55',
    brightYellow: '#b07c18',
    brightBlue: '#3b74d4',
    brightMagenta: '#9d5fcb',
    brightCyan: '#2a929a',
    brightWhite: '#5c616b',
  },
};
