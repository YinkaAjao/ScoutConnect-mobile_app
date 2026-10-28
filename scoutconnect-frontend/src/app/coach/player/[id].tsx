// src/app/coach/player/[id].tsx
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Dimensions, Image, Modal, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LineChart, ProgressChart } from 'react-native-chart-kit';
import { getAuthToken } from '../../../lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import { API_BASE, Colors, CardSpec } from '../../../constants/designSystem';

interface Evaluation {
  id: string;
  sprintSpeed: number;
  dribblingScore: number;
  workRate: string;
  evalType: string;
  evaluatorName?: string;
  evaluationDate?: string;
  overallRating?: number;
  strengths?: string;
  areasForImprovement?: string;
  checklistData?: {
    averages?: {
      technical: number;
      tactical: number;
      physical: number;
      psychological: number;
    };
    strengths?: string;
    areasForImprovement?: string;
    evaluatorName?: string;
    evaluationDate?: string;
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
  matchDate: string;
}

interface Achievement {
  id: string;
  title: string;
  year: number;
}

interface Player {
  id: string;
  name: string;
  position: string;
  dateOfBirth: string;
  profilePhoto?: string;
  Club?: {
    name: string;
    region: string;
    contactEmail: string;
    contactPhone: string;
  };
  Evaluations?: Evaluation[];
  MatchStats?: MatchStat[];
  Achievements?: Achievement[];
}

const screenWidth = Dimensions.get('window').width - 40;

export default function PlayerProfileScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  
  const [player, setPlayer] = useState<Player | null>(null);
  const [loading, setLoading] = useState(true);

  // Flagging State
  const [showFlagModal, setShowFlagModal] = useState(false);
  const [flagReason, setFlagReason] = useState('');

  useEffect(() => {
    if (id) fetchPlayerDetails();
  }, [id]);

