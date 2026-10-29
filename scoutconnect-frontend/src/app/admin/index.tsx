// src/app/admin/index.tsx
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl, ActivityIndicator, Modal, TextInput, Alert, Image, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { apiFetch } from '../../lib/api';
import { getDocumentUrl, isPdf } from '../../lib/verification';
import { Colors, CardSpec } from '../../constants/designSystem';

type Section = 'Clubs' | 'Scouts' | 'Reports';

interface ReviewDocument { id: string; docType: string; fileName: string | null; storagePath: string; }

interface ClubItem {
  id: string;
  name: string;
  region: string | null;
  entityType: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  status: string;
  statement: string | null;
  submittedAt: string | null;
  verifiedAt: string | null;
  rejectionReason: string | null;
  athleteCount: number;
  owner: { username: string; email: string; phone: string | null } | null;
  documents: ReviewDocument[];
}

interface ScoutItem {
  id: string; // the scout's user id
  name: string;
  email: string | null;
  phone: string | null;
  organisation: string | null;
  orgType: string | null;
  licenceNumber: string | null;
  statement: string | null;
  status: string;
  submittedAt: string | null;
  decidedAt: string | null;
  rejectionReason: string | null;
  documents: ReviewDocument[];
}

interface ReportItem {
  id: string;
  category: string;
  details: string;
  status: string;
  createdAt: string;
  resolutionNote: string | null;
  resolvedAt: string | null;
  athlete: { id: string; name: string; position: string; scoutHidden: boolean; scoutHiddenReason: string | null } | null;
  club: { name: string | null } | null;
  reporter: { username: string; role: string } | null;
}

type Item = ClubItem | ScoutItem | ReportItem;
type Decision = 'approve' | 'reject' | 'revoke' | 'suspend' | 'reinstate' | 'resolve' | 'dismiss';

const URGENT_CATEGORY = 'Safeguarding concern';

/** What to call an item in dialogs. */
const itemLabel = (item: Item): string => ('name' in item ? item.name : item.athlete?.name ?? 'This report');

// Status tabs per section: [status sent to the server, label shown]
const TABS: Record<Section, [string, string][]> = {
  Clubs: [['Submitted', 'Submitted'], ['Verified', 'Verified'], ['Rejected', 'Declined']],
  Scouts: [['Submitted', 'Submitted'], ['Approved', 'Approved'], ['Suspended', 'Suspended'], ['Rejected', 'Declined']],
  Reports: [['Pending', 'Pending'], ['Resolved', 'Resolved'], ['Dismissed', 'Dismissed']],
};

const ENDPOINT: Record<Section, { list: string; decide: (id: string) => string }> = {
  Clubs: { list: '/admin/verifications', decide: (id) => `/admin/verifications/${id}` },
  Scouts: { list: '/admin/scouts', decide: (id) => `/admin/scouts/${id}` },
  Reports: { list: '/admin/reports', decide: (id) => `/admin/reports/${id}` },
};

const formatDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString() : '—');

