// src/components/EditAthleteModal.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Modal, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Switch } from 'react-native';
import { apiFetch } from '../lib/api';
import { Colors } from '../constants/designSystem';
import { POSITION_CATEGORIES } from '../constants/positions';

export interface EditableAthlete {
  id: string;
  name: string;
  dateOfBirth: string;
  position: string;
  consentStatus?: string | null;
  consentGuardian?: string | null;
  consentGraceUntil?: string | null;
}

interface Props {
  athlete: EditableAthlete | null; // null = closed
  onClose: () => void;
  onSaved: (updated: EditableAthlete) => void;
}

const ALL_POSITIONS = Object.values(POSITION_CATEGORIES).flat();

export default function EditAthleteModal({ athlete, onClose, onSaved }: Props) {
  const [form, setForm] = useState({ name: '', dateOfBirth: '', position: '' });
  const [consent, setConsent] = useState(false);
  const [guardian, setGuardian] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!athlete) return;
    setForm({ name: athlete.name, dateOfBirth: athlete.dateOfBirth, position: athlete.position });
    setConsent(athlete.consentStatus === 'Recorded');
    setGuardian(athlete.consentGuardian ?? '');
  }, [athlete]);

  const save = async () => {
    if (!athlete) return;
    if (!form.name.trim() || !form.position.trim()) {
      Alert.alert('Missing Information', 'Name and position are required.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.dateOfBirth.trim())) {
      Alert.alert('Invalid Date', 'Enter the date of birth as YYYY-MM-DD.');
      return;
    }
    if (consent && !guardian.trim()) {
      Alert.alert("Guardian's name needed", "Enter the parent or guardian's name to record their consent.");
      return;
    }

    // Only send the consent fields when they changed, so an ordinary edit never rewrites who gave consent or when.
    const wasRecorded = athlete.consentStatus === 'Recorded';
    const consentChanged = consent !== wasRecorded || (consent && guardian.trim() !== (athlete.consentGuardian ?? '').trim());

    setSaving(true);
    try {
      const data = await apiFetch('/club/players/' + athlete.id, {
        method: 'PUT',
        body: {
          name: form.name,
          dateOfBirth: form.dateOfBirth.trim(),
          position: form.position,
          ...(consentChanged ? { consent, guardianName: consent ? guardian : undefined } : {}),
        },
      });
      onSaved(data.player);
    } catch (error: any) {
      Alert.alert('Could not save changes', error?.message || String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={athlete !== null} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.content}>
          <Text style={styles.title}>Edit Athlete</Text>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Full Name *</Text>
            <TextInput style={styles.input} value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} />

            <Text style={styles.label}>Date of Birth * (YYYY-MM-DD)</Text>
            <TextInput style={styles.input} value={form.dateOfBirth} onChangeText={(v) => setForm({ ...form, dateOfBirth: v })} placeholder="2008-01-31" keyboardType="numbers-and-punctuation" />

            <Text style={styles.label}>Position *</Text>
            <View style={styles.chipRow}>
              {ALL_POSITIONS.map((pos) => (
                <TouchableOpacity key={pos} style={[styles.chip, form.position === pos && styles.chipActive]} onPress={() => setForm({ ...form, position: pos })}>
                  <Text style={[styles.chipText, form.position === pos && styles.chipTextActive]}>{pos}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.consentBox}>
              <View style={styles.consentRow}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={styles.consentTitle}>Parent / guardian consent</Text>
                  <Text style={styles.consentHint}>
                    Scouts can only see an athlete once a parent or guardian has agreed. Switch this on only if you hold that consent.
                  </Text>
                </View>
                <Switch value={consent} onValueChange={setConsent} trackColor={{ true: Colors.primary }} accessibilityLabel="Parent or guardian consent recorded" />
              </View>
              {consent && (
                <>
                  <Text style={[styles.label, { marginTop: 12 }]}>Parent / guardian full name *</Text>
                  <TextInput style={styles.input} value={guardian} onChangeText={setGuardian} placeholder="e.g. Marie Uwase" />
                </>
              )}
            </View>
          </ScrollView>

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={saving}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveBtn} onPress={save} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Save Changes</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  content: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '90%' },
  title: { fontSize: 18, fontWeight: 'bold', color: Colors.textPrimary, marginBottom: 12 },
  label: { fontSize: 12, fontWeight: 'bold', color: Colors.textSecondary },
  input: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, marginTop: 4, marginBottom: 12, color: Colors.textPrimary },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6, marginBottom: 12 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: '#D1D5DB' },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: 12, color: Colors.textPrimary, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  consentBox: { backgroundColor: '#F9FAFB', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#E5E7EB', marginBottom: 8 },
  consentRow: { flexDirection: 'row', alignItems: 'center' },
  consentTitle: { fontSize: 14, fontWeight: 'bold', color: Colors.textPrimary },
  consentHint: { fontSize: 12, color: Colors.textSecondary, lineHeight: 17, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  cancelBtn: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: '#D1D5DB' },
  cancelText: { fontWeight: 'bold', color: Colors.textSecondary },
  saveBtn: { flex: 1.4, alignItems: 'center', paddingVertical: 12, borderRadius: 10, backgroundColor: Colors.primary },
  saveText: { fontWeight: 'bold', color: '#fff' },
});
