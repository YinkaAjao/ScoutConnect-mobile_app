// src/app/scout/index.tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { View, Text, FlatList, StyleSheet, TextInput, TouchableOpacity, RefreshControl, ActivityIndicator, Modal, ScrollView, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiFetch } from '../../lib/api';
import ScoutPlayerRow from '../../components/ScoutPlayerRow';
import ScoutAccreditationPanel from '../../components/ScoutAccreditationPanel';
import { PlayerProspect } from '../../lib/scoutPlayer';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/designSystem';
import { positionQueryFor } from '../../constants/positions';

const PAGE_SIZE = 10;

const POSITIONS = ['All', 'Goalkeeper', 'Defender', 'Midfielder', 'Forward', 'Other'];
const EVAL_TYPES = ['All', 'Checklist', 'Combine', 'Match'];
const AGE_GROUPS: { label: string; under: number | null }[] = [
  { label: 'Any', under: null },
  { label: 'U13', under: 13 },
  { label: 'U15', under: 15 },
  { label: 'U17', under: 17 },
  { label: 'U19', under: 19 },
];

export default function ScoutDiscoverScreen() {
  const [players, setPlayers] = useState<PlayerProspect[]>([]);
  const [page, setPage] = useState(1); 
  const [totalPages, setTotalPages] = useState(1); 
  const [searchQuery, setSearchQuery] = useState('');
  
  // Advanced Attribute Filters Modal State
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [selectedPosition, setSelectedPosition] = useState('All');
  const [selectedEvalSource, setSelectedEvalSource] = useState('All');
  const [minDribbling, setMinDribbling] = useState('0'); // 1-5 scale
  const [maxSprint, setMaxSprint] = useState('10');     // 30m sprint time seconds
  const [verifiedOnly, setVerifiedOnly] = useState(false); // only athletes from admin-verified clubs
  const [ageGroup, setAgeGroup] = useState<number | null>(null); // "under N"
  const [notApproved, setNotApproved] = useState(false); // scout has not been accredited yet
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalItems, setTotalItems] = useState(0);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const requestId = useRef(0); // ignores responses that arrive after a newer request was made

  // Search on the server after a short pause, instead of only among the athletes already on screen.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 400);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    setLoading(true);
    fetchPlayers(1, true).finally(() => setLoading(false));
  }, [selectedPosition, selectedEvalSource, verifiedOnly, ageGroup, debouncedSearch]);

  const fetchPlayers = async (pageNum: number, reset: boolean = false) => {
    const id = ++requestId.current;
    let query = `page=${pageNum}&limit=${PAGE_SIZE}`;
    if (debouncedSearch) query += `&search=${encodeURIComponent(debouncedSearch)}`;
    const positionQuery = positionQueryFor(selectedPosition);
    if (positionQuery) query += `&${positionQuery}`;
    if (selectedEvalSource !== 'All') query += `&evalType=${encodeURIComponent(selectedEvalSource)}`;
    if (verifiedOnly) query += '&verifiedOnly=true';
    if (ageGroup) query += `&under=${ageGroup}`;

    try {
      const data = await apiFetch(`/players?${query}`);
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

  // Advanced client-side attribute filtering (Name, Dribbling threshold, Sprint threshold)
  const filteredPlayers = players.filter(p => {
    if (!p.Evaluations || p.Evaluations.length === 0) return false;
    const latestEval = p.Evaluations[p.Evaluations.length - 1];

    // Minimum Dribbling / Ball Control Filter (1-5)
    const minDribNum = parseFloat(minDribbling) || 0;
    if (minDribNum > 0 && (latestEval.dribblingScore || 0) < minDribNum) {
      return false;
    }

    // Maximum Sprint Speed Filter (lower seconds = faster)
    const maxSprintNum = parseFloat(maxSprint) || 10;
    if (maxSprintNum < 10 && (latestEval.sprintSpeed || 99) > maxSprintNum) {
      return false;
    }

    return true;
  });

  // The score filters run on the phone, and athletes without an evaluation are hidden, so one page can show nobody:
  // keep loading pages until a few show or there are no more.
  useEffect(() => {
    if (filteredPlayers.length < 3 && page < totalPages && !loading && !loadingMore && !error) {
      setLoadingMore(true);
      fetchPlayers(page + 1);
    }
  }, [players, minDribbling, maxSprint, page, totalPages, loading]);

  const activeFiltersCount = (selectedPosition !== 'All' ? 1 : 0) + 
                             (selectedEvalSource !== 'All' ? 1 : 0) + 
                             (parseFloat(minDribbling) > 0 ? 1 : 0) + 
                             (parseFloat(maxSprint) < 10 ? 1 : 0) +
                             (verifiedOnly ? 1 : 0) +
                             (ageGroup ? 1 : 0);

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

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBanner}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="people-outline" size={14} color={Colors.warningText} />
          <Text style={styles.topBannerText}>
            {loading ? 'Loading athletes…' : `${totalItems} athlete${totalItems === 1 ? '' : 's'}${activeFiltersCount > 0 || debouncedSearch ? ' match your search' : ' available'}`}
          </Text>
        </View>
      </View>

      <Text style={styles.header}>Talent Discover</Text>

      {/* Search & Advanced Filter Toggle Bar */}
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
          style={[styles.filterToggleBtn, activeFiltersCount > 0 && styles.filterToggleBtnActive]} 
          onPress={() => setShowFilterModal(true)}
          accessibilityRole="button"
          accessibilityLabel={activeFiltersCount > 0 ? `Open filters, ${activeFiltersCount} active` : 'Open filters'}
        >
          <Ionicons name="options-outline" size={18} color={activeFiltersCount > 0 ? '#FFF' : Colors.secondary} />
          {activeFiltersCount > 0 && (
            <View style={styles.filterBadge}>
              <Text style={styles.filterBadgeText}>{activeFiltersCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

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
          ) : (
            <Text style={styles.empty}>No athletes found matching your search and filters.</Text>
          )
        }
        ListFooterComponent={loadingMore ? <ActivityIndicator size="small" color={Colors.secondary} style={{ marginVertical: 15 }} /> : null}
      />

      {/* Advanced Attribute Filter Modal */}
      <Modal visible={showFilterModal} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Advanced Attribute Filters</Text>
              <TouchableOpacity onPress={() => setShowFilterModal(false)}>
                <Ionicons name="close" size={22} color={Colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 10 }}>
              <Text style={styles.filterLabel}>Position</Text>
              <View style={styles.dropdownGrid}>
                {POSITIONS.map(pos => (
                  <TouchableOpacity
                    key={pos}
                    style={[styles.dropdownOption, selectedPosition === pos && styles.dropdownOptionActive]}
                    onPress={() => setSelectedPosition(pos)}
                  >
                    <Text style={[styles.dropdownOptionText, selectedPosition === pos && styles.dropdownOptionTextActive]}>{pos}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.filterLabel}>Evaluation Source</Text>
              <View style={styles.dropdownGrid}>
                {EVAL_TYPES.map(src => (
                  <TouchableOpacity
                    key={src}
                    style={[styles.dropdownOption, selectedEvalSource === src && styles.dropdownOptionActive]}
                    onPress={() => setSelectedEvalSource(src)}
                  >
                    <Text style={[styles.dropdownOptionText, selectedEvalSource === src && styles.dropdownOptionTextActive]}>{src}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.filterLabel}>Age group</Text>
              <View style={styles.dropdownGrid}>
                {AGE_GROUPS.map((group) => (
                  <TouchableOpacity
                    key={group.label}
                    style={[styles.dropdownOption, ageGroup === group.under && styles.dropdownOptionActive]}
                    onPress={() => setAgeGroup(group.under)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: ageGroup === group.under }}
                  >
                    <Text style={[styles.dropdownOptionText, ageGroup === group.under && styles.dropdownOptionTextActive]}>{group.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.switchRow}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={[styles.filterLabel, { marginTop: 0, marginBottom: 2 }]}>Verified clubs only</Text>
                  <Text style={styles.switchHint}>Only show athletes whose club has been reviewed and verified by an administrator.</Text>
                </View>
                <Switch value={verifiedOnly} onValueChange={setVerifiedOnly} trackColor={{ true: Colors.primary }} accessibilityLabel="Verified clubs only" />
              </View>

              <Text style={styles.filterLabel}>Minimum Dribbling / Ball Control Score (1 - 5)</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="e.g. 3 (leave 0 for any)"
                placeholderTextColor="#9CA3AF"
                keyboardType="number-pad"
                value={minDribbling}
                onChangeText={setMinDribbling}
              />

              <Text style={styles.filterLabel}>Maximum 30m Sprint Time (seconds)</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="e.g. 4.20 (leave 10 for any)"
                placeholderTextColor="#9CA3AF"
                keyboardType="decimal-pad"
                value={maxSprint}
                onChangeText={setMaxSprint}
              />

              <View style={styles.modalFooterRow}>
                <TouchableOpacity 
                  style={styles.modalResetBtn} 
                  onPress={() => {
                    setSelectedPosition('All');
                    setSelectedEvalSource('All');
                    setMinDribbling('0');
                    setMaxSprint('10');
                    setVerifiedOnly(false);
                    setAgeGroup(null);
                  }}
                >
                  <Text style={styles.modalResetText}>Reset All</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={styles.modalApplyBtn} 
                  onPress={() => setShowFilterModal(false)}
                >
                  <Text style={styles.modalApplyText}>Apply Filters</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
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
  liveBadge: { backgroundColor: Colors.secondary, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  liveBadgeText: { color: '#FFF', fontSize: 10, fontWeight: 'bold' },
  header: { fontSize: 24, fontWeight: 'bold', color: Colors.textPrimary, marginBottom: 10 },
  
  searchFilterToolbar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 15 },
  searchContainer: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: Colors.border },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 14, color: Colors.textPrimary },
  filterToggleBtn: { width: 44, height: 44, borderRadius: 8, backgroundColor: '#FFF', borderWidth: 1, borderColor: Colors.border, justifyContent: 'center', alignItems: 'center' },
  filterToggleBtnActive: { backgroundColor: Colors.secondary, borderColor: Colors.secondary },
  filterBadge: { position: 'absolute', top: -4, right: -4, backgroundColor: Colors.primary, width: 16, height: 16, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  filterBadgeText: { color: '#FFF', fontSize: 9, fontWeight: 'bold' },

  
  
  
  empty: { textAlign: 'center', marginTop: 50, color: Colors.textSecondary, fontSize: 15 },
  errorBox: { alignItems: 'center', marginTop: 50, paddingHorizontal: 24 },
  errorTitle: { fontSize: 16, fontWeight: 'bold', color: Colors.textPrimary },
  errorText: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', marginTop: 6 },
  retryBtn: { marginTop: 14, backgroundColor: Colors.secondary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
  retryText: { color: '#fff', fontWeight: 'bold' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#FFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '80%' },
  modalHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: Colors.textPrimary },
  switchRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14, paddingVertical: 10, borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#F3F4F6' },
  switchHint: { fontSize: 12, color: Colors.textSecondary, lineHeight: 17 },
  filterLabel: { fontSize: 12, fontWeight: 'bold', color: Colors.textSecondary, marginTop: 12, marginBottom: 6 },
  dropdownGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  dropdownOption: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6, backgroundColor: '#F3F4F6', borderWidth: 1, borderColor: Colors.border },
  dropdownOptionActive: { backgroundColor: Colors.secondary, borderColor: Colors.secondary },
  dropdownOptionText: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  dropdownOptionTextActive: { color: '#FFF' },
  modalInput: { backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, marginTop: 4 },
  modalFooterRow: { flexDirection: 'row', gap: 10, marginTop: 20 },
  modalResetBtn: { flex: 1, padding: 12, backgroundColor: '#E5E7EB', borderRadius: 8, alignItems: 'center' },
  modalResetText: { color: Colors.textPrimary, fontWeight: 'bold', fontSize: 14 },
  modalApplyBtn: { flex: 1, padding: 12, backgroundColor: Colors.secondary, borderRadius: 8, alignItems: 'center' },
  modalApplyText: { color: '#FFF', fontWeight: 'bold', fontSize: 14 }
});