export default function AdminReviewScreen() {
  const router = useRouter();
  const [authorised, setAuthorised] = useState<boolean | null>(null);
  const [section, setSection] = useState<Section>('Clubs');
  const [tab, setTab] = useState('Submitted');
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [viewerLoading, setViewerLoading] = useState(false);

  const [decision, setDecision] = useState<{ item: Item; kind: Decision } | null>(null);
  const [reason, setReason] = useState('');
  const [hideAthlete, setHideAthlete] = useState(false); // when resolving a report: also hide the athlete from scouts
  const [deciding, setDeciding] = useState(false);

  // The server enforces admin access; this only keeps non-admins from seeing an empty screen.
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const isAdmin = session?.user?.app_metadata?.role === 'admin';
      setAuthorised(isAdmin);
      if (!isAdmin) router.replace('/');
    });
  }, []);

  const load = async () => {
    try {
      setItems(await apiFetch(`${ENDPOINT[section].list}?status=${tab}`));
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Could not load requests.');
    }
  };

  useFocusEffect(
    useCallback(() => {
      if (authorised) {
        setLoading(true);
        load().finally(() => setLoading(false));
      }
    }, [authorised, section, tab])
  );

  const switchSection = (next: Section) => {
    if (next === section) return;
    setItems([]);
    setTab('Submitted');
    setSection(next);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const openDocument = async (path: string) => {
    // PDFs can't be drawn by <Image>, so they open in the system browser using the same short-lived link.
    if (isPdf(path)) {
      try {
        await WebBrowser.openBrowserAsync(await getDocumentUrl(path));
      } catch (e: any) {
        Alert.alert('Could not open document', e?.message || String(e));
      }
      return;
    }
    setViewerLoading(true);
    setViewerUrl('');
    try {
      setViewerUrl(await getDocumentUrl(path));
    } catch (e: any) {
      setViewerUrl(null);
      Alert.alert('Could not open document', e?.message || String(e));
    } finally {
      setViewerLoading(false);
    }
  };

  const sendDecision = async (item: Item, kind: Decision, text?: string) => {
    setDeciding(true);
    try {
      await apiFetch(ENDPOINT[section].decide(item.id), {
        method: 'PUT',
        body: { decision: kind, reason: text, ...(kind === 'resolve' ? { hideAthlete } : {}) },
      });
      setDecision(null);
      setReason('');
      setHideAthlete(false);
      setItems((prev) => prev.filter((i) => i.id !== item.id)); // it now belongs under a different tab
    } catch (e: any) {
      Alert.alert('Could not record the decision', e?.message || String(e));
    } finally {
      setDeciding(false);
    }
  };

  const confirmSimple = (item: Item, kind: 'approve' | 'reinstate', title: string, message: string) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: kind === 'approve' ? 'Approve' : 'Reinstate', onPress: () => sendDecision(item, kind) },
    ]);

  const askReason = (item: Item, kind: Decision) => {
    setReason('');
    setHideAthlete(false);
    setDecision({ item, kind });
  };

  const confirmDismiss = (item: ReportItem) =>
    Alert.alert('Dismiss this report?', 'No action will be taken. The reporter is told it was reviewed.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Dismiss', onPress: () => sendDecision(item, 'dismiss') },
    ]);

  const restoreVisibility = (item: ReportItem) => {
    if (!item.athlete) return;
    const athlete = item.athlete;
    Alert.alert('Show this athlete to scouts again?', `${athlete.name} will appear in scout searches again.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Restore',
        onPress: async () => {
          try {
            await apiFetch(`/admin/players/${athlete.id}/scout-visibility`, { method: 'PUT', body: { hidden: false } });
            setItems((prev) => prev.map((i) => (i.id === item.id && 'athlete' in i && i.athlete ? { ...i, athlete: { ...i.athlete, scoutHidden: false } } : i)));
          } catch (e: any) {
            Alert.alert('Could not restore visibility', e?.message || String(e));
          }
        },
      },
    ]);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    await SecureStore.deleteItemAsync('userToken');
    await SecureStore.deleteItemAsync('userRole');
    router.replace('/');
  };

  if (authorised !== true) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={Colors.primary} />
      </SafeAreaView>
    );
  }

  const documentsBlock = (documents: ReviewDocument[]) => (
    <View style={styles.block}>
      <Text style={styles.blockLabel}>DOCUMENTS ({documents.length})</Text>
      {documents.length === 0 && <Text style={styles.blockText}>None attached.</Text>}
      {documents.map((doc) => (
        <TouchableOpacity key={doc.id} style={styles.docRow} onPress={() => openDocument(doc.storagePath)} accessibilityRole="button" accessibilityLabel={`View ${doc.docType}`}>
          <Ionicons name={isPdf(doc.storagePath) ? 'document-text-outline' : 'image-outline'} size={18} color={Colors.secondary} />
          <Text style={styles.docText} numberOfLines={1}>{doc.docType}{doc.fileName ? ` · ${doc.fileName}` : ''}</Text>
          <Ionicons name="eye-outline" size={18} color={Colors.textSecondary} />
        </TouchableOpacity>
      ))}
    </View>
  );

  const renderClub = (item: ClubItem) => (
    <View style={styles.card}>
      <Text style={styles.name}>{item.name}</Text>
      <Text style={styles.meta}>{item.entityType || 'Entity type not set'} · {item.region || 'Region not set'} · {item.athleteCount} athlete{item.athleteCount === 1 ? '' : 's'}</Text>

      <View style={styles.block}>
        <Text style={styles.blockLabel}>CONTACT</Text>
        <Text style={styles.blockText}>{item.contactEmail || 'No email'} · {item.contactPhone || 'No phone'}</Text>
        {item.owner && <Text style={styles.blockText}>Owner: {item.owner.username} ({item.owner.email})</Text>}
      </View>

      {item.statement ? (
        <View style={styles.block}>
          <Text style={styles.blockLabel}>STATEMENT</Text>
          <Text style={styles.blockText}>{item.statement}</Text>
        </View>
      ) : null}

      {documentsBlock(item.documents)}

      <Text style={styles.dates}>
        Submitted {formatDate(item.submittedAt)}{item.verifiedAt ? ` · Verified ${formatDate(item.verifiedAt)}` : ''}
      </Text>
      {item.status === 'Rejected' && item.rejectionReason ? <Text style={styles.reasonText}>Declined: {item.rejectionReason}</Text> : null}

      {item.status === 'Submitted' && (
        <View style={styles.actions}>
          <TouchableOpacity style={[styles.btn, styles.declineBtn]} onPress={() => askReason(item, 'reject')} accessibilityRole="button" accessibilityLabel={`Decline ${item.name}`}>
            <Text style={styles.declineText}>Decline</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.approveBtn]} onPress={() => confirmSimple(item, 'approve', 'Approve verification?', `${item.name} will get the Verified badge.`)} accessibilityRole="button" accessibilityLabel={`Approve ${item.name}`}>
            <Text style={styles.approveText}>Approve</Text>
          </TouchableOpacity>
        </View>
      )}
      {item.status === 'Verified' && (
        <View style={styles.actions}>
          <TouchableOpacity style={[styles.btn, styles.declineBtn]} onPress={() => askReason(item, 'revoke')} accessibilityRole="button" accessibilityLabel={`Revoke verification for ${item.name}`}>
            <Text style={styles.declineText}>Revoke verification</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  const renderScout = (item: ScoutItem) => (
    <View style={styles.card}>
      <Text style={styles.name}>{item.name}</Text>
      <Text style={styles.meta}>{item.organisation || 'No organisation'} · {item.orgType || 'Type not set'}</Text>

      <View style={styles.block}>
        <Text style={styles.blockLabel}>CONTACT</Text>
        <Text style={styles.blockText}>{item.email || 'No email'} · {item.phone || 'No phone'}</Text>
        <Text style={styles.blockText}>Licence / registration: {item.licenceNumber || 'Not given'}</Text>
      </View>

      {item.statement ? (
        <View style={styles.block}>
          <Text style={styles.blockLabel}>STATEMENT</Text>
          <Text style={styles.blockText}>{item.statement}</Text>
        </View>
      ) : null}

      {documentsBlock(item.documents)}

      <Text style={styles.dates}>
        Applied {formatDate(item.submittedAt)}{item.decidedAt && item.status !== 'Submitted' ? ` · Decided ${formatDate(item.decidedAt)}` : ''}
      </Text>
      {(item.status === 'Rejected' || item.status === 'Suspended') && item.rejectionReason ? (
        <Text style={styles.reasonText}>{item.status === 'Suspended' ? 'Suspended' : 'Declined'}: {item.rejectionReason}</Text>
      ) : null}

      {item.status === 'Submitted' && (
        <View style={styles.actions}>
          <TouchableOpacity style={[styles.btn, styles.declineBtn]} onPress={() => askReason(item, 'reject')} accessibilityRole="button" accessibilityLabel={`Decline ${item.name}`}>
            <Text style={styles.declineText}>Decline</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.approveBtn]} onPress={() => confirmSimple(item, 'approve', 'Approve this scout?', `${item.name} will be able to browse athletes and send contact requests.`)} accessibilityRole="button" accessibilityLabel={`Approve ${item.name}`}>
            <Text style={styles.approveText}>Approve</Text>
          </TouchableOpacity>
        </View>
      )}
      {item.status === 'Approved' && (
        <View style={styles.actions}>
          <TouchableOpacity style={[styles.btn, styles.declineBtn]} onPress={() => askReason(item, 'suspend')} accessibilityRole="button" accessibilityLabel={`Suspend ${item.name}`}>
            <Text style={styles.declineText}>Suspend access</Text>
          </TouchableOpacity>
        </View>
      )}
      {item.status === 'Suspended' && (
        <View style={styles.actions}>
          <TouchableOpacity style={[styles.btn, styles.approveBtn]} onPress={() => confirmSimple(item, 'reinstate', 'Restore access?', `${item.name} will be able to browse athletes again.`)} accessibilityRole="button" accessibilityLabel={`Reinstate ${item.name}`}>
            <Text style={styles.approveText}>Reinstate</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  const renderReport = (item: ReportItem) => {
    const urgent = item.category === URGENT_CATEGORY;
    return (
      <View style={[styles.card, urgent && styles.cardUrgent]}>
        <View style={styles.reportHeader}>
          <View style={[styles.categoryPill, urgent && styles.categoryPillUrgent]}>
            {urgent && <Ionicons name="warning" size={12} color="#B91C1C" accessibilityLabel="Urgent" />}
            <Text style={[styles.categoryText, urgent && styles.categoryTextUrgent]}>{item.category}</Text>
          </View>
          <Text style={styles.dates}>{formatDate(item.createdAt)}</Text>
        </View>

        <Text style={styles.name}>{item.athlete?.name ?? 'Athlete no longer exists'}</Text>
        <Text style={styles.meta}>{item.athlete?.position || 'Position not set'}{item.club?.name ? ` · ${item.club.name}` : ''}</Text>

        <View style={styles.block}>
          <Text style={styles.blockLabel}>DETAILS</Text>
          <Text style={styles.blockText}>{item.details}</Text>
        </View>
        <View style={styles.block}>
          <Text style={styles.blockLabel}>REPORTED BY</Text>
          <Text style={styles.blockText}>{item.reporter ? `${item.reporter.username} (${item.reporter.role})` : 'Unknown'}</Text>
        </View>

        {item.athlete?.scoutHidden && (
          <Text style={styles.hiddenNote}>Hidden from scouts{item.athlete.scoutHiddenReason ? `: ${item.athlete.scoutHiddenReason}` : ''}</Text>
        )}
        {item.resolutionNote ? <Text style={styles.blockText}>Note: {item.resolutionNote}</Text> : null}

        {item.status === 'Pending' && (
          <View style={styles.actions}>
            <TouchableOpacity style={[styles.btn, styles.cancelBtn]} onPress={() => confirmDismiss(item)} accessibilityRole="button" accessibilityLabel="Dismiss this report">
              <Text style={styles.cancelText}>Dismiss</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.approveBtn]} onPress={() => askReason(item, 'resolve')} accessibilityRole="button" accessibilityLabel="Resolve this report">
              <Text style={styles.approveText}>Resolve</Text>
            </TouchableOpacity>
          </View>
        )}
        {item.status !== 'Pending' && item.athlete?.scoutHidden && (
          <View style={styles.actions}>
            <TouchableOpacity style={[styles.btn, styles.declineBtn]} onPress={() => restoreVisibility(item)} accessibilityRole="button" accessibilityLabel="Show this athlete to scouts again">
              <Text style={styles.declineText}>Show to scouts again</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  const decisionTitle: Record<Decision, string> = {
    resolve: 'Resolve report',
    dismiss: 'Dismiss report',
    reject: 'Decline request',
    revoke: 'Revoke verification',
    suspend: 'Suspend access',
    approve: 'Approve',
    reinstate: 'Reinstate',
  };
  const decisionButton: Record<Decision, string> = { resolve: 'Resolve', dismiss: 'Dismiss', reject: 'Decline', revoke: 'Revoke', suspend: 'Suspend', approve: 'Approve', reinstate: 'Reinstate' };
  const tabLabel = TABS[section].find(([status]) => status === tab)?.[1] ?? tab;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topRow}>
        <Text style={styles.header}>Review</Text>
        <TouchableOpacity onPress={signOut} accessibilityRole="button" accessibilityLabel="Sign out">
          <Ionicons name="log-out-outline" size={22} color={Colors.danger} />
        </TouchableOpacity>
      </View>

      <View style={styles.sections}>
        {(['Clubs', 'Scouts', 'Reports'] as Section[]).map((name) => (
          <TouchableOpacity key={name} style={[styles.section, section === name && styles.sectionActive]} onPress={() => switchSection(name)} accessibilityRole="button" accessibilityState={{ selected: section === name }}>
            <Ionicons name={name === 'Clubs' ? 'shield-checkmark-outline' : name === 'Scouts' ? 'binoculars-outline' : 'flag-outline'} size={16} color={section === name ? '#fff' : Colors.textSecondary} />
            <Text style={[styles.sectionText, section === name && styles.sectionTextActive]}>{name}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.tabs}>
        {TABS[section].map(([status, label]) => (
          <TouchableOpacity key={status} style={[styles.tab, tab === status && styles.tabActive]} onPress={() => setTab(status)} accessibilityRole="button" accessibilityState={{ selected: tab === status }}>
            <Text style={[styles.tabText, tab === status && styles.tabTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading && items.length === 0 ? (
        <ActivityIndicator style={{ marginTop: 40 }} size="large" color={Colors.primary} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (section === 'Clubs' ? renderClub(item as ClubItem) : section === 'Scouts' ? renderScout(item as ScoutItem) : renderReport(item as ReportItem))}
          contentContainerStyle={{ paddingBottom: 30 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>{error ? "Couldn't load requests" : `No ${tabLabel.toLowerCase()} ${section.toLowerCase()}`}</Text>
              {error ? <Text style={styles.emptyText}>{error}</Text> : null}
            </View>
          }
        />
      )}

      <Modal visible={viewerUrl !== null} animationType="fade" transparent onRequestClose={() => setViewerUrl(null)}>
        <View style={styles.viewerOverlay}>
          {viewerLoading || !viewerUrl ? <ActivityIndicator size="large" color="#fff" /> : <Image source={{ uri: viewerUrl }} style={styles.viewerImage} resizeMode="contain" />}
          <TouchableOpacity style={styles.viewerClose} onPress={() => setViewerUrl(null)} accessibilityRole="button" accessibilityLabel="Close document">
            <Ionicons name="close" size={26} color="#fff" />
          </TouchableOpacity>
        </View>
      </Modal>

      <Modal visible={decision !== null} animationType="slide" transparent onRequestClose={() => setDecision(null)}>
        <View style={styles.sheetOverlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{decision ? decisionTitle[decision.kind] : ''}</Text>
            <Text style={styles.sheetSub}>
              {decision?.kind === 'resolve'
                ? 'Describe what was done. The reporter is only told that the report was reviewed.'
                : `${decision ? itemLabel(decision.item) : ''} will see this reason${decision?.kind === 'reject' ? ' and can apply again' : ''}.`}
            </Text>
            <TextInput
              style={styles.reasonInput}
              value={reason}
              onChangeText={setReason}
              placeholder={decision?.kind === 'resolve' ? 'What was done (required)' : 'Reason (required)'}
              placeholderTextColor="#9CA3AF"
              multiline
              maxLength={500}
            />
            {decision?.kind === 'resolve' && (
              <View style={styles.hideRow}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={styles.hideTitle}>Hide this athlete from scouts</Text>
                  <Text style={styles.hideHint}>They disappear from every scout's search and shortlist until you restore them.</Text>
                </View>
                <Switch value={hideAthlete} onValueChange={setHideAthlete} trackColor={{ true: Colors.danger }} accessibilityLabel="Hide this athlete from scouts" />
              </View>
            )}
            <View style={styles.actions}>
              <TouchableOpacity style={[styles.btn, styles.cancelBtn]} onPress={() => setDecision(null)} disabled={deciding} accessibilityRole="button">
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.approveBtn, { backgroundColor: decision?.kind === 'resolve' ? Colors.primary : Colors.danger }, !reason.trim() && { opacity: 0.5 }]}
                disabled={deciding || !reason.trim()}
                onPress={() => decision && sendDecision(decision.item, decision.kind, reason)}
                accessibilityRole="button"
              >
                {deciding ? <ActivityIndicator color="#fff" /> : <Text style={styles.approveText}>{decision ? decisionButton[decision.kind] : ''}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.canvas, paddingHorizontal: 15 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14 },
  header: { fontSize: 22, fontWeight: 'bold', color: Colors.textPrimary },
  sections: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  section: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10, backgroundColor: '#E5E7EB' },
  sectionActive: { backgroundColor: Colors.primary },
  sectionText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  sectionTextActive: { color: '#fff', fontWeight: 'bold' },
  tabs: { flexDirection: 'row', backgroundColor: '#E5E7EB', borderRadius: 10, padding: 3, marginBottom: 12 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8 },
  tabActive: { backgroundColor: '#fff' },
  tabText: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  tabTextActive: { color: Colors.primary, fontWeight: 'bold' },
  card: { ...CardSpec, padding: 16, marginBottom: 14 },
  name: { fontSize: 18, fontWeight: 'bold', color: Colors.textPrimary },
  meta: { fontSize: 12, color: Colors.textSecondary, marginTop: 2, marginBottom: 6 },
  block: { marginTop: 10 },
  blockLabel: { fontSize: 10, fontWeight: 'bold', color: '#9CA3AF', marginBottom: 3 },
  blockText: { fontSize: 13, color: Colors.textPrimary, lineHeight: 19 },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  docText: { flex: 1, fontSize: 13, color: Colors.textPrimary },
  dates: { fontSize: 11, color: Colors.textSecondary, marginTop: 10 },
  reasonText: { fontSize: 12, color: '#B91C1C', marginTop: 6 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  btn: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 10 },
  approveBtn: { backgroundColor: Colors.primary },
  approveText: { color: '#fff', fontWeight: 'bold' },
  declineBtn: { borderWidth: 1, borderColor: '#FCA5A5', backgroundColor: '#FEF2F2' },
  declineText: { color: '#B91C1C', fontWeight: 'bold' },
  cancelBtn: { borderWidth: 1, borderColor: '#D1D5DB' },
  cancelText: { color: Colors.textSecondary, fontWeight: 'bold' },
  cardUrgent: { borderWidth: 1.5, borderColor: '#F87171' },
  reportHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  categoryPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#F3F4F6', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  categoryPillUrgent: { backgroundColor: '#FEE2E2' },
  categoryText: { fontSize: 11, fontWeight: 'bold', color: Colors.textSecondary },
  categoryTextUrgent: { color: '#B91C1C' },
  hiddenNote: { fontSize: 12, color: '#B91C1C', fontWeight: 'bold', marginTop: 10 },
  hideRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14, padding: 12, backgroundColor: '#F9FAFB', borderRadius: 10 },
  hideTitle: { fontSize: 14, fontWeight: 'bold', color: Colors.textPrimary },
  hideHint: { fontSize: 12, color: Colors.textSecondary, lineHeight: 17, marginTop: 2 },
  empty: { alignItems: 'center', marginTop: 60, paddingHorizontal: 20 },
  emptyTitle: { fontSize: 16, fontWeight: 'bold', color: '#555' },
  emptyText: { fontSize: 13, color: '#888', marginTop: 6, textAlign: 'center' },
  viewerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center' },
  viewerImage: { width: '100%', height: '85%' },
  viewerClose: { position: 'absolute', top: 50, right: 20, padding: 8 },
  sheetOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  sheetTitle: { fontSize: 18, fontWeight: 'bold', color: Colors.textPrimary },
  sheetSub: { fontSize: 13, color: Colors.textSecondary, marginTop: 4, marginBottom: 12 },
  reasonInput: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, padding: 12, height: 90, textAlignVertical: 'top', fontSize: 14, color: Colors.textPrimary },
});
