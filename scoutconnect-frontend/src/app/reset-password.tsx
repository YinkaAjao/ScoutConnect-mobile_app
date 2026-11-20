// src/app/reset-password.tsx
// Opened by the link in a password-reset email (scoutconnectfrontend://reset-password#access_token=...).
import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Linking } from 'react-native';
import PasswordField from '../components/PasswordField';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { supabase } from '../lib/supabase';
import { parseRecoveryLink } from '../lib/recoveryLink';
import { useColors, makeCardSpec, type ThemeColors } from '../theme/theme';

type Stage = 'checking' | 'ready' | 'invalid';

export default function ResetPasswordScreen() {
  const Colors = useColors();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('checking');
  const [problem, setProblem] = useState<string | null>(null);
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let handled = false;

    const handle = async (url: string | null) => {
      const link = parseRecoveryLink(url);
      if (link.kind === 'none' || handled) return;
      handled = true;
      try {
        if (link.kind === 'error') throw new Error(link.message);
        if (link.kind === 'tokens') {
          const { error } = await supabase.auth.setSession({ access_token: link.accessToken, refresh_token: link.refreshToken });
          if (error) throw error;
        } else {
          const { error } = await supabase.auth.exchangeCodeForSession(link.code);
          if (error) throw error;
        }
        setStage('ready');
      } catch (e: any) {
        setProblem(e?.message || 'This link is not valid.');
        setStage('invalid');
      }
    };

    Linking.getInitialURL().then(handle).catch(() => {});
    const sub = Linking.addEventListener('url', ({ url }) => { handle(url); });
    // If no usable link arrives, say so instead of spinning forever.
    const timer = setTimeout(() => {
      if (!handled) {
        setProblem('Open this screen from the link in your reset email.');
        setStage('invalid');
      }
    }, 4000);
    return () => { sub.remove(); clearTimeout(timer); };
  }, []);

  const save = async () => {
    if (next.length < 6) return Alert.alert('Weak passcode', 'Your new passcode must be at least 6 characters long.');
    if (next !== again) return Alert.alert('Passcodes do not match', 'The new passcode and its confirmation are different.');
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: next });
      if (error) throw error;
      // Sign out so the person signs in normally, choosing their role, with the new passcode.
      await supabase.auth.signOut().catch(() => {});
      await SecureStore.deleteItemAsync('userToken');
      await SecureStore.deleteItemAsync('userRole');
      Alert.alert('Passcode updated', 'Sign in with your new passcode.');
      router.replace('/');
    } catch (e: any) {
      Alert.alert('Could not update passcode', e?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Set a new passcode</Text>

        {stage === 'checking' && <ActivityIndicator color={Colors.primary} style={{ marginVertical: 20 }} />}

        {stage === 'invalid' && (
          <>
            <Text style={styles.body}>{problem}</Text>
            <Text style={styles.body}>Reset links expire and work once. Request a new one from the sign-in screen.</Text>
            <TouchableOpacity style={styles.primary} onPress={() => router.replace('/')}>
              <Text style={styles.primaryText}>Back to sign in</Text>
            </TouchableOpacity>
          </>
        )}

        {stage === 'ready' && (
          <>
            <PasswordField style={styles.input} placeholder="New passcode (6+ characters)" placeholderTextColor="#9CA3AF"  value={next} onChangeText={setNext} editable={!saving} />
            <PasswordField style={styles.input} placeholder="Repeat new passcode" placeholderTextColor="#9CA3AF"  value={again} onChangeText={setAgain} editable={!saving} />
            <TouchableOpacity style={[styles.primary, saving && { opacity: 0.5 }]} onPress={save} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Save new passcode</Text>}
            </TouchableOpacity>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (Colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.canvas, justifyContent: 'center', padding: 15 },
  card: { ...makeCardSpec(Colors), padding: 20 },
  title: { fontSize: 20, fontWeight: 'bold', color: Colors.textPrimary, marginBottom: 14 },
  body: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19, marginBottom: 10 },
  input: { backgroundColor: Colors.inputBg, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12, fontSize: 15, color: Colors.textPrimary },
  primary: { backgroundColor: Colors.primary, padding: 14, borderRadius: 8, alignItems: 'center', marginTop: 4 },
  primaryText: { color: '#FFF', fontWeight: 'bold', fontSize: 15 },
});
