import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ThemeColors = { background: string; surface: string; surfaceAlt: string; text: string; textSecondary: string; border: string; accent: string; accentSoft: string; memoBackground: string; memoBorder: string; memoText: string; completedBackground: string; danger: string; guide: string; backdrop: string; snackbarBackground: string; snackbarText: string; snackbarAction: string };

const THEME_MODE_KEY = '@taskmemo/settings/theme/v1';
export const THEME_COLORS: Record<'light' | 'dark', ThemeColors> = {
  light: { background: '#f8f9fb', surface: '#ffffff', surfaceAlt: '#edf0f3', text: '#222b36', textSecondary: '#68737e', border: '#d9dde3', accent: '#40566c', accentSoft: '#edf4f3', memoBackground: '#fff7d6', memoBorder: '#e3d6a5', memoText: '#34372f', completedBackground: '#eef0f1', danger: '#b63838', guide: '#9ca6b1', backdrop: 'rgba(20,25,30,.35)', snackbarBackground: '#222b36', snackbarText: '#ffffff', snackbarAction: '#b9dbf4' },
  dark: { background: '#11151a', surface: '#1b2128', surfaceAlt: '#29313a', text: '#edf1f5', textSecondary: '#aeb8c3', border: '#3a444f', accent: '#8fb5d1', accentSoft: '#243b3b', memoBackground: '#373323', memoBorder: '#655d3d', memoText: '#f1ead0', completedBackground: '#292e33', danger: '#ff8585', guide: '#687582', backdrop: 'rgba(0,0,0,.62)', snackbarBackground: '#e5edf4', snackbarText: '#17202a', snackbarAction: '#315976' },
};

type ThemeContextValue = { mode: ThemeMode; resolved: 'light' | 'dark'; colors: ThemeColors; setMode: (mode: ThemeMode) => void };
const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme(); const [mode, setModeState] = useState<ThemeMode>('system');
  useEffect(() => { AsyncStorage.getItem(THEME_MODE_KEY).then((value) => { if (value === 'system' || value === 'light' || value === 'dark') setModeState(value); }).catch(() => {}); }, []);
  const setMode = (value: ThemeMode) => { setModeState(value); AsyncStorage.setItem(THEME_MODE_KEY, value).catch(() => {}); };
  const resolved = mode === 'system' ? system === 'dark' ? 'dark' : 'light' : mode;
  const value = useMemo(() => ({ mode, resolved, colors: THEME_COLORS[resolved], setMode }), [mode, resolved]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme() { const value = useContext(ThemeContext); if (!value) throw new Error('ThemeProvider is missing.'); return value; }
