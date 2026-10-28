import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl, TouchableOpacity, TextInput, ActivityIndicator, Modal, ScrollView } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch, ApiError } from '../../lib/api';
import { POSITION_CATEGORIES } from '../../constants/positions';
import EditAthleteModal from '../../components/EditAthleteModal';
import { confirmRemoveAthlete } from '../../lib/roster';
import { consentBadge } from '../../lib/consent';

interface MatchStat { id: string; goals: number; assists: number; }
interface Achievement { id: string; }
interface Player {
  id: string;
  name: string;
  position: string;
  dateOfBirth: string;
  consentStatus?: string | null;
  consentGuardian?: string | null;
  consentGraceUntil?: string | null;
  MatchStats?: MatchStat[];
  Achievements?: Achievement[];
}

interface PositionFilter { label: string; positions: string[]; }
const ALL_POSITIONS_LABEL = 'All positions';
const PAGE_SIZE = 20;

const CONSENT_COLORS = {
  ok: { bg: '#D1FAE5', fg: '#047857', icon: 'checkmark-circle' },
  warn: { bg: '#FEF3C7', fg: '#B45309', icon: 'time-outline' },
  bad: { bg: '#FEE2E2', fg: '#B91C1C', icon: 'eye-off-outline' },
} as const;


export default function MyPlayersScreen() {
  const [roster, setRoster] = useState<Player[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [needsConsent, setNeedsConsent] = useState(0); // athletes without guardian consent (whole club)
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filter, setFilter] = useState<PositionFilter | null>(null);
  const [showFilter, setShowFilter] = useState(false);

  const [editingPlayer, setEditingPlayer] = useState<Player | null>(null);
  const router = useRouter();
  const requestId = useRef(0); // ignores responses that arrive after a newer request was made

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 400);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchPage = async (pageNumber: number) => {
    const id = ++requestId.current;
    const params = new URLSearchParams({ page: String(pageNumber), limit: String(PAGE_SIZE) });
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (filter) params.set('positions', filter.positions.join(','));

    try {
      const data = await apiFetch(`/club/players?${params.toString()}`);
      if (id !== requestId.current) return;

      // An older deployed server returns the whole roster as a bare array; the current one returns a page object.
      const legacy = Array.isArray(data);
      const players: Player[] | undefined = legacy ? data : data?.players;
      if (!Array.isArray(players)) throw new Error('Unexpected response from the server. Please update the backend and try again.');
      const visible = legacy
        ? players.filter((p) => (!debouncedSearch || p.name.toLowerCase().includes(debouncedSearch.toLowerCase())) && (!filter || filter.positions.includes(p.position)))
        : players;

      setRoster((prev) => (pageNumber === 1 ? visible : [...(prev ?? []), ...visible]));
      setPage(legacy ? 1 : data.currentPage);
      setTotalPages(legacy ? 1 : data.totalPages);
      setTotalItems(legacy ? visible.length : data.totalItems);
      setNeedsConsent(legacy ? 0 : data.needsConsent ?? 0);
      setError(null);
    } catch (e) {
      if (id !== requestId.current) return;
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'Could not load your roster.');
    }
  };

  // Runs on focus and whenever the search or filter changes.
  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      fetchPage(1).finally(() => setLoading(false));
    }, [debouncedSearch, filter])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchPage(1);
    setRefreshing(false);
  };

  const loadMore = async () => {
    if (loading || loadingMore || refreshing || page >= totalPages) return;
    setLoadingMore(true);
    await fetchPage(page + 1);
    setLoadingMore(false);
  };

  const renderPlayer = ({ item }: { item: Player }) => {
    const totalGoals = item.MatchStats?.reduce((sum, stat) => sum + stat.goals, 0) || 0;
    const totalAssists = item.MatchStats?.reduce((sum, stat) => sum + stat.assists, 0) || 0;
    const totalTrophies = item.Achievements?.length || 0;

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => router.push(`/coach/player/${item.id}`)}
        accessibilityRole="button"
        accessibilityLabel={`Open ${item.name}, ${item.position}`}
      >
        <View style={styles.cardHeader}>
          <Text style={styles.name}>{item.name}</Text>
          <Text style={styles.positionBadge}>{item.position}</Text>
        </View>
        <Text style={styles.dob}>DOB: {item.dateOfBirth}</Text>
        {(() => {
          const badge = consentBadge(item);
          const color = CONSENT_COLORS[badge.tone];
          return (
            <TouchableOpacity
              style={[styles.consentPill, { backgroundColor: color.bg }]}
              onPress={() => setEditingPlayer(item)}
              accessibilityRole="button"
              accessibilityLabel={`${badge.label}. Tap to edit consent.`}
            >
              <Ionicons name={color.icon} size={14} color={color.fg} />
              <Text style={[styles.consentPillText, { color: color.fg }]}>{badge.label}</Text>
            </TouchableOpacity>
          );
        })()}

        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Goals</Text>
            <Text style={styles.statValue}>{totalGoals}</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Assists</Text>
            <Text style={styles.statValue}>{totalAssists}</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Medals</Text>
            <Text style={styles.statValue}>{totalTrophies}</Text>
          </View>
        </View>

        <View style={styles.actionsRow}>
          <TouchableOpacity style={styles.actionBtn} onPress={() => setEditingPlayer(item)} accessibilityRole="button" accessibilityLabel={`Edit ${item.name}`}>
            <Ionicons name="create-outline" size={16} color="#2E8B57" />
            <Text style={styles.actionText}>Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => confirmRemoveAthlete(item, () => {
              setRoster((prev) => prev.filter((p) => p.id !== item.id));
              setTotalItems((n) => Math.max(0, n - 1));
            })}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${item.name} from roster`}
          >
            <Ionicons name="trash-outline" size={16} color="#B91C1C" />
            <Text style={[styles.actionText, { color: '#B91C1C' }]}>Remove</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  const filtering = !!debouncedSearch || !!filter;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.header}>My Roster</Text>
        {!loading && !error && <Text style={styles.count}>{totalItems} athlete{totalItems === 1 ? '' : 's'}{filtering ? ' found' : ''}</Text>}
      </View>

      {needsConsent > 0 && (
        <View style={styles.consentBanner} accessibilityRole="alert">
          <Ionicons name="shield-checkmark-outline" size={16} color="#B45309" />
          <Text style={styles.consentBannerText}>
            {needsConsent} athlete{needsConsent === 1 ? ' needs' : 's need'} parent or guardian consent before scouts can see {needsConsent === 1 ? 'them' : 'them'}. Open an athlete's Edit screen to record it.
          </Text>
        </View>
      )}

      <View style={styles.searchBox}>
        <Ionicons name="search-outline" size={16} color="#888" />
        <TextInput
          style={styles.searchInput}
          placeholder="Search athletes by name"
          placeholderTextColor="#9CA3AF"
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          accessibilityLabel="Search athletes by name"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')} accessibilityRole="button" accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={16} color="#888" />
          </TouchableOpacity>
        )}
      </View>

      <TouchableOpacity
        style={styles.dropdown}
        onPress={() => setShowFilter(true)}
        accessibilityRole="button"
        accessibilityLabel={`Filter by position. Current: ${filter?.label ?? ALL_POSITIONS_LABEL}`}
      >
        <Ionicons name="funnel-outline" size={16} color="#2E8B57" />
        <Text style={styles.dropdownText} numberOfLines={1}>{filter?.label ?? ALL_POSITIONS_LABEL}</Text>
        <Ionicons name="chevron-down" size={16} color="#888" />
      </TouchableOpacity>

      {loading && roster.length === 0 ? (
        <ActivityIndicator style={{ marginTop: 40 }} size="large" color="#2E8B57" />
      ) : (
        <FlatList
          data={roster}
          keyExtractor={(item) => item.id}
          renderItem={renderPlayer}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={loadingMore ? <ActivityIndicator style={{ marginVertical: 16 }} color="#2E8B57" /> : null}
          ListEmptyComponent={
            error ? (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>Couldn't load your roster</Text>
                <Text style={styles.emptySubtext}>{error}</Text>
                <TouchableOpacity style={styles.retryBtn} onPress={onRefresh} accessibilityRole="button">
                  <Text style={styles.retryText}>Try again</Text>
                </TouchableOpacity>
              </View>
            ) : filtering ? (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>No athletes match</Text>
                <Text style={styles.emptySubtext}>Try a different name or position filter.</Text>
              </View>
            ) : (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>Your roster is empty.</Text>
                <Text style={styles.emptySubtext}>Log offline evaluations and sync to see players here.</Text>
              </View>
            )
          }
        />
      )}

      <Modal visible={showFilter} animationType="fade" transparent onRequestClose={() => setShowFilter(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Filter by position</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              <TouchableOpacity
                style={styles.option}
                onPress={() => { setFilter(null); setShowFilter(false); }}
                accessibilityRole="button"
                accessibilityState={{ selected: !filter }}
              >
                <Text style={[styles.optionText, !filter && styles.optionTextActive]}>{ALL_POSITIONS_LABEL}</Text>
                {!filter && <Ionicons name="checkmark" size={18} color="#2E8B57" />}
              </TouchableOpacity>
              {Object.entries(POSITION_CATEGORIES).map(([category, positions]) => (
                <View key={category}>
                  <Text style={styles.groupHeader}>{category.toUpperCase()}</Text>
                  {[{ label: `All ${category}s`, positions }, ...positions.map((p) => ({ label: p, positions: [p] }))]
                    .filter((option, index) => index > 0 || positions.length > 1) // a lone position needs no "All" row
                    .map((option) => {
                      const active = filter?.label === option.label;
                      return (
                        <TouchableOpacity
                          key={option.label}
                          style={styles.option}
                          onPress={() => { setFilter(option); setShowFilter(false); }}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                        >
                          <Text style={[styles.optionText, active && styles.optionTextActive]}>{option.label}</Text>
                          {active && <Ionicons name="checkmark" size={18} color="#2E8B57" />}
                        </TouchableOpacity>
                      );
                    })}
                </View>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.closeBtn} onPress={() => setShowFilter(false)} accessibilityRole="button">
              <Text style={styles.closeText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <EditAthleteModal
        athlete={editingPlayer}
        onClose={() => setEditingPlayer(null)}
        onSaved={(updated) => {
          setRoster((prev) => prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)));
          setEditingPlayer(null);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f4f4', padding: 15 },
  headerRow: { alignItems: 'center', marginBottom: 12, marginTop: 10 },
  header: { fontSize: 24, fontWeight: 'bold', color: '#333' },
  count: { fontSize: 12, color: '#888', marginTop: 2 },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: '#E5E7EB', marginBottom: 10 },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 14, color: '#111' },
  dropdown: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, borderWidth: 1, borderColor: '#E5E7EB', marginBottom: 12 },
  dropdownText: { flex: 1, fontSize: 14, fontWeight: '600', color: '#111' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
  modalContent: { backgroundColor: '#fff', borderRadius: 16, padding: 16 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#111', marginBottom: 8 },
  groupHeader: { fontSize: 11, fontWeight: 'bold', color: '#888', marginTop: 12, marginBottom: 2 },
  option: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  optionText: { fontSize: 15, color: '#333' },
  optionTextActive: { fontWeight: 'bold', color: '#2E8B57' },
  closeBtn: { marginTop: 12, alignItems: 'center', paddingVertical: 12, borderRadius: 10, backgroundColor: '#E5E7EB' },
  closeText: { fontWeight: 'bold', color: '#333' },
  card: { backgroundColor: '#fff', padding: 15, borderRadius: 10, marginBottom: 15, elevation: 2, borderLeftWidth: 5, borderLeftColor: '#2E8B57' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 18, fontWeight: 'bold', color: '#111', flexShrink: 1, marginRight: 8 },
  positionBadge: { backgroundColor: '#eef5fe', color: '#0056b3', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, fontSize: 12, fontWeight: 'bold', overflow: 'hidden' },
  consentPill: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, marginBottom: 12 },
  consentPillText: { fontSize: 11, fontWeight: 'bold', flexShrink: 1 },
  consentBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#FEF3C7', padding: 12, borderRadius: 8, marginBottom: 10 },
  consentBannerText: { flex: 1, fontSize: 12, color: '#92400E', lineHeight: 17 },
  dob: { fontSize: 13, color: '#666', marginTop: 4, marginBottom: 15 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 15 },
  statBox: { alignItems: 'center', flex: 1 },
  statLabel: { fontSize: 12, color: '#888', fontWeight: '600' },
  statValue: { fontSize: 18, color: '#2E8B57', fontWeight: 'bold', marginTop: 4 },
  actionsRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 16, borderTopWidth: 1, borderTopColor: '#eee', marginTop: 12, paddingTop: 10 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 6 },
  actionText: { fontSize: 13, fontWeight: 'bold', color: '#2E8B57' },
  emptyContainer: { alignItems: 'center', marginTop: 50 },
  emptyText: { fontSize: 18, fontWeight: 'bold', color: '#555', marginBottom: 8 },
  emptySubtext: { fontSize: 14, color: '#888', textAlign: 'center', paddingHorizontal: 20 },
  retryBtn: { marginTop: 14, backgroundColor: '#2E8B57', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 8 },
  retryText: { color: '#fff', fontWeight: 'bold' },
});
