import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, SafeAreaView, ScrollView, TouchableOpacity, ActivityIndicator, Dimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LineChart, ProgressChart } from 'react-native-chart-kit';
import * as SecureStore from 'expo-secure-store';

interface Evaluation {
  id: string;
  sprintSpeed: number;
  dribblingScore: number;
  workRate: string;
  evalType: string;
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
  Evaluations?: Evaluation[];
  MatchStats?: MatchStat[];
  Achievements?: Achievement[];
}

const screenWidth = Dimensions.get('window').width - 40; // Accounting for padding

export default function PlayerProfileScreen() {
  const { id } = useLocalSearchParams(); // Captures the dynamic ID from the URL
  const router = useRouter();
  
  const [player, setPlayer] = useState<Player | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPlayerDetails();
  }, [id]);

  const fetchPlayerDetails = async () => {
    try {
      const token = await SecureStore.getItemAsync('userToken');
      const response = await fetch(`https://scoutconnect.onrender.com//api/players/${id}`, {
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

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color="#2E8B57" />
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

  // --- Chart Data Preparation ---
  const hasEvals = player.Evaluations && player.Evaluations.length > 0;
  let ringChartData = { labels: ["Physical", "Technical", "Tactical"], data: [0, 0, 0] };
  let lineChartData = { labels: ['Start'], datasets: [{ data: [0] }] };

  if (hasEvals) {
    const latestEval = player.Evaluations![player.Evaluations!.length - 1];
    const physicalScore = latestEval.sprintSpeed ? Math.min(latestEval.sprintSpeed / 10, 1) : 0.5; 
    const techScore = latestEval.dribblingScore ? latestEval.dribblingScore / 10 : 0.5;
    
    ringChartData = {
      labels: ["Physical", "Technical", "Tactical"],
      data: [physicalScore, techScore, 0.7] // 0.7 is a hardcoded MVP placeholder for tactical
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
          <Text style={styles.backBtn}>← Roster</Text>
        </TouchableOpacity>
        <Text style={styles.header}>Athlete Profile</Text>
        <View style={{ width: 60 }} /> 
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Identity Section */}
        <View style={styles.heroCard}>
          <Text style={styles.name}>{player.name}</Text>
          <View style={styles.badgeRow}>
            <Text style={styles.positionBadge}>{player.position}</Text>
            <Text style={styles.dobBadge}>DOB: {player.dateOfBirth}</Text>
          </View>
        </View>

        {/* Evaluation Charts Section */}
        {hasEvals ? (
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
                  <Text style={styles.statDate}>{stat.matchDate}</Text>
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
                <Text style={styles.achievementIcon}>🏆</Text>
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

        <View style={{ height: 40 }} />
      </ScrollView>
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
  container: { flex: 1, backgroundColor: '#f4f4f4', paddingHorizontal: 15 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { fontSize: 16, color: '#d9534f', marginBottom: 20 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 15 },
  backBtnWrapper: { padding: 5 },
  backBtn: { fontSize: 16, color: '#0056b3', fontWeight: 'bold' },
  header: { fontSize: 20, fontWeight: 'bold', color: '#333' },
  
  heroCard: { backgroundColor: '#2E8B57', padding: 25, borderRadius: 12, marginBottom: 15, alignItems: 'center', elevation: 4 },
  name: { fontSize: 26, fontWeight: 'bold', color: '#fff', marginBottom: 10 },
  badgeRow: { flexDirection: 'row', gap: 10 },
  positionBadge: { backgroundColor: '#fff', color: '#2E8B57', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 15, fontSize: 14, fontWeight: 'bold', overflow: 'hidden' },
  dobBadge: { backgroundColor: 'rgba(255,255,255,0.2)', color: '#fff', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 15, fontSize: 14, fontWeight: '600', overflow: 'hidden' },
  
  sectionCard: { backgroundColor: '#fff', padding: 20, borderRadius: 12, marginBottom: 15, elevation: 2 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#111', marginBottom: 15 },
  chart: { marginVertical: 8, borderRadius: 8, marginLeft: -10 },
  
  emptyCard: { backgroundColor: '#fff', padding: 20, borderRadius: 12, marginBottom: 15, alignItems: 'center' },
  emptyText: { color: '#666', fontStyle: 'italic' },
  emptySubtext: { color: '#888', fontStyle: 'italic', marginTop: 5 },
  
  statListItem: { borderBottomWidth: 1, borderBottomColor: '#eee', paddingBottom: 15, marginBottom: 15 },
  statListHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  statComp: { fontSize: 16, fontWeight: 'bold', color: '#333' },
  statDate: { fontSize: 12, color: '#888' },
  statMatchup: { fontSize: 14, color: '#0056b3', marginBottom: 8, fontWeight: '500' },
  statMetricsRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#f9f9f9', padding: 10, borderRadius: 8 },
  statMetric: { fontSize: 14, color: '#444', fontWeight: '600' },
  
  achievementItem: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, backgroundColor: '#fffaf0', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#ffebcd' },
  achievementIcon: { fontSize: 24, marginRight: 15 },
  achievementTitle: { fontSize: 16, fontWeight: 'bold', color: '#333' },
  achievementYear: { fontSize: 13, color: '#888', marginTop: 2 }
});