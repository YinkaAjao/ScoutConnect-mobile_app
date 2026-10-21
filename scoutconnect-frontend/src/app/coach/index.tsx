// src/app/coach/index.tsx
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, Alert, ScrollView, Image, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';
import * as SecureStore from 'expo-secure-store';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { API_BASE, Colors, CardSpec } from '../../constants/designSystem';
import { 
  initDB, saveEvaluationLocally, deleteEvaluationDraft, saveMatchStatLocally, saveAchievementLocally, 
  getDraftEvaluations, getUnsyncedEvaluations, getUnsyncedMatchStats, getUnsyncedAchievements, 
  markEvaluationsAsSynced, markMatchStatsAsSynced, markAchievementsAsSynced 
} from '../../../database';

const UPLOAD_URL = `${API_BASE}/upload`;
const SYNC_URL = `${API_BASE}/sync`;

const RATING_OPTIONS = [
  { value: 1, short: 'Needs Imp.', full: 'Needs Improvement' },
  { value: 2, short: 'Average', full: 'Average' },
  { value: 3, short: 'Good', full: 'Good' },
  { value: 4, short: 'Excellent', full: 'Excellent' },
];

const POSITIONS = ['Goalkeeper', 'Defender', 'Midfielder', 'Forward', 'Other'];

const STAGES = [
  { id: 1, title: 'Identity & Info', icon: 'person-outline' },
  { id: 2, title: 'Technical', icon: 'football-outline' },
  { id: 3, title: 'Tactical', icon: 'compass-outline' },
  { id: 4, title: 'Physical & Psych', icon: 'fitness-outline' },
  { id: 5, title: 'Summary', icon: 'clipboard-outline' },
];

