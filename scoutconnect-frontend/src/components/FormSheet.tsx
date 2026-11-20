// src/components/FormSheet.tsx
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView, ActivityIndicator, KeyboardAvoidingView } from 'react-native';
import { useColors, useSheetPad, type ThemeColors } from '../theme/theme';
import ModalBackdrop from './ModalBackdrop';

interface Props {
  visible: boolean;
  title: string;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
  /** Label of the confirm button; "Save Changes" suits edits, "Send request" suits something sent. */
  saveLabel?: string;
  children: React.ReactNode;
}

/** Bottom-sheet form container with Cancel / confirm actions (the confirm label defaults to "Save Changes"). */
export default function FormSheet({ visible, title, saving, onCancel, onSave, saveLabel = 'Save Changes', children }: Props) {
  const Colors = useColors();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const sheetPad = useSheetPad();
  return (
    <Modal statusBarTranslucent navigationBarTranslucent visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <KeyboardAvoidingView style={styles.overlay} behavior="padding">
        <ModalBackdrop onPress={() => { if (!saving) onCancel(); }} />
        <View style={[styles.content, sheetPad]}>
          <Text style={styles.title}>{title}</Text>
          <ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView>
          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} disabled={saving} accessibilityRole="button">
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveBtn} onPress={onSave} disabled={saving} accessibilityRole="button">
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>{saveLabel}</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Shared field styles for forms rendered inside a FormSheet; themed, so call it inside the component. */
export function useFormStyles() {
  const Colors = useColors();
  return useMemo(() => StyleSheet.create({
    label: { fontSize: 12, fontWeight: 'bold', color: Colors.textSecondary },
    input: { borderWidth: 1, borderColor: Colors.borderStrong, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, marginTop: 4, marginBottom: 12, color: Colors.textPrimary },
    row: { flexDirection: 'row', gap: 10 },
    col: { flex: 1 },
  }), [Colors]);
}

const makeStyles = (Colors: ThemeColors) => StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  content: { backgroundColor: Colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '90%' },
  title: { fontSize: 18, fontWeight: 'bold', color: Colors.textPrimary, marginBottom: 12 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  cancelBtn: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: Colors.borderStrong },
  cancelText: { fontWeight: 'bold', color: Colors.textSecondary },
  saveBtn: { flex: 1.4, alignItems: 'center', paddingVertical: 12, borderRadius: 10, backgroundColor: Colors.primary },
  saveText: { fontWeight: 'bold', color: '#fff' },
});
