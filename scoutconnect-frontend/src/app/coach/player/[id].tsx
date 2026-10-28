// src/app/coach/player/[id].tsx
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Dimensions, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LineChart, ProgressChart } from 'react-native-chart-kit';
import { apiFetch } from '../../../lib/api';
import { pillarScores } from '../../../lib/ratings';
import { consentBadge } from '../../../lib/consent';
import { Ionicons } from '@expo/vector-icons';
import { Colors, CardSpec } from '../../../constants/designSystem';
import EditAthleteModal from '../../../components/EditAthleteModal';
import { confirmRemoveAthlete, confirmRemoveRecord } from '../../../lib/roster';
import EditMatchStatModal, { EditableMatchStat } from '../../../components/EditMatchStatModal';
import EditAchievementModal, { EditableAchievement } from '../../../components/EditAchievementModal';

interface Evaluation {
  id: string;
  createdAt?: string;
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
  consentStatus?: string | null;
  consentGuardian?: string | null;
  consentGraceUntil?: string | null;
  profilePhoto?: string; // the stored file path; not displayable on its own
  photoUrl?: string | null; // short-lived signed link from the server
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

const CONSENT_COLORS = {
  ok: { bg: '#D1FAE5', fg: '#047857', icon: 'checkmark-circle' },
  warn: { bg: '#FEF3C7', fg: '#B45309', icon: 'time-outline' },
  bad: { bg: '#FEE2E2', fg: '#B91C1C', icon: 'eye-off-outline' },
} as const;

const screenWidth = Dimensions.get('window').width - 40;

export default function PlayerProfileScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  
  const [player, setPlayer] = useState<Player | null>(null);
  const [loading, setLoading] = useState(true);

