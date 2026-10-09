import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, SafeAreaView, TouchableOpacity, Alert, RefreshControl } from 'react-native';
import * as SecureStore from 'expo-secure-store';

interface ShortlistEntry {
  id: string;
  notes: string;
  createdAt: string;
  Player: {
    name: string;
    position: string;
    Evaluations?: { dribblingScore: number; sprintSpeed: number }[];
  };
}

const SHORTLIST_API = 'https://scoutconnect.onrender.com/api/shortlist';

export default function ShortlistScreen() {
  const [shortlist, setShortlist] = useState<ShortlistEntry[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchShortlist();
  }, []);

  const fetchShortlist = async () => {
    try {
      const token = await SecureStore.getItemAsync('userToken');
      const response = await fetch(SHORTLIST_API, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setShortlist(data);
    } catch (error) {
      console.error('Error fetching shortlist:', error);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchShortlist();
    setRefreshing(false);
  };

  const removeEntry = async (id: string, playerName: string) => {
    Alert.alert(
      "Remove Player",
      `Are you sure you want to remove ${playerName} from your shortlist?`,
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Remove", 
          style: "destructive",
          onPress: async () => {
            try {
              const token = await SecureStore.getItemAsync('userToken');
              const response = await fetch(`${SHORTLIST_API}/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
              });

              if (response.ok) {
                // Instantly remove from local UI state for snappy feedback
                setShortlist(prev => prev.filter(entry => entry.id !== id));
              } else {
                Alert.alert('Error', 'Could not remove entry.');
              }
            } catch (error) {
              Alert.alert('Error', 'Request failed.');
            }
          }
        }
      ]
    );
  };

  const renderItem = ({ item }: { item: ShortlistEntry }) => {
    const player = item.Player;
    // Safely get the latest evaluation for a quick snapshot
    const latestEval = player.Evaluations && player.Evaluations.length > 0 
      ? player.Evaluations[player.Evaluations.length - 1] 
      : null;

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View>
            <Text style={styles.name}>{player.name}</Text>
            <Text style={styles.detail}>{player.position}</Text>
          </View>
          <TouchableOpacity onPress={() => removeEntry(item.id, player.name)} style={styles.removeBtn}>
            <Text style={styles.removeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>

        {latestEval && (
          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>Pace</Text>
              <Text style={styles.statValue}>{latestEval.sprintSpeed || '--'}</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>Tech</Text>
              <Text style={styles.statValue}>{latestEval.dribblingScore || '--'}/10</Text>
            </View>
          </View>
        )}

        <View style={styles.notesBox}>
          <Text style={styles.notesTitle}>My Notes:</Text>
          <Text style={styles.notesText}>{item.notes}</Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.header}>My Shortlist</Text>
      
      <FlatList
        data={shortlist}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        refreshControl={ <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>Your shortlist is empty.</Text>
            <Text style={styles.emptySubtext}>Go to the Discover tab to find athletes.</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f4f4', padding: 15 },
  header: { fontSize: 24, fontWeight: 'bold', textAlign: 'center', marginVertical: 15, color: '#333' },
  card: { backgroundColor: '#fff', padding: 15, borderRadius: 10, marginBottom: 15, elevation: 2 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 15 },
  name: { fontSize: 18, fontWeight: 'bold', color: '#111' },
  detail: { fontSize: 14, color: '#666', marginTop: 2 },
  removeBtn: { padding: 5 },
  removeBtnText: { color: '#d9534f', fontSize: 18, fontWeight: 'bold' },
  statsRow: { flexDirection: 'row', gap: 15, marginBottom: 15 },
  statBox: { backgroundColor: '#f9f9f9', padding: 10, borderRadius: 8, alignItems: 'center', flex: 1, borderWidth: 1, borderColor: '#eee' },
  statLabel: { fontSize: 12, color: '#888', fontWeight: '600' },
  statValue: { fontSize: 16, color: '#2E8B57', fontWeight: 'bold', marginTop: 4 },
  notesBox: { backgroundColor: '#eef5fe', padding: 12, borderRadius: 8 },
  notesTitle: { fontSize: 12, fontWeight: 'bold', color: '#0056b3', marginBottom: 4 },
  notesText: { fontSize: 14, color: '#333' },
  emptyContainer: { alignItems: 'center', marginTop: 60 },
  emptyText: { fontSize: 18, fontWeight: 'bold', color: '#555', marginBottom: 8 },
  emptySubtext: { fontSize: 14, color: '#888' }
});