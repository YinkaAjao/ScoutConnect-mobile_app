import { DarkTheme, DefaultTheme, ThemeProvider, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo } from 'react';
import { AppThemeProvider, useAppTheme } from '../theme/theme';

SplashScreen.preventAutoHideAsync();

function ThemedStack() {
  const { colors, isDark } = useAppTheme();

  // React Navigation paints screen backgrounds and headers from its own theme, so feed it the app palette.
  const navTheme = useMemo(() => {
    const base = isDark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: { ...base.colors, primary: colors.primary, background: colors.canvas, card: colors.card, text: colors.textPrimary, border: colors.border },
    };
  }, [colors, isDark]);

  return (
    <ThemeProvider value={navTheme}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="coach" />
        <Stack.Screen name="scout" />
        <Stack.Screen name="admin" />
        <Stack.Screen name="privacy" />
        <Stack.Screen name="reset-password" />
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  return (
    <AppThemeProvider>
      <ThemedStack />
    </AppThemeProvider>
  );
}
