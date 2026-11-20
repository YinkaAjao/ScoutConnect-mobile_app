// src/components/AccountSecurity.tsx
// Change passcode, privacy policy and delete account, shared by the coach and scout profile screens.
import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Modal, Alert, ActivityIndicator, KeyboardAvoidingView } from 'react-native';
import PasswordField from './PasswordField';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { Ionicons } from '@expo/vector-icons';
import ModalBackdrop from './ModalBackdrop';
import { supabase } from '../lib/supabase';
import { apiFetch } from '../lib/api';
import { useColors, makeCardSpec, useSheetPad, type ThemeColors } from '../theme/theme';

interface Props {
  email: string;
  /** What deleting removes, in plain words, shown before the person confirms. */
  deleteSummary: string;
}

export default function AccountSecurity({ email, deleteSummary }: Props) {
  const Colors = useColors();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const sheetPad = useSheetPad();
  const router = useRouter();
  const [mode, setMode] = useState<'password' | 'delete' | null>(null);
  const [usesPassword, setUsesPassword] = useState(true);
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [typedEmail, setTypedEmail] = useState('');

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const provider = data.user?.app_metadata?.provider;
      setUsesPassword(!provider || provider === 'email');
    }).catch(() => {});
  }, []);

  const close = () => {
    if (busy) return;
    setMode(null);
    setCurrent(''); setNext(''); setAgain(''); setTypedEmail('');
  };

  const changePassword = async () => {
    if (!current) return Alert.alert('Current passcode needed', 'Enter your current passcode.');
    if (next.length < 6) return Alert.alert('Weak passcode', 'Your new passcode must be at least 6 characters long.');
    if (next !== again) return Alert.alert('Passcodes do not match', 'The new passcode and its confirmation are different.');
    if (next === current) return Alert.alert('Same passcode', 'Choose a passcode different from your current one.');
    setBusy(true);
    try {
      // Re-check the current passcode first, so a borrowed unlocked phone cannot change it.
      const { error: checkError } = await supabase.auth.signInWithPassword({ email, password: current });
      if (checkError) throw new Error('Your current passcode is incorrect.');
      const { error } = await supabase.auth.updateUser({ password: next });
      if (error) throw error;
      setBusy(false);
      setMode(null);
      setCurrent(''); setNext(''); setAgain('');
      Alert.alert('Passcode changed', 'Use your new passcode the next time you sign in.');
    } catch (error: any) {
      Alert.alert('Could not change passcode', error?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const deleteAccount = async () => {
    setBusy(true);
    try {
      await apiFetch('/account', { method: 'DELETE', body: { confirm: typedEmail }, retries: 0 });
      await supabase.auth.signOut().catch(() => {});
      await SecureStore.deleteItemAsync('userToken');
      await SecureStore.deleteItemAsync('userRole');
      setBusy(false);
      setMode(null);
      Alert.alert('Account deleted', 'Your personal details have been removed.');
      router.replace('/');
    } catch (error: any) {
      setBusy(false);
      Alert.alert('Account not deleted', error?.message || 'Please try again.');
    }
  };

  const emailMatches = typedEmail.trim().toLowerCase() === email.toLowerCase();

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Security & Privacy</Text>

      {usesPassword ? (
        <TouchableOpacity style={styles.row} onPress={() => setMode('password')} accessibilityRole="button">
          <Ionicons name="key-outline" size={18} color={Colors.textPrimary} />
          <Text style={styles.rowText}>Change passcode</Text>
        </TouchableOpacity>
      ) : (
        <Text style={styles.note}>You sign in with Google, so your passcode is managed in your Google account.</Text>
      )}

      <TouchableOpacity style={styles.row} onPress={() => router.push('/privacy' as any)} accessibilityRole="button">
        <Ionicons name="document-text-outline" size={18} color={Colors.textPrimary} />
        <Text style={styles.rowText}>Privacy Policy & Terms</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.row} onPress={() => setMode('delete')} accessibilityRole="button">
        <Ionicons name="trash-outline" size={18} color={Colors.danger} />
        <Text style={[styles.rowText, { color: Colors.danger }]}>Delete my account</Text>
      </TouchableOpacity>

      <Modal statusBarTranslucent navigationBarTranslucent visible={mode !== null} animationType="slide" transparent onRequestClose={close}>
        <KeyboardAvoidingView behavior="padding" style={styles.overlay}>
          <ModalBackdrop onPress={close} />
          <View style={[styles.sheet, sheetPad]}>
            {mode === 'password' ? (
              <>
                <Text style={styles.sheetTitle}>Change passcode</Text>
                <PasswordField style={styles.input} placeholder="Current passcode" placeholderTextColor="#9CA3AF"  value={current} onChangeText={setCurrent} editable={!busy} />
                <PasswordField style={styles.input} placeholder="New passcode (6+ characters)" placeholderTextColor="#9CA3AF"  value={next} onChangeText={setNext} editable={!busy} />
                <PasswordField style={styles.input} placeholder="Repeat new passcode" placeholderTextColor="#9CA3AF"  value={again} onChangeText={setAgain} editable={!busy} />
                <TouchableOpacity style={[styles.primary, busy && styles.disabled]} onPress={changePassword} disabled={busy}>
                  {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Save new passcode</Text>}
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.sheetTitle}>Delete your account?</Text>
                <Text style={styles.body}>{deleteSummary}</Text>
                <Text style={styles.body}>This cannot be undone. To confirm, type your email address: <Text style={{ fontWeight: 'bold' }}>{email}</Text></Text>
                <TextInput style={styles.input} placeholder="Type your email" placeholderTextColor="#9CA3AF" autoCapitalize="none" keyboardType="email-address" value={typedEmail} onChangeText={setTypedEmail} editable={!busy} />
                <TouchableOpacity style={[styles.danger, (!emailMatches || busy) && styles.disabled]} onPress={deleteAccount} disabled={!emailMatches || busy}>
                  {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Delete my account permanently</Text>}
                </TouchableOpacity>
              </>
            )}
            <TouchableOpacity style={styles.cancel} onPress={close} disabled={busy}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const makeStyles = (Colors: ThemeColors) => StyleSheet.create({
  card: { ...makeCardSpec(Colors), padding: 16, marginTop: 15 },
  title: { fontSize: 15, fontWeight: 'bold', color: Colors.textPrimary, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderTopWidth: 1, borderTopColor: Colors.border },
  rowText: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  note: { fontSize: 12, color: Colors.textSecondary, paddingVertical: 8 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  sheetTitle: { fontSize: 18, fontWeight: 'bold', color: Colors.textPrimary, marginBottom: 12 },
  body: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19, marginBottom: 10 },
  input: { backgroundColor: Colors.inputBg, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12, fontSize: 15, color: Colors.textPrimary },
  primary: { backgroundColor: Colors.primary, padding: 14, borderRadius: 8, alignItems: 'center' },
  danger: { backgroundColor: Colors.danger, padding: 14, borderRadius: 8, alignItems: 'center' },
  disabled: { opacity: 0.5 },
  primaryText: { color: '#FFF', fontWeight: 'bold', fontSize: 15 },
  cancel: { alignItems: 'center', padding: 12, marginTop: 6 },
  cancelText: { color: Colors.textSecondary, fontWeight: '600' },
});
