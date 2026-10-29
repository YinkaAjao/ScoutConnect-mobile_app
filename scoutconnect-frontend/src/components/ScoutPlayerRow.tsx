// src/components/ScoutPlayerRow.tsx
import React from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, CardSpec } from '../constants/designSystem';
import { PlayerProspect, latestOverall, positionAgeLine } from '../lib/scoutPlayer';

interface Props {
  player: PlayerProspect;
  onPress: () => void;
  /** Extra line under the club, e.g. the scout's own note. */
  footer?: React.ReactNode;
  /** Right-hand control that replaces nothing: sits after the OVR badge. */
  trailing?: React.ReactNode;
}

/** One compact, tappable athlete row. Tapping opens the full profile. */
export default function ScoutPlayerRow({ player, onPress, footer, trailing }: Props) {
  const overall = latestOverall(player);
  const status = player.contactRequest?.status;

  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.main} onPress={onPress} accessibilityRole="button" accessibilityLabel={`Open ${player.displayName}'s profile`}>
        {player.profilePhoto ? (
          <Image source={{ uri: player.profilePhoto }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarText}>{player.displayName.charAt(0).toUpperCase()}</Text>
          </View>
        )}

        <View style={styles.info}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>{player.displayName}</Text>
            {player.Club?.isVerified && <Ionicons name="checkmark-circle" size={15} color={Colors.primary} accessibilityLabel="Verified club" />}
          </View>
          <Text style={styles.detail} numberOfLines={1}>{positionAgeLine(player)}</Text>
          {player.Club && <Text style={styles.club} numberOfLines={1}>{player.Club.name}</Text>}
          {status === 'Pending' && <Text style={[styles.tag, styles.tagPending]}>Contact requested</Text>}
          {status === 'Accepted' && <Text style={[styles.tag, styles.tagAccepted]}>Contact shared</Text>}
        </View>

        <View style={styles.ovr}>
          <Text style={styles.ovrLabel}>OVR</Text>
          <Text style={styles.ovrValue}>{overall ?? 'N/A'}</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
      </TouchableOpacity>
      {footer}
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { ...CardSpec, padding: 0, marginBottom: 10, overflow: 'hidden' },
  main: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#EEE' },
  avatarFallback: { backgroundColor: Colors.secondary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  info: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name: { fontSize: 16, fontWeight: 'bold', color: Colors.textPrimary, flexShrink: 1 },
  detail: { fontSize: 12, color: Colors.textSecondary, marginTop: 1 },
  club: { fontSize: 12, color: Colors.textSecondary, marginTop: 1 },
  tag: { alignSelf: 'flex-start', fontSize: 10, fontWeight: 'bold', marginTop: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, overflow: 'hidden' },
  tagPending: { backgroundColor: '#FEF3C7', color: '#B45309' },
  tagAccepted: { backgroundColor: '#D1FAE5', color: '#047857' },
  ovr: { backgroundColor: Colors.secondaryLight, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: Colors.secondaryBorder },
  ovrLabel: { fontSize: 8, fontWeight: 'bold', color: Colors.secondary },
  ovrValue: { fontSize: 13, fontWeight: 'bold', color: Colors.secondary },
});