export default function CoachScreen() {
  const [activeTab, setActiveTab] = useState<'Evaluation' | 'MatchStat' | 'Achievement'>('Evaluation'); 
  
  // --- STAGED CHECKLIST STATE ---
  const [currentStage, setCurrentStage] = useState<number>(1);
  const [editingDraftId, setEditingDraftId] = useState<number | null>(null);

  // Stage 1: Identity & Context
  const [playerFirstName, setPlayerFirstName] = useState('');
  const [playerLastName, setPlayerLastName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('2008-01-01');
  const [position, setPosition] = useState('Forward');
  const [teamName, setTeamName] = useState('');
  const [evaluatorFirstName, setEvaluatorFirstName] = useState('');
  const [evaluatorLastName, setEvaluatorLastName] = useState('');
  const [evalMonth, setEvalMonth] = useState('10');
  const [evalDay, setEvalDay] = useState('19');
  const [evalYear, setEvalYear] = useState('2026');
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);

  // Stage 2: Technical Skills Assessment (1-4)
  const [technical, setTechnical] = useState<Record<string, number>>({
    ballControl: 3,
    passingAccuracy: 3,
    dribbling: 3,
    shooting: 3,
    firstTouch: 3,
  });

  // Stage 3: Tactical Awareness Assessment (1-4)
  const [tactical, setTactical] = useState<Record<string, number>>({
    positioning: 3,
    decisionMaking: 3,
    gameVision: 3,
    offTheBallMovement: 3,
  });

  // Stage 4: Physical & Psychological Attributes Assessment (1-4) + Optional 30m Sprint
  const [physical, setPhysical] = useState<Record<string, number>>({
    speed: 3,
    stamina: 3,
    strength: 3,
    agility: 3,
  });
  const [sprintSpeed, setSprintSpeed] = useState(''); // Optional stopwatch 30m time
  const [psychological, setPsychological] = useState<Record<string, number>>({
    teamwork: 3,
    attitude: 3,
    workEthic: 3,
    coachability: 3,
  });

  // Stage 5: Overall Performance Rating & Open Notes
  const [overallRating, setOverallRating] = useState<number>(4); // 1-5 scale
  const [strengths, setStrengths] = useState('');
  const [areasForImprovement, setAreasForImprovement] = useState('');
  const [evalType] = useState('Checklist');

  // --- MATCH STATS & ACHIEVEMENTS STATE ---
  const [statPlayerName, setStatPlayerName] = useState('');
  const [competition, setCompetition] = useState('');
  const [matchDate, setMatchDate] = useState('');
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
    setPosition('Forward');
    setTeamName('');
    setProfilePhoto(null);
    setTechnical({ ballControl: 3, passingAccuracy: 3, dribbling: 3, shooting: 3, firstTouch: 3 });
    setTactical({ positioning: 3, decisionMaking: 3, gameVision: 3, offTheBallMovement: 3 });
    setPhysical({ speed: 3, stamina: 3, strength: 3, agility: 3 });
    setSprintSpeed('');
    setPsychological({ teamwork: 3, attitude: 3, workEthic: 3, coachability: 3 });
    setOverallRating(4);
    setStrengths('');
    setAreasForImprovement('');
  };

  const loadDraftIntoForm = (draft: any) => {
    setEditingDraftId(draft.id);
    setCurrentStage(draft.currentStage || 1);
    setProfilePhoto(draft.profilePhoto || null);
    setDateOfBirth(draft.dateOfBirth || '2008-01-01');
    setPosition(draft.position || 'Forward');

    if (draft.checklistJson) {
      try {
        const parsed = JSON.parse(draft.checklistJson);
        setPlayerFirstName(parsed.playerFirstName || '');
        setPlayerLastName(parsed.playerLastName || '');
        setTeamName(parsed.teamName || '');
        setEvaluatorFirstName(parsed.evaluatorFirstName || '');
        setEvaluatorLastName(parsed.evaluatorLastName || '');
        if (parsed.evalMonth) setEvalMonth(parsed.evalMonth);
        if (parsed.evalDay) setEvalDay(parsed.evalDay);
        if (parsed.evalYear) setEvalYear(parsed.evalYear);
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

  const handleRemoveDraft = async (id: number) => {
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

      const token = await SecureStore.getItemAsync('userToken'); 

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
      }
    } catch (error) {
      console.log('Sync failed:', error);
    } finally {
      setIsSyncing(false);
    }
  };

  // Compute averages & build payload for either Draft (isDraft=1) or Final Submission (isDraft=0)
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
    }

    const avg = (obj: Record<string, number>) => {
      const vals = Object.values(obj);
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    };

    const techAvg4 = avg(technical);         // 1 to 4
    const tacAvg4 = avg(tactical);           // 1 to 4
    const physAvg4 = avg(physical);          // 1 to 4
    const psychAvg4 = avg(psychological);    // 1 to 4

    // Normalize Technical Average to 1-5 scale for backward-compatible charts
    const computedDribblingScore = parseFloat(((techAvg4 / 4) * 5).toFixed(1));
    // Use entered stopwatch time or estimate from Physical Speed rating
    const computedSprintSpeed = sprintSpeed ? parseFloat(sprintSpeed) : parseFloat((4.8 - (physical.speed * 0.25)).toFixed(2));

    const evaluatorFullName = `${evaluatorFirstName.trim()} ${evaluatorLastName.trim()}`.trim();
    const evaluationDate = `${evalYear}-${evalMonth.padStart(2, '0')}-${evalDay.padStart(2, '0')}`;

    const checklistObject = {
      playerFirstName: playerFirstName.trim(),
      playerLastName: playerLastName.trim(),
      position,
      teamName: teamName.trim(),
      evaluatorFirstName: evaluatorFirstName.trim(),
      evaluatorLastName: evaluatorLastName.trim(),
      evaluatorName: evaluatorFullName,
      evalMonth,
      evalDay,
      evalYear,
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
      overallRating,
      strengths: strengths.trim(),
      areasForImprovement: areasForImprovement.trim(),
    };

    const summaryWorkRate = `${position} | Overall: ${overallRating}/5 | Strengths: ${strengths.trim() || 'Logged in checklist'}`;

    await saveEvaluationLocally(
      fullName,
      dateOfBirth,
      profilePhoto,
      computedSprintSpeed,
      computedDribblingScore,
      summaryWorkRate,
      evalType,
      position,
      JSON.stringify(checklistObject),
      currentStage,
      isDraftFlag,
      editingDraftId
    );

    await checkUnsyncedRecords();

    if (isDraftFlag === 1) {
      Alert.alert('Draft Saved', `Progress for ${fullName} (Stage ${currentStage}/5) saved locally. You can resume anytime.`);
    } else {
      resetEvaluationForm();
      Alert.alert('Evaluation Queued', `${fullName}'s full evaluation checklist is finalized and queued for sync.`);
      triggerSync();
    }
  };

  const handleSaveStatsOrMedals = async () => {
    try {
      if (!statPlayerName.trim()) {
        Alert.alert('Validation Error', 'Player Full Name is required.');
        return;
      }
      if (activeTab === 'MatchStat') {
        await saveMatchStatLocally(statPlayerName.trim(), dateOfBirth, competition, matchDate, opponent, matchResult, parseInt(goals) || 0, parseInt(assists) || 0, parseInt(minutesPlayed) || 90);
        setCompetition(''); setMatchDate(''); setOpponent(''); setMatchResult(''); setGoals('0'); setAssists('0'); setMinutesPlayed('');
      } else if (activeTab === 'Achievement') {
        await saveAchievementLocally(statPlayerName.trim(), dateOfBirth, title, parseInt(year) || 2026);
        setTitle(''); setYear('');
      }
      await checkUnsyncedRecords();
      Alert.alert('Saved to Local Cache', `${statPlayerName} record cached offline.`);
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
  ) => (
    <View key={fieldKey} style={styles.matrixRow}>
      <View style={styles.matrixHeaderRow}>
        <Text style={styles.matrixAttrLabel}>{label}</Text>
        <Text style={styles.matrixSelectedBadge}>
          {RATING_OPTIONS.find(o => o.value === stateObj[fieldKey])?.full}
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

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
        
        {/* Offline Status Top Banner */}
        <View style={styles.topBanner}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="flash" size={14} color={Colors.warningText} />
            <Text style={styles.topBannerText}>OFFLINE MODE • PITCHSIDE STORAGE ACTIVE</Text>
          </View>
          <View style={styles.pillBadge}>
            <Text style={styles.pillBadgeText}>v2.5 Staged</Text>
          </View>
        </View>

        <View style={styles.headerRow}>
          <View>
            <Text style={styles.subHeader}>SCOUTCONNECT ACADEMY</Text>
            <Text style={styles.header}>Player Evaluation Checklist</Text>
          </View>
          <View style={styles.coachBadge}>
            <Text style={styles.coachBadgeText}>COACH</Text>
          </View>
        </View>
        
        {/* Main Tab Switcher */}
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

        {/* Saved Drafts Banner (Allows Resuming Incomplete Evaluations) */}
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
                    <Text style={{ fontSize: 11, color: Colors.textSecondary }}>{draft.position || 'Forward'} • Tap to continue</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleRemoveDraft(draft.id)} style={{ padding: 6 }}>
                  <Ionicons name="trash-outline" size={18} color={Colors.danger} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {/* EVALUATION MULTI-STAGE CHECKLIST CARD */}
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

            {/* Interactive 5-Stage Progress Stepper */}
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

            {/* STAGE 1: PLAYER & EVALUATOR IDENTITY */}
            {currentStage === 1 && (
              <View>
                <Text style={styles.sectionTitle}>Stage 1: Player & Evaluator Info</Text>
                <Text style={styles.sectionSub}>Fill out basic profile info now and save as a draft anytime.</Text>

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

                <Text style={styles.label}>Player Position *</Text>
                <View style={styles.positionGrid}>
                  {POSITIONS.map(pos => (
                    <TouchableOpacity
                      key={pos}
                      onPress={() => setPosition(pos)}
                      style={[styles.posOption, position === pos && styles.posOptionActive]}
                    >
                      <Text style={[styles.posOptionText, position === pos && styles.posOptionTextActive]}>{pos}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <View style={styles.row}>
                  <View style={styles.halfCol}>
                    <Text style={styles.label}>Team Name</Text>
                    <TextInput style={styles.input} placeholder="e.g. ALU Sentinels" placeholderTextColor="#9CA3AF" value={teamName} onChangeText={setTeamName} />
                  </View>
                  <View style={styles.halfCol}>
                    <Text style={styles.label}>Player DOB</Text>
                    <TextInput style={styles.input} placeholder="YYYY-MM-DD" placeholderTextColor="#9CA3AF" value={dateOfBirth} onChangeText={setDateOfBirth} />
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

                <Text style={styles.label}>Evaluation Date * (MM / DD / YYYY)</Text>
                <View style={styles.row}>
                  <TextInput style={[styles.input, { flex: 0.28, textAlign: 'center' }]} placeholder="MM" maxLength={2} keyboardType="numeric" value={evalMonth} onChangeText={setEvalMonth} />
                  <TextInput style={[styles.input, { flex: 0.28, textAlign: 'center' }]} placeholder="DD" maxLength={2} keyboardType="numeric" value={evalDay} onChangeText={setEvalDay} />
                  <TextInput style={[styles.input, { flex: 0.4, textAlign: 'center' }]} placeholder="YYYY" maxLength={4} keyboardType="numeric" value={evalYear} onChangeText={setEvalYear} />
                </View>
              </View>
            )}

            {/* STAGE 2: TECHNICAL SKILLS ASSESSMENT */}
            {currentStage === 2 && (
              <View>
                <Text style={styles.sectionTitle}>Stage 2: Technical Skills Assessment *</Text>
                <Text style={styles.sectionSub}>Rate each technical attribute from Needs Improvement to Excellent.</Text>
                {renderRatingRow('Ball Control', 'ballControl', technical, setTechnical)}
                {renderRatingRow('Passing Accuracy', 'passingAccuracy', technical, setTechnical)}
                {renderRatingRow('Dribbling', 'dribbling', technical, setTechnical)}
                {renderRatingRow('Shooting', 'shooting', technical, setTechnical)}
                {renderRatingRow('First Touch', 'firstTouch', technical, setTechnical)}
              </View>
            )}

            {/* STAGE 3: TACTICAL AWARENESS ASSESSMENT */}
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

            {/* STAGE 4: PHYSICAL & PSYCHOLOGICAL ATTRIBUTES */}
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

            {/* STAGE 5: OVERALL RATING & SUMMARY NOTES */}
            {currentStage === 5 && (
              <View>
                <Text style={styles.sectionTitle}>Stage 5: Overall Rating & Review *</Text>
                <Text style={styles.sectionSub}>Provide final summary notes and submit to the sync queue.</Text>

                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 }}>
                  <Text style={styles.label}>Overall Performance Rating (1-5) *</Text>
                  <Text style={{ fontSize: 12, color: Colors.primary, fontWeight: 'bold' }}>{overallRating} / 5 • Verified</Text>
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
                  placeholder="e.g. Exceptional close control under pressure, vocal organizer..." 
                  placeholderTextColor="#9CA3AF"
                  multiline
                  value={strengths} 
                  onChangeText={setStrengths} 
                />

                <Text style={styles.label}>Areas for Improvement (What can the player work on?)</Text>
                <TextInput 
                  style={[styles.input, { height: 75, textAlignVertical: 'top' }]} 
                  placeholder="e.g. Weak foot distribution and defensive transition recovery..." 
                  placeholderTextColor="#9CA3AF"
                  multiline
                  value={areasForImprovement} 
                  onChangeText={setAreasForImprovement} 
                />
              </View>
            )}

            {/* STAGE NAVIGATION & DRAFT CONTROLS */}
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

        {/* MATCH STATS & ACHIEVEMENTS CARD */}
        {activeTab !== 'Evaluation' && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{activeTab === 'MatchStat' ? 'Log Match Statistics' : 'Log Trophy / Medal'}</Text>
            <Text style={styles.label}>Player Full Name *</Text>
            <TextInput style={styles.input} placeholder="e.g. Mateo Kovacic" placeholderTextColor="#9CA3AF" value={statPlayerName} onChangeText={setStatPlayerName} />

            {activeTab === 'MatchStat' ? (
              <View>
                <Text style={styles.label}>Competition / League</Text>
                <TextInput style={styles.input} placeholder="e.g. Varsity League" placeholderTextColor="#9CA3AF" value={competition} onChangeText={setCompetition} />
                <Text style={styles.label}>Match Date</Text>
                <TextInput style={styles.input} placeholder="YYYY-MM-DD" placeholderTextColor="#9CA3AF" value={matchDate} onChangeText={setMatchDate} />
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

        {/* Finalized Offline Buffer Queue Section */}
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
            cachedQueue.slice(0, 3).map((item, index) => (
              <View key={index} style={styles.queueItem}>
                <View style={styles.queueAvatar}>
                  <Text style={{color: '#FFF', fontWeight: 'bold', fontSize: 11}}>{item.playerName.substring(0, 2).toUpperCase()}</Text>
                </View>
                <View style={{flex: 1, marginLeft: 10}}>
                  <Text style={{fontWeight: 'bold', fontSize: 14, color: Colors.textPrimary}}>{item.playerName}</Text>
                  <Text style={{fontSize: 12, color: Colors.textSecondary}} numberOfLines={1}>{item.workRate || 'Completed Checklist'}</Text>
                </View>
                <Ionicons name="cloud-upload-outline" size={18} color={Colors.primary} />
              </View>
            ))
          )}
        </View>

        {/* Sync Status Box with Manual Sync Button */}
        <View style={styles.statusBox}>
          <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}}>
            <View style={{flex: 1, marginRight: 10}}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Ionicons name="warning-outline" size={16} color={Colors.warningText} />
                <Text style={styles.statusTitle}>Finalized Records Waiting: {pendingSync}</Text>
              </View>
              <Text style={styles.statusSub}>Drafts ({draftsList.length}) stay local until submitted</Text>
            </View>
            <TouchableOpacity 
              style={[styles.syncBtn, isSyncing && {backgroundColor: '#9CA3AF'}]} 
              onPress={triggerSync}
              disabled={isSyncing}
            >
              {isSyncing ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={styles.syncBtnText}>Sync Now</Text>}
            </TouchableOpacity>
          </View>
        </View>

      </ScrollView>
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
  positionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6, marginBottom: 10 },
  posOption: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, backgroundColor: '#F3F4F6', borderWidth: 1, borderColor: Colors.border },
  posOptionActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  posOptionText: { fontSize: 12, fontWeight: 'bold', color: Colors.textSecondary },
  posOptionTextActive: { color: '#FFF' },
  label: { fontSize: 13, fontWeight: '600', marginTop: 8, color: Colors.textSecondary },
  input: { backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginTop: 4, marginBottom: 8, fontSize: 14 },
  matrixRow: { marginBottom: 14, backgroundColor: '#F9FAFB', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: Colors.border },
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
  syncBtnText: { color: '#FFF', fontWeight: 'bold', fontSize: 13 }
});