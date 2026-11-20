// src/app/scout/requests.tsx
import React, { useCallback, useState, useMemo } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl, ActivityIndicator, Linking, Image, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch } from '../../lib/api';
import ScoutAccreditationPanel from '../../components/ScoutAccreditationPanel';
import { useColors, makeCardSpec, type ThemeColors } from '../../theme/theme';

interface RequestItem {
  id: string;
  status: 'Pending' | 'Accepted' | 'Declined' | 'Withdrawn';
  message: string;
  responseNote: string | null;
  createdAt: string;
  respondedAt: string | null;
  athlete: { id: string; displayName: string; position: string; age: number | null; profilePhoto: string | null } | null;
  club: { name: string; isVerified: boolean; contactEmail?: string | null; contactPhone?: string | null } | null;
}

const statusStyle = (Colors: ThemeColors) => ({
  Pending: { label: 'Waiting for the club', bg: Colors.warnBg, fg: Colors.warnText },
  Accepted: { label: 'Accepted', bg: Colors.successBg, fg: Colors.successText },
  Declined: { label: 'Declined', bg: Colors.dangerBg, fg: Colors.dangerText },
  Withdrawn: { label: 'Withdrawn', bg: Colors.border, fg: Colors.textSecondary },
} as const);

export default function RequestsScreen() {
  const Colors = useColors();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notApproved, setNotApproved] = useState(false);

  const load = async () => {
    try {
      const data = await apiFetch('/contact-requests');
      if (!Array.isArray(data)) throw new Error('Unexpected response from the server.');
      setRequests(data);
      setError(null);
      setNotApproved(false);
    } catch (e: any) {
      if (e?.code === 'SCOUT_NOT_APPROVED') {
        setNotApproved(true);
        return;
      }
      setError(e?.message || 'Could not load your requests.');
    }
  };

  // Reload whenever the tab is opened: a club may have answered since last time.
  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load().finally(() => setLoading(false));
    }, [])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const withdraw = (item: RequestItem) => {
    Alert.alert('Withdraw this request?', 'The club will no longer see it as waiting. You can send a new request later.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Withdraw',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiFetch(`/contact-requests/${item.id}/withdraw`, { method: 'PUT', retries: 0 });
            await load();
          } catch (e: any) {
            Alert.alert('Could not withdraw', e?.message || 'Please try again.');
            await load();
          }
        }
      }
    ]);
  };

  const renderItem = ({ item }: { item: RequestItem }) => {
    const style = statusStyle(Colors)[item.status] ?? statusStyle(Colors).Pending;
    const accepted = item.status === 'Accepted';

    return (
      <View style={styles.card}>
        <View style={styles.row}>
          {item.athlete?.profilePhoto ? (
            <Image source={{ uri: item.athlete.profilePhoto }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Text style={styles.avatarText}>{(item.athlete?.displayName ?? '?').charAt(0).toUpperCase()}</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{item.athlete?.displayName ?? 'Athlete no longer available'}</Text>
            <Text style={styles.detail}>
              {item.athlete?.position || ''}{item.athlete?.age != null ? ` · ${item.athlete.age} yrs` : ''}
            </Text>
          </View>
          <View style={[styles.pill, { backgroundColor: style.bg }]}>
            <Text style={[styles.pillText, { color: style.fg }]}>{style.label}</Text>
          </View>
        </View>

        {item.club && (
          <View style={styles.clubRow}>
            {item.club.isVerified && <Ionicons name="checkmark-circle" size={14} color={Colors.primary} accessibilityLabel="Verified club" />}
            <Text style={styles.club}>
              {item.club.isVerified ? 'Verified club: ' : 'Club: '}
              {item.club.name}
            </Text>
          </View>
        )}
        <Text style={styles.message}>“{item.message}”</Text>
        <Text style={styles.date}>Sent {new Date(item.createdAt).toLocaleDateString()}</Text>

        {item.status === 'Pending' && (
          <TouchableOpacity onPress={() => withdraw(item)} accessibilityRole="button" accessibilityLabel="Withdraw this request" style={{ alignSelf: 'flex-start', marginTop: 8 }}>
            <Text style={{ color: Colors.danger, fontWeight: 'bold', fontSize: 13 }}>Withdraw request</Text>
          </TouchableOpacity>
        )}

        {item.responseNote ? (
          <View style={styles.noteBox}>
            <Text style={styles.noteTitle}>Note from the club</Text>
            <Text style={styles.noteText}>{item.responseNote}</Text>
          </View>
        ) : null}

        {accepted && item.club && (
          <View style={styles.contactBox}>
            <Text style={styles.contactTitle}>Club contact details</Text>
            {item.club.contactEmail ? (
              <TouchableOpacity onPress={() => Linking.openURL(`mailto:${item.club!.contactEmail}`)} accessibilityRole="link" accessibilityLabel={`Email ${item.club.name}`}>
                <View style={styles.contactRow}>
                  <Ionicons name="mail-outline" size={16} color={Colors.secondary} />
                  <Text style={styles.contactLink}>{item.club.contactEmail}</Text>
                </View>
              </TouchableOpacity>
            ) : null}
            {item.club.contactPhone ? (
              <TouchableOpacity onPress={() => Linking.openURL(`tel:${item.club!.contactPhone}`)} accessibilityRole="link" accessibilityLabel={`Call ${item.club.name}`}>
                <View style={styles.contactRow}>
                  <Ionicons name="call-outline" size={16} color={Colors.secondary} />
                  <Text style={styles.contactLink}>{item.club.contactPhone}</Text>
                </View>
              </TouchableOpacity>
            ) : null}
            {!item.club.contactEmail && !item.club.contactPhone ? <Text style={styles.noteText}>The club has not added contact details yet.</Text> : null}
          </View>
        )}
      </View>
    );
  };

  if (notApproved) {
    return (
      <SafeAreaView style={styles.container}>
        <ScoutAccreditationPanel onApproved={() => { setNotApproved(false); setLoading(true); load().finally(() => setLoading(false)); }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.header}>My Requests</Text>
      {loading && requests.length === 0 ? (
        <ActivityIndicator style={{ marginTop: 40 }} size="large" color={Colors.secondary} />
      ) : (
        <FlatList
          data={requests}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 30 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            error ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>Couldn't load your requests</Text>
                <Text style={styles.emptyText}>{error}</Text>
                <TouchableOpacity style={styles.retryBtn} onPress={onRefresh} accessibilityRole="button">
                  <Text style={styles.retryText}>Try again</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.empty}>
                <Ionicons name="mail-outline" size={40} color="#9CA3AF" />
                <Text style={styles.emptyTitle}>No requests yet</Text>
                <Text style={styles.emptyText}>Open an athlete on Discover and tap "Request contact". The club decides whether to share their details.</Text>
              </View>
            )
          }
        />
      )}
    </SafeAreaView>
  );
}

