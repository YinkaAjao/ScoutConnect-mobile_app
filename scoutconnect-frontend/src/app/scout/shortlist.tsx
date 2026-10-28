import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, Alert, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { apiFetch } from '../../lib/api';
import ScoutAccreditationPanel from '../../components/ScoutAccreditationPanel';

interface ShortlistEntry {
  id: string;
  notes: string | null;
  createdAt: string;
  unavailable: boolean; // the athlete was removed, or their consent lapsed
  Player: {
    displayName: string;
    position: string;
    age: number | null;
    Evaluations?: { dribblingScore: number | null; sprintSpeed: number | null }[];
  } | null;
}

export default function ShortlistScreen() {
  const [shortlist, setShortlist] = useState<ShortlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notApproved, setNotApproved] = useState(false);

  const fetchShortlist = async () => {
    try {
      const data = await apiFetch('/shortlist');
      if (!Array.isArray(data)) throw new Error('Unexpected response from the server.');
      setShortlist(data);
      setError(null);
      setNotApproved(false);
    } catch (e: any) {
      if (e?.code === 'SCOUT_NOT_APPROVED') {
        setNotApproved(true);
        return;
      }
      setError(e?.message || 'Could not load your shortlist.');
    }
  };

  // The tab stays mounted, so reload every time it is opened (an athlete may have been added on Discover).
  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      fetchShortlist().finally(() => setLoading(false));
    }, [])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchShortlist();
    setRefreshing(false);
  };

  const removeEntry = (id: string, label: string) => {
    Alert.alert(
      'Remove Player',
      `Are you sure you want to remove ${label} from your shortlist?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await apiFetch(`/shortlist/${id}`, { method: 'DELETE' });
              setShortlist((prev) => prev.filter((entry) => entry.id !== id)); // instant feedback
            } catch (e: any) {
              Alert.alert('Could not remove entry', e?.message || String(e));
            }
          },
        },
      ]
    );
  };

  const renderItem = ({ item }: { item: ShortlistEntry }) => {
    const player = item.Player;

    if (item.unavailable || !player) {
      return (
        <View style={[styles.card, styles.cardMuted]}>
          <View style={styles.cardHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>Athlete no longer available</Text>
              <Text style={styles.detail}>They were removed, or their guardian's consent is no longer on record.</Text>
            </View>
            <TouchableOpacity onPress={() => removeEntry(item.id, 'this athlete')} style={styles.removeBtn} accessibilityRole="button" accessibilityLabel="Remove unavailable athlete from shortlist">
              <Text style={styles.removeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    // The server returns evaluations oldest to newest, so the last one is the latest.
    const latestEval = player.Evaluations && player.Evaluations.length > 0 ? player.Evaluations[player.Evaluations.length - 1] : null;

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{player.displayName}</Text>
            <Text style={styles.detail}>
              {player.position || 'Position not set'}{player.age != null ? ` · ${player.age} yrs` : ''}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => removeEntry(item.id, player.displayName)}
            style={styles.removeBtn}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${player.displayName} from shortlist`}
          >
            <Text style={styles.removeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>

        {latestEval && (
          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>30m Sprint</Text>
              <Text style={styles.statValue}>{latestEval.sprintSpeed ? `${latestEval.sprintSpeed}s` : '--'}</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>Ball Control</Text>
              <Text style={styles.statValue}>{latestEval.dribblingScore ? `${latestEval.dribblingScore}/5` : '--'}</Text>
            </View>
          </View>
        )}

        {item.notes ? (
          <View style={styles.notesBox}>
            <Text style={styles.notesTitle}>My Notes:</Text>
            <Text style={styles.notesText}>{item.notes}</Text>
          </View>
        ) : null}
      </View>
    );
  };

  if (notApproved) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.header}>My Shortlist</Text>
        <ScoutAccreditationPanel onApproved={() => { setNotApproved(false); setLoading(true); fetchShortlist().finally(() => setLoading(false)); }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.header}>My Shortlist</Text>

      {loading && shortlist.length === 0 ? (
        <ActivityIndicator style={{ marginTop: 40 }} size="large" color="#2E8B57" />
      ) : (
        <FlatList
          data={shortlist}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            error ? (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>Couldn't load your shortlist</Text>
                <Text style={styles.emptySubtext}>{error}</Text>
                <TouchableOpacity style={styles.retryBtn} onPress={onRefresh} accessibilityRole="button">
                  <Text style={styles.retryText}>Try again</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>Your shortlist is empty.</Text>
                <Text style={styles.emptySubtext}>Go to the Discover tab to find athletes.</Text>
              </View>
            )
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f4f4', padding: 15 },
  header: { fontSize: 24, fontWeight: 'bold', textAlign: 'center', marginVertical: 15, color: '#333' },
  card: { backgroundColor: '#fff', padding: 15, borderRadius: 10, marginBottom: 15, elevation: 2 },
  cardMuted: { backgroundColor: '#F3F4F6', elevation: 0 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 15 },
  name: { fontSize: 18, fontWeight: 'bold', color: '#111' },
  detail: { fontSize: 14, color: '#666', marginTop: 2 },
  removeBtn: { padding: 5 },
  removeBtnText: { color: '#d9534f', fontSize: 18, fontWeight: 'bold' },
  statsRow: { flexDirection: 'row', gap: 15, marginBottom: 15 },
  statBox: { backgroundColor: '#f9f9f9', padding: 10, borderRadius: 8, alignItems: 'center', flex: 1, borderWidth: 1, borderColor: '#eee' },
  statLabel: { fontSize: 12, color: '#888', fontWeight: '600' },
  statValue: { fontSize: 16, color: '#2E8B57', fontWeight: 'bold', marginTop: 4 },
  notesBox: { backgroundColor: '#eef5fe', padding: 12, borderRadius: 8 },
  notesTitle: { fontSize: 12, fontWeight: 'bold', color: '#0056b3', marginBottom: 4 },
  notesText: { fontSize: 14, color: '#333' },
  emptyContainer: { alignItems: 'center', marginTop: 60, paddingHorizontal: 20 },
  emptyText: { fontSize: 18, fontWeight: 'bold', color: '#555', marginBottom: 8 },
  emptySubtext: { fontSize: 14, color: '#888', textAlign: 'center' },
  retryBtn: { marginTop: 14, backgroundColor: '#2E8B57', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 8 },
  retryText: { color: '#fff', fontWeight: 'bold' },
});
