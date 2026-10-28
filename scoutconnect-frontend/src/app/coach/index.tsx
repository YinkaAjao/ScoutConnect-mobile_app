// src/app/coach/index.tsx
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, Alert, ScrollView, Image, ActivityIndicator, Modal, FlatList, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';
import { getAuthToken } from '../../lib/supabase';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { API_BASE, Colors, CardSpec } from '../../constants/designSystem';
import { 
  initDB, saveEvaluationLocally, deleteEvaluationDraft, saveMatchStatLocally, saveAchievementLocally, 
  getDraftEvaluations, getUnsyncedEvaluations, getUnsyncedMatchStats, getUnsyncedAchievements, 
  markEvaluationsAsSynced, markMatchStatsAsSynced, markAchievementsAsSynced 
} from '../../../database';

const UPLOAD_URL = `${API_BASE}/upload`;
const SYNC_URL = `${API_BASE}/sync`;
const CLUB_API = `${API_BASE}/club`;
const ROSTER_API = `${API_BASE}/club/players`;

const RATING_OPTIONS = [
  { value: 1, short: 'Needs Imp.', full: 'Needs Improvement' },
  { value: 2, short: 'Average', full: 'Average' },
  { value: 3, short: 'Good', full: 'Good' },
  { value: 4, short: 'Excellent', full: 'Excellent' },
];

const POSITION_CATEGORIES = {
  Goalkeeper: ['Goalkeeper'],
  Defender: ['Center Back', 'Left Fullback', 'Right Fullback', 'Left Wingback', 'Right Wingback'],
  Midfielder: ['Defensive Midfielder', 'Central Midfielder', 'Attacking Midfielder', 'Left Midfielder', 'Right Midfielder'],
  Forward: ['Left Winger', 'Right Winger', 'Striker / Center Forward'],
};

const STAGES = [
  { id: 1, title: 'Identity & Info', icon: 'person-outline' },
  { id: 2, title: 'Technical', icon: 'football-outline' },
  { id: 3, title: 'Tactical', icon: 'compass-outline' },
  { id: 4, title: 'Physical & Psych', icon: 'fitness-outline' },
  { id: 5, title: 'Summary', icon: 'clipboard-outline' },
];

