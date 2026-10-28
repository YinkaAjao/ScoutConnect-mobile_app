// src/components/FormSheet.tsx
import React from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { Colors } from '../constants/designSystem';

interface Props {
  visible: boolean;
  title: string;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
  children: React.ReactNode;
}

/** Bottom-sheet form container with Cancel / Save Changes actions. */
export default function FormSheet({ visible, title, saving, onCancel, onSave, children }: Props) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.content}>
          <Text style={styles.title}>{title}</Text>
          <ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView>
          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} disabled={saving} accessibilityRole="button">
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveBtn} onPress={onSave} disabled={saving} accessibilityRole="button">
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Save Changes</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export const formStyles = StyleSheet.create({
  label: { fontSize: 12, fontWeight: 'bold', color: Colors.textSecondary },
  input: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, marginTop: 4, marginBottom: 12, color: Colors.textPrimary },
  row: { flexDirection: 'row', gap: 10 },
  col: { flex: 1 },
});

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  content: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '90%' },
  title: { fontSize: 18, fontWeight: 'bold', color: Colors.textPrimary, marginBottom: 12 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  cancelBtn: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: '#D1D5DB' },
  cancelText: { fontWeight: 'bold', color: Colors.textSecondary },
  saveBtn: { flex: 1.4, alignItems: 'center', paddingVertical: 12, borderRadius: 10, backgroundColor: Colors.primary },
  saveText: { fontWeight: 'bold', color: '#fff' },
});