const makeStyles = (Colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.canvas, paddingHorizontal: 15 },
  header: { fontSize: 24, fontWeight: 'bold', textAlign: 'center', marginVertical: 15, color: Colors.textPrimary },
  card: { ...makeCardSpec(Colors), padding: 14, marginBottom: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.surfaceMuted },
  avatarFallback: { backgroundColor: Colors.secondary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: 'bold', fontSize: 18 },
  name: { fontSize: 16, fontWeight: 'bold', color: Colors.textPrimary },
  detail: { fontSize: 12, color: Colors.textSecondary, marginTop: 1 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, maxWidth: 130 },
  pillText: { fontSize: 11, fontWeight: 'bold', textAlign: 'center' },
  clubRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10 },
  club: { fontSize: 12, color: Colors.textSecondary },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  message: { fontSize: 13, color: Colors.textPrimary, fontStyle: 'italic', marginTop: 6, lineHeight: 19 },
  date: { fontSize: 11, color: '#9CA3AF', marginTop: 6 },
  noteBox: { backgroundColor: Colors.inputBg, borderRadius: 8, padding: 10, marginTop: 10 },
  noteTitle: { fontSize: 11, fontWeight: 'bold', color: Colors.textSecondary, marginBottom: 2 },
  noteText: { fontSize: 13, color: Colors.textPrimary, lineHeight: 18 },
  contactBox: { backgroundColor: Colors.secondaryLight, borderRadius: 8, padding: 12, marginTop: 10, borderWidth: 1, borderColor: Colors.secondaryBorder, gap: 6 },
  contactTitle: { fontSize: 12, fontWeight: 'bold', color: Colors.secondary },
  contactLink: { fontSize: 14, color: Colors.secondary, fontWeight: '600', paddingVertical: 4 },
  empty: { alignItems: 'center', marginTop: 60, paddingHorizontal: 24, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: 'bold', color: Colors.textSecondary },
  emptyText: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', lineHeight: 19 },
  retryBtn: { marginTop: 10, backgroundColor: Colors.secondary, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 8 },
  retryText: { color: '#fff', fontWeight: 'bold' },
});
