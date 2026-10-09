import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, SafeAreaView, RefreshControl, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router'; // NEW: Imported router
import * as SecureStore from 'expo-secure-store';

interface MatchStat { id: string; competition: string; goals: number; assists: number; minutesPlayed: number; }
interface Achievement { id: string; title: string; year: number; }
interface Player { 
  id: string; 
  name: string; 
  position: string; 
  dateOfBirth: string;
  MatchStats?: MatchStat[]; 
  Achievements?: Achievement[]; 
}

const ROSTER_API = 'https://scoutconnect.onrender.com/api/club/players';

export default function MyPlayersScreen() {
  const [roster, setRoster] = useState<Player[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const router = useRouter(); // NEW: Initialized router

  useEffect(() => {
    fetchRoster();
  }, []);

  const fetchRoster = async () => {
    try {
      const token = await SecureStore.getItemAsync('userToken');
      const response = await fetch(ROSTER_API, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setRoster(data);
    } catch (error) {
      console.error('Error fetching roster:', error);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchRoster();
    setRefreshing(false);
  };

  const renderPlayer = ({ item }: { item: Player }) => {
    const totalGoals = item.MatchStats?.reduce((sum, stat) => sum + stat.goals, 0) || 0;
    const totalAssists = item.MatchStats?.reduce((sum, stat) => sum + stat.assists, 0) || 0;
    const totalTrophies = item.Achievements?.length || 0;

    return (
      // NEW: Wrapped in TouchableOpacity to make it clickable
      <TouchableOpacity 
        style={styles.card}
        onPress={() => router.push(`/coach/player/${item.id}`)}
      >
        <View style={styles.cardHeader}>
          <Text style={styles.name}>{item.name}</Text>
          <Text style={styles.positionBadge}>{item.position}</Text>
        </View>
        <Text style={styles.dob}>DOB: {item.dateOfBirth}</Text>

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
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.header}>My Roster</Text>
      </View>
      
      <FlatList
        data={roster}
        keyExtractor={(item) => item.id}
        renderItem={renderPlayer}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>Your roster is empty.</Text>
            <Text style={styles.emptySubtext}>Log offline evaluations and sync to see players here.</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f4f4', padding: 15 },
  headerRow: { alignItems: 'center', marginBottom: 20, marginTop: 10 },
  header: { fontSize: 24, fontWeight: 'bold', color: '#333' },
  card: { backgroundColor: '#fff', padding: 15, borderRadius: 10, marginBottom: 15, elevation: 2, borderLeftWidth: 5, borderLeftColor: '#2E8B57' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 18, fontWeight: 'bold', color: '#111' },
  positionBadge: { backgroundColor: '#eef5fe', color: '#0056b3', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, fontSize: 12, fontWeight: 'bold' },
  dob: { fontSize: 13, color: '#666', marginTop: 4, marginBottom: 15 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 15 },
  statBox: { alignItems: 'center', flex: 1 },
  statLabel: { fontSize: 12, color: '#888', fontWeight: '600' },
  statValue: { fontSize: 18, color: '#2E8B57', fontWeight: 'bold', marginTop: 4 },
  emptyContainer: { alignItems: 'center', marginTop: 60 },
  emptyText: { fontSize: 18, fontWeight: 'bold', color: '#555', marginBottom: 8 },
  emptySubtext: { fontSize: 14, color: '#888', textAlign: 'center', paddingHorizontal: 20 }
});