  // Flagging State
  const [editingAthlete, setEditingAthlete] = useState(false);
  const [editingStat, setEditingStat] = useState<EditableMatchStat | null>(null);
  const [editingAch, setEditingAch] = useState<EditableAchievement | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (id) fetchPlayerDetails();
  }, [id]);

  const fetchPlayerDetails = async () => {
    try {
      setPlayer(await apiFetch(`/players/${id}`));
      setLoadError(null);
    } catch (error: any) {
      setLoadError(error?.message || 'Could not load this athlete.');
    } finally {
      setLoading(false);
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
        <Text style={styles.errorText}>{loadError || 'Player data could not be loaded.'}</Text>
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
    // Unrated pillars show as empty rings; nothing is guessed (see lib/ratings.ts).
    const scores = pillarScores(latestEval);
    ringChartData = {
      labels: ["Physical", "Technical", "Tactical"],
      data: [scores.physical ?? 0, scores.technical ?? 0, scores.tactical ?? 0]
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
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => setEditingAthlete(true)} style={styles.headerIconBtn} accessibilityLabel="Edit athlete">
            <Ionicons name="create-outline" size={20} color={Colors.secondary} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => confirmRemoveAthlete(player, () => router.back())}
            style={styles.headerIconBtn}
            accessibilityLabel="Remove athlete"
          >
            <Ionicons name="trash-outline" size={20} color="#DC2626" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Hero Identity Section with Photo */}
        <View style={styles.heroCard}>
          {player.photoUrl ? (
            <Image source={{ uri: player.photoUrl }} style={styles.profileImage} />
          ) : (
            <View style={styles.imagePlaceholder}>
              <Text style={styles.imagePlaceholderText}>{player.name.charAt(0).toUpperCase()}</Text>
            </View>
          )}

          <Text style={styles.name}>{player.name}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 }}>
            <Ionicons name="football-outline" size={14} color="#A7F3D0" />
            <Text style={styles.clubText}>{player.Club?.name || 'No club linked'}</Text>
          </View>
          <View style={styles.badgeRow}>
            <Text style={styles.positionBadge}>{player.position || 'Position not set'}</Text>
            <Text style={styles.dobBadge}>DOB: {player.dateOfBirth}</Text>
          </View>
          {(() => {
            const badge = consentBadge(player);
            const color = CONSENT_COLORS[badge.tone];
            return (
              <TouchableOpacity
                style={[styles.consentPill, { backgroundColor: color.bg }]}
                onPress={() => setEditingAthlete(true)}
                accessibilityRole="button"
                accessibilityLabel={`${badge.label}. Tap to edit consent.`}
              >
                <Ionicons name={color.icon} size={14} color={color.fg} />
                <Text style={[styles.consentPillText, { color: color.fg }]}>{badge.label}</Text>
              </TouchableOpacity>
            );
          })()}
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

        {/* Evaluation History */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Evaluation History</Text>
          {hasEvals ? (
            [...player.Evaluations!].reverse().map((ev) => (
              <View key={ev.id} style={styles.statListItem}>
                <View style={styles.statListHeader}>
                  <Text style={styles.statComp}>
                    {ev.evaluationDate || ev.checklistData?.evaluationDate || (ev.createdAt ? ev.createdAt.slice(0, 10) : 'Evaluation')}
                  </Text>
                  <TouchableOpacity
                    onPress={() => confirmRemoveRecord('evaluations', ev.id, 'this evaluation', fetchPlayerDetails)}
                    accessibilityRole="button"
                    accessibilityLabel="Remove this evaluation"
                    style={styles.recordBtn}
                  >
                    <Ionicons name="trash-outline" size={18} color="#DC2626" />
                  </TouchableOpacity>
                </View>
                <Text style={styles.statMatchup}>
                  Overall {ev.overallRating ?? '–'}/5 • Evaluator: {ev.evaluatorName || ev.checklistData?.evaluatorName || 'Not recorded'}
                </Text>
              </View>
            ))
          ) : (
            <Text style={styles.emptySubtext}>No evaluations logged.</Text>
          )}
          {hasEvals && <Text style={styles.signedNote}>Evaluations are cryptographically signed, so they can be removed but not edited.</Text>}
        </View>

        {/* Match Stats Section */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Match History</Text>
          {player.MatchStats && player.MatchStats.length > 0 ? (
            player.MatchStats.map((stat) => (
              <View key={stat.id} style={styles.statListItem}>
                <View style={styles.statListHeader}>
                  <Text style={[styles.statComp, { flex: 1 }]}>{stat.competition}</Text>
                  <Text style={styles.statDate}>{stat.matchDate || 'Date not set'}</Text>
                  <TouchableOpacity onPress={() => setEditingStat(stat)} accessibilityRole="button" accessibilityLabel={`Edit match record ${stat.competition}`} style={styles.recordBtn}>
                    <Ionicons name="create-outline" size={18} color={Colors.secondary} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => confirmRemoveRecord('match-stats', stat.id, `the ${stat.competition} match record`, fetchPlayerDetails)}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove match record ${stat.competition}`}
                    style={styles.recordBtn}
                  >
                    <Ionicons name="trash-outline" size={18} color="#DC2626" />
                  </TouchableOpacity>
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
                <View style={{ flex: 1 }}>
                  <Text style={styles.achievementTitle}>{ach.title}</Text>
                  <Text style={styles.achievementYear}>{ach.year}</Text>
                </View>
                <TouchableOpacity onPress={() => setEditingAch(ach)} accessibilityRole="button" accessibilityLabel={`Edit ${ach.title}`} style={styles.recordBtn}>
                  <Ionicons name="create-outline" size={18} color={Colors.secondary} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => confirmRemoveRecord('achievements', ach.id, `"${ach.title}"`, fetchPlayerDetails)}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${ach.title}`}
                  style={styles.recordBtn}
                >
                  <Ionicons name="trash-outline" size={18} color="#DC2626" />
                </TouchableOpacity>
              </View>
            ))
          ) : (
            <Text style={styles.emptySubtext}>No achievements logged.</Text>
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      <EditAthleteModal
        athlete={editingAthlete ? player : null}
        onClose={() => setEditingAthlete(false)}
        onSaved={(updated) => {
          setPlayer((prev) => (prev ? { ...prev, ...updated } : prev));
          setEditingAthlete(false);
        }}
      />

      <EditMatchStatModal
        stat={editingStat}
        onClose={() => setEditingStat(null)}
        onSaved={() => { setEditingStat(null); fetchPlayerDetails(); }}
      />

      <EditAchievementModal
        achievement={editingAch}
        onClose={() => setEditingAch(null)}
        onSaved={() => { setEditingAch(null); fetchPlayerDetails(); }}
      />
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
  headerActions: { flexDirection: 'row', width: 60, justifyContent: 'flex-end', gap: 4 },
  headerIconBtn: { padding: 5 },

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

  consentPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, marginTop: 12 },
  consentPillText: { fontSize: 11, fontWeight: 'bold' },
  recordBtn: { padding: 5, marginLeft: 2 },
  signedNote: { fontSize: 11, color: Colors.textSecondary, fontStyle: 'italic', marginTop: 4 },
});