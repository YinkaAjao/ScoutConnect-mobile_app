// src/app/scout/index.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, TextInput, TouchableOpacity, RefreshControl, Alert, Dimensions, Image, ActivityIndicator, Modal, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getAuthToken } from '../../lib/supabase';
import { LineChart, ProgressChart } from 'react-native-chart-kit';
import { Ionicons } from '@expo/vector-icons';
import { API_BASE, Colors, CardSpec } from '../../constants/designSystem';

interface Evaluation {
  id?: string;
  sprintSpeed: number;
  dribblingScore: number;
  workRate: string;
  evalType: string;
  checklistData?: {
    averages?: {
      technical: number;
      tactical: number;
      physical: number;
      psychological: number;
    };
  };
}

interface MatchStat {
  id: string;
  competition: string;
  opponent?: string;     
  matchResult?: string;  
  goals: number;
  assists: number;
  minutesPlayed: number;
}

interface Achievement {
  id: string;
  title: string;
  year: number;
}

interface PlayerProspect {
  id: string;
  name: string;
  position: string;
  age?: number;
  profilePhoto?: string;
  Evaluations?: Evaluation[];
  MatchStats?: MatchStat[];
  Achievements?: Achievement[];
  Club?: { 
    name: string; 
    contactEmail: string; 
    contactPhone: string; 
  }; 
}

const PLAYERS_API = `${API_BASE}/players`;
const SHORTLIST_API = `${API_BASE}/shortlist`;
const screenWidth = Dimensions.get('window').width - 60;

