// src/app/scout/player/[id].tsx
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, Dimensions, Image, ActivityIndicator, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { LineChart, ProgressChart } from 'react-native-chart-kit';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch } from '../../../lib/api';
import FormSheet, { formStyles } from '../../../components/FormSheet';
import { pillarScores } from '../../../lib/ratings';
import { shareReportPdf } from '../../../lib/reportExport';
import { PlayerProspect, Evaluation, MatchStat, Achievement, latestOverall, positionAgeLine, matchTotals, latestBody, overallTrend, daysSinceLastEvaluation, outOfFive } from '../../../lib/scoutPlayer';
import { Colors, CardSpec } from '../../../constants/designSystem';

// One distinct colour per rating, used by the rings and the bars so they read together.
const PILLAR_COLORS = { technical: '#0056B3', physical: '#F59E0B', coaching: '#8B5CF6' };
const screenWidth = Dimensions.get('window').width - 60;
// Must match REPORT_CATEGORIES in scoutconnect-backend/lib/reports.js
const REPORT_CATEGORIES = ['Inaccurate stats', 'Wrong identity', 'Inappropriate photo', 'Safeguarding concern', 'Other'];

export default function ScoutPlayerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [player, setPlayer] = useState<PlayerProspect | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shortlistBusy, setShortlistBusy] = useState(false);

  const [contactOpen, setContactOpen] = useState(false);
  const [contactMessage, setContactMessage] = useState('');
  const [sendingRequest, setSendingRequest] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportCategory, setReportCategory] = useState('');
  const [reportDetails, setReportDetails] = useState('');
  const [sendingReport, setSendingReport] = useState(false);

  const load = async () => {
    try {
      const data: PlayerProspect = await apiFetch(`/players/${id}`);
      setPlayer(data);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Could not load this athlete.');
    }
  };

  // Reload on every focus: a club may have answered a request since the screen was last open.
  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load().finally(() => setLoading(false));
    }, [id])
  );

  const toggleShortlist = async () => {
    if (!player || shortlistBusy) return;
    setShortlistBusy(true);
    try {
      if (player.shortlistId) {
        await apiFetch(`/shortlist/${player.shortlistId}`, { method: 'DELETE' });
        setPlayer({ ...player, shortlistId: null });
      } else {
        const result = await apiFetch('/shortlist', { method: 'POST', body: { playerId: player.id, notes: '' } });
        setPlayer({ ...player, shortlistId: result?.entry?.id ?? 'new' });
        if (!result?.entry?.id) await load();
      }
    } catch (e: any) {
      Alert.alert(player.shortlistId ? 'Could not remove from shortlist' : 'Could not add to shortlist', e?.message || String(e));
    } finally {
      setShortlistBusy(false);
    }
  };

  const sendContactRequest = async () => {
    if (!player) return;
    if (contactMessage.trim().length < 10) {
      Alert.alert('Add a short message', 'Tell the club why you would like to contact them (at least 10 characters).');
      return;
    }
    setSendingRequest(true);
    try {
      await apiFetch('/contact-requests', { method: 'POST', body: { playerId: player.id, message: contactMessage } });
      setPlayer({ ...player, contactRequest: { id: 'new', status: 'Pending', responseNote: null } });
      setContactOpen(false);
      Alert.alert('Request sent', "The club's owner will be told. Their answer appears in your Requests tab.");
    } catch (e: any) {
      Alert.alert('Could not send your request', e?.message || String(e));
    } finally {
      setSendingRequest(false);
    }
  };

  const sendReport = async () => {
    if (!player) return;
    if (!reportCategory) return Alert.alert('Choose a category', 'Tell us what kind of problem this is.');
    if (reportDetails.trim().length < 5) return Alert.alert('Add a few details', 'Describe the problem in a few words.');
    setSendingReport(true);
    try {
      await apiFetch('/flags', { method: 'POST', body: { playerId: player.id, category: reportCategory, details: reportDetails } });
      setReportOpen(false);
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
        {!waiting && (
          <TouchableOpacity
            style={styles.requestBtn}
            onPress={() => { setContactMessage(''); setContactOpen(true); }}
            accessibilityRole="button"
            accessibilityLabel={`Request contact about ${item.displayName}`}
          >
            <Ionicons name="mail-outline" size={15} color={Colors.secondary} />
            <Text style={styles.requestBtnText}>Request contact</Text>
          </TouchableOpacity>
        )}
      </>
    );
  };

  const renderBody = (item: PlayerProspect) => {
    const evaluations = item.Evaluations ?? [];
    const latestEval: Evaluation | undefined = evaluations[evaluations.length - 1];
    const scores = latestEval ? pillarScores(latestEval) : { physical: null, technical: null, coaching: null };
    const overall = latestOverall(item);
    const trend = overallTrend(item);
    const totals = matchTotals(item.MatchStats);
    const body = latestBody(item);
    const lastEvalDays = daysSinceLastEvaluation(item);
    const historyData = evaluations.map((ev) => ev.dribblingScore || 0);
    const pillars = [
      { key: 'Technical', value: scores.technical, color: PILLAR_COLORS.technical },
      { key: 'Physical', value: scores.physical, color: PILLAR_COLORS.physical },
      { key: 'Coaching', value: scores.coaching, color: PILLAR_COLORS.coaching },
    ];
    const hasUnrated = pillars.some((pillar) => pillar.value === null);

    return (
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            {item.profilePhoto ? (
              <Image source={{ uri: item.profilePhoto }} style={styles.profileImage} />
            ) : (
              <View style={[styles.profileImage, styles.imagePlaceholder]}>
                <Text style={styles.imagePlaceholderText}>{item.displayName.charAt(0).toUpperCase()}</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text style={styles.name}>{item.displayName}</Text>
                {item.Club?.isVerified && <Ionicons name="checkmark-circle" size={16} color={Colors.primary} accessibilityLabel="Verified club" />}
              </View>
              <Text style={styles.detail}>{positionAgeLine(item)}</Text>
              {item.Club && <Text style={styles.detail} numberOfLines={1}>{item.Club.name}</Text>}
            </View>
            <View style={styles.ovrBadge}>
              <Text style={styles.ovrLabel}>OVR</Text>
              <Text style={styles.ovrValue}>{overall ?? 'N/A'}</Text>
              {trend !== null && trend !== 0 && (
                <View style={styles.trendRow}>
                  <Ionicons name={trend > 0 ? 'caret-up' : 'caret-down'} size={11} color={trend > 0 ? '#047857' : '#B91C1C'} />
                  <Text style={[styles.trendText, { color: trend > 0 ? '#047857' : '#B91C1C' }]}>{Math.abs(trend)}</Text>
                </View>
              )}
            </View>
          </View>

          <View style={styles.glanceRow}>
            <View style={styles.glanceBox}>
              <Text style={styles.glanceValue}>{evaluations.length}</Text>
              <Text style={styles.glanceLabel}>Evaluations</Text>
            </View>
            <View style={styles.glanceBox}>
              <Text style={styles.glanceValue}>{lastEvalDays === null ? '--' : lastEvalDays === 0 ? 'Today' : `${lastEvalDays}d`}</Text>
              <Text style={styles.glanceLabel}>Last evaluated</Text>
            </View>
            <View style={styles.glanceBox}>
              <Text style={styles.glanceValue}>{totals.matches}</Text>
              <Text style={styles.glanceLabel}>Matches</Text>
            </View>
            <View style={styles.glanceBox}>
              <Text style={styles.glanceValue}>{totals.goals + totals.assists}</Text>
              <Text style={styles.glanceLabel}>Goals + assists</Text>
            </View>
          </View>

          <Text style={styles.sectionTitle}>Physical profile</Text>
          <View style={styles.glanceRow}>
            <View style={styles.glanceBox}>
              {!body.heightCm && !item.identityRevealed
                ? <Ionicons name="lock-closed" size={16} color={Colors.textSecondary} accessibilityLabel="Locked until the club accepts your request" />
                : <Text style={styles.glanceValue}>{body.heightCm ? `${body.heightCm} cm` : '--'}</Text>}
              <Text style={styles.glanceLabel}>Height</Text>
            </View>
            <View style={styles.glanceBox}>
              {!body.weightKg && !item.identityRevealed
                ? <Ionicons name="lock-closed" size={16} color={Colors.textSecondary} accessibilityLabel="Locked until the club accepts your request" />
                : <Text style={styles.glanceValue}>{body.weightKg ? `${body.weightKg} kg` : '--'}</Text>}
              <Text style={styles.glanceLabel}>Weight</Text>
            </View>
            <View style={styles.glanceBox}>
              <Text style={styles.glanceValue}>{body.dominantFoot ?? '--'}</Text>
              <Text style={styles.glanceLabel}>Dominant foot</Text>
            </View>
          </View>
          {!item.identityRevealed && <Text style={styles.unratedNote}>Height and weight are shared once the club accepts your contact request.</Text>}

          {latestEval ? (
            <>
              <Text style={styles.sectionTitle}>Coach ratings (latest evaluation, out of 5)</Text>
              <ProgressChart
                data={{
                  labels: pillars.map((pillar) => pillar.key),
                  data: pillars.map((pillar) => pillar.value ?? 0),
                  colors: pillars.map((pillar) => pillar.color),
                }}
                width={screenWidth}
                height={110}
                strokeWidth={10}
                radius={22}
                chartConfig={chartConfig}
                withCustomBarColorFromData
                hideLegend
                style={styles.chart}
              />
              {pillars.map((pillar) => {
                const rating = outOfFive(pillar.value);
                return (
                  <View key={pillar.key} style={styles.barRow}>
                    <View style={[styles.barDot, { backgroundColor: pillar.color }]} />
                    <Text style={styles.barLabel}>{pillar.key}</Text>
                    <View style={styles.barTrack}>
                      <View style={[styles.barFill, { width: `${Math.round((pillar.value ?? 0) * 100)}%`, backgroundColor: pillar.color }]} />
                    </View>
                    <Text style={styles.barValue}>{rating === null ? 'n/r' : rating.toFixed(1)}</Text>
                  </View>
                );
              })}
              {hasUnrated && <Text style={styles.unratedNote}>n/r = not rated by the coach.</Text>}

              <Text style={styles.sectionTitle}>Test results</Text>
              <View style={styles.glanceRow}>
                <View style={styles.glanceBox}>
                  <Text style={styles.glanceValue}>{latestEval.sprintSpeed ? `${latestEval.sprintSpeed}s` : '--'}</Text>
                  <Text style={styles.glanceLabel}>30m sprint</Text>
                </View>
                <View style={styles.glanceBox}>
                  <Text style={styles.glanceValue}>{latestEval.dribblingScore ? `${latestEval.dribblingScore}/5` : '--'}</Text>
                  <Text style={styles.glanceLabel}>Ball control</Text>
                </View>
                <View style={styles.glanceBox}>
                  <Text style={styles.glanceValue}>{latestEval.evalType || '--'}</Text>
                  <Text style={styles.glanceLabel}>Evaluation type</Text>
                </View>
              </View>
            </>
          ) : (
            <Text style={styles.unratedNote}>No evaluation has been recorded yet.</Text>
          )}

          {historyData.length > 1 && (
            <>
              <Text style={styles.sectionTitle}>Ball control over time</Text>
              <LineChart
                data={{ labels: evaluations.map((_, index) => `E${index + 1}`), datasets: [{ data: historyData }] }}
                width={screenWidth}
                height={160}
                chartConfig={chartConfig}
                bezier
                style={styles.chart}
              />
            </>
          )}

          {totals.matches > 0 && (
            <View style={styles.portfolioSection}>
              <Text style={styles.sectionTitle}>Match record</Text>
              <View style={styles.glanceRow}>
                <View style={styles.glanceBox}>
                  <Text style={styles.glanceValue}>{totals.goals}</Text>
                  <Text style={styles.glanceLabel}>Goals</Text>
                </View>
                <View style={styles.glanceBox}>
                  <Text style={styles.glanceValue}>{totals.assists}</Text>
                  <Text style={styles.glanceLabel}>Assists</Text>
                </View>
                <View style={styles.glanceBox}>
                  <Text style={styles.glanceValue}>{totals.minutes}</Text>
                  <Text style={styles.glanceLabel}>Minutes</Text>
                </View>
                <View style={styles.glanceBox}>
                  <Text style={styles.glanceValue}>{totals.goalsPer90 ?? '--'}</Text>
                  <Text style={styles.glanceLabel}>Goals / 90</Text>
                </View>
              </View>
              {item.MatchStats!.map((stat: MatchStat) => (
                <View key={stat.id} style={{ marginVertical: 3 }}>
                  <Text style={styles.statLine}>
                    • {stat.competition} {stat.opponent ? `vs ${stat.opponent} (${stat.matchResult || 'W'})` : ''}
                  </Text>
                  <Text style={styles.statSubLine}>Goals: {stat.goals} | Assists: {stat.assists} ({stat.minutesPlayed} mins)</Text>
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
                  <Text style={styles.statLine}>{ach.title} ({ach.year})</Text>
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

          <TouchableOpacity
            style={[styles.shortlistBtn, item.shortlistId ? styles.shortlistBtnOn : null, shortlistBusy && { opacity: 0.6 }]}
            onPress={toggleShortlist}
            disabled={shortlistBusy}
            accessibilityRole="button"
            accessibilityLabel={item.shortlistId ? `Remove ${item.displayName} from shortlist` : `Add ${item.displayName} to shortlist`}
          >
            <Ionicons name={item.shortlistId ? 'star' : 'star-outline'} size={16} color={item.shortlistId ? Colors.secondary : '#FFF'} style={{ marginRight: 6 }} />
            <Text style={[styles.shortlistText, item.shortlistId ? { color: Colors.secondary } : null]}>
              {item.shortlistId ? 'In your shortlist (tap to remove)' : 'Add to Shortlist'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.pdfBtn}
            onPress={() => shareReportPdf({
              audience: 'scout',
              name: item.displayName,
              position: item.position,
              age: item.age,
              clubName: item.Club?.name,
              clubVerified: item.Club?.isVerified,
              evaluations: item.Evaluations ?? [],
              matchStats: item.MatchStats ?? [],
              achievements: item.Achievements ?? [],
              sharedBody: item.identityRevealed ? { heightCm: body.heightCm, weightKg: body.weightKg } : undefined,
            })}
            accessibilityRole="button"
            accessibilityLabel={`Download a PDF report for ${item.displayName}`}
          >
            <Ionicons name="document-text-outline" size={16} color={Colors.secondary} />
            <Text style={styles.pdfBtnText}>Download PDF report</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.reportLink}
            onPress={() => { setReportCategory(''); setReportDetails(''); setReportOpen(true); }}
            accessibilityRole="button"
            accessibilityLabel={`Report a concern about ${item.displayName}`}
          >
            <Ionicons name="flag-outline" size={14} color={Colors.textSecondary} />
            <Text style={styles.reportLinkText}>Report a concern</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={22} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Athlete profile</Text>
        <View style={styles.backBtn} />
      </View>

      {loading && !player ? (
        <ActivityIndicator style={{ marginTop: 40 }} size="large" color={Colors.secondary} />
      ) : player ? (
        renderBody(player)
      ) : (
        <View style={styles.errorBox}>
          <Text style={styles.errorTitle}>Couldn't load this athlete</Text>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => { setLoading(true); load().finally(() => setLoading(false)); }} accessibilityRole="button">
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      )}

      <FormSheet
        visible={contactOpen}
        title="Request contact"
        saveLabel="Send request"
        saving={sendingRequest}
        onCancel={() => setContactOpen(false)}
        onSave={sendContactRequest}
      >
        <Text style={styles.sheetNote}>
          The club decides whether to share {player?.displayName ?? 'the athlete'}'s full name and the club's contact details. Be clear about who you are and what you would like.
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
        visible={reportOpen}
        title="Report a concern"
        saveLabel="Send report"
        saving={sendingReport}
        onCancel={() => setReportOpen(false)}
        onSave={sendReport}
      >
        <Text style={styles.sheetNote}>
          Tell an administrator if something about {player?.displayName ?? 'this profile'} looks wrong. If a child may be at risk, choose "Safeguarding concern": those reports are looked at first.
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
  container: { flex: 1, backgroundColor: Colors.canvas },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 6 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  topTitle: { fontSize: 16, fontWeight: 'bold', color: Colors.textPrimary },
  scroll: { padding: 15, paddingBottom: 40 },
  card: { ...CardSpec, padding: 15 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: '#F3F4F6', paddingBottom: 12, marginBottom: 12 },
  profileImage: { width: 55, height: 55, borderRadius: 27.5, backgroundColor: '#eee' },
  imagePlaceholder: { backgroundColor: Colors.secondary, justifyContent: 'center', alignItems: 'center' },
  imagePlaceholderText: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  name: { fontSize: 18, fontWeight: 'bold', color: Colors.textPrimary },
  detail: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  ovrBadge: { backgroundColor: Colors.secondaryLight, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: Colors.secondaryBorder },
  ovrLabel: { fontSize: 9, fontWeight: 'bold', color: Colors.secondary },
  ovrValue: { fontSize: 14, fontWeight: 'bold', color: Colors.secondary },
  trendRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 1 },
  trendText: { fontSize: 10, fontWeight: 'bold' },
  glanceRow: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  glanceBox: { flex: 1, backgroundColor: '#F9FAFB', borderRadius: 8, borderWidth: 1, borderColor: Colors.border, paddingVertical: 8, paddingHorizontal: 4, alignItems: 'center' },
  glanceValue: { fontSize: 15, fontWeight: 'bold', color: Colors.textPrimary },
  glanceLabel: { fontSize: 10, color: Colors.textSecondary, marginTop: 2, textAlign: 'center' },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 4 },
  barDot: { width: 10, height: 10, borderRadius: 5 },
  barLabel: { width: 64, fontSize: 12, fontWeight: '600', color: Colors.textPrimary },
  barTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: '#E5E7EB', overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
  barValue: { width: 32, textAlign: 'right', fontSize: 12, fontWeight: 'bold', color: Colors.textPrimary },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary, marginBottom: 8, marginTop: 10 },
  chart: { marginVertical: 4, borderRadius: 8, alignSelf: 'center' },
  portfolioSection: { marginTop: 12, padding: 10, backgroundColor: '#F9FAFB', borderRadius: 8, borderWidth: 1, borderColor: Colors.border },
  statLine: { fontSize: 13, fontWeight: '600', color: Colors.textPrimary },
  statSubLine: { fontSize: 12, color: Colors.textSecondary, marginTop: 1 },
  contactSection: { marginTop: 12, padding: 10, backgroundColor: Colors.secondaryLight, borderRadius: 8, borderWidth: 1, borderColor: Colors.secondaryBorder },
  contactTitle: { fontSize: 12, fontWeight: 'bold', color: Colors.secondary, marginBottom: 4 },
  contactText: { fontSize: 13, color: Colors.textPrimary, marginVertical: 1 },
  contactNote: { fontSize: 12, color: Colors.textSecondary, marginTop: 8, lineHeight: 17 },
  requestBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: Colors.secondaryBorder, backgroundColor: '#fff' },
  requestBtnText: { color: Colors.secondary, fontWeight: 'bold', fontSize: 13 },
  shortlistBtn: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.secondary, padding: 12, borderRadius: 8, marginTop: 15, borderWidth: 1, borderColor: Colors.secondary },
  shortlistBtnOn: { backgroundColor: Colors.secondaryLight, borderColor: Colors.secondaryBorder },
  shortlistText: { color: '#FFF', fontWeight: 'bold', fontSize: 14 },
  pdfBtn: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: Colors.secondary, padding: 10, borderRadius: 8, marginTop: 10 },
  pdfBtnText: { color: Colors.secondary, fontWeight: 'bold', fontSize: 13 },
  reportLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12, paddingVertical: 6 },
  reportLinkText: { fontSize: 12, color: Colors.textSecondary },
  reportChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6, marginBottom: 14 },
  reportChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: '#D1D5DB' },
  reportChipActive: { backgroundColor: Colors.secondary, borderColor: Colors.secondary },
  reportChipText: { fontSize: 12, color: Colors.textPrimary, fontWeight: '600' },
  reportChipTextActive: { color: '#fff' },
  sheetNote: { fontSize: 13, color: Colors.textPrimary, lineHeight: 19, backgroundColor: '#F9FAFB', padding: 12, borderRadius: 8, marginBottom: 12 },
  unratedNote: { fontSize: 11, color: Colors.textSecondary, fontStyle: 'italic', textAlign: 'center', marginBottom: 6 },
  errorBox: { alignItems: 'center', marginTop: 50, paddingHorizontal: 24 },
  errorTitle: { fontSize: 16, fontWeight: 'bold', color: Colors.textPrimary },
  errorText: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', marginTop: 6 },
  retryBtn: { marginTop: 14, backgroundColor: Colors.secondary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
  retryText: { color: '#fff', fontWeight: 'bold' },
});
