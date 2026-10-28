// src/app/scout/index.tsx
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, StyleSheet, TextInput, TouchableOpacity, RefreshControl, Alert, Dimensions, Image, ActivityIndicator, Modal, ScrollView, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiFetch } from '../../lib/api';
import FormSheet, { formStyles } from '../../components/FormSheet';
import ScoutAccreditationPanel from '../../components/ScoutAccreditationPanel';
import { pillarScores, overallScore } from '../../lib/ratings';
import { LineChart, ProgressChart } from 'react-native-chart-kit';
import { Ionicons } from '@expo/vector-icons';
import { Colors, CardSpec } from '../../constants/designSystem';
import { positionQueryFor } from '../../constants/positions';

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
  displayName: string; // first name + surname initial until the club accepts a contact request
  identityRevealed: boolean;
  position: string;
  age: number | null;
  profilePhoto?: string | null;
  Evaluations?: Evaluation[];
  MatchStats?: MatchStat[];
  Achievements?: Achievement[];
  Club?: {
    name: string;
    isVerified?: boolean;
    contactEmail?: string | null; // only present once the club has accepted
    contactPhone?: string | null;
  } | null;
  contactRequest?: { id: string; status: 'Pending' | 'Accepted' | 'Declined'; responseNote: string | null; canRequestAgainAt?: string | null } | null;
}

const PAGE_SIZE = 10;
const screenWidth = Dimensions.get('window').width - 60;