const POSITIONS = ['All', 'Goalkeeper', 'Defender', 'Midfielder', 'Forward', 'Other'];
const EVAL_TYPES = ['All', 'Checklist', 'Combine', 'Match'];

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

  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    fetchPlayers(1, true);
  }, [selectedPosition, selectedEvalSource]);

  const fetchPlayers = async (pageNum: number, reset: boolean = false) => {
    try {
      const token = await getAuthToken();
      let queryURL = `${PLAYERS_API}?page=${pageNum}&limit=5`;
      
      if (selectedPosition !== 'All') {
        queryURL += `&position=${selectedPosition}`;
      }
      if (selectedEvalSource !== 'All') {
        queryURL += `&evalType=${selectedEvalSource}`;
      }
      
      const response = await fetch(queryURL, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      const data = await response.json();
      
      if (response.ok) {
        const fetchedList = data.players || data;
        if (reset || pageNum === 1) {
          setPlayers(fetchedList); 
        } else {
          setPlayers(prev => [...prev, ...fetchedList]); 
        }
        setTotalPages(data.totalPages || 1);
        setPage(pageNum);
      }
    } catch (error) {
      console.error('Error fetching players:', error);
    } finally {
      setLoadingMore(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchPlayers(1, true);
    setRefreshing(false);
  };

  const handleShortlist = async (playerId: string, playerName: string) => {
    try {
      const token = await getAuthToken();
      const response = await fetch(SHORTLIST_API, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({ playerId, notes: 'Potential recruit from discover hub' })
      });

      const data = await response.json();
      if (response.ok) {
        Alert.alert('Success', `${playerName} has been added to your shortlist.`);
      } else {
        Alert.alert('Notice', data.error || 'Player already in shortlist.');
      }
    } catch (error) {
      Alert.alert('Error', 'Could not connect to shortlist service.');
    }
  };

  // Advanced client-side attribute filtering (Name, Dribbling threshold, Sprint threshold)
  const filteredPlayers = players.filter(p => {
    if (!p.Evaluations || p.Evaluations.length === 0) return false;
    const latestEval = p.Evaluations[p.Evaluations.length - 1];

    // Name / Position keyword search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchesName = p.name.toLowerCase().includes(q);
      const matchesPos = p.position.toLowerCase().includes(q);
      if (!matchesName && !matchesPos) return false;
    }

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

  const activeFiltersCount = (selectedPosition !== 'All' ? 1 : 0) + 
                             (selectedEvalSource !== 'All' ? 1 : 0) + 
                             (parseFloat(minDribbling) > 0 ? 1 : 0) + 
                             (parseFloat(maxSprint) < 10 ? 1 : 0);

  const renderPlayer = ({ item }: { item: PlayerProspect }) => {
    const latestEval = item.Evaluations![item.Evaluations!.length - 1];
    const avgs = latestEval.checklistData?.averages;
    const physicalScore = avgs?.physical ? avgs.physical / 4 : (latestEval.sprintSpeed ? Math.min(latestEval.sprintSpeed / 10, 1) : 0.5); 
    const techScore = avgs?.technical ? avgs.technical / 4 : (latestEval.dribblingScore ? latestEval.dribblingScore / 5 : 0.5);
    const tacScore = avgs?.tactical ? avgs.tactical / 4 : 0.8;
    
    const ringChartData = {
      labels: ["Physical", "Technical", "Tactical"],
      data: [physicalScore, techScore, tacScore] 
    };

    const historyLabels = item.Evaluations!.map((_, index) => `E${index + 1}`);
    const historyData = item.Evaluations!.map((ev: Evaluation) => ev.dribblingScore || 0);

    const lineChartData = {
      labels: historyLabels.length > 0 ? historyLabels : ['Start'],
      datasets: [{ data: historyData.length > 0 ? historyData : [0] }]
    };

    const ovrRating = Math.round(((techScore + physicalScore + tacScore) / 3) * 100);

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          {item.profilePhoto ? (
            <Image source={{ uri: item.profilePhoto }} style={styles.profileImage} />
          ) : (
            <View style={styles.imagePlaceholder}>
              <Text style={styles.imagePlaceholderText}>{item.name.charAt(0).toUpperCase()}</Text>
            </View>
          )}
          
          <View style={styles.headerInfo}>
            <Text style={styles.name}>{item.name}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
              <Ionicons name="football-outline" size={12} color={Colors.textSecondary} />
              <Text style={styles.detail}>{item.position || 'Forward (CF)'}</Text>
            </View>
          </View>

          <View style={styles.ovrBadge}>
            <Text style={styles.ovrLabel}>OVR</Text>
            <Text style={styles.ovrValue}>{ovrRating}</Text>
          </View>
        </View>
        
        <Text style={styles.sectionTitle}>Performance Telemetry Rings</Text>
        <ProgressChart
          data={ringChartData}
          width={screenWidth}
          height={110}
          strokeWidth={10}
          radius={22}
          chartConfig={chartConfig}
          hideLegend={false}
          style={styles.chart}
        />

        {historyData.length > 1 && (
          <>
            <Text style={styles.sectionTitle}>Technical Development Curve</Text>
            <LineChart
              data={lineChartData}
              width={screenWidth}
              height={160}
              chartConfig={chartConfig}
              bezier
              style={styles.chart}
            />
          </>
        )}

        {item.MatchStats && item.MatchStats.length > 0 && (
          <View style={styles.portfolioSection}>
            <Text style={styles.sectionTitle}>League Match Statistics</Text>
            {item.MatchStats.map((stat: MatchStat) => (
              <View key={stat.id} style={{ marginVertical: 3 }}>
                <Text style={styles.statLine}>
                  • {stat.competition} {stat.opponent ? `vs ${stat.opponent} (${stat.matchResult || 'W'})` : ''} 
                </Text>
                <Text style={styles.statSubLine}>
                  Goals: {stat.goals} | Assists: {stat.assists} ({stat.minutesPlayed} mins)
                </Text>
              </View>
            ))}
          </View>
        )}

        {item.Achievements && item.Achievements.length > 0 && (
          <View style={styles.portfolioSection}>
            <Text style={styles.sectionTitle}>Trophies & Medals</Text>
            {item.Achievements.map((ach: Achievement) => (
              <View key={ach.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginVertical: 2 }}>
                <Ionicons name="trophy-outline" size={14} color="#D97706" />
                <Text style={styles.statLine}>
                  {ach.title} ({ach.year})
                </Text>
              </View>
            ))}
          </View>
        )}

        {item.Club && (
          <View style={styles.contactSection}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 }}>
              <Ionicons name="shield-checkmark-outline" size={14} color={Colors.secondary} />
              <Text style={styles.contactTitle}>Verified Representative: {item.Club.name}</Text>
            </View>
            <Text style={styles.contactText}>Email: {item.Club.contactEmail || 'coach@academy.rw'}</Text>
            <Text style={styles.contactText}>Phone: {item.Club.contactPhone || '+250 788 000 000'}</Text>
          </View>
        )}

        <TouchableOpacity style={styles.shortlistBtn} onPress={() => handleShortlist(item.id, item.name)}>
          <Ionicons name="star" size={16} color="#FFF" style={{ marginRight: 6 }} />
          <Text style={styles.shortlistText}>Add to Shortlist</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Top Hub Banner */}
      <View style={styles.topBanner}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="flash" size={14} color={Colors.warningText} />
          <Text style={styles.topBannerText}>Synced Regional Feed • Kigali Hub</Text>
        </View>
        <View style={styles.liveBadge}>
          <Text style={styles.liveBadgeText}>LIVE</Text>
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
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={18} color="#9CA3AF" />
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity 
          style={[styles.filterToggleBtn, activeFiltersCount > 0 && styles.filterToggleBtnActive]} 
          onPress={() => setShowFilterModal(true)}
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
          if (page < totalPages && !loadingMore) {
            setLoadingMore(true);
            fetchPlayers(page + 1); 
          }
        }}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={<Text style={styles.empty}>No athletes found matching search criteria.</Text>}
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

              <Text style={styles.filterLabel}>Minimum Dribbling / Ball Control Score (1 - 5)</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="e.g. 3 (leave 0 for any)"
                placeholderTextColor="#9CA3AF"
                keyboardDataType="numeric"
                value={minDribbling}
                onChangeText={setMinDribbling}
              />

              <Text style={styles.filterLabel}>Maximum 30m Sprint Time (seconds)</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="e.g. 4.20 (leave 10 for any)"
                placeholderTextColor="#9CA3AF"
                keyboardDataType="numeric"
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

