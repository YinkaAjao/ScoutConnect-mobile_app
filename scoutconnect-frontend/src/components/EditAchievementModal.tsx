// src/components/EditAchievementModal.tsx
import React, { useEffect, useState } from 'react';
import { Text, TextInput, Alert } from 'react-native';
import FormSheet, { formStyles } from './FormSheet';
import { apiFetch } from '../lib/api';

export interface EditableAchievement {
  id: string;
  title: string;
  year: number;
}

interface Props {
  achievement: EditableAchievement | null; // null = closed
  onClose: () => void;
  onSaved: (updated: EditableAchievement) => void;
}

export default function EditAchievementModal({ achievement, onClose, onSaved }: Props) {
  const [title, setTitle] = useState('');
  const [year, setYear] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!achievement) return;
    setTitle(achievement.title ?? '');
    setYear(String(achievement.year ?? ''));
  }, [achievement]);

  const save = async () => {
    if (!achievement) return;
    if (!title.trim()) return Alert.alert('Missing Information', 'Please enter the trophy or medal title.');
    setSaving(true);
    try {
      const data = await apiFetch(`/club/achievements/${achievement.id}`, { method: 'PUT', body: { title, year } });
      onSaved(data.achievement);
    } catch (error: any) {
      Alert.alert('Could not save changes', error?.message || String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormSheet visible={achievement !== null} title="Edit Trophy / Medal" saving={saving} onCancel={onClose} onSave={save}>
      <Text style={formStyles.label}>Title *</Text>
      <TextInput style={formStyles.input} value={title} onChangeText={setTitle} />

      <Text style={formStyles.label}>Year</Text>
      <TextInput style={formStyles.input} value={year} onChangeText={setYear} keyboardType="number-pad" maxLength={4} />
    </FormSheet>
  );
}
