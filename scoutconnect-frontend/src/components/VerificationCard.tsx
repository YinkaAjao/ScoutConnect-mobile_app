// src/components/VerificationCard.tsx
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, ActivityIndicator } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import FormSheet, { formStyles } from './FormSheet';
import DocumentAttachments from './DocumentAttachments';
import { apiFetch } from '../lib/api';
import { supabase } from '../lib/supabase';
import { markVerificationSeen } from '../lib/verificationSeen';
import { Attachment, VerificationInfo, uploadAttachments } from '../lib/verification';
import { Colors, CardSpec } from '../constants/designSystem';

const STATUS_STYLE: Record<string, { label: string; bg: string; fg: string }> = {
  Verified: { label: 'Verified', bg: '#D1FAE5', fg: '#047857' },
  Submitted: { label: 'Under Review', bg: '#DBEAFE', fg: '#1D4ED8' },
  Rejected: { label: 'Declined', bg: '#FEE2E2', fg: '#B91C1C' },
  Unverified: { label: 'Not Verified', bg: '#FEF3C7', fg: '#B45309' },
};

const formatDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString() : '');

/** Verification status for the signed-in coach's club, with the request flow for the club owner. */
export default function VerificationCard({ refreshKey = 0 }: { refreshKey?: number }) {
  const [info, setInfo] = useState<VerificationInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [statement, setStatement] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  const load = async () => {
    try {
      const data: VerificationInfo = await apiFetch('/club/verification');
      setInfo(data);
      setError(null);
      markVerificationSeen(data.history); // the owner is looking at it now, so clear that part of the Club tab badge
    } catch (e: any) {
      setError(e?.message || 'Could not load verification status.');
    }
  };

  useFocusEffect(
    useCallback(() => {
      load();
    }, [refreshKey])
  );

  const openRequest = () => {
    setStatement('');
    setAttachments([]);
    setRequesting(true);
  };

  const submit = async () => {
    if (attachments.length === 0) return Alert.alert('Documents needed', 'Attach at least one supporting document.');
    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) throw new Error('Your session has expired. Please sign in again.');

      const documents = await uploadAttachments(userId, attachments);
      await apiFetch('/club/verification', { method: 'POST', body: { statement, documents } });
      setRequesting(false);
      await load();
      Alert.alert('Request sent', 'An administrator will review your documents. You can follow the status here.');
    } catch (e: any) {
      Alert.alert('Could not send your request', e?.message || String(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (!info) {
    return (
      <View style={[styles.card, styles.center]}>
        {error ? <Text style={styles.errorText}>{error}</Text> : <ActivityIndicator color={Colors.primary} />}
        {error && (
          <TouchableOpacity onPress={load} accessibilityRole="button"><Text style={styles.link}>Try again</Text></TouchableOpacity>
        )}
      </View>
    );
  }

  const style = STATUS_STYLE[info.status] ?? STATUS_STYLE.Unverified;
  const canResubmit = info.status === 'Rejected' || info.status === 'Unverified';

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>Club Verification</Text>
        <View style={[styles.pill, { backgroundColor: style.bg }]}>
          <Text style={[styles.pillText, { color: style.fg }]}>{style.label}</Text>
        </View>
      </View>

      {info.status === 'Verified' && (
        <Text style={styles.body}>
          Your club was verified{info.verifiedAt ? ` on ${formatDate(info.verifiedAt)}` : ''}. Changing the club name or classification removes this until it is reviewed again.
        </Text>
      )}

      {info.status === 'Submitted' && (
        <Text style={styles.body}>
          Submitted{info.submittedAt ? ` on ${formatDate(info.submittedAt)}` : ''} with {info.documents.length} document{info.documents.length === 1 ? '' : 's'}. An administrator is reviewing it.
        </Text>
      )}

      {info.status === 'Rejected' && (
        <View style={styles.rejectBox}>
          <Text style={styles.rejectTitle}>Not approved</Text>
          <Text style={styles.rejectText}>{info.rejectionReason || 'No reason was given.'}</Text>
        </View>
      )}

      {canResubmit && (
        <>
          <Text style={styles.body}>
            Verified clubs get a badge that scouts can trust. Complete these details, then send your documents for review.
          </Text>
          {info.checklist.map((item) => (
            <View key={item.key} style={styles.checkRow}>
              <Ionicons name={item.done ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={item.done ? Colors.primary : '#9CA3AF'} />
              <Text style={[styles.checkText, !item.done && { color: Colors.textSecondary }]}>{item.label}</Text>
            </View>
          ))}
          {info.isOwner ? (
            <TouchableOpacity
              style={[styles.primaryBtn, !info.canRequest && styles.primaryBtnDisabled]}
              onPress={openRequest}
              disabled={!info.canRequest}
              accessibilityRole="button"
              accessibilityState={{ disabled: !info.canRequest }}
            >
              <Text style={styles.primaryBtnText}>{info.status === 'Rejected' ? 'Fix and resubmit' : 'Request verification'}</Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.note}>Only the club owner can request verification.</Text>
          )}
          {info.isOwner && !info.canRequest && <Text style={styles.note}>Finish the checklist above to unlock the request.</Text>}
        </>
      )}

      {info.history.length > 0 && (
        <View style={styles.history}>
          <Text style={styles.historyTitle}>ACTIVITY</Text>
          {info.history.slice(0, 3).map((event, i) => (
            <Text key={i} style={styles.historyRow}>
              {formatDate(event.at)} · {event.action}{event.note && event.action !== 'Submitted' ? ` — ${event.note}` : ''}
            </Text>
          ))}
        </View>
      )}

      <FormSheet visible={requesting} title="Request verification" saving={submitting} onCancel={() => setRequesting(false)} onSave={submit}>
        <Text style={formStyles.label}>Anything the reviewer should know? (optional)</Text>
        <TextInput
          style={[formStyles.input, { height: 90, textAlignVertical: 'top' }]}
          value={statement}
          onChangeText={setStatement}
          multiline
          maxLength={1000}
          placeholder="e.g. Registered with the federation in 2021…"
          placeholderTextColor="#9CA3AF"
        />

        <DocumentAttachments attachments={attachments} onChange={setAttachments} />
      </FormSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { ...CardSpec, padding: 16, marginBottom: 20 },
  center: { alignItems: 'center', justifyContent: 'center', minHeight: 80, gap: 8 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  title: { fontSize: 16, fontWeight: 'bold', color: Colors.textPrimary },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  pillText: { fontSize: 11, fontWeight: 'bold' },
  body: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19, marginBottom: 10 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  checkText: { fontSize: 13, color: Colors.textPrimary },
  primaryBtn: { marginTop: 12, backgroundColor: Colors.primary, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  primaryBtnDisabled: { backgroundColor: '#9CA3AF' },
  primaryBtnText: { color: '#fff', fontWeight: 'bold' },
  note: { fontSize: 11, color: Colors.textSecondary, fontStyle: 'italic', marginTop: 8 },
  rejectBox: { backgroundColor: '#FEF2F2', borderRadius: 8, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: '#FECACA' },
  rejectTitle: { fontSize: 12, fontWeight: 'bold', color: '#B91C1C', marginBottom: 2 },
  rejectText: { fontSize: 13, color: '#7F1D1D', lineHeight: 18 },
  history: { marginTop: 14, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  historyTitle: { fontSize: 10, fontWeight: 'bold', color: '#9CA3AF', marginBottom: 4 },
  historyRow: { fontSize: 12, color: Colors.textSecondary, paddingVertical: 1 },
  errorText: { color: Colors.danger, fontSize: 13, textAlign: 'center' },
  link: { color: Colors.secondary, fontWeight: 'bold' },
});
