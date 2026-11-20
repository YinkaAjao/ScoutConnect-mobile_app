// src/theme/theme.tsx
// App-wide light/dark theme. Screens read colours with useColors() and build their StyleSheet from them with
// makeStyles(Colors), so a theme change re-renders everything in place (no remount, no lost form state).
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance, useColorScheme } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors as LightPalette } from '../constants/designSystem';

export type ThemeMode = 'system' | 'light' | 'dark';

/** Every colour role the app uses. Add a role here and in both palettes below. */
export interface ThemeColors {
  primary: string;
  primaryDark: string;
  primaryLight: string;
  secondary: string;
  secondaryLight: string;
  secondaryBorder: string;
  canvas: string;
  card: string;
  inputBg: string;        // text-field fill
  surfaceMuted: string;   // segmented controls, chips, dividers
  warningBg: string;
  warningText: string;
  textPrimary: string;
  textSecondary: string;
  border: string;
  borderStrong: string;   // outlines of fields and ghost buttons
  danger: string;
  dangerBg: string;
  dangerText: string;
  dangerBorder: string;
  warnBg: string;
  warnText: string;
  warnBorder: string;
  successBg: string;
  successText: string;
  successBorder: string;
  infoBg: string;
  infoText: string;
  infoBorder: string;
}

export const lightColors: ThemeColors = {
  ...LightPalette,
  inputBg: '#F9FAFB',
  surfaceMuted: '#F3F4F6',
  borderStrong: '#D1D5DB',
  dangerBg: '#FEE2E2',
  dangerText: '#B91C1C',
  dangerBorder: '#FCA5A5',
  warnBg: '#FEF3C7',
  warnText: '#B45309',
  warnBorder: '#FCD34D',
  successBg: '#D1FAE5',
  successText: '#047857',
  successBorder: '#A7F3D0',
  infoBg: '#DBEAFE',
  infoText: '#1D4ED8',
  infoBorder: '#93C5FD',
};

export const darkColors: ThemeColors = {
  primary: '#2E8B57',
  primaryDark: '#065F46',
  primaryLight: '#15301F',
  secondary: '#3B82D6',
  secondaryLight: '#14263D',
  secondaryBorder: '#244A78',
  canvas: '#0E1211',
  card: '#1A201E',
  inputBg: '#121715',
  surfaceMuted: '#242B28',
  warningBg: '#3D2E10',
  warningText: '#F5C76B',
  textPrimary: '#F3F4F6',
  textSecondary: '#A0A7AF',
  border: '#2A322F',
  borderStrong: '#3C4642',
  danger: '#E5534F',
  dangerBg: '#3A1A1A',
  dangerText: '#FCA5A5',
  dangerBorder: '#7F1D1D',
  warnBg: '#3A2E0F',
  warnText: '#FCD34D',
  warnBorder: '#7A5A12',
  successBg: '#10301F',
  successText: '#6EE7B7',
  successBorder: '#1F6B47',
  infoBg: '#14263D',
  infoText: '#93C5FD',
  infoBorder: '#244A78',
};

/** Shared elevated-card look (the old static CardSpec), themed. */
export const makeCardSpec = (c: ThemeColors) => ({
  backgroundColor: c.card,
  borderRadius: 14,
  padding: 16,
  elevation: 2,
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.08,
  shadowRadius: 4,
});

interface ThemeContextValue {
  colors: ThemeColors;
  isDark: boolean;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

const MODE_KEY = 'scoutconnect.themeMode';

const ThemeContext = createContext<ThemeContextValue>({
  colors: lightColors,
  isDark: false,
  mode: 'system',
  setMode: () => {},
});

/** Applies the chosen mode to the native layer too, so dialogs, pickers and the keyboard follow it. */
function applyNativeScheme(mode: ThemeMode) {
  try {
    Appearance.setColorScheme(mode === 'system' ? 'unspecified' : mode);
  } catch {
    // not supported on this platform: the JS palette still switches
  }
}

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>('system');
  const scheme = useColorScheme();

  useEffect(() => {
    let active = true;
    SecureStore.getItemAsync(MODE_KEY)
      .then((saved) => {
        if (!active || (saved !== 'light' && saved !== 'dark' && saved !== 'system')) return;
        setModeState(saved);
        applyNativeScheme(saved);
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    applyNativeScheme(next);
    SecureStore.setItemAsync(MODE_KEY, next).catch(() => {});
  }, []);

  const isDark = scheme === 'dark';
  const value = useMemo<ThemeContextValue>(
    () => ({ colors: isDark ? darkColors : lightColors, isDark, mode, setMode }),
    [isDark, mode, setMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useAppTheme = () => useContext(ThemeContext);
export const useColors = () => useContext(ThemeContext).colors;

/** Extra style for a bottom sheet so its buttons clear the Android navigation bar / iOS home indicator. */
export function useSheetPad() {
  const { bottom } = useSafeAreaInsets();
  return useMemo(() => ({ paddingBottom: 20 + bottom }), [bottom]);
}

/** Tab-bar screen options: themed, and tall enough to sit above the Android navigation bar / iOS home indicator. */
export function useTabBarOptions(activeTint: string) {
  const colors = useColors();
  const { bottom } = useSafeAreaInsets();
  return useMemo(
    () => ({
      headerShown: false as const,
      tabBarActiveTintColor: activeTint,
      tabBarInactiveTintColor: colors.textSecondary,
      tabBarStyle: {
        backgroundColor: colors.card,
        borderTopColor: colors.border,
        height: 60 + bottom,
        paddingBottom: 8 + bottom,
        paddingTop: 6,
      },
      tabBarLabelStyle: { fontSize: 11, fontWeight: '600' as const },
    }),
    [activeTint, colors, bottom],
  );
}
