// src/components/EditMatchStatModal.tsx
import React, { useEffect, useState } from 'react';
import { Text, TextInput, Alert } from 'react-native';
import FormSheet, { formStyles } from './FormSheet';
import { apiFetch } from '../lib/api';
import { isValidDob } from '../lib/text';

export interface EditableMatchStat {
  id: string;
  competition: string;
  opponent?: string | null;
  matchResult?: string | null;
  matchDate?: string | null;
  goals: number;
  assists: number;
  minutesPlayed: number;
}

interface Props {
  stat: EditableMatchStat | null; // null = closed
  onClose: () => void;
  onSaved: (updated: EditableMatchStat) => void;
}

export default function EditMatchStatModal({ stat, onClose, onSaved }: Props) {
  const [form, setForm] = useState({ competition: '', opponent: '', matchResult: '', matchDate: '', goals: '0', assists: '0', minutesPlayed: '0' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!stat) return;
    setForm({
      competition: stat.competition ?? '',
      opponent: stat.opponent ?? '',
      matchResult: stat.matchResult ?? '',
      matchDate: stat.matchDate ?? '',
      goals: String(stat.goals ?? 0),
      assists: String(stat.assists ?? 0),
      minutesPlayed: String(stat.minutesPlayed ?? 0),
    });
  }, [stat]);

  const save = async () => {
    if (!stat) return;
    if (!form.competition.trim()) return Alert.alert('Missing Information', 'Please enter the competition.');
    if (form.matchDate.trim() && !isValidDob(form.matchDate.trim())) return Alert.alert('Invalid Date', 'Enter the match date as YYYY-MM-DD.');
    setSaving(true);
    try {
      const data = await apiFetch(`/club/match-stats/${stat.id}`, {
        method: 'PUT',
        body: {
          competition: form.competition,
          opponent: form.opponent,
          matchResult: form.matchResult,
          ...(form.matchDate.trim() && { matchDate: form.matchDate.trim() }),
          goals: form.goals,
          assists: form.assists,
          minutesPlayed: form.minutesPlayed,
        },
      });
      onSaved(data.matchStat);
    } catch (error: any) {
      Alert.alert('Could not save changes', error?.message || String(error));
    } finally {
      setSaving(false);
    }
  };

  const set = (key: keyof typeof form) => (value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <FormSheet visible={stat !== null} title="Edit Match Record" saving={saving} onCancel={onClose} onSave={save}>
      <Text style={formStyles.label}>Competition / League *</Text>
      <TextInput style={formStyles.input} value={form.competition} onChangeText={set('competition')} />

      <Text style={formStyles.label}>Opponent</Text>
      <TextInput style={formStyles.input} value={form.opponent} onChangeText={set('opponent')} />

      <Text style={formStyles.label}>Result (e.g. 2-1)</Text>
      <TextInput style={formStyles.input} value={form.matchResult} onChangeText={set('matchResult')} />

      <Text style={formStyles.label}>Match Date (YYYY-MM-DD)</Text>
      <TextInput style={formStyles.input} value={form.matchDate} onChangeText={set('matchDate')} placeholder="2026-03-14" keyboardType="numbers-and-punctuation" />

      <TextInputRow form={form} set={set} />
    </FormSheet>
  );
}

function TextInputRow({ form, set }: { form: { goals: string; assists: string; minutesPlayed: string }; set: (k: 'goals' | 'assists' | 'minutesPlayed') => (v: string) => void }) {
  return (
    <>
      <Text style={formStyles.label}>Goals</Text>
      <TextInput style={formStyles.input} value={form.goals} onChangeText={set('goals')} keyboardType="number-pad" />
      <Text style={formStyles.label}>Assists</Text>
      <TextInput style={formStyles.input} value={form.assists} onChangeText={set('assists')} keyboardType="number-pad" />
      <Text style={formStyles.label}>Minutes Played</Text>
      <TextInput style={formStyles.input} value={form.minutesPlayed} onChangeText={set('minutesPlayed')} keyboardType="number-pad" />
    </>
  );
}
