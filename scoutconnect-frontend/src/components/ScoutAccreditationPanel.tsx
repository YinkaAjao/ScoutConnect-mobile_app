// src/components/ScoutAccreditationPanel.tsx
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, ActivityIndicator, ScrollView } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
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

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const HERO: Record<string, { icon: IconName; bg: string; fg: string; title: string; body: string }> = {
  Pending: { icon: 'shield-checkmark-outline', bg: '#DBEAFE', fg: Colors.secondary, title: 'Get accredited to start scouting', body: 'The athletes on ScoutConnect are young people, so only vetted scouts can browse them. It takes a few minutes to apply.' },
  Submitted: { icon: 'hourglass-outline', bg: '#DBEAFE', fg: '#1D4ED8', title: 'Your application is being reviewed', body: 'An administrator is checking your details. You will get an email as soon as there is a decision.' },
  Approved: { icon: 'checkmark-circle-outline', bg: '#D1FAE5', fg: '#047857', title: "You're accredited", body: 'You can now browse athletes, build a shortlist and contact clubs.' },
  Rejected: { icon: 'alert-circle-outline', bg: '#FEE2E2', fg: '#B91C1C', title: 'Your application was not approved', body: 'You can fix the issue below and apply again.' },
  Suspended: { icon: 'lock-closed-outline', bg: '#FEE2E2', fg: '#B91C1C', title: 'Your scout access is suspended', body: 'You cannot browse athletes while the suspension lasts.' },
};

const STEPS = [
  { title: 'Tell us who you scout for', body: 'Your organisation and what kind of scout you are.' },
  { title: 'Attach proof', body: 'A licence, ID or a letter from your organisation (PDF, JPG or PNG).' },
  { title: 'Wait for approval', body: 'An administrator reviews every application and emails you the decision.' },
];

/**
 * Shown to a scout until an administrator approves them. Scouts must be accredited before they can browse athletes,
 * because the athletes are young people and their data should only reach vetted people.
 * It fills the whole screen, so callers should not put their own page title above it.
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
  const hero = HERO[info.status] ?? HERO.Pending;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.hero}>
        <View style={[styles.heroIcon, { backgroundColor: hero.bg }]}>
          <Ionicons name={hero.icon} size={34} color={hero.fg} />
        </View>
        <View style={[styles.pill, { backgroundColor: style.bg }]}>
          <Text style={[styles.pillText, { color: style.fg }]}>{style.label}</Text>
        </View>
        <Text style={styles.heroTitle}>{hero.title}</Text>
        <Text style={styles.heroBody}>{hero.body}</Text>
      </View>

      {info.status === 'Pending' && (
        <View style={styles.steps}>
          {STEPS.map((step, index) => (
            <View key={step.title} style={styles.step}>
              <View style={styles.stepNumber}><Text style={styles.stepNumberText}>{index + 1}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.stepTitle}>{step.title}</Text>
                <Text style={styles.stepBody}>{step.body}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {info.status === 'Rejected' && (
        <View style={styles.rejectBox}>
          <Text style={styles.rejectTitle}>Why it was not approved</Text>
          <Text style={styles.rejectText}>{info.rejectionReason || 'No reason was given.'}</Text>
        </View>
      )}

      {info.status === 'Suspended' && (
        <View style={styles.rejectBox}>
          <Text style={styles.rejectTitle}>Why your access is suspended</Text>
          <Text style={styles.rejectText}>{info.rejectionReason || 'Contact an administrator for details.'}</Text>
        </View>
      )}

      {info.status === 'Submitted' && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your application</Text>
          <Text style={styles.summaryLine}>Organisation: <Text style={styles.summaryValue}>{info.organisation}</Text></Text>
          {info.orgType ? <Text style={styles.summaryLine}>Type: <Text style={styles.summaryValue}>{info.orgType}</Text></Text> : null}
          <Text style={styles.summaryLine}>
            Sent: <Text style={styles.summaryValue}>{info.submittedAt ? new Date(info.submittedAt).toLocaleDateString() : 'recently'}</Text>
            {' · '}
            <Text style={styles.summaryValue}>{info.documents.length} document{info.documents.length === 1 ? '' : 's'}</Text>
          </Text>
          <TouchableOpacity style={styles.secondaryBtn} onPress={load} accessibilityRole="button">
            <Text style={styles.secondaryText}>Check for a decision</Text>
          </TouchableOpacity>
        </View>
      )}

      {info.status === 'Approved' && (
        <TouchableOpacity style={styles.primaryBtn} onPress={() => onApproved?.()} accessibilityRole="button">
          <Text style={styles.primaryText}>Start browsing</Text>
        </TouchableOpacity>
      )}

      {canApply && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{info.status === 'Rejected' ? 'Apply again' : 'Your details'}</Text>

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
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  container: { padding: 15, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  hero: { alignItems: 'center', paddingVertical: 20, gap: 10 },
  heroIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { fontSize: 21, fontWeight: 'bold', color: Colors.textPrimary, textAlign: 'center' },
  heroBody: { fontSize: 14, color: Colors.textSecondary, lineHeight: 20, textAlign: 'center', paddingHorizontal: 10 },
  steps: { gap: 14, marginBottom: 20, paddingHorizontal: 4 },
  step: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  stepNumber: { width: 26, height: 26, borderRadius: 13, backgroundColor: Colors.secondary, alignItems: 'center', justifyContent: 'center' },
  stepNumberText: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
  stepTitle: { fontSize: 14, fontWeight: 'bold', color: Colors.textPrimary },
  stepBody: { fontSize: 12, color: Colors.textSecondary, lineHeight: 17, marginTop: 1 },
  section: { ...CardSpec, padding: 16, marginBottom: 14 },
  sectionTitle: { fontSize: 15, fontWeight: 'bold', color: Colors.textPrimary, marginBottom: 10 },
  summaryLine: { fontSize: 13, color: Colors.textSecondary, marginBottom: 4 },
  summaryValue: { color: Colors.textPrimary, fontWeight: '600' },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  pillText: { fontSize: 11, fontWeight: 'bold' },
  label: { fontSize: 12, fontWeight: 'bold', color: Colors.textSecondary, marginTop: 4 },
  input: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, marginTop: 4, marginBottom: 12, color: Colors.textPrimary },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6, marginBottom: 12 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: '#D1D5DB' },
  chipActive: { backgroundColor: Colors.secondary, borderColor: Colors.secondary },
  chipText: { fontSize: 12, color: Colors.textPrimary, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  primaryBtn: { marginTop: 14, backgroundColor: Colors.secondary, paddingVertical: 13, borderRadius: 10, alignItems: 'center' },
  primaryText: { color: '#fff', fontWeight: 'bold' },
  secondaryBtn: { alignSelf: 'flex-start', marginTop: 10, borderWidth: 1, borderColor: Colors.secondaryBorder, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10 },
  secondaryText: { color: Colors.secondary, fontWeight: 'bold' },
  rejectBox: { backgroundColor: '#FEF2F2', borderRadius: 10, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: '#FECACA' },
  rejectTitle: { fontSize: 12, fontWeight: 'bold', color: '#B91C1C', marginBottom: 2 },
  rejectText: { fontSize: 13, color: '#7F1D1D', lineHeight: 18 },
  errorText: { color: Colors.danger, fontSize: 13, textAlign: 'center' },
  link: { color: Colors.secondary, fontWeight: 'bold' },
});