  const fetchPlayerDetails = async () => {
    try {
      const token = await getAuthToken();
      const response = await fetch(`${API_BASE}/players/${id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      const data = await response.json();
      if (response.ok) {
        setPlayer(data);
      }
    } catch (error) {
      console.error('Error fetching player details:', error);
    } finally {
      setLoading(false);
    }
  };

  const submitFlag = async () => {
    if (!flagReason.trim()) {
      Alert.alert('Error', 'Please provide a reason for flagging this profile.');
      return;
    }

    try {
      const token = await getAuthToken();
      const response = await fetch(`${API_BASE}/flags`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({ playerId: player?.id, reason: flagReason.trim() })
      });

      if (response.ok) {
        Alert.alert('Report Submitted', 'Thank you. Our regional review team will audit this profile.');
        setShowFlagModal(false);
        setFlagReason('');
      } else {
        Alert.alert('Error', 'Could not submit flag.');
      }
    } catch (err) {
      Alert.alert('Connection Error', 'Failed to reach reporting service.');
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </SafeAreaView>
    );
  }

  if (!player) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.errorText}>Player data could not be loaded.</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtnWrapper}>
          <Text style={styles.backBtn}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const hasEvals = player.Evaluations && player.Evaluations.length > 0;
  let ringChartData = { labels: ["Physical", "Technical", "Tactical"], data: [0, 0, 0] };
  let lineChartData = { labels: ['Start'], datasets: [{ data: [0] }] };
  const latestEval = hasEvals ? player.Evaluations![player.Evaluations!.length - 1] : null;

  if (latestEval) {
    const avgs = latestEval.checklistData?.averages;
    const physicalScore = avgs?.physical ? avgs.physical / 4 : (latestEval.sprintSpeed ? Math.min(latestEval.sprintSpeed / 10, 1) : 0.5); 
    const techScore = avgs?.technical ? avgs.technical / 4 : (latestEval.dribblingScore ? latestEval.dribblingScore / 5 : 0.5);
    const tacScore = avgs?.tactical ? avgs.tactical / 4 : 0.8;
    
    ringChartData = {
      labels: ["Physical", "Technical", "Tactical"],
      data: [physicalScore, techScore, tacScore] 
    };

    const historyLabels = player.Evaluations!.map((_, index) => `E${index + 1}`);
    const historyData = player.Evaluations!.map(ev => ev.dribblingScore || 0);

    if (historyData.length > 1) {
      lineChartData = { labels: historyLabels, datasets: [{ data: historyData }] };
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtnWrapper}>
          <Ionicons name="arrow-back" size={18} color={Colors.secondary} />
          <Text style={styles.backBtn}>Roster</Text>
        </TouchableOpacity>
        <Text style={styles.header}>Athlete Profile</Text>
        <View style={{ width: 60 }} /> 
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Hero Identity Section with Photo */}
        <View style={styles.heroCard}>
          {player.profilePhoto ? (
            <Image source={{ uri: player.profilePhoto }} style={styles.profileImage} />
          ) : (
            <View style={styles.imagePlaceholder}>
              <Text style={styles.imagePlaceholderText}>{player.name.charAt(0).toUpperCase()}</Text>
            </View>
          )}

          <Text style={styles.name}>{player.name}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 }}>
            <Ionicons name="football-outline" size={14} color="#A7F3D0" />
            <Text style={styles.clubText}>{player.Club?.name || 'ALU Sentinels FC'}</Text>
          </View>
          <View style={styles.badgeRow}>
            <Text style={styles.positionBadge}>{player.position || 'Forward'}</Text>
            <Text style={styles.dobBadge}>DOB: {player.dateOfBirth}</Text>
          </View>
        </View>

        {/* Evaluation Charts & Checklist Breakdown Section */}
        {hasEvals && latestEval ? (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Latest Evaluation Snapshot</Text>
            <ProgressChart
              data={ringChartData}
              width={screenWidth}
              height={120}
              strokeWidth={12}
              radius={24}
              chartConfig={chartConfig}
              hideLegend={false}
              style={styles.chart}
            />

            {latestEval.checklistData?.averages && (
              <View style={styles.checklistSummaryBox}>
                <Text style={styles.checklistSubTitle}>4-PILLAR CHECKLIST AVERAGES (OUT OF 4.0)</Text>
                <View style={styles.pillarRow}>
                  <View style={styles.pillarPill}>
                    <Text style={styles.pillarLabel}>TECH</Text>
                    <Text style={styles.pillarVal}>{latestEval.checklistData.averages.technical}</Text>
                  </View>
                  <View style={styles.pillarPill}>
                    <Text style={styles.pillarLabel}>TACT</Text>
                    <Text style={styles.pillarVal}>{latestEval.checklistData.averages.tactical}</Text>
                  </View>
                  <View style={styles.pillarPill}>
                    <Text style={styles.pillarLabel}>PHYS</Text>
                    <Text style={styles.pillarVal}>{latestEval.checklistData.averages.physical}</Text>
                  </View>
                  <View style={styles.pillarPill}>
                    <Text style={styles.pillarLabel}>PSYCH</Text>
                    <Text style={styles.pillarVal}>{latestEval.checklistData.averages.psychological}</Text>
                  </View>
                </View>

                {(latestEval.strengths || latestEval.checklistData?.strengths) ? (
                  <View style={styles.noteBlock}>
                    <Text style={styles.noteHeading}>Strengths:</Text>
                    <Text style={styles.noteBody}>{latestEval.strengths || latestEval.checklistData?.strengths}</Text>
                  </View>
                ) : null}

                {(latestEval.areasForImprovement || latestEval.checklistData?.areasForImprovement) ? (
                  <View style={styles.noteBlock}>
                    <Text style={styles.noteHeading}>Areas for Improvement:</Text>
                    <Text style={styles.noteBody}>{latestEval.areasForImprovement || latestEval.checklistData?.areasForImprovement}</Text>
                  </View>
                ) : null}
              </View>
            )}

            {player.Evaluations!.length > 1 && (
              <>
                <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Technical Progression</Text>
                <LineChart
                  data={lineChartData}
                  width={screenWidth}
                  height={180}
                  chartConfig={chartConfig}
                  bezier
                  style={styles.chart}
                />
              </>
            )}
          </View>
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No evaluations logged yet.</Text>
          </View>
        )}

        {/* Match Stats Section */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Match History</Text>
          {player.MatchStats && player.MatchStats.length > 0 ? (
            player.MatchStats.map((stat) => (
              <View key={stat.id} style={styles.statListItem}>
                <View style={styles.statListHeader}>
                  <Text style={styles.statComp}>{stat.competition}</Text>
                  <Text style={styles.statDate}>{stat.matchDate || 'Recent'}</Text>
                </View>
                
                {stat.opponent && (
                  <Text style={styles.statMatchup}>
                    vs {stat.opponent} {stat.matchResult ? `(${stat.matchResult})` : ''}
                  </Text>
                )}
                
                <View style={styles.statMetricsRow}>
                  <Text style={styles.statMetric}>Goals: {stat.goals}</Text>
                  <Text style={styles.statMetric}>Assists: {stat.assists}</Text>
                  <Text style={styles.statMetric}>Mins: {stat.minutesPlayed}</Text>
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.emptySubtext}>No match statistics logged.</Text>
          )}
        </View>

        {/* Achievements Section */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Trophies & Medals</Text>
          {player.Achievements && player.Achievements.length > 0 ? (
            player.Achievements.map((ach) => (
              <View key={ach.id} style={styles.achievementItem}>
                <Ionicons name="trophy" size={24} color="#D97706" style={{ marginRight: 15 }} />
                <View>
                  <Text style={styles.achievementTitle}>{ach.title}</Text>
                  <Text style={styles.achievementYear}>{ach.year}</Text>
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.emptySubtext}>No achievements logged.</Text>
          )}
        </View>

        {/* Flag Suspicious Profile Button */}
        <TouchableOpacity 
          style={styles.flagBtn}
          onPress={() => setShowFlagModal(true)}
        >
          <Ionicons name="flag-outline" size={18} color="#DC2626" />
          <Text style={styles.flagBtnText}>Flag Suspicious Profile</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Flagging Modal Dialog */}
      <Modal visible={showFlagModal} animationType="fade" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Report Profile Inaccuracy</Text>
            <Text style={styles.modalSub}>
              Provide details on why this telemetry data or identity seems fraudulent.
            </Text>

            <TextInput 
              style={styles.modalInput}
              placeholder="e.g. Inflated sprint times or incorrect player identity..."
              placeholderTextColor="#9CA3AF"
              multiline
              value={flagReason}
              onChangeText={setFlagReason}
            />

            <TouchableOpacity style={styles.submitFlagBtn} onPress={submitFlag}>
              <Text style={styles.submitFlagText}>Submit Flag for Audit</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setShowFlagModal(false)}>
              <Text style={styles.modalCloseText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const chartConfig = {
  backgroundGradientFrom: '#fff',
  backgroundGradientTo: '#fff',
  color: (opacity = 1) => `rgba(46, 139, 87, ${opacity})`,
  labelColor: (opacity = 1) => `rgba(0, 0, 0, ${opacity})`,
  strokeWidth: 2,
  useShadowColorFromDataset: false,
  decimalPlaces: 1,
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.canvas, paddingHorizontal: 15 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { fontSize: 16, color: Colors.danger, marginBottom: 20 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 15 },
  backBtnWrapper: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 5 },
  backBtn: { fontSize: 16, color: Colors.secondary, fontWeight: 'bold' },
  header: { fontSize: 20, fontWeight: 'bold', color: Colors.textPrimary },
  
  heroCard: { backgroundColor: Colors.primary, padding: 25, borderRadius: 12, marginBottom: 15, alignItems: 'center', elevation: 4 },
  profileImage: { width: 80, height: 80, borderRadius: 40, marginBottom: 12, borderWidth: 2, borderColor: '#FFF', backgroundColor: '#EEE' },
  imagePlaceholder: { width: 80, height: 80, borderRadius: 40, backgroundColor: Colors.primaryDark, justifyContent: 'center', alignItems: 'center', marginBottom: 12, borderWidth: 2, borderColor: '#FFF' },
  imagePlaceholderText: { color: '#FFF', fontSize: 32, fontWeight: 'bold' },
  name: { fontSize: 24, fontWeight: 'bold', color: '#fff', marginBottom: 4, textAlign: 'center' },
  clubText: { fontSize: 13, color: '#A7F3D0', fontWeight: '600' },
  badgeRow: { flexDirection: 'row', gap: 10 },
  positionBadge: { backgroundColor: '#fff', color: Colors.primary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 15, fontSize: 13, fontWeight: 'bold', overflow: 'hidden' },
  dobBadge: { backgroundColor: 'rgba(255,255,255,0.2)', color: '#fff', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 15, fontSize: 13, fontWeight: '600', overflow: 'hidden' },
  
  sectionCard: { ...CardSpec, padding: 20, marginBottom: 15 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: Colors.textPrimary, marginBottom: 15 },
  chart: { marginVertical: 8, borderRadius: 8, alignSelf: 'center' },
  
  checklistSummaryBox: { marginTop: 12, padding: 12, backgroundColor: '#F9FAFB', borderRadius: 8, borderWidth: 1, borderColor: Colors.border },
  checklistSubTitle: { fontSize: 11, fontWeight: 'bold', color: Colors.textSecondary, marginBottom: 8 },
  pillarRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 6, marginBottom: 8 },
  pillarPill: { flex: 1, backgroundColor: '#FFF', paddingVertical: 8, borderRadius: 6, alignItems: 'center', borderWidth: 1, borderColor: Colors.border },
  pillarLabel: { fontSize: 10, fontWeight: 'bold', color: Colors.textSecondary },
  pillarVal: { fontSize: 15, fontWeight: 'bold', color: Colors.primary, marginTop: 2 },
  noteBlock: { marginTop: 8 },
  noteHeading: { fontSize: 12, fontWeight: 'bold', color: Colors.textPrimary },
  noteBody: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },

  emptyCard: { ...CardSpec, padding: 20, marginBottom: 15, alignItems: 'center' },
  emptyText: { color: Colors.textSecondary, fontStyle: 'italic' },
  emptySubtext: { color: Colors.textSecondary, fontStyle: 'italic', marginTop: 5 },
  
  statListItem: { borderBottomWidth: 1, borderBottomColor: Colors.border, paddingBottom: 15, marginBottom: 15 },
  statListHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  statComp: { fontSize: 16, fontWeight: 'bold', color: Colors.textPrimary },
  statDate: { fontSize: 12, color: Colors.textSecondary },
  statMatchup: { fontSize: 14, color: Colors.secondary, marginBottom: 8, fontWeight: '500' },
  statMetricsRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#F9FAFB', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: Colors.border },
  statMetric: { fontSize: 13, color: Colors.textPrimary, fontWeight: '600' },
  
  achievementItem: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, backgroundColor: '#FFFBEB', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#FEF3C7' },
  achievementTitle: { fontSize: 16, fontWeight: 'bold', color: Colors.textPrimary },
  achievementYear: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },

  flagBtn: { flexDirection: 'row', justifyContent: 'center', gap: 8, backgroundColor: '#FEE2E2', padding: 14, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: '#FCA5A5', marginTop: 5 },
  flagBtnText: { color: '#DC2626', fontWeight: 'bold', fontSize: 14 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#FFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: Colors.textPrimary, marginBottom: 6 },
  modalSub: { fontSize: 13, color: Colors.textSecondary, marginBottom: 15 },
  modalInput: { backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: Colors.border, borderRadius: 8, padding: 12, height: 90, textAlignVertical: 'top', marginBottom: 15, fontSize: 14 },
  submitFlagBtn: { backgroundColor: '#DC2626', padding: 14, borderRadius: 8, alignItems: 'center', marginBottom: 10 },
  submitFlagText: { color: '#FFF', fontWeight: 'bold', fontSize: 14 },
  modalCloseBtn: { padding: 12, backgroundColor: '#E5E7EB', borderRadius: 8, alignItems: 'center' },
  modalCloseText: { color: Colors.textPrimary, fontWeight: 'bold' }
});