// src/app/coach/profile.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Alert, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { Ionicons } from '@expo/vector-icons';
import { createClient } from '@supabase/supabase-js';
import { API_BASE, Colors, CardSpec } from '../../constants/designSystem';
import { 
  initDB, 
  getDraftEvaluations, 
  getUnsyncedEvaluations, 
  getUnsyncedMatchStats, 
  getUnsyncedAchievements 
} from '../../../database';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'placeholder';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

interface ClubInfo {
  id: string;
  name: string;
  region: string;
  contactEmail?: string;
  contactPhone?: string;
  isVerified?: boolean;
  standingStatus?: 'Good' | 'Penalized' | 'Suspended';
  trustScore?: number;
}

export default function CoachProfileScreen() {
  const router = useRouter();

  const [club, setClub] = useState<ClubInfo | null>(null);
  const [coachProfile, setCoachProfile] = useState<any>(null);
  const [playerCount, setPlayerCount] = useState<number>(0);
  const [draftCount, setDraftCount] = useState<number>(0);
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeModal, setActiveModal] = useState<'account' | 'support' | null>(null);

  useEffect(() => {
    loadProfileData();
  }, []);

  const loadProfileData = async () => {
    setLoading(true);
    try {
      await initDB();
      const drafts = await getDraftEvaluations();
      const evals = await getUnsyncedEvaluations();
      const stats = await getUnsyncedMatchStats();
      const achs = await getUnsyncedAchievements();

      setDraftCount(drafts.length);
      setPendingSyncCount(evals.length + stats.length + achs.length);

      const token = await SecureStore.getItemAsync('userToken');
      if (token) {
        const response = await fetch(`${API_BASE}/club`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
          const data = await response.json();
          setClub(data.club);
          setPlayerCount(data.playerCount || 0);
          setCoachProfile(data.coachProfile);
        }
      }
    } catch (error) {
      console.log('Profile fetch note (offline or unlinked):', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to log out? Your local SQLite drafts and unsynced evaluations will remain safely stored on this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Out',
          style: 'destructive',
          onPress: async () => {
            await supabase.auth.signOut();
            await SecureStore.deleteItemAsync('userToken');
            await SecureStore.deleteItemAsync('userRole');
            router.replace('/');
          }
        }
      ]
    );
  };

  const standing = club?.standingStatus || 'Good';
  const trustScore = club?.trustScore ?? 100;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 30 }}>
        
        {/* Top Status Banner */}
        <View style={styles.topBanner}>
          <View style={styles.rowCenter}>
            <Ionicons name="shield-checkmark" size={14} color={Colors.warningText} />
            <Text style={styles.topBannerText}>CRYPTOGRAPHIC EVALUATION SIGNING ACTIVE</Text>
          </View>
          <TouchableOpacity onPress={loadProfileData} style={styles.refreshPill}>
            <Ionicons name="refresh" size={12} color={Colors.warningText} />
            <Text style={styles.refreshPillText}>Refresh</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.header}>Coach Profile</Text>

        {/* Hero Identity Card */}
        <View style={styles.heroCard}>
          <View style={styles.heroTopRow}>
            <View style={styles.avatarCircle}>
              <Ionicons name="person" size={30} color="#FFF" />
            </View>
            <View style={{ flex: 1, marginLeft: 14 }}>
              <View style={styles.rowCenter}>
                <Text style={styles.heroTitle}>{coachProfile?.username || 'Academy Coach'}</Text>
                <Ionicons 
                  name={club?.isVerified ? "checkmark-circle" : "time-outline"} 
                  size={16} 
                  color="#A7F3D0" 
                  style={{ marginLeft: 6 }} 
                />
              </View>
              <Text style={styles.heroSubtitle}>
                {club?.name || 'Kigali Regional Hub'} • {club?.isVerified ? 'Verified Club' : 'Provisional Academy'}
              </Text>
            </View>
            <View style={styles.roleBadge}>
              <Text style={styles.roleBadgeText}>COACH</Text>
            </View>
          </View>

          <View style={styles.heroMetricsRow}>
            <View style={styles.heroMetricBox}>
              <Text style={styles.heroMetricVal}>{playerCount}</Text>
              <Text style={styles.heroMetricLabel}>Synced Players</Text>
            </View>
            <View style={styles.heroMetricDivider} />
            <View style={styles.heroMetricBox}>
              <Text style={styles.heroMetricVal}>{trustScore}%</Text>
              <Text style={styles.heroMetricLabel}>Trust Score</Text>
            </View>
            <View style={styles.heroMetricDivider} />
            <View style={styles.heroMetricBox}>
              <Text style={[styles.heroMetricVal, standing !== 'Good' && { color: '#FCA5A5' }]}>{standing}</Text>
              <Text style={styles.heroMetricLabel}>Standing</Text>
            </View>
          </View>
        </View>

        {/* Accountability & Standing Card */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <View style={styles.rowCenter}>
              <Ionicons name="ribbon-outline" size={18} color={Colors.primary} />
              <Text style={styles.sectionTitle}>Academy Accountability Standing</Text>
            </View>
            <View style={[styles.statusPill, standing === 'Good' ? styles.statusGood : styles.statusPenalized]}>
              <Text style={[styles.statusPillText, standing === 'Good' ? { color: Colors.primary } : { color: Colors.danger }]}>
                {standing.toUpperCase()}
              </Text>
            </View>
          </View>
          <Text style={styles.sectionDesc}>
            Every player evaluation synced from your device is signed with an HMAC SHA-256 digital signature tied to your credentials. Maintaining accurate telemetry preserves your academy's regional trust score.
          </Text>
        </View>

        {/* Local SQLite Storage Summary Card */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <View style={styles.rowCenter}>
              <Ionicons name="hardware-chip-outline" size={18} color={Colors.secondary} />
              <Text style={styles.sectionTitle}>Pitchside Local Storage</Text>
            </View>
            {loading && <ActivityIndicator size="small" color={Colors.primary} />}
          </View>

          <View style={styles.storageGrid}>
            <View style={styles.storageBox}>
              <Ionicons name="document-text-outline" size={22} color={Colors.secondary} />
              <Text style={styles.storageCount}>{draftCount}</Text>
              <Text style={styles.storageLabel}>Staged Drafts</Text>
            </View>
            <View style={styles.storageBox}>
              <Ionicons name="cloud-upload-outline" size={22} color={Colors.primary} />
              <Text style={styles.storageCount}>{pendingSyncCount}</Text>
              <Text style={styles.storageLabel}>Ready to Sync</Text>
            </View>
          </View>

          <TouchableOpacity style={styles.actionOutlineBtn} onPress={() => router.push('/coach')}>
            <Ionicons name="create-outline" size={16} color={Colors.primary} />
            <Text style={styles.actionOutlineText}>Go to Evaluation Checklist & Queue</Text>
          </TouchableOpacity>
        </View>

        {/* Settings & Support Menu */}
        <View style={styles.menuCard}>
          <TouchableOpacity style={styles.menuRow} onPress={() => setActiveModal('account')}>
            <View style={styles.rowCenter}>
              <View style={[styles.menuIconBox, { backgroundColor: Colors.primaryLight }]}>
                <Ionicons name="settings-outline" size={18} color={Colors.primary} />
              </View>
              <View>
                <Text style={styles.menuItemTitle}>My Contact & Academy Details</Text>
                <Text style={styles.menuItemSub}>View personal profile & verification state</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.textSecondary} />
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity style={styles.menuRow} onPress={() => setActiveModal('support')}>
            <View style={styles.rowCenter}>
              <View style={[styles.menuIconBox, { backgroundColor: Colors.secondaryLight }]}>
                <Ionicons name="help-buoy-outline" size={18} color={Colors.secondary} />
              </View>
              <View>
                <Text style={styles.menuItemTitle}>Help & Pitchside Support</Text>
                <Text style={styles.menuItemSub}>Offline sync guide & regional hub desk</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.textSecondary} />
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn}>
            <Ionicons name="log-out-outline" size={18} color={Colors.danger} />
            <Text style={styles.logoutText}>Sign Out of Academy</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>

      {/* Modal for Account Settings / Support */}
      <Modal visible={activeModal !== null} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {activeModal === 'account' ? (
              <>
                <View style={styles.rowCenter}>
                  <Ionicons name="shield-outline" size={20} color={Colors.primary} />
                  <Text style={styles.modalTitle}>My Contact & Academy Details</Text>
                </View>
                <View style={styles.infoList}>
                  <Text style={styles.infoLabel}>My Registered Email</Text>
                  <Text style={styles.infoVal}>{coachProfile?.email || 'Not provided'}</Text>

                  <Text style={styles.infoLabel}>My Phone Number</Text>
                  <Text style={styles.infoVal}>{coachProfile?.phone || 'Not provided'}</Text>

                  <Text style={styles.infoLabel}>Assigned Club / Academy</Text>
                  <Text style={styles.infoVal}>{club?.name || 'Synced on next connection'}</Text>

                  <Text style={styles.infoLabel}>Regional Hub</Text>
                  <Text style={styles.infoVal}>{club?.region || 'Kigali'}</Text>
                </View>
              </>
            ) : (
              <>
                <View style={styles.rowCenter}>
                  <Ionicons name="help-circle-outline" size={20} color={Colors.secondary} />
                  <Text style={styles.modalTitle}>Help & Pitchside Support</Text>
                </View>
                <Text style={styles.supportParagraph}>
                  • <Text style={{ fontWeight: 'bold' }}>Staged Evaluations:</Text> Use "Save Draft" during live matches to store incomplete checklists locally. Drafts will not sync to scouts until you submit Stage 5.
                </Text>
                <Text style={styles.supportParagraph}>
                  • <Text style={{ fontWeight: 'bold' }}>Conflict Resolution:</Text> When multiple coaches evaluate the same player offline, the cloud server merges evaluations chronologically and preserves your cryptographic signature.
                </Text>
                <Text style={styles.supportParagraph}>
                  • <Text style={{ fontWeight: 'bold' }}>Regional Hub Desk:</Text> Contact support@scoutconnect.rw for academy verification inquiries.
                </Text>
              </>
            )}

            <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setActiveModal(null)}>
              <Text style={styles.modalCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.canvas, paddingHorizontal: 15, paddingTop: 10 },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  topBanner: { backgroundColor: Colors.warningBg, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, marginBottom: 12 },
  topBannerText: { color: Colors.warningText, fontWeight: 'bold', fontSize: 10 },
  refreshPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#FFF', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  refreshPillText: { color: Colors.warningText, fontSize: 10, fontWeight: 'bold' },
  header: { fontSize: 24, fontWeight: 'bold', marginBottom: 14, color: Colors.textPrimary },
  
  heroCard: { backgroundColor: Colors.primary, borderRadius: 14, padding: 18, marginBottom: 15, elevation: 3 },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  avatarCircle: { width: 54, height: 54, borderRadius: 27, backgroundColor: Colors.primaryDark, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#A7F3D0' },
  heroTitle: { fontSize: 18, fontWeight: 'bold', color: '#FFF' },
  heroSubtitle: { fontSize: 12, color: '#A7F3D0', marginTop: 2 },
  roleBadge: { backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  roleBadgeText: { color: '#FFF', fontSize: 10, fontWeight: 'bold' },
  heroMetricsRow: { flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.15)', borderRadius: 10, paddingVertical: 10 },
  heroMetricBox: { flex: 1, alignItems: 'center' },
  heroMetricDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.2)' },
  heroMetricVal: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },
  heroMetricLabel: { color: '#A7F3D0', fontSize: 11, marginTop: 2 },

  card: { ...CardSpec, padding: 16, marginBottom: 15 },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  sectionTitle: { fontSize: 15, fontWeight: 'bold', color: Colors.textPrimary },
  sectionDesc: { fontSize: 12, color: Colors.textSecondary, lineHeight: 18 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusGood: { backgroundColor: Colors.primaryLight },
  statusPenalized: { backgroundColor: '#FEE2E2' },
  statusPillText: { fontSize: 10, fontWeight: 'bold' },

  storageGrid: { flexDirection: 'row', gap: 10, marginVertical: 10 },
  storageBox: { flex: 1, backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: Colors.border, borderRadius: 10, padding: 12, alignItems: 'center' },
  storageCount: { fontSize: 20, fontWeight: 'bold', color: Colors.textPrimary, marginTop: 4 },
  storageLabel: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  actionOutlineBtn: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingVertical: 10, borderRadius: 8, backgroundColor: Colors.primaryLight, marginTop: 4 },
  actionOutlineText: { color: Colors.primary, fontWeight: 'bold', fontSize: 13 },

  menuCard: { ...CardSpec, padding: 12 },
  menuRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4 },
  menuIconBox: { width: 36, height: 36, borderRadius: 8, justifyContent: 'center', alignItems: 'center', marginRight: 4 },
  menuItemTitle: { fontSize: 14, fontWeight: 'bold', color: Colors.textPrimary },
  menuItemSub: { fontSize: 11, color: Colors.textSecondary, marginTop: 1 },
  divider: { height: 1, backgroundColor: Colors.border, marginVertical: 4 },
  logoutBtn: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, paddingVertical: 14, marginTop: 4 },
  logoutText: { color: Colors.danger, fontSize: 15, fontWeight: 'bold' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#FFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  modalTitle: { fontSize: 17, fontWeight: 'bold', color: Colors.textPrimary },
  infoList: { marginVertical: 14 },
  infoLabel: { fontSize: 11, fontWeight: 'bold', color: Colors.textSecondary, marginTop: 10 },
  infoVal: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary, marginTop: 2 },
  supportParagraph: { fontSize: 13, color: Colors.textSecondary, lineHeight: 20, marginTop: 12 },
  modalCloseBtn: { marginTop: 18, padding: 12, backgroundColor: Colors.primary, borderRadius: 8, alignItems: 'center' },
  modalCloseText: { color: '#FFF', fontWeight: 'bold', fontSize: 14 }
});