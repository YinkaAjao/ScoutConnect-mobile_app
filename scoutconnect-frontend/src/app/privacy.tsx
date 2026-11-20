// src/app/privacy.tsx
// Privacy Policy and Terms of Use. Each promise below names the feature that enforces it.
import React, { useMemo } from 'react';
import { ScrollView, Text, TouchableOpacity, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useColors, makeCardSpec, type ThemeColors } from '../theme/theme';

const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: '1. What we collect',
    body: [
      'Account details: your name, email, optional phone number, role (coach or scout) and, for coaches, your academy.',
      'Athlete records entered by coaches: name, date of birth, position, evaluations, match statistics, achievements, optional photo and documents.',
      'Scout activity: searches, shortlists and contact requests.',
    ],
  },
  {
    title: '2. Why we collect it',
    body: [
      'To let coaches record player progress, including without a connection, and to let accredited scouts find players. We do not sell data or use it for advertising.',
    ],
  },
  {
    title: '3. Guardian consent comes first',
    body: [
      'Athletes are mostly minors. A player is hidden from scouts until a coach records guardian consent. Records that existed before this rule had a short grace period of 3 days so coaches could record consent.',
      'In the app: the consent badge on each player in the coach roster. The server applies the same rule on every scout search.',
    ],
  },
  {
    title: '4. What scouts can see',
    body: [
      'Scouts see masked names and performance data. Contact details stay with the coach or academy. Only accredited scouts get access, and a scout can contact the same player no more than once every 30 days.',
      'In the app: scout search results, and the contact request button.',
    ],
  },
  {
    title: '5. Storage and security',
    body: [
      'Data is stored with Supabase (authentication, database and a private photo bucket). The backend runs on Render. Emails are sent with Resend. Photos are not public links.',
      'Known limit: these services are hosted outside Rwanda. Rwanda’s data protection law (Law No. 058/2021, Art. 50) requires in-country storage or authorisation from the supervisory authority. We have not yet obtained that authorisation and are reviewing options.',
      'Searches are rate limited. Scout access to athlete records is logged and the log is deleted after 90 days.',
    ],
  },
  {
    title: '6. Your choices',
    body: [
      'Delete your account: Profile > Security & Privacy > Delete my account. Your name, email, phone and sign-in are removed. A scout’s accreditation details, documents and shortlist are removed too. Contact requests already sent stay in the club’s history without the scout’s message. Scout activity logs hold only an anonymous id and are deleted after 90 days.',
      'Athlete records belong to the academy, not to the coach. A coach can edit or remove them, and a coach who is the only owner of an academy must remove them before deleting their account. A guardian who wants a record corrected or removed should ask the academy that registered the player.',
      'You can change your passcode in the same place.',
    ],
  },
  {
    title: '7. Terms of use',
    body: [
      'Use the app only for genuine coaching and scouting. Enter only players you are responsible for and have consent to record. Do not copy, resell or share athlete data outside the app. Accounts that break these terms can be suspended by an administrator.',
    ],
  },
  {
    title: '8. Credits',
    body: ['Google logo icon by Icons8 (https://icons8.com), used on the sign-in button.'],
  },
  {
    title: '9. Limits',
    body: [
      'ScoutConnect is a capstone project, tested with a small group of users. Free hosting means the service may be slow or unavailable. Treat this policy as a draft until it has been reviewed against Rwanda’s data protection law by a qualified adviser.',
    ],
  },
];

export default function PrivacyScreen() {
  const Colors = useColors();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const router = useRouter();
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Privacy Policy & Terms</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.updated}>Last updated: November 2026</Text>
          {SECTIONS.map((s) => (
            <View key={s.title} style={styles.section}>
              <Text style={styles.sectionTitle}>{s.title}</Text>
              {s.body.map((p, i) => (
                <Text key={i} style={styles.paragraph}>{p}</Text>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (Colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.canvas },
  header: { flexDirection: 'row', alignItems: 'center', padding: 15, gap: 10 },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: Colors.textPrimary },
  content: { padding: 15, paddingTop: 0 },
  card: { ...makeCardSpec(Colors), padding: 20 },
  updated: { fontSize: 12, color: Colors.textSecondary, marginBottom: 12 },
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 15, fontWeight: 'bold', color: Colors.textPrimary, marginBottom: 6 },
  paragraph: { fontSize: 14, color: Colors.textPrimary, lineHeight: 20, marginBottom: 6 },
});
