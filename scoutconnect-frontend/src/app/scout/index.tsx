// src/app/scout/index.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { View, Text, FlatList, StyleSheet, TextInput, TouchableOpacity, RefreshControl, ActivityIndicator, Modal, ScrollView, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiFetch } from '../../lib/api';
import ScoutPlayerRow from '../../components/ScoutPlayerRow';
import ScoutAccreditationPanel from '../../components/ScoutAccreditationPanel';
import { PlayerProspect } from '../../lib/scoutPlayer';
import {
  AGE_BANDS, BALL_CONTROL_STEPS, DEFAULT_FILTERS, DiscoverFilters, OVERALL_STEPS, RECENCY_STEPS, SORTS, SPRINT_STEPS,
  activeChips, needsClientFilter, passesClientFilters, serverQuery,
} from '../../lib/discoverFilters';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/designSystem';

const PAGE_SIZE = 10;

const POSITIONS = ['All', 'Goalkeeper', 'Defender', 'Midfielder', 'Forward', 'Other'];
const EVAL_TYPES = ['All', 'Checklist', 'Combine', 'Match'];

/** A row of single-choice chips. */
function ChipGroup<T extends string | number | null>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (value: T) => void }) {
  return (
    <View style={styles.dropdownGrid}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <TouchableOpacity
            key={option.label}
            style={[styles.dropdownOption, selected && styles.dropdownOptionActive]}
            onPress={() => onChange(option.value)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
          >
            <Text style={[styles.dropdownOptionText, selected && styles.dropdownOptionTextActive]}>{option.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function ScoutDiscoverScreen() {
  const [players, setPlayers] = useState<PlayerProspect[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<DiscoverFilters>(DEFAULT_FILTERS);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [notApproved, setNotApproved] = useState(false); // scout has not been accredited yet
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalItems, setTotalItems] = useState(0);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const requestId = useRef(0); // ignores responses that arrive after a newer request was made

  const update = (patch: Partial<DiscoverFilters>) => setFilters((prev) => ({ ...prev, ...patch }));

  // Search on the server after a short pause, instead of only among the athletes already on screen.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 400);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Everything the server understands; the rating and test filters are applied on the phone below.
  const query = serverQuery(filters, debouncedSearch);

  useEffect(() => {
    setLoading(true);
    fetchPlayers(1, true).finally(() => setLoading(false));
  }, [query]);

  const fetchPlayers = async (pageNum: number, reset: boolean = false) => {
    const id = ++requestId.current;
    try {
      const data = await apiFetch(`/players?page=${pageNum}&limit=${PAGE_SIZE}${query ? `&${query}` : ''}`);
      if (id !== requestId.current) return;
      const list = Array.isArray(data) ? data : data?.players;
      if (!Array.isArray(list)) throw new Error('Unexpected response from the server.');

      setPlayers((prev) => (reset || pageNum === 1 ? list : [...prev, ...list]));
      setTotalPages(data.totalPages || 1);
      setTotalItems(data.totalItems ?? list.length);
      setPage(pageNum);
      setError(null);
      setNotApproved(false);
    } catch (e: any) {
      if (id !== requestId.current) return;
      if (e?.code === 'SCOUT_NOT_APPROVED') {
        setNotApproved(true);
        return;
      }
      setError(e?.message || 'Could not load athletes.');
    } finally {
      setLoadingMore(false);
    }
  };

  // Quietly refresh when returning to this tab; the first focus is already covered by the filter effect.
  const fetchPlayersRef = useRef(fetchPlayers);
  fetchPlayersRef.current = fetchPlayers;
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      fetchPlayersRef.current(1, true);
    }, [])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchPlayers(1, true);
    setRefreshing(false);
  };

  const filteredPlayers = useMemo(() => players.filter((p) => passesClientFilters(p, filters)), [players, filters]);

  // The rating and test filters run on the phone, and athletes without an evaluation are hidden, so one page can show nobody:
  // keep loading pages until a few show or there are no more.
  useEffect(() => {
    if (filteredPlayers.length < 3 && page < totalPages && !loading && !loadingMore && !error) {
      setLoadingMore(true);
      fetchPlayers(page + 1);
    }
  }, [players, filters, page, totalPages, loading]);

  const chips = activeChips(filters);
  const clientFiltering = needsClientFilter(filters);

  const renderPlayer = ({ item }: { item: PlayerProspect }) => (
    <ScoutPlayerRow player={item} onPress={() => router.push({ pathname: '/scout/player/[id]', params: { id: item.id } })} />
  );

  if (notApproved) {
    return (
      <SafeAreaView style={styles.container}>
        <ScoutAccreditationPanel
          onApproved={() => {
            setNotApproved(false);
            setLoading(true);
            fetchPlayers(1, true).finally(() => setLoading(false));
          }}
        />
      </SafeAreaView>
    );
  }

  const summary = loading
    ? 'Loading athletes…'
    : clientFiltering
      ? `${filteredPlayers.length} match${filteredPlayers.length === 1 ? '' : 'es'} so far${page < totalPages ? ' · scroll for more' : ''}`
      : `${totalItems} athlete${totalItems === 1 ? '' : 's'}${chips.length > 0 || debouncedSearch ? ' match your search' : ' available'}`;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBanner}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="people-outline" size={14} color={Colors.warningText} />
          <Text style={styles.topBannerText}>{summary}</Text>
        </View>
      </View>

      <Text style={styles.header}>Talent Discover</Text>

      <View style={styles.searchFilterToolbar}>
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={18} color="#9CA3AF" style={{ marginRight: 8 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by prospect name..."
            placeholderTextColor="#9CA3AF"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} accessibilityRole="button" accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={18} color="#9CA3AF" />
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity
          style={[styles.filterToggleBtn, chips.length > 0 && styles.filterToggleBtnActive]}
          onPress={() => setShowFilterModal(true)}
          accessibilityRole="button"
          accessibilityLabel={chips.length > 0 ? `Open filters, ${chips.length} active` : 'Open filters'}
        >
          <Ionicons name="options-outline" size={18} color={chips.length > 0 ? '#FFF' : Colors.secondary} />
          {chips.length > 0 && (
            <View style={styles.filterBadge}>
              <Text style={styles.filterBadgeText}>{chips.length}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {chips.length > 0 && (
        <View style={styles.chipsWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
            {chips.map((chip) => (
              <TouchableOpacity key={chip.key} style={styles.activeChip} onPress={() => update(chip.reset)} accessibilityRole="button" accessibilityLabel={`Remove filter ${chip.label}`}>
                <Text style={styles.activeChipText}>{chip.label}</Text>
                <Ionicons name="close" size={13} color={Colors.secondary} />
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.clearAll} onPress={() => setFilters({ ...DEFAULT_FILTERS, sort: filters.sort })} accessibilityRole="button">
              <Text style={styles.clearAllText}>Clear all</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      )}

      <FlatList
        data={filteredPlayers}
        keyExtractor={(item) => item.id}
        renderItem={renderPlayer}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        onEndReached={() => {
          if (page < totalPages && !loadingMore && !loading && !error) {
            setLoadingMore(true);
            fetchPlayers(page + 1);
          }
        }}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={{ marginTop: 40 }} size="large" color={Colors.secondary} />
          ) : error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorTitle}>Couldn't load athletes</Text>
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={onRefresh} accessibilityRole="button">
                <Text style={styles.retryText}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : loadingMore ? null : (
            <View style={styles.errorBox}>
              <Text style={styles.empty}>No athletes match your search and filters.</Text>
              {chips.length > 0 && (
                <TouchableOpacity style={styles.retryBtn} onPress={() => setFilters({ ...DEFAULT_FILTERS, sort: filters.sort })} accessibilityRole="button">
                  <Text style={styles.retryText}>Clear filters</Text>
                </TouchableOpacity>
              )}
            </View>
          )
        }
        ListFooterComponent={loadingMore ? <ActivityIndicator size="small" color={Colors.secondary} style={{ marginVertical: 15 }} /> : null}
      />

      <Modal visible={showFilterModal} animationType="slide" transparent={true} onRequestClose={() => setShowFilterModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Filter & sort</Text>
              <TouchableOpacity onPress={() => setShowFilterModal(false)} accessibilityRole="button" accessibilityLabel="Close filters">
                <Ionicons name="close" size={22} color={Colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 10 }}>
              <Text style={styles.filterLabel}>Sort by</Text>
              <ChipGroup options={SORTS.map((s) => ({ value: s.key, label: s.label }))} value={filters.sort} onChange={(sort) => update({ sort })} />

              <Text style={styles.sectionHeading}>The player</Text>
              <Text style={styles.filterLabel}>Position</Text>
              <ChipGroup options={POSITIONS.map((p) => ({ value: p, label: p }))} value={filters.position} onChange={(position) => update({ position })} />

              <Text style={styles.filterLabel}>Age</Text>
              <ChipGroup options={AGE_BANDS.map((b) => ({ value: b.key, label: b.label }))} value={filters.ageBand} onChange={(ageBand) => update({ ageBand })} />

              <View style={styles.switchRow}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={[styles.filterLabel, { marginTop: 0, marginBottom: 2 }]}>Verified clubs only</Text>
                  <Text style={styles.switchHint}>Only athletes whose club has been reviewed and verified by an administrator.</Text>
                </View>
                <Switch value={filters.verifiedOnly} onValueChange={(verifiedOnly) => update({ verifiedOnly })} trackColor={{ true: Colors.primary }} accessibilityLabel="Verified clubs only" />
              </View>

              <Text style={styles.sectionHeading}>Quality</Text>
              <Text style={styles.filterLabel}>Overall rating (OVR)</Text>
              <ChipGroup options={OVERALL_STEPS.map((n) => ({ value: n, label: n === 0 ? 'Any' : `${n}+` }))} value={filters.minOverall} onChange={(minOverall) => update({ minOverall })} />

              <Text style={styles.filterLabel}>Ball control (1-5)</Text>
              <ChipGroup options={BALL_CONTROL_STEPS.map((n) => ({ value: n, label: n === 0 ? 'Any' : `${n}+` }))} value={filters.minBallControl} onChange={(minBallControl) => update({ minBallControl })} />

              <Text style={styles.filterLabel}>30m sprint, at most</Text>
              <ChipGroup options={SPRINT_STEPS.map((n) => ({ value: n, label: n === null ? 'Any' : `${n}s` }))} value={filters.maxSprint} onChange={(maxSprint) => update({ maxSprint })} />

              <Text style={styles.sectionHeading}>Evidence</Text>
              <Text style={styles.filterLabel}>Evaluation type</Text>
              <ChipGroup options={EVAL_TYPES.map((t) => ({ value: t, label: t }))} value={filters.evalSource} onChange={(evalSource) => update({ evalSource })} />

              <Text style={styles.filterLabel}>Last evaluated</Text>
              <ChipGroup options={RECENCY_STEPS.map((n) => ({ value: n, label: n === null ? 'Any time' : `${n} days` }))} value={filters.evaluatedWithinDays} onChange={(evaluatedWithinDays) => update({ evaluatedWithinDays })} />

              <View style={styles.switchRow}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={[styles.filterLabel, { marginTop: 0, marginBottom: 2 }]}>Has match stats</Text>
                  <Text style={styles.switchHint}>Only athletes with at least one recorded match.</Text>
                </View>
                <Switch value={filters.hasMatches} onValueChange={(hasMatches) => update({ hasMatches })} trackColor={{ true: Colors.primary }} accessibilityLabel="Has match stats" />
              </View>

              {clientFiltering && (
                <Text style={styles.switchHint}>Rating, test, evaluation-date and match filters check the athletes loaded so far; scroll to load more.</Text>
              )}
            </ScrollView>

            <View style={styles.modalFooterRow}>
              <TouchableOpacity style={styles.modalResetBtn} onPress={() => setFilters({ ...DEFAULT_FILTERS, sort: filters.sort })}>
                <Text style={styles.modalResetText}>Reset filters</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalApplyBtn} onPress={() => setShowFilterModal(false)}>
                <Text style={styles.modalApplyText}>Show results</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.canvas, padding: 15 },
  topBanner: { backgroundColor: Colors.warningBg, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, marginBottom: 12 },
  topBannerText: { color: Colors.warningText, fontWeight: 'bold', fontSize: 11 },
  header: { fontSize: 24, fontWeight: 'bold', color: Colors.textPrimary, marginBottom: 10 },

  searchFilterToolbar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  searchContainer: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: Colors.border },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 14, color: Colors.textPrimary },
  filterToggleBtn: { width: 44, height: 44, borderRadius: 8, backgroundColor: '#FFF', borderWidth: 1, borderColor: Colors.border, justifyContent: 'center', alignItems: 'center' },
  filterToggleBtnActive: { backgroundColor: Colors.secondary, borderColor: Colors.secondary },
  filterBadge: { position: 'absolute', top: -4, right: -4, backgroundColor: Colors.primary, width: 16, height: 16, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  filterBadgeText: { color: '#FFF', fontSize: 9, fontWeight: 'bold' },

  chipsWrap: { marginBottom: 10, marginHorizontal: -15 },
  chipsRow: { paddingHorizontal: 15, gap: 6, alignItems: 'center' },
  activeChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 14, backgroundColor: Colors.secondaryLight, borderWidth: 1, borderColor: Colors.secondaryBorder },
  activeChipText: { fontSize: 12, fontWeight: '600', color: Colors.secondary },
  clearAll: { paddingVertical: 6, paddingHorizontal: 8 },
  clearAllText: { fontSize: 12, fontWeight: 'bold', color: Colors.textSecondary },

  empty: { textAlign: 'center', color: Colors.textSecondary, fontSize: 15 },
  errorBox: { alignItems: 'center', marginTop: 50, paddingHorizontal: 24 },
  errorTitle: { fontSize: 16, fontWeight: 'bold', color: Colors.textPrimary },
  errorText: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', marginTop: 6 },
  retryBtn: { marginTop: 14, backgroundColor: Colors.secondary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
  retryText: { color: '#fff', fontWeight: 'bold' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#FFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '88%' },
  modalHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: Colors.textPrimary },
  sectionHeading: { fontSize: 14, fontWeight: 'bold', color: Colors.textPrimary, marginTop: 22, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  switchRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14, paddingVertical: 10, borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#F3F4F6' },
  switchHint: { fontSize: 12, color: Colors.textSecondary, lineHeight: 17 },
  filterLabel: { fontSize: 12, fontWeight: 'bold', color: Colors.textSecondary, marginTop: 12, marginBottom: 6 },
  dropdownGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  dropdownOption: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6, backgroundColor: '#F3F4F6', borderWidth: 1, borderColor: Colors.border },
  dropdownOptionActive: { backgroundColor: Colors.secondary, borderColor: Colors.secondary },
  dropdownOptionText: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  dropdownOptionTextActive: { color: '#FFF' },
  modalFooterRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  modalResetBtn: { flex: 1, padding: 12, backgroundColor: '#E5E7EB', borderRadius: 8, alignItems: 'center' },
  modalResetText: { color: Colors.textPrimary, fontWeight: 'bold', fontSize: 14 },
  modalApplyBtn: { flex: 1.4, padding: 12, backgroundColor: Colors.secondary, borderRadius: 8, alignItems: 'center' },
  modalApplyText: { color: '#FFF', fontWeight: 'bold', fontSize: 14 },
});
