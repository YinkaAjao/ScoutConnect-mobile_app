import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, SafeAreaView, ActivityIndicator } from 'react-native';
import * as SecureStore from 'expo-secure-store';

interface ClubInfo {
  id: string;
  name: string;
  region: string;
}

const CLUB_API = 'https://scoutconnect.onrender.com/api/club';

export default function ClubScreen() {
  const [club, setClub] = useState<ClubInfo | null>(null);
  const [playerCount, setPlayerCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchClubInfo();
  }, []);

  const fetchClubInfo = async () => {
    try {
      const token = await SecureStore.getItemAsync('userToken');
      const response = await fetch(CLUB_API, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      
      if (response.ok) {
        setClub(data.club);
        setPlayerCount(data.playerCount);
      }
    } catch (error) {
      console.error('Error fetching club info:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2E8B57" />
      </View>
    );
  }

  if (!club) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Club information not found.</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.heroSection}>
        <View style={styles.avatarPlaceholder}>
          <Text style={styles.avatarText}>{club.name.charAt(0)}</Text>
        </View>
        <Text style={styles.clubName}>{club.name}</Text>
        <Text style={styles.region}>Region: {club.region || 'Not specified'}</Text>
      </View>

      <Text style={styles.sectionTitle}>Club Statistics</Text>
      <View style={styles.statsGrid}>
        
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{playerCount}</Text>
          <Text style={styles.statLabel}>Registered Athletes</Text>
        </View>

        <View style={styles.statCard}>
          <Text style={styles.statNumber}>Active</Text>
          <Text style={styles.statLabel}>Sync Status</Text>
        </View>

      </View>
      
      <View style={styles.infoCard}>
        <Text style={styles.infoText}>
          As a registered coach for {club.name}, all athletes you evaluate and sync while offline will be automatically assigned to this roster.
        </Text>
      </View>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f4f4', padding: 20 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { fontSize: 16, color: '#d9534f' },
  heroSection: { alignItems: 'center', backgroundColor: '#fff', padding: 30, borderRadius: 12, elevation: 3, marginBottom: 25, marginTop: 10 },
  avatarPlaceholder: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#2E8B57', justifyContent: 'center', alignItems: 'center', marginBottom: 15 },
  avatarText: { fontSize: 36, color: '#fff', fontWeight: 'bold' },
  clubName: { fontSize: 24, fontWeight: 'bold', color: '#111', textAlign: 'center' },
  region: { fontSize: 14, color: '#666', marginTop: 5 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#333', marginBottom: 15 },
  statsGrid: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 25 },
  statCard: { flex: 0.48, backgroundColor: '#fff', padding: 20, borderRadius: 10, elevation: 2, alignItems: 'center' },
  statNumber: { fontSize: 28, fontWeight: 'bold', color: '#2E8B57', marginBottom: 5 },
  statLabel: { fontSize: 12, color: '#666', fontWeight: '600', textAlign: 'center' },
  infoCard: { backgroundColor: '#eef5fe', padding: 20, borderRadius: 10, borderWidth: 1, borderColor: '#d0e3ff' },
  infoText: { fontSize: 14, color: '#0056b3', lineHeight: 22, textAlign: 'center' }
});