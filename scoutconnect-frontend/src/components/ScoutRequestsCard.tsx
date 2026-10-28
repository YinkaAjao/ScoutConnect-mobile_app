// src/components/ScoutRequestsCard.tsx
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, ActivityIndicator } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import FormSheet, { formStyles } from './FormSheet';
import { apiFetch } from '../lib/api';
import { setPendingContactRequests } from '../lib/verificationSeen';
import { Colors, CardSpec } from '../constants/designSystem';

interface IncomingRequest {
  id: string;
  message: string;
  createdAt: string;
  athlete: { id: string; name: string; position: string } | null;
  scout: { username: string; organisation: string | null; orgType: string | null };
}

/** Scout contact requests waiting for the club owner. Accepting is what releases the athlete's name and the club's contact details. */
export default function ScoutRequestsCard() {
  const [requests, setRequests] = useState<IncomingRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answering, setAnswering] = useState<{ request: IncomingRequest; decision: 'accept' | 'decline' } | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const data = await apiFetch('/club/contact-requests?status=Pending');
      setRequests(data);
      setPendingContactRequests(data.length);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Could not load scout requests.');
    }
  };

  useFocusEffect(
    useCallback(() => {
      load();
    }, [])
  );

  const startAnswer = (request: IncomingRequest, decision: 'accept' | 'decline') => {
    setNote('');
    setAnswering({ request, decision });
  };

  const send = async () => {
    if (!answering) return;
    setSaving(true);
    try {
      await apiFetch(`/club/contact-requests/${answering.request.id}`, {
        method: 'PUT',
        body: { decision: answering.decision, note },
      });
      const remaining = (requests ?? []).filter((r) => r.id !== answering.request.id);
      setRequests(remaining);
      setPendingContactRequests(remaining.length);
      setAnswering(null);
    } catch (e: any) {
      Alert.alert('Could not send your answer', e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  if (!requests) {
    return (
      <View style={[styles.card, styles.center]}>
        {error ? <Text style={styles.errorText}>{error}</Text> : <ActivityIndicator color={Colors.primary} />}
        {error && (
          <TouchableOpacity onPress={load} accessibilityRole="button"><Text style={styles.link}>Try again</Text></TouchableOpacity>
        )}
      </View>
    );
  }

  const accepting = answering?.decision === 'accept';

  return (
    <View style={[styles.card, requests.length > 0 && styles.cardAttention]}>
      <View style={styles.header}>
        <Text style={styles.title}>Scout Requests</Text>
        {requests.length > 0 && (
          <View style={styles.countPill}><Text style={styles.countText}>{requests.length} waiting</Text></View>
        )}
      </View>

      {requests.length === 0 ? (
        <Text style={styles.empty}>No scouts are waiting for an answer. Scouts only see your athletes by first name and cannot contact you until you accept.</Text>
      ) : (
        requests.map((request) => (
          <View key={request.id} style={styles.item}>
            <Text style={styles.athlete}>
              {request.athlete?.name ?? 'An athlete'}
              {request.athlete?.position ? ` · ${request.athlete.position}` : ''}
            </Text>
            <Text style={styles.scout}>
              From {request.scout.username}
              {request.scout.organisation ? `, ${request.scout.organisation}` : ''}
              {request.scout.orgType ? ` (${request.scout.orgType})` : ''}
            </Text>
            <Text style={styles.message}>“{request.message}”</Text>
            <Text style={styles.date}>{new Date(request.createdAt).toLocaleDateString()}</Text>
            <View style={styles.actions}>
              <TouchableOpacity style={[styles.btn, styles.declineBtn]} onPress={() => startAnswer(request, 'decline')} accessibilityRole="button" accessibilityLabel={`Decline request about ${request.athlete?.name ?? 'athlete'}`}>
                <Text style={styles.declineText}>Decline</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, styles.acceptBtn]} onPress={() => startAnswer(request, 'accept')} accessibilityRole="button" accessibilityLabel={`Accept request about ${request.athlete?.name ?? 'athlete'}`}>
                <Text style={styles.acceptText}>Accept</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))
      )}

      <FormSheet
        visible={answering !== null}
        title={accepting ? 'Accept this request?' : 'Decline this request?'}
        saving={saving}
        onCancel={() => setAnswering(null)}
        onSave={send}
      >
        <Text style={styles.sheetWarning}>
          {accepting
            ? `Accepting shares ${answering?.request.athlete?.name ?? 'the athlete'}'s full name and your club's email and phone with ${answering?.request.scout.username ?? 'this scout'}.`
            : 'The scout is told you declined. Nothing about the athlete or your club is shared.'}
        </Text>
        <Text style={formStyles.label}>Note for the scout (optional)</Text>
        <TextInput
          style={[formStyles.input, { height: 80, textAlignVertical: 'top' }]}
          value={note}
          onChangeText={setNote}
          multiline
          maxLength={300}
          placeholder={accepting ? 'e.g. Please call after 5pm.' : 'e.g. He is not available this season.'}
          placeholderTextColor="#9CA3AF"
        />
      </FormSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { ...CardSpec, padding: 16, marginBottom: 20 },
  cardAttention: { borderWidth: 1, borderColor: '#FCD34D' },
  center: { alignItems: 'center', justifyContent: 'center', minHeight: 70, gap: 8 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  title: { fontSize: 16, fontWeight: 'bold', color: Colors.textPrimary },
  countPill: { backgroundColor: '#FEF3C7', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  countText: { fontSize: 11, fontWeight: 'bold', color: '#B45309' },
  empty: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },
  item: { borderTopWidth: 1, borderTopColor: '#F3F4F6', paddingTop: 12, marginTop: 8 },
  athlete: { fontSize: 15, fontWeight: 'bold', color: Colors.textPrimary },
  scout: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  message: { fontSize: 13, color: Colors.textPrimary, fontStyle: 'italic', marginTop: 8, lineHeight: 19 },
  date: { fontSize: 11, color: '#9CA3AF', marginTop: 6 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 10 },
  btn: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 10 },
  acceptBtn: { backgroundColor: Colors.primary },
  acceptText: { color: '#fff', fontWeight: 'bold' },
  declineBtn: { borderWidth: 1, borderColor: '#FCA5A5', backgroundColor: '#FEF2F2' },
  declineText: { color: '#B91C1C', fontWeight: 'bold' },
  errorText: { color: Colors.danger, fontSize: 13, textAlign: 'center' },
  link: { color: Colors.secondary, fontWeight: 'bold' },
  sheetWarning: { fontSize: 13, color: Colors.textPrimary, lineHeight: 19, backgroundColor: '#F9FAFB', padding: 12, borderRadius: 8, marginBottom: 12 },
});
