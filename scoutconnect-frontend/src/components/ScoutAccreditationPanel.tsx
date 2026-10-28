// src/components/ScoutAccreditationPanel.tsx
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, ActivityIndicator, ScrollView } from 'react-native';
import { useFocusEffect } from 'expo-router';
import DocumentAttachments from './DocumentAttachments';
import { apiFetch } from '../lib/api';
import { supabase } from '../lib/supabase';
import { Attachment, uploadAttachments } from '../lib/verification';
import { Colors, CardSpec } from '../constants/designSystem';

interface Accreditation {
  status: 'Pending' | 'Submitted' | 'Approved' | 'Rejected' | 'Suspended';
  organisation: string | null;
  orgType: string | null;
  licenceNumber: string | null;
  statement: string | null;
  submittedAt: string | null;
  rejectionReason: string | null;
  documents: { id: string; docType: string; fileName: string | null }[];
  orgTypes: string[];
}

const STATUS_STYLE: Record<string, { label: string; bg: string; fg: string }> = {
  Pending: { label: 'Not applied', bg: '#FEF3C7', fg: '#B45309' },
  Submitted: { label: 'Under review', bg: '#DBEAFE', fg: '#1D4ED8' },
  Approved: { label: 'Approved', bg: '#D1FAE5', fg: '#047857' },
  Rejected: { label: 'Declined', bg: '#FEE2E2', fg: '#B91C1C' },
  Suspended: { label: 'Suspended', bg: '#FEE2E2', fg: '#B91C1C' },
};

/**
 * Shown to a scout until an administrator approves them. Scouts must be accredited before they can browse athletes,
 * because the athletes are young people and their data should only reach vetted people.
 */
