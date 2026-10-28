// src/app/coach/club.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getAuthToken } from '../../lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import { API_BASE, Colors, CardSpec } from '../../constants/designSystem';

interface ClubInfo {
  id: string;
  name: string;
  region: string;
  contactEmail?: string;
  contactPhone?: string;
  isVerified?: boolean;
}

const CLUB_API = `${API_BASE}/club`;

export default function ClubScreen() {
  const [club, setClub] = useState<ClubInfo | null>(null);
  const [playerCount, setPlayerCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchClubInfo();
  }, []);

  const fetchClubInfo = async () => {
    try {
      const token = await getAuthToken();
      const response = await fetch(CLUB_API, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();

      if (response.ok && data?.club) {
        setClub(data.club);
        setPlayerCount(data.playerCount || 0);
      } else {
        Alert.alert(`Club request failed (${response.status})`, data?.error || 'Unexpected response from server.');
      }
    } catch (error) {
      Alert.alert('Network Fetch Failed', String(error));
      console.error('Error fetching club info:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (!club) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={48} color={Colors.warningText} />
          <Text style={[styles.errorText, { marginTop: 10 }]}>Club information not linked or found.</Text>
          <Text style={{ fontSize: 12, color: Colors.textSecondary, textAlign: 'center', marginTop: 6, paddingHorizontal: 30 }}>
            Ensure your coach account is linked to an active academy or provisional grassroots club profile in the backend sync settings.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.heroSection}>
          <View style={styles.avatarPlaceholder}>
            <Text style={styles.avatarText}>{club.name.charAt(0)}</Text>
          </View>
          <Text style={styles.clubName}>{club.name}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <Ionicons name="location-outline" size={14} color="#666" />
            <Text style={styles.region}>Region: {club.region || 'Kigali'}</Text>
          </View>
          <View style={[styles.verifyPill, club.isVerified ? styles.verifiedBg : styles.provisionalBg]}>
            <Text style={[styles.verifyText, club.isVerified ? { color: '#047857' } : { color: '#B45309' }]}>
              {club.isVerified ? 'Verified Club' : 'Provisional Academy (Under Review)'}
            </Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Club Statistics</Text>
        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{playerCount}</Text>
            <Text style={styles.statLabel}>Registered Athletes</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statNumber, { fontSize: 22 }]}>Active</Text>
            <Text style={styles.statLabel}>Sync Status</Text>
          </View>
        </View>

        {/* Contact & Academy Details Section */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Contact & Institutional Details</Text>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Official Contact Email:</Text>
            <Text style={styles.infoVal}>{club.contactEmail || 'coach@academy.rw'}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Contact Phone:</Text>
            <Text style={styles.infoVal}>{club.contactPhone || '+250 788 000 000'}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Entity Classification:</Text>
            <Text style={styles.infoVal}>Grassroots Academy / Youth Development Hub</Text>
          </View>
        </View>
        
        <View style={styles.infoCard}>
          <Text style={styles.infoText}>
            As a registered coach for {club.name}, all athletes you evaluate and sync while offline will be automatically assigned to this institutional roster.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.canvas, padding: 20 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  errorText: { fontSize: 16, color: Colors.danger, fontWeight: 'bold' },
  heroSection: { alignItems: 'center', backgroundColor: '#fff', padding: 30, borderRadius: 12, elevation: 3, marginBottom: 20, marginTop: 10 },
  avatarPlaceholder: { width: 80, height: 80, borderRadius: 40, backgroundColor: Colors.primary, justifyContent: 'center', alignItems: 'center', marginBottom: 15 },
  avatarText: { fontSize: 36, color: '#fff', fontWeight: 'bold' },
  clubName: { fontSize: 24, fontWeight: 'bold', color: Colors.textPrimary, textAlign: 'center' },
  region: { fontSize: 14, color: Colors.textSecondary },
  verifyPill: { marginTop: 10, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  verifiedBg: { backgroundColor: '#D1FAE5' },
  provisionalBg: { backgroundColor: '#FEF3C7' },
  verifyText: { fontSize: 11, fontWeight: 'bold' },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: Colors.textPrimary, marginBottom: 12 },
  statsGrid: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  statCard: { flex: 0.48, backgroundColor: '#fff', padding: 20, borderRadius: 10, elevation: 2, alignItems: 'center' },
  statNumber: { fontSize: 28, fontWeight: 'bold', color: Colors.primary, marginBottom: 5 },
  statLabel: { fontSize: 12, color: Colors.textSecondary, fontWeight: '600', textAlign: 'center' },
  card: { ...CardSpec, padding: 16, marginBottom: 20 },
  infoRow: { marginVertical: 6 },
  infoLabel: { fontSize: 12, fontWeight: 'bold', color: Colors.textSecondary },
  infoVal: { fontSize: 14, color: Colors.textPrimary, fontWeight: '600', marginTop: 2 },
  infoCard: { backgroundColor: Colors.secondaryLight, padding: 20, borderRadius: 10, borderWidth: 1, borderColor: Colors.secondaryBorder },
  infoText: { fontSize: 14, color: Colors.secondary, lineHeight: 22, textAlign: 'center' }
});