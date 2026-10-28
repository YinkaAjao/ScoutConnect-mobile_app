// src/app/coach/club.tsx
import React, { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView, Alert, TouchableOpacity, Modal, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch } from '../../lib/api';
import { Colors, CardSpec } from '../../constants/designSystem';
import { ENTITY_TYPES } from '../../constants/entityTypes';
import VerificationCard from '../../components/VerificationCard';
import ScoutRequestsCard from '../../components/ScoutRequestsCard';
import { verificationLabel } from '../../lib/verification';

interface ClubInfo {
  id: string;
  name: string;
  region?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  entityType?: string | null;
  isVerified?: boolean;
  verificationStatus?: string | null;
}

interface Member {
  id: string;
  username: string;
  email: string;
  phone?: string | null;
  clubRole?: string | null;
  membershipStatus?: string | null;
}

const NOT_PROVIDED = 'Not provided';

export default function ClubScreen() {
  const [club, setClub] = useState<ClubInfo | null>(null);
  const [playerCount, setPlayerCount] = useState(0);
  const [membership, setMembership] = useState<'Active' | 'Pending' | 'Rejected'>('Active');
  const [isOwner, setIsOwner] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [verificationKey, setVerificationKey] = useState(0); // bumped to make the verification card reload
  const [form, setForm] = useState({ name: '', region: '', contactEmail: '', contactPhone: '', entityType: '' });

  const loadMembers = async () => {
    try {
      setMembers(await apiFetch('/club/members'));
    } catch (e) {
      console.log('Could not load club members:', e);
    }
  };

  const fetchClubInfo = async () => {
    try {
      const data = await apiFetch('/club');
      setClub(data.club);
      setPlayerCount(data.playerCount || 0);
      const status = data.membershipStatus || 'Active';
      setMembership(status);
      const owner = (data.coachProfile?.clubRole || 'Owner') === 'Owner';
      setIsOwner(owner);
      setError(null);
      if (status === 'Active' && owner) await loadMembers();
    } catch (e: any) {
      setClub(null);
      setError(e?.message || 'Could not load your club.');
    } finally {
      setLoading(false);
    }
  };

  // Refetch whenever the tab gains focus; the tab stays mounted, so a mount-only fetch keeps stale results.
  useFocusEffect(
    useCallback(() => {
      fetchClubInfo();
    }, [])
  );

  const decideMember = (member: Member, action: 'approve' | 'reject') => {
    const verb = action === 'approve' ? 'Approve' : 'Decline';
    Alert.alert(`${verb} ${member.username}?`, action === 'approve'
      ? `${member.username} will be able to view this club's roster and sync evaluations to it.`
      : `${member.username} will not get access to this club.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: verb,
        style: action === 'reject' ? 'destructive' : 'default',
        onPress: async () => {
          try {
            await apiFetch(`/club/members/${member.id}`, { method: 'PUT', body: { action } });
            await loadMembers();
          } catch (e: any) {
            Alert.alert('Could not update member', e?.message || String(e));
          }
        },
      },
    ]);
  };

  const openEditor = () => {
    if (!club) return;
    setForm({
      name: club.name,
      region: club.region ?? '',
      contactEmail: club.contactEmail ?? '',
      contactPhone: club.contactPhone ?? '',
      entityType: club.entityType ?? '',
    });
    setEditing(true);
  };

  const saveClub = async () => {
    if (!form.name.trim()) {
      Alert.alert('Missing Name', 'The club name cannot be empty.');
      return;
    }
    setSaving(true);
    try {
      const data = await apiFetch('/club', { method: 'PUT', body: { ...form, entityType: form.entityType || undefined } });
      setClub(data.club);
      setEditing(false);
      if (data.verificationReset) {
        setVerificationKey((k) => k + 1);
        Alert.alert('Verification removed', 'Changing the club name or classification means the club needs to be reviewed again. You can request verification from this screen.');
      }
    } catch (e: any) {
      Alert.alert('Could not save changes', e?.message || String(e));
    } finally {
      setSaving(false);
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
          <Text style={[styles.errorText, { marginTop: 10 }]}>{error ? "Couldn't load your club" : 'Club information not linked or found.'}</Text>
          <Text style={styles.centerSub}>
            {error ?? 'Ensure your coach account is linked to an academy or club profile.'}
          </Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => { setLoading(true); fetchClubInfo(); }} accessibilityRole="button">
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (membership !== 'Active') {
    const pending = membership === 'Pending';
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Ionicons name={pending ? 'time-outline' : 'close-circle-outline'} size={52} color={pending ? Colors.warningText : Colors.danger} />
          <Text style={[styles.errorText, { marginTop: 10, color: Colors.textPrimary }]}>
            {pending ? 'Awaiting approval' : 'Request declined'}
          </Text>
          <Text style={styles.centerSub}>
            {pending
              ? `Your request to join ${club.name} has been sent to the club owner. You'll get access to the roster once it is approved.`
              : `Your request to join ${club.name} was declined. Contact the club owner, or register a different academy.`}
          </Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => { setLoading(true); fetchClubInfo(); }} accessibilityRole="button">
            <Text style={styles.retryText}>Check again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const pendingMembers = members.filter((m) => m.membershipStatus === 'Pending');
  const otherMembers = members.filter((m) => m.membershipStatus !== 'Pending');

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
            <Text style={styles.region}>Region: {club.region || NOT_PROVIDED}</Text>
          </View>
          <View style={[styles.verifyPill, club.isVerified ? styles.verifiedBg : styles.provisionalBg]}>
            <Text style={[styles.verifyText, club.isVerified ? { color: '#047857' } : { color: '#B45309' }]}>
              {verificationLabel(club)}
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
            <Text style={[styles.statNumber, { fontSize: 22 }]}>{members.filter((m) => m.membershipStatus !== 'Rejected').length || 1}</Text>
            <Text style={styles.statLabel}>Coaches</Text>
          </View>
        </View>

        {isOwner && pendingMembers.length > 0 && (
          <View style={[styles.card, styles.requestsCard]}>
            <Text style={styles.sectionTitle}>Join Requests ({pendingMembers.length})</Text>
            {pendingMembers.map((m) => (
              <View key={m.id} style={styles.memberRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.memberName}>{m.username}</Text>
                  <Text style={styles.memberMeta}>{m.email}{m.phone ? ` • ${m.phone}` : ''}</Text>
                </View>
                <TouchableOpacity style={[styles.memberBtn, styles.approveBtn]} onPress={() => decideMember(m, 'approve')} accessibilityRole="button" accessibilityLabel={`Approve ${m.username}`}>
                  <Ionicons name="checkmark" size={16} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity style={[styles.memberBtn, styles.declineBtn]} onPress={() => decideMember(m, 'reject')} accessibilityRole="button" accessibilityLabel={`Decline ${m.username}`}>
                  <Ionicons name="close" size={16} color="#fff" />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>Contact & Institutional Details</Text>
            {isOwner && (
              <TouchableOpacity style={styles.editBtn} onPress={openEditor} accessibilityRole="button" accessibilityLabel="Edit club details">
                <Ionicons name="create-outline" size={14} color={Colors.primary} />
                <Text style={styles.editBtnText}>Edit</Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Official Contact Email:</Text>
            <Text style={styles.infoVal}>{club.contactEmail || NOT_PROVIDED}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Contact Phone:</Text>
            <Text style={styles.infoVal}>{club.contactPhone || NOT_PROVIDED}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Entity Classification:</Text>
            <Text style={styles.infoVal}>{club.entityType || NOT_PROVIDED}</Text>
          </View>
          {!isOwner && <Text style={styles.ownerNote}>Only the club owner can edit these details.</Text>}
        </View>

        {isOwner && otherMembers.length > 1 && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Coaches</Text>
            {otherMembers.map((m) => (
              <View key={m.id} style={styles.memberRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.memberName}>{m.username}</Text>
                  <Text style={styles.memberMeta}>{m.clubRole === 'Member' ? 'Member' : 'Owner'} • {m.membershipStatus}</Text>
                </View>
                {m.clubRole === 'Member' && m.membershipStatus === 'Active' && (
                  <TouchableOpacity onPress={() => decideMember(m, 'reject')} accessibilityRole="button" accessibilityLabel={`Remove ${m.username} from the club`}>
                    <Text style={styles.removeText}>Remove</Text>
                  </TouchableOpacity>
                )}
                {m.membershipStatus === 'Rejected' && (
                  <TouchableOpacity onPress={() => decideMember(m, 'approve')} accessibilityRole="button" accessibilityLabel={`Approve ${m.username}`}>
                    <Text style={styles.approveText}>Approve</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>
        )}

        {isOwner && <ScoutRequestsCard />}

        <VerificationCard refreshKey={verificationKey} />

        <View style={styles.infoCard}>
          <Text style={styles.infoText}>
            As a registered coach for {club.name}, all athletes you evaluate and sync while offline will be automatically assigned to this institutional roster.
          </Text>
        </View>
      </ScrollView>

      <Modal visible={editing} animationType="slide" transparent onRequestClose={() => setEditing(false)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Edit Club Details</Text>
            {club.isVerified && (
              <Text style={styles.verifiedWarning}>This club is verified. Changing its name or classification will remove the Verified badge until it is reviewed again.</Text>
            )}
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.infoLabel}>Club / Academy Name *</Text>
              <TextInput style={styles.input} value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} />

              <Text style={styles.infoLabel}>District / Region</Text>
              <TextInput style={styles.input} value={form.region} onChangeText={(v) => setForm({ ...form, region: v })} placeholder="e.g. Kigali (Gasabo)" />

              <Text style={styles.infoLabel}>Official Contact Email</Text>
              <TextInput style={styles.input} value={form.contactEmail} onChangeText={(v) => setForm({ ...form, contactEmail: v })} keyboardType="email-address" autoCapitalize="none" />

              <Text style={styles.infoLabel}>Contact Phone</Text>
              <TextInput style={styles.input} value={form.contactPhone} onChangeText={(v) => setForm({ ...form, contactPhone: v })} keyboardType="phone-pad" />

              <Text style={styles.infoLabel}>Entity Classification</Text>
              <View style={styles.chipRow}>
                {ENTITY_TYPES.map((type) => (
                  <TouchableOpacity
                    key={type}
                    style={[styles.chip, form.entityType === type && styles.chipActive]}
                    onPress={() => setForm({ ...form, entityType: type })}
                    accessibilityRole="button"
                    accessibilityState={{ selected: form.entityType === type }}
                  >
                    <Text style={[styles.chipText, form.entityType === type && styles.chipTextActive]}>{type}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditing(false)} disabled={saving}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={saveClub} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save Changes</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.canvas, padding: 20 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  centerSub: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', marginTop: 6, paddingHorizontal: 30, lineHeight: 19 },
  errorText: { fontSize: 16, color: Colors.danger, fontWeight: 'bold' },
  retryBtn: { marginTop: 16, backgroundColor: Colors.primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
  retryText: { color: '#fff', fontWeight: 'bold' },
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
  requestsCard: { borderWidth: 1, borderColor: '#FCD34D' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: Colors.primaryLight },
  editBtnText: { fontSize: 12, fontWeight: 'bold', color: Colors.primary },
  ownerNote: { fontSize: 11, color: Colors.textSecondary, fontStyle: 'italic', marginTop: 8 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  memberName: { fontSize: 14, fontWeight: 'bold', color: Colors.textPrimary },
  memberMeta: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  memberBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  approveBtn: { backgroundColor: Colors.primary },
  declineBtn: { backgroundColor: Colors.danger },
  removeText: { fontSize: 12, fontWeight: 'bold', color: Colors.danger },
  approveText: { fontSize: 12, fontWeight: 'bold', color: Colors.primary },
  verifiedWarning: { fontSize: 12, color: '#B45309', backgroundColor: '#FEF3C7', padding: 10, borderRadius: 8, marginBottom: 12, lineHeight: 17 },
  infoRow: { marginVertical: 6 },
  infoLabel: { fontSize: 12, fontWeight: 'bold', color: Colors.textSecondary },
  infoVal: { fontSize: 14, color: Colors.textPrimary, fontWeight: '600', marginTop: 2 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalContent: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '90%' },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: Colors.textPrimary, marginBottom: 12 },
  input: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, marginTop: 4, marginBottom: 12, color: Colors.textPrimary },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6, marginBottom: 12 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: '#D1D5DB' },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: 12, color: Colors.textPrimary, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  cancelBtn: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: '#D1D5DB' },
  cancelBtnText: { fontWeight: 'bold', color: Colors.textSecondary },
  saveBtn: { flex: 1.4, alignItems: 'center', paddingVertical: 12, borderRadius: 10, backgroundColor: Colors.primary },
  saveBtnText: { fontWeight: 'bold', color: '#fff' },
  infoCard: { backgroundColor: Colors.secondaryLight, padding: 20, borderRadius: 10, borderWidth: 1, borderColor: Colors.secondaryBorder },
  infoText: { fontSize: 14, color: Colors.secondary, lineHeight: 22, textAlign: 'center' }
});