const POSITIONS = ['All', 'Goalkeeper', 'Defender', 'Midfielder', 'Forward', 'Other'];
const EVAL_TYPES = ['All', 'Checklist', 'Combine', 'Match'];
// Must match REPORT_CATEGORIES in scoutconnect-backend/lib/reports.js
const REPORT_CATEGORIES = ['Inaccurate stats', 'Wrong identity', 'Inappropriate photo', 'Safeguarding concern', 'Other'];
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
  const [contactTarget, setContactTarget] = useState<PlayerProspect | null>(null);
  const [contactMessage, setContactMessage] = useState('');
  const [sendingRequest, setSendingRequest] = useState(false);
  const [reportTarget, setReportTarget] = useState<PlayerProspect | null>(null);
  const [reportCategory, setReportCategory] = useState('');
  const [reportDetails, setReportDetails] = useState('');
  const [sendingReport, setSendingReport] = useState(false);

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

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchPlayers(1, true);
    setRefreshing(false);
  };

  const handleShortlist = async (playerId: string, playerName: string) => {
    try {
      await apiFetch('/shortlist', { method: 'POST', body: { playerId, notes: '' } });
      Alert.alert('Added', `${playerName} has been added to your shortlist.`);
    } catch (e: any) {
      Alert.alert('Could not add to shortlist', e?.message || String(e));
    }
  };

  const sendContactRequest = async () => {
    if (!contactTarget) return;
    if (contactMessage.trim().length < 10) {
      Alert.alert('Add a short message', 'Tell the club why you would like to contact them (at least 10 characters).');
      return;
    }
    setSendingRequest(true);
    try {
      await apiFetch('/contact-requests', { method: 'POST', body: { playerId: contactTarget.id, message: contactMessage } });
      const sentTo = contactTarget.id;
      setPlayers((prev) => prev.map((p) => (p.id === sentTo ? { ...p, contactRequest: { id: 'new', status: 'Pending', responseNote: null } } : p)));
      setContactTarget(null);
      Alert.alert('Request sent', "The club's owner will be told. Their answer appears in your Requests tab.");
    } catch (e: any) {
      Alert.alert('Could not send your request', e?.message || String(e));
    } finally {
      setSendingRequest(false);
    }
  };

  const sendReport = async () => {
    if (!reportTarget) return;
    if (!reportCategory) return Alert.alert('Choose a category', 'Tell us what kind of problem this is.');
    if (reportDetails.trim().length < 5) return Alert.alert('Add a few details', 'Describe the problem in a few words.');
    setSendingReport(true);
    try {
      await apiFetch('/flags', { method: 'POST', body: { playerId: reportTarget.id, category: reportCategory, details: reportDetails } });
      setReportTarget(null);
      Alert.alert('Thank you', 'An administrator will review your report.');
    } catch (e: any) {
      Alert.alert('Could not send your report', e?.message || String(e));
    } finally {
      setSendingReport(false);
    }
  };

  const renderContactAction = (item: PlayerProspect) => {
    const status = item.contactRequest?.status;
    if (status === 'Accepted') return <Text style={styles.contactNote}>The club accepted your request. Their details are shown above.</Text>;
    if (status === 'Pending') return <Text style={styles.contactNote}>Request sent. Waiting for the club to answer.</Text>;
    const askAgainAt = item.contactRequest?.canRequestAgainAt ? new Date(item.contactRequest.canRequestAgainAt) : null;
    const waiting = askAgainAt !== null && askAgainAt > new Date();
    return (
      <>
        {status === 'Declined' && (
          <Text style={styles.contactNote}>
            The club declined your last request{item.contactRequest?.responseNote ? `: ${item.contactRequest.responseNote}` : '.'}
            {waiting ? ` You can ask again on ${askAgainAt!.toLocaleDateString()}.` : ''}
          </Text>
        )}
        {!waiting && <TouchableOpacity
          style={styles.requestBtn}
          onPress={() => { setContactMessage(''); setContactTarget(item); }}
          accessibilityRole="button"
          accessibilityLabel={`Request contact about ${item.displayName}`}
        >
          <Ionicons name="mail-outline" size={15} color={Colors.secondary} />
          <Text style={styles.requestBtnText}>Request contact</Text>
        </TouchableOpacity>}
      </>
    );
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

  const renderPlayer = ({ item }: { item: PlayerProspect }) => {
    const latestEval = item.Evaluations![item.Evaluations!.length - 1];
    const scores = pillarScores(latestEval);
    const ovrRating = overallScore(scores); // null when the coach rated nothing: shown as N/A, never invented
    const hasUnrated = scores.physical === null || scores.technical === null || scores.tactical === null;

    const ringChartData = {
      labels: ["Physical", "Technical", "Tactical"],
      data: [scores.physical ?? 0, scores.technical ?? 0, scores.tactical ?? 0]
    };

    const historyLabels = item.Evaluations!.map((_, index) => `E${index + 1}`);
    const historyData = item.Evaluations!.map((ev: Evaluation) => ev.dribblingScore || 0);

    const lineChartData = {
      labels: historyLabels.length > 0 ? historyLabels : ['Start'],
      datasets: [{ data: historyData.length > 0 ? historyData : [0] }]
    };

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          {item.profilePhoto ? (
            <Image source={{ uri: item.profilePhoto }} style={styles.profileImage} />
          ) : (
            <View style={styles.imagePlaceholder}>
              <Text style={styles.imagePlaceholderText}>{item.displayName.charAt(0).toUpperCase()}</Text>
            </View>
          )}
          
          <View style={styles.headerInfo}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={styles.name}>{item.displayName}</Text>
              {item.Club?.isVerified && <Ionicons name="checkmark-circle" size={16} color={Colors.primary} accessibilityLabel="Verified club" />}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
              <Ionicons name="football-outline" size={12} color={Colors.textSecondary} />
              <Text style={styles.detail}>{item.position || 'Position not set'}{item.age != null ? ` · ${item.age} yrs` : ''}</Text>
            </View>
          </View>

          <View style={styles.ovrBadge}>
            <Text style={styles.ovrLabel}>OVR</Text>
            <Text style={styles.ovrValue}>{ovrRating ?? 'N/A'}</Text>
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
        {hasUnrated && <Text style={styles.unratedNote}>Empty rings were not rated by the coach.</Text>}

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
              <Ionicons name={item.Club.isVerified ? 'shield-checkmark' : 'shield-outline'} size={14} color={item.Club.isVerified ? Colors.primary : Colors.textSecondary} />
              <Text style={styles.contactTitle}>
                {item.Club.isVerified ? `Verified club: ${item.Club.name}` : `${item.Club.name} (not yet verified)`}
              </Text>
            </View>
            {item.identityRevealed && (
              <>
                <Text style={styles.contactText}>Email: {item.Club.contactEmail || 'Not provided'}</Text>
                <Text style={styles.contactText}>Phone: {item.Club.contactPhone || 'Not provided'}</Text>
              </>
            )}
            {renderContactAction(item)}
          </View>
        )}

        <TouchableOpacity style={styles.shortlistBtn} onPress={() => handleShortlist(item.id, item.displayName)} accessibilityRole="button" accessibilityLabel={`Add ${item.displayName} to shortlist`}>
          <Ionicons name="star" size={16} color="#FFF" style={{ marginRight: 6 }} />
          <Text style={styles.shortlistText}>Add to Shortlist</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.reportLink}
          onPress={() => { setReportCategory(''); setReportDetails(''); setReportTarget(item); }}
          accessibilityRole="button"
          accessibilityLabel={`Report a concern about ${item.displayName}`}
        >
          <Ionicons name="flag-outline" size={14} color={Colors.textSecondary} />
          <Text style={styles.reportLinkText}>Report a concern</Text>
        </TouchableOpacity>
      </View>
    );
  };

  if (notApproved) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.header}>Talent Discover</Text>
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

      <FormSheet
        visible={contactTarget !== null}
        title="Request contact"
        saving={sendingRequest}
        onCancel={() => setContactTarget(null)}
        onSave={sendContactRequest}
      >
        <Text style={styles.sheetNote}>
          The club decides whether to share {contactTarget?.displayName ?? 'the athlete'}'s full name and the club's contact details. Be clear about who you are and what you would like.
        </Text>
        <Text style={formStyles.label}>Your message *</Text>
        <TextInput
          style={[formStyles.input, { height: 110, textAlignVertical: 'top' }]}
          value={contactMessage}
          onChangeText={setContactMessage}
          multiline
          maxLength={500}
          placeholder="e.g. I scout for … and would like to invite him to a trial."
          placeholderTextColor="#9CA3AF"
        />
      </FormSheet>

      <FormSheet
        visible={reportTarget !== null}
        title="Report a concern"
        saving={sendingReport}
        onCancel={() => setReportTarget(null)}
        onSave={sendReport}
      >
        <Text style={styles.sheetNote}>
          Tell an administrator if something about {reportTarget?.displayName ?? 'this profile'} looks wrong. If a child may be at risk, choose "Safeguarding concern": those reports are looked at first.
        </Text>
        <Text style={formStyles.label}>What is the problem? *</Text>
        <View style={styles.reportChips}>
          {REPORT_CATEGORIES.map((category) => (
            <TouchableOpacity
              key={category}
              style={[styles.reportChip, reportCategory === category && styles.reportChipActive]}
              onPress={() => setReportCategory(category)}
              accessibilityRole="button"
              accessibilityState={{ selected: reportCategory === category }}
            >
              <Text style={[styles.reportChipText, reportCategory === category && styles.reportChipTextActive]}>{category}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={formStyles.label}>Details *</Text>
        <TextInput
          style={[formStyles.input, { height: 90, textAlignVertical: 'top' }]}
          value={reportDetails}
          onChangeText={setReportDetails}
          multiline
          maxLength={255}
          placeholder="e.g. The sprint time looks impossible for his age."
          placeholderTextColor="#9CA3AF"
        />
      </FormSheet>

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
  reportLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12, paddingVertical: 6 },
  reportLinkText: { fontSize: 12, color: Colors.textSecondary },
  reportChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6, marginBottom: 14 },
  reportChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: '#D1D5DB' },
  reportChipActive: { backgroundColor: Colors.secondary, borderColor: Colors.secondary },
  reportChipText: { fontSize: 12, color: Colors.textPrimary, fontWeight: '600' },
  reportChipTextActive: { color: '#fff' },
  contactNote: { fontSize: 12, color: Colors.textSecondary, marginTop: 8, lineHeight: 17 },
  requestBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: Colors.secondaryBorder, backgroundColor: '#fff' },
  requestBtnText: { color: Colors.secondary, fontWeight: 'bold', fontSize: 13 },
  sheetNote: { fontSize: 13, color: Colors.textPrimary, lineHeight: 19, backgroundColor: '#F9FAFB', padding: 12, borderRadius: 8, marginBottom: 12 },
  unratedNote: { fontSize: 11, color: Colors.textSecondary, fontStyle: 'italic', textAlign: 'center', marginBottom: 6 },
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