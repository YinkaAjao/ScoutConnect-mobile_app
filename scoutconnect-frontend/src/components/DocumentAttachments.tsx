// src/components/DocumentAttachments.tsx
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Image } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons } from '@expo/vector-icons';
import { formStyles } from './FormSheet';
import { ALLOWED_MIME_TYPES, Attachment, DOC_TYPES, DocType, MAX_FILE_BYTES, isPdf, withExtension } from '../lib/verification';
import { Colors } from '../constants/designSystem';

const MAX_MB = MAX_FILE_BYTES / 1024 / 1024;

interface Props {
  attachments: Attachment[];
  onChange: (next: Attachment[]) => void;
  maxFiles?: number;
}

/** Pick, label and remove supporting documents (photos, PDFs). Upload happens later, on submit. */
export default function DocumentAttachments({ attachments, onChange, maxFiles = 5 }: Props) {
  const remaining = maxFiles - attachments.length;

  const warnTooBig = (count: number, noun: string) =>
    Alert.alert('File too large', `Files must be ${MAX_MB} MB or smaller. ${count} ${noun}${count === 1 ? ' was' : 's were'} skipped.`);

  const addPhotos = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission Required', 'Please allow access to photos to attach your documents.');
      return;
    }
    if (remaining <= 0) return Alert.alert('Limit reached', `You can attach up to ${maxFiles} documents.`);

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      allowsMultipleSelection: true,
      selectionLimit: remaining,
    });
    if (result.canceled) return;

    const tooBig = result.assets.filter((asset) => (asset.fileSize ?? 0) > MAX_FILE_BYTES);
    if (tooBig.length) warnTooBig(tooBig.length, 'photo');
    onChange([
      ...attachments,
      ...result.assets
        .filter((asset) => (asset.fileSize ?? 0) <= MAX_FILE_BYTES)
        .slice(0, remaining)
        .map((asset, i) => ({
          uri: asset.uri,
          fileName: withExtension(asset.fileName || `document-${Date.now()}-${i}`, asset.mimeType),
          docType: 'Registration Certificate' as DocType,
        })),
    ]);
  };

  const addFiles = async () => {
    if (remaining <= 0) return Alert.alert('Limit reached', `You can attach up to ${maxFiles} documents.`);

    const result = await DocumentPicker.getDocumentAsync({
      type: ALLOWED_MIME_TYPES,
      multiple: true,
      copyToCacheDirectory: true, // needed so the upload can read the file
    });
    if (result.canceled) return;

    const tooBig = result.assets.filter((asset) => (asset.size ?? 0) > MAX_FILE_BYTES);
    if (tooBig.length) warnTooBig(tooBig.length, 'file');
    onChange([
      ...attachments,
      ...result.assets
        .filter((asset) => (asset.size ?? 0) <= MAX_FILE_BYTES)
        .slice(0, remaining)
        .map((asset) => ({
          uri: asset.uri,
          fileName: withExtension(asset.name, asset.mimeType),
          docType: 'Registration Certificate' as DocType,
        })),
    ]);
  };

  return (
    <View>
      <Text style={formStyles.label}>Supporting documents * (PDF, JPG or PNG, up to {MAX_MB} MB each, max {maxFiles})</Text>

      {attachments.map((attachment, index) => (
        <View key={attachment.uri} style={styles.attachment}>
          <View style={styles.attachmentTop}>
            {isPdf(attachment.fileName) ? (
              <View style={[styles.thumb, styles.pdfThumb]}>
                <Ionicons name="document-text" size={24} color="#B91C1C" />
                <Text style={styles.pdfLabel}>PDF</Text>
              </View>
            ) : (
              <Image source={{ uri: attachment.uri }} style={styles.thumb} />
            )}
            <Text style={styles.attachmentName} numberOfLines={1}>{attachment.fileName}</Text>
            <TouchableOpacity onPress={() => onChange(attachments.filter((_, i) => i !== index))} accessibilityRole="button" accessibilityLabel={`Remove ${attachment.fileName}`}>
              <Ionicons name="close-circle" size={22} color={Colors.danger} />
            </TouchableOpacity>
          </View>
          <View style={styles.chipRow}>
            {DOC_TYPES.map((type) => (
              <TouchableOpacity
                key={type}
                style={[styles.chip, attachment.docType === type && styles.chipActive]}
                onPress={() => onChange(attachments.map((a, i) => (i === index ? { ...a, docType: type } : a)))}
                accessibilityRole="button"
                accessibilityState={{ selected: attachment.docType === type }}
              >
                <Text style={[styles.chipText, attachment.docType === type && styles.chipTextActive]}>{type}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ))}

      <View style={styles.addRow}>
        <TouchableOpacity style={styles.addBtn} onPress={addPhotos} accessibilityRole="button" accessibilityLabel="Add document photos">
          <Ionicons name="camera-outline" size={18} color={Colors.secondary} />
          <Text style={styles.addBtnText}>Add photos</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.addBtn} onPress={addFiles} accessibilityRole="button" accessibilityLabel="Add PDF or other files">
          <Ionicons name="document-attach-outline" size={18} color={Colors.secondary} />
          <Text style={styles.addBtnText}>Add PDF / file</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  attachment: { borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 10, padding: 10, marginTop: 8 },
  attachmentTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  thumb: { width: 44, height: 44, borderRadius: 6, backgroundColor: '#EEE' },
  pdfThumb: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#FEF2F2' },
  pdfLabel: { fontSize: 8, fontWeight: 'bold', color: '#B91C1C' },
  attachmentName: { flex: 1, fontSize: 13, color: Colors.textPrimary },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: '#D1D5DB' },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: 11, fontWeight: '600', color: Colors.textPrimary },
  chipTextActive: { color: '#fff' },
  addRow: { flexDirection: 'row', gap: 10, marginTop: 10, marginBottom: 8 },
  addBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderStyle: 'dashed', borderColor: Colors.secondaryBorder, borderRadius: 10, paddingVertical: 12 },
  addBtnText: { color: Colors.secondary, fontWeight: 'bold', fontSize: 13 },
});
