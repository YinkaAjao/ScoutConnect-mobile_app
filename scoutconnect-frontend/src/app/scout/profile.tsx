// src/app/scout/profile.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Alert, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { supabase } from '../../lib/supabase';
import { apiFetch } from '../../lib/api';
import { Ionicons } from '@expo/vector-icons';
import { Colors, CardSpec } from '../../constants/designSystem';

const ACCREDITATION_LABEL: Record<string, string> = {
  Pending: 'Not applied',
  Submitted: 'Under review',
  Approved: 'Approved',
  Rejected: 'Declined',
  Suspended: 'Suspended',
};

export default function ScoutProfileScreen() {
  const router = useRouter();

  const [shortlistCount, setShortlistCount] = useState<number>(0);
  const [me, setMe] = useState<{ username: string; email: string; phone: string | null; createdAt: string | null; accreditationStatus?: string } | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeModal, setActiveModal] = useState<'account' | 'support' | null>(null);

  useEffect(() => {
    loadScoutStats();
  }, []);

  const loadScoutStats = async () => {
    setLoading(true);
    const [account, shortlist] = await Promise.allSettled([apiFetch('/me'), apiFetch('/shortlist')]);
    if (account.status === 'fulfilled') setMe(account.value);
    else console.log('Could not load account details:', account.reason);
    if (shortlist.status === 'fulfilled' && Array.isArray(shortlist.value)) setShortlistCount(shortlist.value.length);
    setLoading(false);
  };

  const handleLogout = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to log out of your Scout portal?',
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

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 30 }}>
        
        {/* Top Status Banner */}
        <View style={styles.topBanner}>
          <View style={styles.rowCenter}>
            <Ionicons name="globe-outline" size={14} color={Colors.warningText} />
            <Text style={styles.topBannerText}>SCOUT ACCOUNT</Text>
          </View>
          <TouchableOpacity onPress={loadScoutStats} style={styles.refreshPill}>
            <Ionicons name="refresh" size={12} color={Colors.warningText} />
            <Text style={styles.refreshPillText}>Sync</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.header}>Scout Profile</Text>

        {/* Scout Hero Card */}
        <View style={styles.heroCard}>
          <View style={styles.heroTopRow}>
            <View style={styles.avatarCircle}>
              <Ionicons name="binoculars" size={26} color="#FFF" />
            </View>
            <View style={{ flex: 1, marginLeft: 14 }}>
              <View style={styles.rowCenter}>
                <Text style={styles.heroTitle}>{me?.username || (loading ? 'Loading…' : 'Name not set')}</Text>
              </View>
              <Text style={styles.heroSubtitle}>{me?.email || ''}</Text>
              <Text style={styles.heroSubtitle}>Accreditation: {ACCREDITATION_LABEL[me?.accreditationStatus ?? ''] ?? (loading ? 'Checking…' : 'Not applied')}</Text>
            </View>
            <View style={styles.roleBadge}>
              <Text style={styles.roleBadgeText}>SCOUT</Text>
            </View>
          </View>

          <View style={styles.heroMetricsRow}>
            <View style={styles.heroMetricBox}>
              <Text style={styles.heroMetricVal}>{loading ? '...' : shortlistCount}</Text>
              <Text style={styles.heroMetricLabel}>Shortlisted</Text>
            </View>
            <View style={styles.heroMetricDivider} />
            <View style={styles.heroMetricBox}>
              <Text style={styles.heroMetricVal}>{me?.createdAt ? new Date(me.createdAt).getFullYear() : '—'}</Text>
              <Text style={styles.heroMetricLabel}>Member Since</Text>
            </View>
          </View>
        </View>

        {/* Recruitment Tools Card */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <View style={styles.rowCenter}>
              <Ionicons name="analytics-outline" size={18} color={Colors.secondary} />
              <Text style={styles.sectionTitle}>About the Data</Text>
            </View>
            {loading && <ActivityIndicator size="small" color={Colors.secondary} />}
          </View>
          <Text style={styles.sectionDesc}>
            Evaluations in your feed come from coaches' 4-pillar checklists (Technical, Tactical, Physical, Psychological). Scores shown as N/A, or empty rings, were not rated by the coach. Athletes are shown by first name only; the club decides whether to share their full name and contact details when you send a request.
          </Text>

          <TouchableOpacity style={styles.actionOutlineBtn} onPress={() => router.push('/scout')}>
            <Ionicons name="compass-outline" size={16} color={Colors.secondary} />
            <Text style={styles.actionOutlineText}>Open Talent Discover Feed</Text>
          </TouchableOpacity>
        </View>

        {/* Settings & Support Menu */}
        <View style={styles.menuCard}>
          <TouchableOpacity style={styles.menuRow} onPress={() => setActiveModal('account')}>
            <View style={styles.rowCenter}>
              <View style={[styles.menuIconBox, { backgroundColor: Colors.secondaryLight }]}>
                <Ionicons name="person-circle-outline" size={20} color={Colors.secondary} />
              </View>
              <View>
                <Text style={styles.menuItemTitle}>My Account</Text>
                <Text style={styles.menuItemSub}>Your name, email and phone</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.textSecondary} />
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity style={styles.menuRow} onPress={() => setActiveModal('support')}>
            <View style={styles.rowCenter}>
              <View style={[styles.menuIconBox, { backgroundColor: Colors.primaryLight }]}>
                <Ionicons name="help-buoy-outline" size={18} color={Colors.primary} />
              </View>
              <View>
                <Text style={styles.menuItemTitle}>Help & Support</Text>
                <Text style={styles.menuItemSub}>How to contact clubs</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.textSecondary} />
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn}>
            <Ionicons name="log-out-outline" size={18} color={Colors.danger} />
            <Text style={styles.logoutText}>Log Out</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>

      <Modal visible={activeModal !== null} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {activeModal === 'account' ? (
              <>
                <View style={styles.rowCenter}>
                  <Ionicons name="id-card-outline" size={20} color={Colors.secondary} />
                  <Text style={styles.modalTitle}>My Account</Text>
                </View>
                <Text style={styles.supportParagraph}>
                  • <Text style={{ fontWeight: 'bold' }}>Name:</Text> {me?.username || 'Not provided'}
                </Text>
                <Text style={styles.supportParagraph}>
                  • <Text style={{ fontWeight: 'bold' }}>Email:</Text> {me?.email || 'Not provided'}
                </Text>
                <Text style={styles.supportParagraph}>
                  • <Text style={{ fontWeight: 'bold' }}>Phone:</Text> {me?.phone || 'Not provided'}
                </Text>
                <Text style={styles.supportParagraph}>
                  • <Text style={{ fontWeight: 'bold' }}>Shortlisted Athletes:</Text> {shortlistCount} prospects saved to cloud shortlist.
                </Text>
              </>
            ) : (
              <>
                <View style={styles.rowCenter}>
                  <Ionicons name="information-circle-outline" size={20} color={Colors.primary} />
                  <Text style={styles.modalTitle}>Scouting Guidelines</Text>
                </View>
                <Text style={styles.supportParagraph}>
                  • To arrange trials with youth prospects, always reach out through the club contact listed on the athlete's card. Clubs marked Verified have been reviewed by an administrator.
                </Text>
                <Text style={styles.supportParagraph}>
                  • Scores shown as N/A, or empty rings, were not rated by the coach. Ask the club for details before drawing conclusions.
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
  
  heroCard: { backgroundColor: Colors.secondary, borderRadius: 14, padding: 18, marginBottom: 15, elevation: 3 },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  avatarCircle: { width: 54, height: 54, borderRadius: 27, backgroundColor: 'rgba(0,0,0,0.2)', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#93C5FD' },
  heroTitle: { fontSize: 18, fontWeight: 'bold', color: '#FFF' },
  heroSubtitle: { fontSize: 12, color: '#DBEAFE', marginTop: 2 },
  roleBadge: { backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  roleBadgeText: { color: '#FFF', fontSize: 10, fontWeight: 'bold' },
  heroMetricsRow: { flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.15)', borderRadius: 10, paddingVertical: 10 },
  heroMetricBox: { flex: 1, alignItems: 'center' },
  heroMetricDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.2)' },
  heroMetricVal: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },
  heroMetricLabel: { color: '#DBEAFE', fontSize: 11, marginTop: 2 },

  card: { ...CardSpec, padding: 16, marginBottom: 15 },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  sectionTitle: { fontSize: 15, fontWeight: 'bold', color: Colors.textPrimary },
  sectionDesc: { fontSize: 12, color: Colors.textSecondary, lineHeight: 18, marginBottom: 12 },
  actionOutlineBtn: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingVertical: 10, borderRadius: 8, backgroundColor: Colors.secondaryLight },
  actionOutlineText: { color: Colors.secondary, fontWeight: 'bold', fontSize: 13 },

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
  supportParagraph: { fontSize: 13, color: Colors.textSecondary, lineHeight: 20, marginTop: 12 },
  modalCloseBtn: { marginTop: 18, padding: 12, backgroundColor: Colors.secondary, borderRadius: 8, alignItems: 'center' },
  modalCloseText: { color: '#FFF', fontWeight: 'bold', fontSize: 14 }
});