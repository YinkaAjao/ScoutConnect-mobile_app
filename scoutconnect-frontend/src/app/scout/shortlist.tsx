import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, TextInput, Alert, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch } from '../../lib/api';
import ScoutAccreditationPanel from '../../components/ScoutAccreditationPanel';
import ScoutPlayerRow from '../../components/ScoutPlayerRow';
import FormSheet, { formStyles } from '../../components/FormSheet';
import { PlayerProspect, latestOverall } from '../../lib/scoutPlayer';
import { Colors } from '../../constants/designSystem';

interface ShortlistEntry {
  id: string;
  notes: string | null;
  createdAt: string;
  unavailable: boolean; // the athlete was removed, or their consent lapsed
  Player: PlayerProspect | null;
}

type SortKey = 'recent' | 'name' | 'rating';
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'recent', label: 'Recently added' },
  { key: 'name', label: 'Name' },
  { key: 'rating', label: 'Top rated' },
];

export default function ShortlistScreen() {
  const [shortlist, setShortlist] = useState<ShortlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notApproved, setNotApproved] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');
  const [noteTarget, setNoteTarget] = useState<ShortlistEntry | null>(null);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);

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
      'Remove from shortlist',
      `Remove ${label} from your shortlist?`,
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

  const saveNote = async () => {
    if (!noteTarget) return;
    setSavingNote(true);
    try {
      const result = await apiFetch(`/shortlist/${noteTarget.id}`, { method: 'PATCH', body: { notes: noteText } });
      setShortlist((prev) => prev.map((entry) => (entry.id === noteTarget.id ? { ...entry, notes: result?.notes ?? null } : entry)));
      setNoteTarget(null);
    } catch (e: any) {
      Alert.alert('Could not save your note', e?.message || String(e));
    } finally {
      setSavingNote(false);
    }
  };

  const visibleEntries = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = shortlist.filter((entry) => {
      if (!needle) return true;
      const player = entry.Player;
      if (!player) return false;
      return [player.displayName, player.position, player.Club?.name, entry.notes].some((field) => field?.toLowerCase().includes(needle));
    });
    // The server already returns newest first; unavailable placeholders always sink to the bottom.
    const rank = (entry: ShortlistEntry) => (entry.Player ? 0 : 1);
    return [...filtered].sort((a, b) => {
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      if (sort === 'name') return (a.Player?.displayName ?? '').localeCompare(b.Player?.displayName ?? '');
      if (sort === 'rating') return (b.Player ? latestOverall(b.Player) ?? -1 : -1) - (a.Player ? latestOverall(a.Player) ?? -1 : -1);
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [shortlist, search, sort]);

  const renderItem = ({ item }: { item: ShortlistEntry }) => {
    const player = item.Player;

    if (item.unavailable || !player) {
      return (
        <View style={[styles.unavailable]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.unavailableTitle}>Athlete no longer available</Text>
            <Text style={styles.unavailableText}>They were removed, or their guardian's consent is no longer on record.</Text>
          </View>
          <TouchableOpacity onPress={() => removeEntry(item.id, 'this athlete')} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Remove unavailable athlete from shortlist">
            <Ionicons name="trash-outline" size={18} color={Colors.danger} />
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <ScoutPlayerRow
        player={player}
        onPress={() => router.push({ pathname: '/scout/player/[id]', params: { id: player.id } })}
        footer={
          <View style={styles.footer}>
            {item.notes ? <Text style={styles.noteText} numberOfLines={3}>“{item.notes}”</Text> : null}
            <View style={styles.footerActions}>
              <TouchableOpacity
                style={styles.footerBtn}
                onPress={() => { setNoteText(item.notes ?? ''); setNoteTarget(item); }}
                accessibilityRole="button"
                accessibilityLabel={`${item.notes ? 'Edit' : 'Add'} a note about ${player.displayName}`}
              >
                <Ionicons name="create-outline" size={15} color={Colors.secondary} />
                <Text style={styles.footerBtnText}>{item.notes ? 'Edit note' : 'Add note'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.footerBtn}
                onPress={() => removeEntry(item.id, player.displayName)}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${player.displayName} from shortlist`}
              >
                <Ionicons name="star" size={15} color={Colors.danger} />
                <Text style={[styles.footerBtnText, { color: Colors.danger }]}>Remove</Text>
              </TouchableOpacity>
            </View>
          </View>
        }
      />
    );
  };

  if (notApproved) {
    return (
      <SafeAreaView style={styles.container}>
        <ScoutAccreditationPanel onApproved={() => { setNotApproved(false); setLoading(true); fetchShortlist().finally(() => setLoading(false)); }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.header}>My Shortlist</Text>
      {shortlist.length > 0 && <Text style={styles.count}>{shortlist.length} athlete{shortlist.length === 1 ? '' : 's'} saved</Text>}

      {shortlist.length > 1 && (
        <>
          <View style={styles.searchContainer}>
            <Ionicons name="search" size={18} color="#9CA3AF" style={{ marginRight: 8 }} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search name, position, club or note..."
              placeholderTextColor="#9CA3AF"
              value={search}
              onChangeText={setSearch}
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch('')} accessibilityRole="button" accessibilityLabel="Clear search">
                <Ionicons name="close-circle" size={18} color="#9CA3AF" />
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.sortRow}>
            {SORTS.map((option) => (
              <TouchableOpacity
                key={option.key}
                style={[styles.sortChip, sort === option.key && styles.sortChipActive]}
                onPress={() => setSort(option.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: sort === option.key }}
              >
                <Text style={[styles.sortChipText, sort === option.key && styles.sortChipTextActive]}>{option.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      {loading && shortlist.length === 0 ? (
        <ActivityIndicator style={{ marginTop: 40 }} size="large" color={Colors.secondary} />
      ) : (
        <FlatList
          data={visibleEntries}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 30 }}
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
            ) : shortlist.length > 0 ? (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>No match</Text>
                <Text style={styles.emptySubtext}>Nobody on your shortlist matches "{search.trim()}".</Text>
              </View>
            ) : (
              <View style={styles.emptyContainer}>
                <Ionicons name="star-outline" size={40} color="#9CA3AF" />
                <Text style={styles.emptyText}>Your shortlist is empty</Text>
                <Text style={styles.emptySubtext}>Open an athlete on Discover and tap "Add to Shortlist" to keep track of them here.</Text>
              </View>
            )
          }
        />
      )}

      <FormSheet
        visible={noteTarget !== null}
        title={`Note about ${noteTarget?.Player?.displayName ?? 'this athlete'}`}
        saveLabel="Save note"
        saving={savingNote}
        onCancel={() => setNoteTarget(null)}
        onSave={saveNote}
      >
        <Text style={formStyles.label}>Only you can see this note</Text>
        <TextInput
          style={[formStyles.input, { height: 110, textAlignVertical: 'top' }]}
          value={noteText}
          onChangeText={setNoteText}
          multiline
          maxLength={500}
          placeholder="e.g. Strong left foot. Watch again in March."
          placeholderTextColor="#9CA3AF"
        />
      </FormSheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.canvas, paddingHorizontal: 15 },
  header: { fontSize: 24, fontWeight: 'bold', textAlign: 'center', marginTop: 15, marginBottom: 4, color: Colors.textPrimary },
  count: { fontSize: 12, color: Colors.textSecondary, textAlign: 'center', marginBottom: 12 },
  searchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, marginBottom: 10 },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 14, color: Colors.textPrimary },
  sortRow: { flexDirection: 'row', gap: 6, marginBottom: 12 },
  sortChip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, backgroundColor: '#FFF', borderWidth: 1, borderColor: Colors.border },
  sortChipActive: { backgroundColor: Colors.secondary, borderColor: Colors.secondary },
  sortChipText: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  sortChipTextActive: { color: '#FFF' },
  footer: { borderTopWidth: 1, borderTopColor: '#F3F4F6', paddingHorizontal: 12, paddingVertical: 8 },
  noteText: { fontSize: 13, color: Colors.textPrimary, fontStyle: 'italic', lineHeight: 18, marginBottom: 6 },
  footerActions: { flexDirection: 'row', justifyContent: 'space-between' },
  footerBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4 },
  footerBtnText: { fontSize: 12, fontWeight: 'bold', color: Colors.secondary },
  unavailable: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F3F4F6', borderRadius: 14, padding: 14, marginBottom: 10 },
  unavailableTitle: { fontSize: 15, fontWeight: 'bold', color: Colors.textPrimary },
  unavailableText: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  iconBtn: { padding: 8 },
  emptyContainer: { alignItems: 'center', marginTop: 60, paddingHorizontal: 20, gap: 8 },
  emptyText: { fontSize: 18, fontWeight: 'bold', color: '#555' },
  emptySubtext: { fontSize: 14, color: '#888', textAlign: 'center' },
  retryBtn: { marginTop: 14, backgroundColor: Colors.secondary, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 8 },
  retryText: { color: '#fff', fontWeight: 'bold' },
});