const chartConfig = {
  backgroundGradientFrom: '#fff',
  backgroundGradientTo: '#fff',
  color: (opacity = 1) => `rgba(0, 86, 179, ${opacity})`,
  labelColor: (opacity = 1) => `rgba(0, 0, 0, ${opacity})`,
  strokeWidth: 2,
  useShadowColorFromDataset: false,
  decimalPlaces: 1,
};

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

  card: { ...CardSpec, padding: 15, marginBottom: 20 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#F3F4F6', paddingBottom: 12, marginBottom: 12 },
  profileImage: { width: 55, height: 55, borderRadius: 27.5, marginRight: 12, backgroundColor: '#eee' },
  imagePlaceholder: { width: 55, height: 55, borderRadius: 27.5, backgroundColor: Colors.secondary, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  imagePlaceholderText: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  headerInfo: { flex: 1 },
  name: { fontSize: 18, fontWeight: 'bold', color: Colors.textPrimary },
  detail: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  ovrBadge: { backgroundColor: Colors.secondaryLight, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: Colors.secondaryBorder },
  ovrLabel: { fontSize: 9, fontWeight: 'bold', color: Colors.secondary },
  ovrValue: { fontSize: 14, fontWeight: 'bold', color: Colors.secondary },
  
  sectionTitle: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary, marginBottom: 8, marginTop: 10 },
  chart: { marginVertical: 4, borderRadius: 8, alignSelf: 'center' },
  portfolioSection: { marginTop: 12, padding: 10, backgroundColor: '#F9FAFB', borderRadius: 8, borderWidth: 1, borderColor: Colors.border },
  statLine: { fontSize: 13, fontWeight: '600', color: Colors.textPrimary },
  statSubLine: { fontSize: 12, color: Colors.textSecondary, marginTop: 1 },
  
  contactSection: { marginTop: 12, padding: 10, backgroundColor: Colors.secondaryLight, borderRadius: 8, borderWidth: 1, borderColor: Colors.secondaryBorder },
  contactTitle: { fontSize: 12, fontWeight: 'bold', color: Colors.secondary, marginBottom: 4 },
  contactText: { fontSize: 13, color: Colors.textPrimary, marginVertical: 1 },
  
  shortlistBtn: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.secondary, padding: 12, borderRadius: 8, marginTop: 15 },
  shortlistText: { color: '#FFF', fontWeight: 'bold', fontSize: 14 },
  empty: { textAlign: 'center', marginTop: 50, color: Colors.textSecondary, fontSize: 15 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#FFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '80%' },
  modalHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: Colors.textPrimary },
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