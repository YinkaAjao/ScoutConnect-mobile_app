// src/components/AppearanceToggle.tsx
import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { makeCardSpec, useAppTheme, useColors, type ThemeColors, type ThemeMode } from '../theme/theme';

const OPTIONS: { mode: ThemeMode; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { mode: 'system', label: 'System', icon: 'phone-portrait-outline' },
  { mode: 'light', label: 'Light', icon: 'sunny-outline' },
  { mode: 'dark', label: 'Dark', icon: 'moon-outline' },
];

/** Settings card: follow the phone's setting, or force light / dark. The choice is remembered. */
export default function AppearanceToggle() {
  const Colors = useColors();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const { mode, setMode } = useAppTheme();

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Appearance</Text>
      <View style={styles.segment}>
        {OPTIONS.map((o) => {
          const active = mode === o.mode;
          return (
            <TouchableOpacity
              key={o.mode}
              style={[styles.option, active && styles.optionActive]}
              onPress={() => setMode(o.mode)}
              accessibilityRole="button"
              accessibilityLabel={`${o.label} appearance`}
              accessibilityState={{ selected: active }}
            >
              <Ionicons name={o.icon} size={16} color={active ? '#FFF' : Colors.textSecondary} />
              <Text style={[styles.optionText, active && styles.optionTextActive]}>{o.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

/** Small sun/moon button for screens without settings (the sign-in screen): flips between light and dark. */
export function ThemeQuickToggle() {
  const Colors = useColors();
  const { isDark, setMode } = useAppTheme();
  return (
    <TouchableOpacity
      onPress={() => setMode(isDark ? 'light' : 'dark')}
      accessibilityRole="button"
      accessibilityLabel={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      hitSlop={8}
      style={{ alignSelf: 'flex-end', width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center', elevation: 1 }}
    >
      <Ionicons name={isDark ? 'sunny-outline' : 'moon-outline'} size={20} color={Colors.textPrimary} />
    </TouchableOpacity>
  );
}

const makeStyles = (Colors: ThemeColors) => StyleSheet.create({
  card: { ...makeCardSpec(Colors), marginBottom: 15 },
  title: { fontSize: 14, fontWeight: 'bold', color: Colors.textPrimary, marginBottom: 10 },
  segment: { flexDirection: 'row', backgroundColor: Colors.surfaceMuted, borderRadius: 10, padding: 4, gap: 4 },
  option: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 8 },
  optionActive: { backgroundColor: Colors.primary },
  optionText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  optionTextActive: { color: '#FFF' },
});
