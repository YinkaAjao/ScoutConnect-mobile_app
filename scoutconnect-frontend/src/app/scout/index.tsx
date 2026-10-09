import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, SafeAreaView, TouchableOpacity, Alert, Dimensions, TextInput, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { LineChart, ProgressChart } from 'react-native-chart-kit';
import * as SecureStore from 'expo-secure-store';

// TypeScript Interfaces to fix 'any' type errors
interface Evaluation {
  id?: string;
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
  age: number;
  profilePhoto?: string; // NEW: Added to support cloud media URLs
  Evaluations?: Evaluation[];
  MatchStats?: MatchStat[];
  Achievements?: Achievement[];
  Club?: { 
    name: string; 
    contactEmail: string; 
    contactPhone: string; 
  }; 
}

const API_URL = 'https://scoutconnect.onrender.com/api/players';
const SHORTLIST_URL = 'https://scoutconnect.onrender.com/api/shortlist';
const screenWidth = Dimensions.get('window').width - 70;

export default function ScoutDashboard() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [page, setPage] = useState(1); 
  const [totalPages, setTotalPages] = useState(1); 
  const [positionFilter, setPositionFilter] = useState(''); 
  const router = useRouter();

  useEffect(() => {
    fetchPlayers(1);
  }, [positionFilter]);

  const fetchPlayers = async (pageNum: number) => {
    try {
      const token = await SecureStore.getItemAsync('userToken');
      
      const queryURL = `${API_URL}?page=${pageNum}&limit=5${positionFilter ? `&position=${positionFilter}` : ''}`;
      
      const response = await fetch(queryURL, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      const data = await response.json();
      
      if (pageNum === 1) {
        setPlayers(data.players); 
      } else {
        setPlayers(prev => [...prev, ...data.players]); 
      }
      
      setTotalPages(data.totalPages);
      setPage(pageNum);
    } catch (error) {
      console.error('Error fetching players:', error);
    }
  };

  const handleShortlist = async (playerId: string, playerName: string) => {
    try {
      const token = await SecureStore.getItemAsync('userToken');
      
      const response = await fetch(SHORTLIST_URL, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({
          playerId: playerId,
          notes: `Potential recruit from discover tab`
        })
      });

      const data = await response.json();
      if (response.ok) {
        Alert.alert('Success', `${playerName} has been added to your shortlist.`);
      } else {
        Alert.alert('Notice', data.error);
      }
    } catch (error) {
      Alert.alert('Error', 'Could not add athlete to shortlist.');
    }
  };

  const renderPlayer = ({ item }: { item: Player }) => {
    if (!item.Evaluations || item.Evaluations.length === 0) return null;

    const latestEval = item.Evaluations[item.Evaluations.length - 1];
    
    const physicalScore = latestEval.sprintSpeed ? Math.min(latestEval.sprintSpeed / 10, 1) : 0.5; 
    const techScore = latestEval.dribblingScore ? latestEval.dribblingScore / 10 : 0.5;
    
    const ringChartData = {
      labels: ["Physical", "Technical", "Tactical"],
      data: [physicalScore, techScore, 0.7] 
    };

    const historyLabels = item.Evaluations.map((ev: Evaluation, index: number) => `Eval ${index + 1}`);
    const historyData = item.Evaluations.map((ev: Evaluation) => ev.dribblingScore || 0);

    const lineChartData = {
      labels: historyLabels.length > 0 ? historyLabels : ['Start'],
      datasets: [{ data: historyData.length > 0 ? historyData : [0] }]
    };

    return (
      <View style={styles.card}>
        
        {/* UPDATED: Card Header now includes the Profile Photo */}
        <View style={styles.cardHeader}>
          {item.profilePhoto ? (
            <Image source={{ uri: item.profilePhoto }} style={styles.profileImage} />
          ) : (
            <View style={styles.imagePlaceholder}>
              <Text style={styles.imagePlaceholderText}>{item.name.charAt(0)}</Text>
            </View>
          )}
          
          <View style={styles.headerInfo}>
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.detail}>{item.position}</Text>
          </View>
        </View>
        
        <Text style={styles.sectionTitle}>Current Profile Snapshot</Text>
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

        {historyData.length > 1 && (
          <>
            <Text style={styles.sectionTitle}>Technical Development Curve</Text>
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

        {item.MatchStats && item.MatchStats.length > 0 && (
          <View style={styles.portfolioSection}>
            <Text style={styles.sectionTitle}>League Match Statistics</Text>
            {item.MatchStats.map((stat: MatchStat) => (
              <Text key={stat.id} style={styles.statLine}>
                - {stat.competition} {stat.opponent ? `vs ${stat.opponent} (${stat.matchResult})` : ''} 
                {"\n"}  ⚽ {stat.goals} Goals | 🎯 {stat.assists} Assists ({stat.minutesPlayed} mins)
              </Text>
            ))}
          </View>
        )}

        {item.Achievements && item.Achievements.length > 0 && (
          <View style={styles.portfolioSection}>
            <Text style={styles.sectionTitle}>Trophies & Medals</Text>
            {item.Achievements.map((ach: Achievement) => (
              <Text key={ach.id} style={styles.statLine}>
                - {ach.title} ({ach.year})
              </Text>
            ))}
          </View>
        )}

        {item.Club && (
          <View style={styles.contactSection}>
            <Text style={styles.contactTitle}>Managed by: {item.Club.name}</Text>
            <Text style={styles.contactText}>Email: {item.Club.contactEmail || 'N/A'}</Text>
            <Text style={styles.contactText}>Phone: {item.Club.contactPhone || 'N/A'}</Text>
          </View>
        )}

        <TouchableOpacity style={styles.shortlistBtn} onPress={() => handleShortlist(item.id, item.name)}>
          <Text style={styles.shortlistText}>Add to Shortlist</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.header}>Talent Discover</Text>
      </View>

      <TextInput 
        style={styles.searchInput} 
        placeholder="Filter by Position (e.g. Striker)" 
        value={positionFilter} 
        onChangeText={setPositionFilter} 
      />

      <FlatList
        data={players}
        keyExtractor={(item) => item.id}
        renderItem={renderPlayer}
        onEndReached={() => { 
          if (page < totalPages) fetchPlayers(page + 1); 
        }}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={<Text style={styles.empty}>No athletes found.</Text>}
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
  container: { flex: 1, backgroundColor: '#f4f4f4', padding: 15 },
  headerRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginBottom: 15, marginTop: 10 },
  header: { fontSize: 22, fontWeight: 'bold', color: '#333' },
  searchInput: { backgroundColor: '#fff', padding: 12, borderRadius: 8, marginBottom: 15, borderWidth: 1, borderColor: '#ddd' },
  card: { backgroundColor: '#fff', padding: 20, borderRadius: 12, marginBottom: 20, elevation: 3 },
  
  // NEW: Updated Header Styles to accommodate the image
  cardHeader: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#eee', paddingBottom: 15, marginBottom: 15 },
  profileImage: { width: 60, height: 60, borderRadius: 30, marginRight: 15, backgroundColor: '#eee' },
  imagePlaceholder: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#2E8B57', justifyContent: 'center', alignItems: 'center', marginRight: 15 },
  imagePlaceholderText: { color: '#fff', fontSize: 24, fontWeight: 'bold' },
  headerInfo: { flex: 1 },
  
  name: { fontSize: 20, fontWeight: 'bold', color: '#111' },
  detail: { fontSize: 14, color: '#666', marginTop: 4 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#555', marginBottom: 10, marginTop: 5 },
  chart: { marginVertical: 8, borderRadius: 8 },
  portfolioSection: { marginTop: 15, padding: 10, backgroundColor: '#f9f9f9', borderRadius: 8 },
  statLine: { fontSize: 14, color: '#444', marginVertical: 4 },
  contactSection: { marginTop: 15, padding: 12, backgroundColor: '#eef5fe', borderRadius: 8, borderWidth: 1, borderColor: '#d0e3ff' },
  contactTitle: { fontSize: 14, fontWeight: 'bold', color: '#0056b3', marginBottom: 4 },
  contactText: { fontSize: 14, color: '#333' },
  shortlistBtn: { backgroundColor: '#0056b3', padding: 12, borderRadius: 8, alignItems: 'center', marginTop: 15 },
  shortlistText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  empty: { textAlign: 'center', marginTop: 50, color: '#888' }
});