export default function CoachScreen() {
  const [activeTab, setActiveTab] = useState<'Evaluation' | 'MatchStat' | 'Achievement'>('Evaluation'); 
  const [clubNameDisplay, setClubNameDisplay] = useState('My Academy');
  const [rosterList, setRosterList] = useState<any[]>([]);
  
  // --- STAGED CHECKLIST STATE ---
  const [currentStage, setCurrentStage] = useState<number>(1);
  const [editingDraftId, setEditingDraftId] = useState<number | null>(null);

  // Stage 1: Identity & Context
  const [playerFirstName, setPlayerFirstName] = useState('');
  const [playerLastName, setPlayerLastName] = useState('');
  
  // Date Picker States
  const [dateOfBirth, setDateOfBirth] = useState('2008-01-01');
  const [showDobPicker, setShowDobPicker] = useState(false);
  const [matchDate, setMatchDate] = useState('');
  const [showMatchDatePicker, setShowMatchDatePicker] = useState(false);

  const [mainPosition, setMainPosition] = useState('Striker / Center Forward');
  const [subPosition, setSubPosition] = useState('None');
  const [showPositionModal, setShowPositionModal] = useState(false);
  const [positionTargetType, setPositionTargetType] = useState<'main' | 'sub'>('main');

  const [teamName, setTeamName] = useState('');
  const [evaluatorFirstName, setEvaluatorFirstName] = useState('');
  const [evaluatorLastName, setEvaluatorLastName] = useState('');
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);

  // Stage 2, 3, 4: Attributes
  const [technical, setTechnical] = useState<Record<string, number>>({ ballControl: 0, passingAccuracy: 0, dribbling: 0, shooting: 0, firstTouch: 0 });
  const [tactical, setTactical] = useState<Record<string, number>>({ positioning: 0, decisionMaking: 0, gameVision: 0, offTheBallMovement: 0 });
  const [physical, setPhysical] = useState<Record<string, number>>({ speed: 0, stamina: 0, strength: 0, agility: 0 });
  const [sprintSpeed, setSprintSpeed] = useState('');
  const [psychological, setPsychological] = useState<Record<string, number>>({ teamwork: 0, attitude: 0, workEthic: 0, coachability: 0 });

  // Stage 5: Overall Performance Rating & Open Notes
  const [overallRating, setOverallRating] = useState<number>(0); 
  const [strengths, setStrengths] = useState('');
  const [areasForImprovement, setAreasForImprovement] = useState('');
  const [evalType] = useState('Checklist');

  // --- MATCH STATS & ACHIEVEMENTS STATE ---
  const [selectedPlayerId, setSelectedPlayerId] = useState('');
  const [selectedPlayerNameDisplay, setSelectedPlayerNameDisplay] = useState('Select Roster Athlete');
  const [showPlayerPickerModal, setShowPlayerPickerModal] = useState(false);

  const [competition, setCompetition] = useState('');
  const [opponent, setOpponent] = useState('');
  const [matchResult, setMatchResult] = useState('');
  const [goals, setGoals] = useState('0');
  const [assists, setAssists] = useState('0');
  const [minutesPlayed, setMinutesPlayed] = useState('');
  const [title, setTitle] = useState('');
  const [year, setYear] = useState('');
  
  // --- OFFLINE DRAFTS & QUEUE STATE ---
  const [draftsList, setDraftsList] = useState<any[]>([]);
  const [pendingSync, setPendingSync] = useState(0);
  const [cachedQueue, setCachedQueue] = useState<any[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    const setupDB = async () => {
      try {
        await initDB();
        await checkUnsyncedRecords();
        await fetchCoachClubAndRoster();
      } catch (err) {
        console.log('DB Init Error:', err);
      }
    };
    setupDB();

    const unsubscribe = NetInfo.addEventListener(state => {
      if (state.isConnected) triggerSync();
    });
    return () => unsubscribe();
  }, []);

  const fetchCoachClubAndRoster = async () => {
    try {
      const token = await getAuthToken();
      if (!token) return;

      const clubRes = await fetch(CLUB_API, { headers: { 'Authorization': `Bearer ${token}` } });
      if (clubRes.ok) {
        const clubData = await clubRes.json();
        if (clubData?.club?.name) {
          setClubNameDisplay(clubData.club.name.toUpperCase());
          setTeamName(clubData.club.name);
        }
      }

      const rosterRes = await fetch(ROSTER_API, { headers: { 'Authorization': `Bearer ${token}` } });
      if (rosterRes.ok) {
        const rosterData = await rosterRes.json();
        setRosterList(rosterData);
      }
    } catch (e) {
      console.log('Could not fetch club/roster metadata:', e);
    }
  };

  const checkUnsyncedRecords = async () => {
    const drafts = await getDraftEvaluations();
    const evals = await getUnsyncedEvaluations();
    const stats = await getUnsyncedMatchStats();
    const achs = await getUnsyncedAchievements();
    setDraftsList(drafts);
    setPendingSync(evals.length + stats.length + achs.length);
    setCachedQueue(evals);
  };

  const resetEvaluationForm = () => {
    setEditingDraftId(null);
    setCurrentStage(1);
    setPlayerFirstName('');
    setPlayerLastName('');
    setDateOfBirth('2008-01-01');
    setMainPosition('Striker / Center Forward');
    setSubPosition('None');
    setProfilePhoto(null);
    setTechnical({ ballControl: 0, passingAccuracy: 0, dribbling: 0, shooting: 0, firstTouch: 0 });
    setTactical({ positioning: 0, decisionMaking: 0, gameVision: 0, offTheBallMovement: 0 });
    setPhysical({ speed: 0, stamina: 0, strength: 0, agility: 0 });
    setSprintSpeed('');
    setPsychological({ teamwork: 0, attitude: 0, workEthic: 0, coachability: 0 });
    setOverallRating(0);
    setStrengths('');
    setAreasForImprovement('');
  };

  const loadDraftIntoForm = (draft: any) => {
    setEditingDraftId(draft.id);
    setCurrentStage(draft.currentStage || 1);
    setProfilePhoto(draft.profilePhoto || null);
    setDateOfBirth(draft.dateOfBirth || '2008-01-01');
    setMainPosition(draft.position || 'Striker / Center Forward');

    if (draft.checklistJson) {
      try {
        const parsed = JSON.parse(draft.checklistJson);
        setPlayerFirstName(parsed.playerFirstName || '');
        setPlayerLastName(parsed.playerLastName || '');
        setTeamName(parsed.teamName || '');
        if (parsed.subPosition) setSubPosition(parsed.subPosition);
        setEvaluatorFirstName(parsed.evaluatorFirstName || '');
        setEvaluatorLastName(parsed.evaluatorLastName || '');
        if (parsed.technical) setTechnical(parsed.technical);
        if (parsed.tactical) setTactical(parsed.tactical);
        if (parsed.physical) setPhysical(parsed.physical);
        if (parsed.psychological) setPsychological(parsed.psychological);
        if (parsed.sprintSpeed) setSprintSpeed(String(parsed.sprintSpeed));
        if (parsed.overallRating) setOverallRating(parsed.overallRating);
        setStrengths(parsed.strengths || '');
        setAreasForImprovement(parsed.areasForImprovement || '');
      } catch (e) {
        console.log('Failed to parse draft JSON:', e);
      }
    } else {
      const parts = (draft.playerName || '').split(' ');
      setPlayerFirstName(parts[0] || '');
      setPlayerLastName(parts.slice(1).join(' ') || '');
    }
  };

  const handleRemoveDraftOrFinal = async (id: number) => {
    // Works for both drafts and finalized records queued in SQLite
    await deleteEvaluationDraft(id);
    if (editingDraftId === id) resetEvaluationForm();
    await checkUnsyncedRecords();
  };

  const pickImage = async () => {
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissionResult.granted) {
      Alert.alert("Permission Required", "Please allow access to photos to upload profile pictures.");
      return;
    }
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.5,
    });
    if (!result.canceled) {
      setProfilePhoto(result.assets[0].uri);
    }
  };

  const triggerSync = async () => {
    setIsSyncing(true);
    try {
      const records = await getUnsyncedEvaluations();
      const matchStats = await getUnsyncedMatchStats();
      const achievements = await getUnsyncedAchievements();

      if (records.length === 0 && matchStats.length === 0 && achievements.length === 0) {
        setIsSyncing(false);
        return;
      }

      const token = await getAuthToken(); 

      const processedRecords = await Promise.all(records.map(async (record: any) => {
        let finalPhotoUrl = record.profilePhoto;
        if (finalPhotoUrl && finalPhotoUrl.startsWith('file://')) {
          const formData = new FormData();
          formData.append('media', {
            uri: finalPhotoUrl,
            name: `photo_${Date.now()}.jpg`,
            type: 'image/jpeg'
          } as any);

          try {
            const uploadRes = await fetch(UPLOAD_URL, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${token}` },
              body: formData
            });
            const uploadData = await uploadRes.json();
            if (uploadRes.ok) finalPhotoUrl = uploadData.url;
          } catch (uploadErr) {
            console.log('Failed to upload image during sync:', uploadErr);
          }
        }
        return { ...record, profilePhoto: finalPhotoUrl };
      }));
      
      const response = await fetch(SYNC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ records: processedRecords, matchStats, achievements }) 
      });

      if (response.ok) {
        if (records.length > 0) await markEvaluationsAsSynced(records.map((r: any) => r.id));
        if (matchStats.length > 0) await markMatchStatsAsSynced(matchStats.map((r: any) => r.id));
        if (achievements.length > 0) await markAchievementsAsSynced(achievements.map((r: any) => r.id));
        
        await checkUnsyncedRecords(); 
        Alert.alert('Sync Successful', 'Pitchside telemetry synced with cloud database!');
      } else {
        const errJson = await response.json();
        Alert.alert('Sync Notice', errJson.error || 'Server rejected synchronization payload.');
      }
    } catch (error) {
      console.log('Sync failed connection error:', error);
    } finally {
      setIsSyncing(false);
    }
  };

  const persistEvaluation = async (isDraftFlag: 0 | 1) => {
    const fullName = `${playerFirstName.trim()} ${playerLastName.trim()}`.trim();
    if (!fullName) {
      Alert.alert('Required Field', 'Please enter at least the Player First or Last Name in Stage 1 before saving.');
      setCurrentStage(1);
      return;
    }

    if (isDraftFlag === 0) {
      if (!playerFirstName.trim() || !playerLastName.trim()) {
        Alert.alert('Validation Error', 'Both Player First Name and Last Name are required for final submission.');
        setCurrentStage(1);
        return;
      }
      if (!evaluatorFirstName.trim() || !evaluatorLastName.trim()) {
        Alert.alert('Validation Error', 'Evaluator First Name and Last Name are required.');
        setCurrentStage(1);
        return;
      }
      const unratedTech = Object.values(technical).some(v => v === 0);
      const unratedTac = Object.values(tactical).some(v => v === 0);
      const unratedPhys = Object.values(physical).some(v => v === 0);
      const unratedPsych = Object.values(psychological).some(v => v === 0);

      if (unratedTech || unratedTac || unratedPhys || unratedPsych || overallRating === 0) {
        Alert.alert('Incomplete Ratings', 'Please ensure all technical, tactical, physical, psychological attributes and overall rating have been explicitly reviewed before final submission.');
        return;
      }
    }

    const sanitizeVal = (val: number) => (val === 0 ? 3 : val);
    const techAvg4 = Object.values(technical).reduce((a, b) => a + sanitizeVal(b), 0) / Object.values(technical).length;
    const tacAvg4 = Object.values(tactical).reduce((a, b) => a + sanitizeVal(b), 0) / Object.values(tactical).length;
    const physAvg4 = Object.values(physical).reduce((a, b) => a + sanitizeVal(b), 0) / Object.values(physical).length;
    const psychAvg4 = Object.values(psychological).reduce((a, b) => a + sanitizeVal(b), 0) / Object.values(psychological).length;

    const computedDribblingScore = parseFloat(((techAvg4 / 4) * 5).toFixed(1));
    const activeSpeedRating = physical.speed === 0 ? 3 : physical.speed;
    const computedSprintSpeed = sprintSpeed ? parseFloat(sprintSpeed) : parseFloat((4.8 - (activeSpeedRating * 0.25)).toFixed(2));

    const evaluatorFullName = `${evaluatorFirstName.trim()} ${evaluatorLastName.trim()}`.trim();
    const evaluationDate = new Date().toISOString().split('T')[0]; // Auto-set to Today

    const checklistObject = {
      playerFirstName: playerFirstName.trim(),
      playerLastName: playerLastName.trim(),
      position: mainPosition,
      subPosition,
      teamName: teamName.trim(),
      evaluatorFirstName: evaluatorFirstName.trim(),
      evaluatorLastName: evaluatorLastName.trim(),
      evaluatorName: evaluatorFullName,
      evaluationDate,
      technical,
      tactical,
      physical,
      psychological,
      averages: {
        technical: parseFloat(techAvg4.toFixed(2)),
        tactical: parseFloat(tacAvg4.toFixed(2)),
        physical: parseFloat(physAvg4.toFixed(2)),
        psychological: parseFloat(psychAvg4.toFixed(2)),
      },
      sprintSpeed: computedSprintSpeed,
      overallRating: overallRating === 0 ? 3 : overallRating,
      strengths: strengths.trim(),
      areasForImprovement: areasForImprovement.trim(),
    };

    const summaryWorkRate = `${mainPosition} (Sub: ${subPosition}) | Overall: ${overallRating || 3}/5`;

    await saveEvaluationLocally(
      fullName,
      dateOfBirth,
      profilePhoto,
      computedSprintSpeed,
      computedDribblingScore,
      summaryWorkRate,
      evalType,
      mainPosition,
      JSON.stringify(checklistObject),
      currentStage,
      isDraftFlag,
      editingDraftId
    );

    await checkUnsyncedRecords();

    if (isDraftFlag === 1) {
      Alert.alert('Draft Saved', `Progress for ${fullName} (Stage ${currentStage}/5) saved locally.`);
    } else {
      resetEvaluationForm();
      Alert.alert('Evaluation Queued', `${fullName}'s full evaluation checklist is finalized and queued for sync.`);
      triggerSync();
    }
  };

  const handleSaveStatsOrMedals = async () => {
    try {
      if (!selectedPlayerId) {
        Alert.alert('Validation Error', 'Please select a roster player to guarantee unique identification.');
        return;
      }
      if (activeTab === 'MatchStat') {
        await saveMatchStatLocally(selectedPlayerNameDisplay, dateOfBirth, competition, matchDate, opponent, matchResult, parseInt(goals) || 0, parseInt(assists) || 0, parseInt(minutesPlayed) || 90);
        setCompetition(''); setMatchDate(''); setOpponent(''); setMatchResult(''); setGoals('0'); setAssists('0'); setMinutesPlayed('');
      } else if (activeTab === 'Achievement') {
        await saveAchievementLocally(selectedPlayerNameDisplay, dateOfBirth, title, parseInt(year) || 2026);
        setTitle(''); setYear('');
      }
      await checkUnsyncedRecords();
      Alert.alert('Saved to Local Cache', `Record securely linked to ${selectedPlayerNameDisplay} (ID: ${selectedPlayerId.substring(0, 6)}...).`);
      triggerSync();
    } catch (err) {
      Alert.alert('Error', (err as Error).message);
    }
  };

  const renderRatingRow = (
    label: string,
    fieldKey: string,
    stateObj: Record<string, number>,
    setStateFn: React.Dispatch<React.SetStateAction<Record<string, number>>>
  ) => {
    const isUnreviewed = stateObj[fieldKey] === 0;
    return (
      <View key={fieldKey} style={[styles.matrixRow, isUnreviewed && styles.matrixRowUnreviewed]}>
        <View style={styles.matrixHeaderRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={styles.matrixAttrLabel}>{label}</Text>
            {isUnreviewed && (
              <View style={styles.unreviewedPill}>
                <Text style={styles.unreviewedPillText}>DEFAULT / UNREVIEWED</Text>
              </View>
            )}
          </View>
          <Text style={styles.matrixSelectedBadge}>
            {isUnreviewed ? 'Not Rated Yet' : RATING_OPTIONS.find(o => o.value === stateObj[fieldKey])?.full}
          </Text>
        </View>
        <View style={styles.matrixOptionsRow}>
          {RATING_OPTIONS.map(opt => {
            const active = stateObj[fieldKey] === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[styles.matrixOptionBtn, active && styles.matrixOptionBtnActive]}
                onPress={() => setStateFn(prev => ({ ...prev, [fieldKey]: opt.value }))}
              >
                <Text style={[styles.matrixOptionText, active && styles.matrixOptionTextActive]}>
                  {opt.short}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
        
        <View style={styles.topBanner}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="flash" size={14} color={Colors.warningText} />
            <Text style={styles.topBannerText}>OFFLINE MODE • PITCHSIDE STORAGE ACTIVE</Text>
          </View>
          <View style={styles.pillBadge}>
            <Text style={styles.pillBadgeText}>v2.6 Enhanced</Text>
          </View>
        </View>

        <View style={styles.headerRow}>
          <View>
            <Text style={styles.subHeader}>{clubNameDisplay}</Text>
            <Text style={styles.header}>Player Evaluation Checklist</Text>
          </View>
          <View style={styles.coachBadge}>
            <Text style={styles.coachBadgeText}>COACH</Text>
          </View>
        </View>
        
        <View style={styles.tabContainer}>
          <TouchableOpacity onPress={() => setActiveTab('Evaluation')} style={[styles.tabBtn, activeTab === 'Evaluation' && styles.tabBtnActive]}>
            <Text style={[styles.tabText, activeTab === 'Evaluation' && styles.tabTextActive]}>Checklist</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setActiveTab('MatchStat')} style={[styles.tabBtn, activeTab === 'MatchStat' && styles.tabBtnActive]}>
            <Text style={[styles.tabText, activeTab === 'MatchStat' && styles.tabTextActive]}>Match Stats</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setActiveTab('Achievement')} style={[styles.tabBtn, activeTab === 'Achievement' && styles.tabBtnActive]}>
            <Text style={[styles.tabText, activeTab === 'Achievement' && styles.tabTextActive]}>Medals</Text>
          </TouchableOpacity>
        </View>

        {/* Saved Drafts Banner */}
        {activeTab === 'Evaluation' && draftsList.length > 0 && (
          <View style={styles.draftsCard}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="document-text-outline" size={16} color={Colors.secondary} />
                <Text style={styles.draftsHeaderTitle}>IN-PROGRESS DRAFTS (TAP TO RESUME)</Text>
              </View>
              <View style={styles.countPill}>
                <Text style={styles.countPillText}>{draftsList.length} Saved</Text>
              </View>
            </View>
            {draftsList.map((draft) => (
              <View key={draft.id} style={[styles.draftItem, editingDraftId === draft.id && styles.draftItemActive]}>
                <TouchableOpacity style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }} onPress={() => loadDraftIntoForm(draft)}>
                  <View style={styles.draftStageBadge}>
                    <Text style={styles.draftStageText}>S{draft.currentStage || 1}/5</Text>
                  </View>
                  <View style={{ marginLeft: 10, flex: 1 }}>
                    <Text style={{ fontWeight: 'bold', color: Colors.textPrimary, fontSize: 14 }}>{draft.playerName}</Text>
                    <Text style={{ fontSize: 11, color: Colors.textSecondary }}>{draft.position || 'Forward'} • Click to continue</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleRemoveDraftOrFinal(draft.id)} style={{ padding: 6 }}>
                  <Ionicons name="trash-outline" size={18} color={Colors.danger} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {activeTab === 'Evaluation' && (
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <View style={styles.fastTrackTag}>
                <Ionicons name="checkmark-circle" size={12} color={Colors.primary} style={{ marginRight: 4 }} />
                <Text style={{ fontSize: 10, color: Colors.primary, fontWeight: 'bold' }}>
                  {editingDraftId ? `EDITING DRAFT #${editingDraftId}` : 'STAGED EVALUATION WORKFLOW'}
                </Text>
              </View>
              {editingDraftId && (
                <TouchableOpacity onPress={resetEvaluationForm}>
                  <Text style={{ fontSize: 11, color: Colors.secondary, fontWeight: 'bold' }}>+ Start New</Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.stepperContainer}>
              {STAGES.map((stage) => {
                const isCurrent = currentStage === stage.id;
                const isCompleted = currentStage > stage.id;
                return (
                  <TouchableOpacity
                    key={stage.id}
                    style={[
                      styles.stepPill,
                      isCurrent && styles.stepPillCurrent,
                      isCompleted && styles.stepPillCompleted
                    ]}
                    onPress={() => setCurrentStage(stage.id)}
                  >
                    <Ionicons
                      name={isCompleted ? 'checkmark-circle' : (stage.icon as any)}
                      size={14}
                      color={isCurrent || isCompleted ? '#FFF' : Colors.textSecondary}
                    />
                    <Text style={[styles.stepPillText, (isCurrent || isCompleted) && { color: '#FFF' }]}>
                      {stage.id}. {stage.title}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* STAGE 1 */}
            {currentStage === 1 && (
              <View>
                <Text style={styles.sectionTitle}>Stage 1: Player & Evaluator Info</Text>
                <Text style={styles.sectionSub}>Set player details, main position, and secondary role.</Text>

                <View style={styles.imagePickerContainer}>
                  <TouchableOpacity onPress={pickImage} style={styles.imagePlaceholder}>
                    {profilePhoto ? (
                      <Image source={{ uri: profilePhoto }} style={styles.profileImage} />
                    ) : (
                      <View style={{ alignItems: 'center' }}>
                        <Ionicons name="camera-outline" size={24} color={Colors.secondary} />
                        <Text style={styles.imagePlaceholderText}>Add Photo</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                </View>

                <Text style={styles.label}>Player Full Name *</Text>
                <View style={styles.row}>
                  <View style={styles.halfCol}>
                    <TextInput style={styles.input} placeholder="First Name" placeholderTextColor="#9CA3AF" value={playerFirstName} onChangeText={setPlayerFirstName} />
                  </View>
                  <View style={styles.halfCol}>
                    <TextInput style={styles.input} placeholder="Last Name" placeholderTextColor="#9CA3AF" value={playerLastName} onChangeText={setPlayerLastName} />
                  </View>
                </View>

                <View style={styles.row}>
                  <View style={styles.halfCol}>
                    <Text style={styles.label}>Main Position *</Text>
                    <TouchableOpacity style={styles.dropdownSelector} onPress={() => { setPositionTargetType('main'); setShowPositionModal(true); }}>
                      <Text style={styles.dropdownSelectorText} numberOfLines={1}>{mainPosition}</Text>
                      <Ionicons name="chevron-down" size={14} color={Colors.textSecondary} />
                    </TouchableOpacity>
                  </View>

                  <View style={styles.halfCol}>
                    <Text style={styles.label}>Secondary Position</Text>
                    <TouchableOpacity style={styles.dropdownSelector} onPress={() => { setPositionTargetType('sub'); setShowPositionModal(true); }}>
                      <Text style={styles.dropdownSelectorText} numberOfLines={1}>{subPosition}</Text>
                      <Ionicons name="chevron-down" size={14} color={Colors.textSecondary} />
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.row}>
                  <View style={styles.halfCol}>
                    <Text style={styles.label}>Team Name</Text>
                    <TextInput style={styles.input} placeholder="e.g. ALU Sentinels" placeholderTextColor="#9CA3AF" value={teamName} onChangeText={setTeamName} />
                  </View>
                  <View style={styles.halfCol}>
                    <Text style={styles.label}>Player DOB</Text>
                    <TouchableOpacity style={styles.dropdownSelector} onPress={() => setShowDobPicker(true)}>
                      <Text style={styles.dropdownSelectorText}>{dateOfBirth || 'YYYY-MM-DD'}</Text>
                      <Ionicons name="calendar-outline" size={14} color={Colors.textSecondary} />
                    </TouchableOpacity>
                    {showDobPicker && (
                      <DateTimePicker
                        value={new Date(dateOfBirth)}
                        mode="date"
                        display="default"
                        onValueChange={(e, selectedDate) => {
                          setShowDobPicker(Platform.OS === 'ios');
                          if (selectedDate) setDateOfBirth(selectedDate.toISOString().split('T')[0]);
                        }}
                      />
                    )}
                  </View>
                </View>

                <Text style={styles.label}>Evaluator Name *</Text>
                <View style={styles.row}>
                  <View style={styles.halfCol}>
                    <TextInput style={styles.input} placeholder="First Name" placeholderTextColor="#9CA3AF" value={evaluatorFirstName} onChangeText={setEvaluatorFirstName} />
                  </View>
                  <View style={styles.halfCol}>
                    <TextInput style={styles.input} placeholder="Last Name" placeholderTextColor="#9CA3AF" value={evaluatorLastName} onChangeText={setEvaluatorLastName} />
                  </View>
                </View>
                
                <Text style={styles.label}>Evaluation Date *</Text>
                <View style={[styles.input, { backgroundColor: '#E5E7EB', borderColor: '#D1D5DB' }]}>
                  <Text style={{ color: Colors.textSecondary }}>{new Date().toDateString()} (Auto-logged today)</Text>
                </View>
              </View>
            )}

            {/* STAGE 2 */}
            {currentStage === 2 && (
              <View>
                <Text style={styles.sectionTitle}>Stage 2: Technical Skills Assessment *</Text>
                <Text style={styles.sectionSub}>Unreviewed attributes are clearly flagged so you know what has been evaluated.</Text>
                {renderRatingRow('Ball Control', 'ballControl', technical, setTechnical)}
                {renderRatingRow('Passing Accuracy', 'passingAccuracy', technical, setTechnical)}
                {renderRatingRow('Dribbling', 'dribbling', technical, setTechnical)}
                {renderRatingRow('Shooting', 'shooting', technical, setTechnical)}
                {renderRatingRow('First Touch', 'firstTouch', technical, setTechnical)}
              </View>
            )}

            {/* STAGE 3 */}
            {currentStage === 3 && (
              <View>
                <Text style={styles.sectionTitle}>Stage 3: Tactical Awareness Assessment *</Text>
                <Text style={styles.sectionSub}>Assess spatial awareness, vision, and decision-making on the pitch.</Text>
                {renderRatingRow('Positioning', 'positioning', tactical, setTactical)}
                {renderRatingRow('Decision Making', 'decisionMaking', tactical, setTactical)}
                {renderRatingRow('Game Vision', 'gameVision', tactical, setTactical)}
                {renderRatingRow('Off-the-ball Movement', 'offTheBallMovement', tactical, setTactical)}
              </View>
            )}

            {/* STAGE 4 */}
            {currentStage === 4 && (
              <View>
                <Text style={styles.sectionTitle}>Stage 4: Physical Attributes *</Text>
                <Text style={styles.sectionSub}>Assess athletic output and optional 30m combine sprint speed.</Text>
                {renderRatingRow('Speed', 'speed', physical, setPhysical)}
                {renderRatingRow('Stamina', 'stamina', physical, setPhysical)}
                {renderRatingRow('Strength', 'strength', physical, setPhysical)}
                {renderRatingRow('Agility', 'agility', physical, setPhysical)}

                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                  <Text style={styles.label}>Optional: 30m Sprint Stopwatch (seconds)</Text>
                  <Text style={{ fontSize: 11, color: Colors.textSecondary, marginTop: 10 }}>Goal: &lt; 4.20s</Text>
                </View>
                <TextInput style={styles.input} placeholder="e.g. 3.85 (optional)" placeholderTextColor="#9CA3AF" keyboardType="numeric" value={sprintSpeed} onChangeText={setSprintSpeed} />

                <View style={{ height: 1, backgroundColor: Colors.border, marginVertical: 12 }} />

                <Text style={styles.sectionTitle}>Psychological Attributes *</Text>
                <Text style={styles.sectionSub}>Assess mentality, work ethic, and reception to coaching.</Text>
                {renderRatingRow('Teamwork', 'teamwork', psychological, setPsychological)}
                {renderRatingRow('Attitude', 'attitude', psychological, setPsychological)}
                {renderRatingRow('Work Ethic', 'workEthic', psychological, setPsychological)}
                {renderRatingRow('Coachability', 'coachability', psychological, setPsychological)}
              </View>
            )}

            {/* STAGE 5 */}
            {currentStage === 5 && (
              <View>
                <Text style={styles.sectionTitle}>Stage 5: Overall Rating & Review *</Text>
                <Text style={styles.sectionSub}>Provide final summary notes and submit to the sync queue.</Text>

                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 }}>
                  <Text style={styles.label}>Overall Performance Rating (1-5) *</Text>
                  <Text style={{ fontSize: 12, color: Colors.primary, fontWeight: 'bold' }}>{overallRating === 0 ? 'Not Rated Yet' : `${overallRating} / 5 • Verified`}</Text>
                </View>
                <View style={styles.starRow}>
                  {[1, 2, 3, 4, 5].map(star => (
                    <TouchableOpacity key={star} onPress={() => setOverallRating(star)}>
                      <Ionicons 
                        name={overallRating >= star ? "star" : "star-outline"} 
                        size={28} 
                        color={overallRating >= star ? '#F59E0B' : '#D1D5DB'} 
                      />
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.label}>Strengths (What did the player do well?)</Text>
                <TextInput 
                  style={[styles.input, { height: 75, textAlignVertical: 'top' }]} 
                  placeholder="e.g. Exceptional close control under pressure..." 
                  placeholderTextColor="#9CA3AF"
                  multiline
                  value={strengths} 
                  onChangeText={setStrengths} 
                />

                <Text style={styles.label}>Areas for Improvement (What can the player work on?)</Text>
                <TextInput 
                  style={[styles.input, { height: 75, textAlignVertical: 'top' }]} 
                  placeholder="e.g. Defensive transition recovery..." 
                  placeholderTextColor="#9CA3AF"
                  multiline
                  value={areasForImprovement} 
                  onChangeText={setAreasForImprovement} 
                />
              </View>
            )}

            <View style={styles.stageFooterRow}>
              {currentStage > 1 ? (
                <TouchableOpacity style={styles.secondaryNavBtn} onPress={() => setCurrentStage(currentStage - 1)}>
                  <Ionicons name="arrow-back" size={16} color={Colors.textPrimary} />
                  <Text style={styles.secondaryNavBtnText}>Prev</Text>
                </TouchableOpacity>
              ) : (
                <View style={{ flex: 0.28 }} />
              )}

              <TouchableOpacity style={styles.draftSaveBtn} onPress={() => persistEvaluation(1)}>
                <Ionicons name="bookmark-outline" size={16} color={Colors.secondary} />
                <Text style={styles.draftSaveBtnText}>Save Draft</Text>
              </TouchableOpacity>

              {currentStage < 5 ? (
                <TouchableOpacity style={styles.primaryNavBtn} onPress={() => setCurrentStage(currentStage + 1)}>
                  <Text style={styles.primaryNavBtnText}>Next</Text>
                  <Ionicons name="arrow-forward" size={16} color="#FFF" />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.submitEvalBtn} onPress={() => persistEvaluation(0)}>
                  <Ionicons name="checkmark-done" size={16} color="#FFF" />
                  <Text style={styles.primaryNavBtnText}>Submit</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {/* MATCH STATS & ACHIEVEMENTS */}
        {activeTab !== 'Evaluation' && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{activeTab === 'MatchStat' ? 'Log Match Statistics' : 'Log Trophy / Medal'}</Text>
            
            <Text style={styles.label}>Select Roster Athlete (Unique Identifier) *</Text>
            <TouchableOpacity style={styles.dropdownSelector} onPress={() => setShowPlayerPickerModal(true)}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="person-circle-outline" size={20} color={Colors.primary} />
                <Text style={[styles.dropdownSelectorText, selectedPlayerId && { fontWeight: 'bold', color: Colors.textPrimary }]}>
                  {selectedPlayerNameDisplay}
                </Text>
              </View>
              <Ionicons name="chevron-down" size={16} color={Colors.textSecondary} />
            </TouchableOpacity>

            {activeTab === 'MatchStat' ? (
              <View>
                <Text style={styles.label}>Competition / League</Text>
                <TextInput style={styles.input} placeholder="e.g. Varsity League" placeholderTextColor="#9CA3AF" value={competition} onChangeText={setCompetition} />
                
                <Text style={styles.label}>Match Date</Text>
                <TouchableOpacity style={styles.dropdownSelector} onPress={() => setShowMatchDatePicker(true)}>
                  <Text style={styles.dropdownSelectorText}>{matchDate || 'Select Date'}</Text>
                  <Ionicons name="calendar-outline" size={14} color={Colors.textSecondary} />
                </TouchableOpacity>
                {showMatchDatePicker && (
                  <DateTimePicker
                    value={matchDate ? new Date(matchDate) : new Date()}
                    mode="date"
                    display="default"
                    onValueChange={(e, selectedDate) => {
                      setShowMatchDatePicker(Platform.OS === 'ios');
                      if (selectedDate) setMatchDate(selectedDate.toISOString().split('T')[0]);
                    }}
                  />
                )}

                <Text style={styles.label}>Opponent</Text>
                <TextInput style={styles.input} placeholder="e.g. Kigali FC" placeholderTextColor="#9CA3AF" value={opponent} onChangeText={setOpponent} />
                <Text style={styles.label}>Final Result</Text>
                <TextInput style={styles.input} placeholder="e.g. W 2-1" placeholderTextColor="#9CA3AF" value={matchResult} onChangeText={setMatchResult} />
                <View style={styles.row}>
                  <View style={styles.halfCol}>
                    <Text style={styles.label}>Goals</Text>
                    <TextInput style={styles.input} keyboardType="numeric" value={goals} onChangeText={setGoals} />
                  </View>
                  <View style={styles.halfCol}>
                    <Text style={styles.label}>Assists</Text>
                    <TextInput style={styles.input} keyboardType="numeric" value={assists} onChangeText={setAssists} />
                  </View>
                </View>
                <Text style={styles.label}>Minutes Played</Text>
                <TextInput style={styles.input} placeholder="e.g. 90" placeholderTextColor="#9CA3AF" keyboardType="numeric" value={minutesPlayed} onChangeText={setMinutesPlayed} />
              </View>
            ) : (
              <View>
                <Text style={styles.label}>Trophy / Title</Text>
                <TextInput style={styles.input} placeholder="e.g. Tournament MVP" placeholderTextColor="#9CA3AF" value={title} onChangeText={setTitle} />
                <Text style={styles.label}>Year Awarded</Text>
                <TextInput style={styles.input} placeholder="e.g. 2026" placeholderTextColor="#9CA3AF" keyboardType="numeric" value={year} onChangeText={setYear} />
              </View>
            )}

            <TouchableOpacity style={styles.button} onPress={handleSaveStatsOrMedals}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="save-outline" size={18} color="#FFF" />
                <Text style={styles.buttonText}>Save to Local Storage</Text>
              </View>
            </TouchableOpacity>
          </View>
        )}

        {/* Finalized Offline Buffer Queue */}
        <View style={styles.bufferCard}>
          <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10}}>
            <Text style={{fontWeight: 'bold', fontSize: 13, color: Colors.textSecondary}}>READY FOR SYNC (FINALIZED QUEUE)</Text>
            <View style={styles.countPill}>
              <Text style={styles.countPillText}>{pendingSync} Ready</Text>
            </View>
          </View>

          {cachedQueue.length === 0 ? (
            <Text style={{fontSize: 13, color: Colors.textSecondary, fontStyle: 'italic', textAlign: 'center', padding: 10}}>Buffer is clean. All finalized records synced.</Text>
          ) : (
            cachedQueue.map((item, index) => (
              <View key={item.id || index} style={styles.queueItem}>
                <View style={{flexDirection: 'row', alignItems: 'center', flex: 1}}>
                  <View style={styles.queueAvatar}>
                    <Text style={{color: '#FFF', fontWeight: 'bold', fontSize: 11}}>{item.playerName.substring(0, 2).toUpperCase()}</Text>
                  </View>
                  <View style={{marginLeft: 10, flex: 1}}>
                    <Text style={{fontWeight: 'bold', fontSize: 14, color: Colors.textPrimary}}>{item.playerName}</Text>
                    <Text style={{fontSize: 12, color: Colors.textSecondary}} numberOfLines={1}>{item.workRate || 'Completed Checklist'}</Text>
                  </View>
                </View>
                {/* Trash Can to Delete Staged Finalizations */}
                <TouchableOpacity onPress={() => handleRemoveDraftOrFinal(item.id)} style={{ padding: 6, marginRight: 4 }}>
                  <Ionicons name="trash-outline" size={18} color={Colors.danger} />
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>

        <View style={styles.statusBox}>
          <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}}>
            <View style={{flex: 1, marginRight: 10}}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Ionicons name="warning-outline" size={16} color={Colors.warningText} />
                <Text style={styles.statusTitle}>Finalized Records Waiting: {pendingSync}</Text>
              </View>
              <Text style={styles.statusSub}>Drafts ({draftsList.length}) stay local until submitted</Text>
            </View>
            <TouchableOpacity style={[styles.syncBtn, isSyncing && {backgroundColor: '#9CA3AF'}]} onPress={triggerSync} disabled={isSyncing}>
              {isSyncing ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={styles.syncBtnText}>Sync Now</Text>}
            </TouchableOpacity>
          </View>
        </View>

      </ScrollView>

      {/* POSITIONS DROPDOWN MODAL */}
      <Modal visible={showPositionModal} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              {positionTargetType === 'main' ? 'Select Main Position' : 'Select Secondary Position'}
            </Text>
            <ScrollView style={{ maxHeight: 350, marginVertical: 10 }}>
              {positionTargetType === 'sub' && (
                <TouchableOpacity 
                  style={styles.modalPositionItem} 
                  onPress={() => { setSubPosition('None'); setShowPositionModal(false); }}
                >
                  <Text style={styles.modalPositionText}>None (Single Position)</Text>
                </TouchableOpacity>
              )}
              {Object.entries(POSITION_CATEGORIES).map(([category, posList]) => (
                <View key={category} style={{ marginBottom: 12 }}>
                  <Text style={styles.modalCatHeader}>{category.toUpperCase()}</Text>
                  {posList.map(pos => (
                    <TouchableOpacity
                      key={pos}
                      style={styles.modalPositionItem}
                      onPress={() => {
                        if (positionTargetType === 'main') setMainPosition(pos);
                        else setSubPosition(pos);
                        setShowPositionModal(false);
                      }}
                    >
                      <Text style={styles.modalPositionText}>{pos}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setShowPositionModal(false)}>
              <Text style={styles.modalCloseText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* UNIQUE PLAYER PICKER MODAL */}
      <Modal visible={showPlayerPickerModal} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Select Athlete from Roster</Text>
            <Text style={styles.modalSub}>Guarantees accurate unique identification for stats and medals.</Text>
            
            {rosterList.length === 0 ? (
              <Text style={{ textAlign: 'center', color: Colors.textSecondary, marginVertical: 20 }}>No synced players found on roster. Sync evaluations first.</Text>
            ) : (
              <FlatList
                data={rosterList}
                keyExtractor={(item) => item.id}
                style={{ maxHeight: 300, marginVertical: 10 }}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.modalPlayerItem}
                    onPress={() => {
                      setSelectedPlayerId(item.id);
                      setSelectedPlayerNameDisplay(item.name);
                      setShowPlayerPickerModal(false);
                    }}
                  >
                    <View>
                      <Text style={styles.modalPlayerName}>{item.name}</Text>
                      <Text style={styles.modalPlayerMeta}>{item.position} • DOB: {item.dateOfBirth}</Text>
                    </View>
                    <Ionicons name="checkmark-circle-outline" size={20} color={Colors.primary} />
                  </TouchableOpacity>
                )}
              />
            )}

            <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setShowPlayerPickerModal(false)}>
              <Text style={styles.modalCloseText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.canvas, padding: 15 },
  topBanner: { backgroundColor: Colors.warningBg, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, marginBottom: 12 },
  topBannerText: { color: Colors.warningText, fontWeight: 'bold', fontSize: 11 },
  pillBadge: { backgroundColor: '#FFF', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  pillBadgeText: { color: Colors.warningText, fontSize: 10, fontWeight: 'bold' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  subHeader: { fontSize: 11, fontWeight: 'bold', color: Colors.primary },
  header: { fontSize: 22, fontWeight: 'bold', color: Colors.textPrimary },
  coachBadge: { backgroundColor: Colors.primaryLight, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  coachBadgeText: { color: Colors.primary, fontSize: 11, fontWeight: 'bold' },
  tabContainer: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 15, backgroundColor: '#E5E7EB', borderRadius: 8, padding: 4 },
  tabBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 6 },
  tabBtnActive: { backgroundColor: '#FFF', elevation: 1 },
  tabText: { color: Colors.textSecondary, fontWeight: '600', fontSize: 13 },
  tabTextActive: { color: Colors.primary, fontWeight: 'bold' },
  draftsCard: { backgroundColor: Colors.secondaryLight, padding: 14, borderRadius: 10, marginBottom: 15, borderWidth: 1, borderColor: Colors.secondaryBorder },
  draftsHeaderTitle: { fontWeight: 'bold', fontSize: 12, color: Colors.secondary },
  draftItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', padding: 10, borderRadius: 8, marginTop: 6, borderWidth: 1, borderColor: Colors.border },
  draftItemActive: { borderColor: Colors.secondary, borderWidth: 1.5 },
  draftStageBadge: { backgroundColor: Colors.secondary, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  draftStageText: { color: '#FFF', fontSize: 11, fontWeight: 'bold' },
  card: { ...CardSpec, padding: 18, marginBottom: 15 },
  fastTrackTag: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.primaryLight, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, alignSelf: 'flex-start' },
  stepperContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  stepPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 16, backgroundColor: '#F3F4F6' },
  stepPillCurrent: { backgroundColor: Colors.primary },
  stepPillCompleted: { backgroundColor: Colors.secondary },
  stepPillText: { fontSize: 11, fontWeight: 'bold', color: Colors.textSecondary },
  sectionTitle: { fontSize: 17, fontWeight: 'bold', color: Colors.textPrimary },
  sectionSub: { fontSize: 12, color: Colors.textSecondary, marginBottom: 14, marginTop: 2 },
  imagePickerContainer: { alignItems: 'center', marginBottom: 12 },
  imagePlaceholder: { width: 76, height: 76, borderRadius: 38, backgroundColor: Colors.secondaryLight, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: Colors.secondaryBorder, borderStyle: 'dashed' },
  imagePlaceholderText: { color: Colors.secondary, fontWeight: '600', fontSize: 11, marginTop: 2 },
  profileImage: { width: 76, height: 76, borderRadius: 38 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  halfCol: { flex: 1 },
  label: { fontSize: 13, fontWeight: '600', marginTop: 8, color: Colors.textSecondary },
  input: { backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginTop: 4, marginBottom: 8, fontSize: 14 },
  dropdownSelector: { backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12, marginTop: 4, marginBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dropdownSelectorText: { fontSize: 14, color: Colors.textPrimary, fontWeight: '600' },
  
  matrixRow: { marginBottom: 14, backgroundColor: '#F9FAFB', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: Colors.border },
  matrixRowUnreviewed: { borderColor: '#F59E0B', backgroundColor: '#FFFBEB' },
  unreviewedPill: { backgroundColor: '#FEF3C7', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  unreviewedPillText: { fontSize: 9, fontWeight: 'bold', color: '#B45309' },
  matrixHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  matrixAttrLabel: { fontSize: 14, fontWeight: 'bold', color: Colors.textPrimary },
  matrixSelectedBadge: { fontSize: 11, fontWeight: 'bold', color: Colors.primary },
  matrixOptionsRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 6 },
  matrixOptionBtn: { flex: 1, paddingVertical: 8, paddingHorizontal: 4, borderRadius: 6, backgroundColor: '#FFF', borderWidth: 1, borderColor: Colors.border, alignItems: 'center' },
  matrixOptionBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  matrixOptionText: { fontSize: 11, fontWeight: '600', color: Colors.textSecondary, textAlign: 'center' },
  matrixOptionTextActive: { color: '#FFF', fontWeight: 'bold' },
  starRow: { flexDirection: 'row', gap: 12, marginVertical: 10, paddingHorizontal: 4 },
  stageFooterRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 18, paddingTop: 14, borderTopWidth: 1, borderTopColor: Colors.border, gap: 8 },
  secondaryNavBtn: { flex: 0.28, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 12, borderRadius: 8, backgroundColor: '#E5E7EB' },
  secondaryNavBtnText: { color: Colors.textPrimary, fontWeight: 'bold', fontSize: 13 },
  draftSaveBtn: { flex: 0.38, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 12, borderRadius: 8, backgroundColor: Colors.secondaryLight, borderWidth: 1, borderColor: Colors.secondaryBorder },
  draftSaveBtnText: { color: Colors.secondary, fontWeight: 'bold', fontSize: 13 },
  primaryNavBtn: { flex: 0.34, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 12, borderRadius: 8, backgroundColor: Colors.secondary },
  submitEvalBtn: { flex: 0.34, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 12, borderRadius: 8, backgroundColor: Colors.primary },
  primaryNavBtnText: { color: '#FFF', fontWeight: 'bold', fontSize: 13 },
  button: { backgroundColor: Colors.primary, padding: 15, borderRadius: 8, alignItems: 'center', marginTop: 15 },
  buttonText: { color: '#FFF', textAlign: 'center', fontWeight: 'bold', fontSize: 15 },
  bufferCard: { backgroundColor: '#FFF', padding: 15, borderRadius: 10, marginBottom: 15, elevation: 1 },
  countPill: { backgroundColor: Colors.secondaryLight, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  countPillText: { color: Colors.secondary, fontSize: 11, fontWeight: 'bold' },
  queueItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  queueAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: Colors.primary, justifyContent: 'center', alignItems: 'center' },
  statusBox: { backgroundColor: Colors.warningBg, padding: 15, borderRadius: 10, marginBottom: 20 },
  statusTitle: { fontWeight: 'bold', color: Colors.warningText, fontSize: 14 },
  statusSub: { fontSize: 11, color: Colors.warningText, marginTop: 2 },
  syncBtn: { backgroundColor: Colors.warningText, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 },
  syncBtnText: { color: '#FFF', fontWeight: 'bold', fontSize: 13 },
  
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#FFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '80%' },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: Colors.textPrimary, marginBottom: 6 },
  modalSub: { fontSize: 12, color: Colors.textSecondary, marginBottom: 10 },
  modalCatHeader: { fontSize: 11, fontWeight: 'bold', color: Colors.primary, marginTop: 8, marginBottom: 4 },
  modalPositionItem: { paddingVertical: 12, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  modalPositionText: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  modalPlayerItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  modalPlayerName: { fontSize: 15, fontWeight: 'bold', color: Colors.textPrimary },
  modalPlayerMeta: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  modalCloseBtn: { marginTop: 15, padding: 12, backgroundColor: Colors.danger, borderRadius: 8, alignItems: 'center' },
  modalCloseText: { color: '#FFF', fontWeight: 'bold' }
});