export default function ScoutAccreditationPanel({ onApproved }: { onApproved?: () => void }) {
  const [info, setInfo] = useState<Accreditation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [organisation, setOrganisation] = useState('');
  const [orgType, setOrgType] = useState('');
  const [licenceNumber, setLicenceNumber] = useState('');
  const [statement, setStatement] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    try {
      const data: Accreditation = await apiFetch('/scout/accreditation');
      setInfo(data);
      setError(null);
      // Pre-fill a re-application with what the scout sent last time.
      setOrganisation((prev) => prev || data.organisation || '');
      setOrgType((prev) => prev || data.orgType || '');
      setLicenceNumber((prev) => prev || data.licenceNumber || '');
      if (data.status === 'Approved') onApproved?.();
    } catch (e: any) {
      setError(e?.message || 'Could not load your accreditation status.');
    }
  };

  useFocusEffect(
    useCallback(() => {
      load();
    }, [])
  );

  const submit = async () => {
    if (!organisation.trim()) return Alert.alert('Organisation needed', 'Enter the organisation you scout for, or "Independent".');
    if (!orgType) return Alert.alert('Type needed', 'Choose what kind of scout you are.');
    if (attachments.length === 0) return Alert.alert('Documents needed', 'Attach at least one document, such as a licence or a letter from your organisation.');

    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) throw new Error('Your session has expired. Please sign in again.');

      const documents = await uploadAttachments(userId, attachments);
      await apiFetch('/scout/accreditation', {
        method: 'POST',
        body: { organisation, orgType, licenceNumber, statement, documents },
      });
      setAttachments([]);
      await load();
      Alert.alert('Application sent', 'An administrator will review it. You will get an email when there is a decision.');
    } catch (e: any) {
      Alert.alert('Could not send your application', e?.message || String(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (!info) {
    return (
      <View style={styles.center}>
        {error ? <Text style={styles.errorText}>{error}</Text> : <ActivityIndicator color={Colors.secondary} />}
        {error && (
          <TouchableOpacity onPress={load} accessibilityRole="button"><Text style={styles.link}>Try again</Text></TouchableOpacity>
        )}
      </View>
    );
  }

  const style = STATUS_STYLE[info.status] ?? STATUS_STYLE.Pending;
  const canApply = info.status === 'Pending' || info.status === 'Rejected';

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <View style={styles.header}>
          <Text style={styles.title}>Scout accreditation</Text>
          <View style={[styles.pill, { backgroundColor: style.bg }]}>
            <Text style={[styles.pillText, { color: style.fg }]}>{style.label}</Text>
          </View>
        </View>

        <Text style={styles.body}>
          The athletes on ScoutConnect are young people, so only accredited scouts can browse them. An administrator reviews every application.
        </Text>

        {info.status === 'Rejected' && (
          <View style={styles.rejectBox}>
            <Text style={styles.rejectTitle}>Your last application was not approved</Text>
            <Text style={styles.rejectText}>{info.rejectionReason || 'No reason was given.'}</Text>
          </View>
        )}

        {info.status === 'Submitted' && (
          <>
            <Text style={styles.body}>
              Sent{info.submittedAt ? ` on ${new Date(info.submittedAt).toLocaleDateString()}` : ''} for {info.organisation} with {info.documents.length} document{info.documents.length === 1 ? '' : 's'}. You will get an email when it is decided.
            </Text>
            <TouchableOpacity style={styles.secondaryBtn} onPress={load} accessibilityRole="button">
              <Text style={styles.secondaryText}>Check again</Text>
            </TouchableOpacity>
          </>
        )}

        {info.status === 'Suspended' && (
          <View style={styles.rejectBox}>
            <Text style={styles.rejectTitle}>Your scout access is suspended</Text>
            <Text style={styles.rejectText}>{info.rejectionReason || 'Contact an administrator for details.'}</Text>
          </View>
        )}

        {info.status === 'Approved' && (
          <TouchableOpacity style={styles.primaryBtn} onPress={() => onApproved?.()} accessibilityRole="button">
            <Text style={styles.primaryText}>Start browsing</Text>
          </TouchableOpacity>
        )}

        {canApply && (
          <>
            <Text style={styles.label}>Organisation you scout for *</Text>
            <TextInput style={styles.input} value={organisation} onChangeText={setOrganisation} placeholder='e.g. Kigali Youth Academy, or "Independent"' placeholderTextColor="#9CA3AF" />

            <Text style={styles.label}>What kind of scout are you? *</Text>
            <View style={styles.chipRow}>
              {info.orgTypes.map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[styles.chip, orgType === type && styles.chipActive]}
                  onPress={() => setOrgType(type)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: orgType === type }}
                >
                  <Text style={[styles.chipText, orgType === type && styles.chipTextActive]}>{type}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Licence or registration number (optional)</Text>
            <TextInput style={styles.input} value={licenceNumber} onChangeText={setLicenceNumber} maxLength={60} placeholderTextColor="#9CA3AF" />

            <Text style={styles.label}>Anything the reviewer should know? (optional)</Text>
            <TextInput
              style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
              value={statement}
              onChangeText={setStatement}
              multiline
              maxLength={1000}
              placeholder="e.g. I scout under-17 players for…"
              placeholderTextColor="#9CA3AF"
            />

            <DocumentAttachments attachments={attachments} onChange={setAttachments} />

            <TouchableOpacity style={[styles.primaryBtn, submitting && { opacity: 0.6 }]} onPress={submit} disabled={submitting} accessibilityRole="button">
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{info.status === 'Rejected' ? 'Apply again' : 'Send application'}</Text>}
            </TouchableOpacity>
          </>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 15, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  card: { ...CardSpec, padding: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  title: { fontSize: 18, fontWeight: 'bold', color: Colors.textPrimary },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  pillText: { fontSize: 11, fontWeight: 'bold' },
  body: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19, marginBottom: 12 },
  label: { fontSize: 12, fontWeight: 'bold', color: Colors.textSecondary, marginTop: 4 },
  input: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, marginTop: 4, marginBottom: 12, color: Colors.textPrimary },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6, marginBottom: 12 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: '#D1D5DB' },
  chipActive: { backgroundColor: Colors.secondary, borderColor: Colors.secondary },
  chipText: { fontSize: 12, color: Colors.textPrimary, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  primaryBtn: { marginTop: 14, backgroundColor: Colors.secondary, paddingVertical: 13, borderRadius: 10, alignItems: 'center' },
  primaryText: { color: '#fff', fontWeight: 'bold' },
  secondaryBtn: { alignSelf: 'flex-start', borderWidth: 1, borderColor: Colors.secondaryBorder, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10 },
  secondaryText: { color: Colors.secondary, fontWeight: 'bold' },
  rejectBox: { backgroundColor: '#FEF2F2', borderRadius: 8, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#FECACA' },
  rejectTitle: { fontSize: 12, fontWeight: 'bold', color: '#B91C1C', marginBottom: 2 },
  rejectText: { fontSize: 13, color: '#7F1D1D', lineHeight: 18 },
  errorText: { color: Colors.danger, fontSize: 13, textAlign: 'center' },
  link: { color: Colors.secondary, fontWeight: 'bold' },
});
