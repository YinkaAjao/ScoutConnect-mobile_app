import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, Alert, ScrollView, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';
import * as yup from 'yup';
import * as SecureStore from 'expo-secure-store';
import * as ImagePicker from 'expo-image-picker';
import { 
  initDB, saveEvaluationLocally, saveMatchStatLocally, saveAchievementLocally, 
  getUnsyncedEvaluations, getUnsyncedMatchStats, getUnsyncedAchievements, 
  markEvaluationsAsSynced, markMatchStatsAsSynced, markAchievementsAsSynced 
} from '../../../database';

const BACKEND_URL = 'https://scoutconnect.onrender.com/api/sync'; 
const UPLOAD_URL = 'https://scoutconnect.onrender.com/api/upload'; // NEW: Upload API endpoint

const evaluationSchema = yup.object().shape({
  playerName: yup.string().required('Player Name is required.'),
  dateOfBirth: yup.string().matches(/^\d{4}-\d{2}-\d{2}$/, 'DOB must be YYYY-MM-DD').required('DOB is required.'),
  sprintSpeed: yup.number().typeError('Sprint speed must be a number.').min(0).max(15),
  dribblingScore: yup.number().typeError('Dribbling score must be a number.').min(1).max(10),
  workRate: yup.string().required('Work rate is required.')
});

export default function CoachScreen() {
  const [activeTab, setActiveTab] = useState('Evaluation'); 
  const [playerName, setPlayerName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null); // NEW: Image State
  
  const [sprintSpeed, setSprintSpeed] = useState('');
  const [dribblingScore, setDribblingScore] = useState('');
  const [workRate, setWorkRate] = useState('');
  const [evalType, setEvalType] = useState('Combine'); 
  
  const [competition, setCompetition] = useState('');
  const [matchDate, setMatchDate] = useState('');
  const [opponent, setOpponent] = useState('');
  const [matchResult, setMatchResult] = useState('');
  const [goals, setGoals] = useState('0');
  const [assists, setAssists] = useState('0');
  const [minutesPlayed, setMinutesPlayed] = useState('');
  
  const [title, setTitle] = useState('');
  const [year, setYear] = useState('');
  
  const [pendingSync, setPendingSync] = useState(0);

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
    const evals = await getUnsyncedEvaluations();
    const stats = await getUnsyncedMatchStats();
    const achs = await getUnsyncedAchievements();
    setPendingSync(evals.length + stats.length + achs.length);
  };

  // --- NEW: Handle Image Selection ---
  const pickImage = async () => {
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissionResult.granted) {
      Alert.alert("Permission Required", "Please allow access to your photos to upload a profile picture.");
      return;
    }

    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.5, // Compress for faster upload
    });

    if (!result.canceled) {
      setProfilePhoto(result.assets[0].uri); // Saves the local file:// URI
    }
  };


  const triggerSync = async () => {
    const records = await getUnsyncedEvaluations();
    const matchStats = await getUnsyncedMatchStats();
    const achievements = await getUnsyncedAchievements();

    if (records.length === 0 && matchStats.length === 0 && achievements.length === 0) return;

    try {
      const token = await SecureStore.getItemAsync('userToken'); 

      // --- NEW: Process Media Uploads before Syncing Data ---
      const processedRecords = await Promise.all(records.map(async (record: any) => {
        let finalPhotoUrl = record.profilePhoto;

        // If the photo is a local file, upload it via FormData
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
              headers: { 'Authorization': `Bearer ${token}` }, // fetch automatically sets multipart Content-Type
              body: formData
            });
            const uploadData = await uploadRes.json();
            if (uploadRes.ok) finalPhotoUrl = uploadData.url; // Replace local URI with public Cloud URL
          } catch (uploadErr) {
            console.log('Failed to upload image:', uploadErr);
          }
        }
        return { ...record, profilePhoto: finalPhotoUrl };
      }));
      // ----------------------------------------------------
      
      const response = await fetch(BACKEND_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        // Use the newly processed records that contain the cloud URLs
        body: JSON.stringify({ records: processedRecords, matchStats, achievements }) 
      });

      if (response.ok) {
        if (records.length > 0) await markEvaluationsAsSynced(records.map(r => r.id));
        if (matchStats.length > 0) await markMatchStatsAsSynced(matchStats.map(r => r.id));
        if (achievements.length > 0) await markAchievementsAsSynced(achievements.map(r => r.id));
        
        await checkUnsyncedRecords(); 
        Alert.alert('Sync Successful', 'All offline data pushed to the server!');
      }
    } catch (error) {
      console.log('Sync failed:', error);
    }
  };

  const handleSaveOffline = async () => {
    try {
      if (activeTab === 'Evaluation') {
        await evaluationSchema.validate({ playerName, dateOfBirth, sprintSpeed, dribblingScore, workRate });
      } else if (activeTab === 'MatchStat' || activeTab === 'Achievement') {
        if (!playerName || !dateOfBirth) throw new Error("Name and DOB required");
      }

      Alert.alert(
        "Verify Data",
        `Are you sure the ${activeTab} data for ${playerName} is correct?`,
        [
          { text: "Edit", style: "cancel" },
          { 
            text: "Confirm & Save", 
            style: "default",
            onPress: async () => {
              if (activeTab === 'Evaluation') {
                // FIXED: Passed profilePhoto into the local save function
                await saveEvaluationLocally(playerName, dateOfBirth, profilePhoto, parseFloat(sprintSpeed) || 0, parseInt(dribblingScore) || 0, workRate, evalType);
                setSprintSpeed(''); setDribblingScore(''); setWorkRate(''); setProfilePhoto(null);
              } else if (activeTab === 'MatchStat') {
                await saveMatchStatLocally(playerName, dateOfBirth, competition, matchDate, opponent, matchResult, parseInt(goals) || 0, parseInt(assists) || 0, parseInt(minutesPlayed) || 0);
                setCompetition(''); setMatchDate(''); setOpponent(''); setMatchResult(''); setGoals('0'); setAssists('0'); setMinutesPlayed('');
              } else if (activeTab === 'Achievement') {
                await saveAchievementLocally(playerName, dateOfBirth, title, parseInt(year) || 2026);
                setTitle(''); setYear('');
              }
              
              await checkUnsyncedRecords();
              Alert.alert('Saved', 'Added to offline queue.');
              triggerSync(); 
            }
          }
        ]
      );
    } catch (error) {
      if (error instanceof yup.ValidationError) Alert.alert('Validation Error', error.message);
      else Alert.alert('Error', (error as Error).message);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView>
        <Text style={styles.header}>Coach Dashboard</Text>
        
        <View style={styles.tabContainer}>
          <TouchableOpacity onPress={() => setActiveTab('Evaluation')} style={[styles.tabBtn, activeTab === 'Evaluation' && styles.tabBtnActive]}>
            <Text style={[styles.tabText, activeTab === 'Evaluation' && styles.tabTextActive]}>Evaluation</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setActiveTab('MatchStat')} style={[styles.tabBtn, activeTab === 'MatchStat' && styles.tabBtnActive]}>
            <Text style={[styles.tabText, activeTab === 'MatchStat' && styles.tabTextActive]}>Stats</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setActiveTab('Achievement')} style={[styles.tabBtn, activeTab === 'Achievement' && styles.tabBtnActive]}>
            <Text style={[styles.tabText, activeTab === 'Achievement' && styles.tabTextActive]}>Medals</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Athlete Identity</Text>
          
          {/* NEW: Image Picker UI */}
          <View style={styles.imagePickerContainer}>
            <TouchableOpacity onPress={pickImage} style={styles.imagePlaceholder}>
              {profilePhoto ? (
                <Image source={{ uri: profilePhoto }} style={styles.profileImage} />
              ) : (
                <Text style={styles.imagePlaceholderText}>+ Add Photo</Text>
              )}
            </TouchableOpacity>
          </View>

          <TextInput style={styles.input} placeholder="Player Name" value={playerName} onChangeText={setPlayerName} />
          <TextInput style={styles.input} placeholder="Date of Birth (YYYY-MM-DD)" value={dateOfBirth} onChangeText={setDateOfBirth} />
          <View style={styles.divider} />

          {activeTab === 'Evaluation' && (
            <View>
              <View style={styles.subToggleContainer}>
                <TouchableOpacity onPress={() => setEvalType('Combine')} style={[styles.subToggleBtn, evalType === 'Combine' && styles.subToggleBtnActive]}>
                  <Text style={[styles.subToggleText, evalType === 'Combine' && styles.subToggleTextActive]}>Combine</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setEvalType('Match')} style={[styles.subToggleBtn, evalType === 'Match' && styles.subToggleBtnActive]}>
                  <Text style={[styles.subToggleText, evalType === 'Match' && styles.subToggleTextActive]}>Match Eval</Text>
                </TouchableOpacity>
              </View>
              
              <Text style={styles.label}>Sprint Speed</Text>
              <TextInput style={styles.input} placeholder="e.g. 8.5" keyboardType="numeric" value={sprintSpeed} onChangeText={setSprintSpeed} />
              <Text style={styles.label}>Dribbling Score (1-10)</Text>
              <TextInput style={styles.input} placeholder="e.g. 7" keyboardType="numeric" value={dribblingScore} onChangeText={setDribblingScore} />
              <Text style={styles.label}>Work Rate</Text>
              <TextInput style={styles.input} placeholder="e.g. High, Medium, Low" value={workRate} onChangeText={setWorkRate} />
            </View>
          )}

          {activeTab === 'MatchStat' && (
            <View>
              <Text style={styles.label}>Competition / League</Text>
              <TextInput style={styles.input} placeholder="e.g. Varsity League" value={competition} onChangeText={setCompetition} />
              <Text style={styles.label}>Match Date</Text>
              <TextInput style={styles.input} placeholder="YYYY-MM-DD" value={matchDate} onChangeText={setMatchDate} />
              <Text style={styles.label}>Opponent</Text>
              <TextInput style={styles.input} placeholder="e.g. Kigali FC" value={opponent} onChangeText={setOpponent} />
              <Text style={styles.label}>Final Result</Text>
              <TextInput style={styles.input} placeholder="e.g. W 2-1" value={matchResult} onChangeText={setMatchResult} />

              <View style={{flexDirection: 'row', justifyContent: 'space-between'}}>
                <View style={{flex: 0.48}}>
                  <Text style={styles.label}>Goals</Text>
                  <TextInput style={styles.input} keyboardType="numeric" value={goals} onChangeText={setGoals} />
                </View>
                <View style={{flex: 0.48}}>
                  <Text style={styles.label}>Assists</Text>
                  <TextInput style={styles.input} keyboardType="numeric" value={assists} onChangeText={setAssists} />
                </View>
              </View>
              <Text style={styles.label}>Minutes Played</Text>
              <TextInput style={styles.input} placeholder="e.g. 90" keyboardType="numeric" value={minutesPlayed} onChangeText={setMinutesPlayed} />
            </View>
          )}

          {activeTab === 'Achievement' && (
            <View>
              <Text style={styles.label}>Trophy / Title</Text>
              <TextInput style={styles.input} placeholder="e.g. Tournament MVP" value={title} onChangeText={setTitle} />
              <Text style={styles.label}>Year</Text>
              <TextInput style={styles.input} placeholder="e.g. 2026" keyboardType="numeric" value={year} onChangeText={setYear} />
            </View>
          )}

          <TouchableOpacity style={styles.button} onPress={handleSaveOffline}>
            <Text style={styles.buttonText}>Save {activeTab}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.statusBox}>
          <Text style={styles.statusText}>Total Records Waiting to Sync: {pendingSync}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f4f4', padding: 15 },
  header: { fontSize: 24, fontWeight: 'bold', textAlign: 'center', marginVertical: 15, color: '#333' },
  tabContainer: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 15, backgroundColor: '#ddd', borderRadius: 8, padding: 4 },
  tabBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 6 },
  tabBtnActive: { backgroundColor: '#fff' },
  tabText: { color: '#666', fontWeight: '600' },
  tabTextActive: { color: '#2E8B57', fontWeight: 'bold' },
  card: { backgroundColor: '#fff', padding: 20, borderRadius: 10, elevation: 3 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#111', marginBottom: 10 },
  divider: { height: 1, backgroundColor: '#eee', marginVertical: 15 },
  
  // NEW STYLES
  imagePickerContainer: { alignItems: 'center', marginBottom: 15 },
  imagePlaceholder: { width: 100, height: 100, borderRadius: 50, backgroundColor: '#eef5fe', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#d0e3ff', borderStyle: 'dashed' },
  imagePlaceholderText: { color: '#0056b3', fontWeight: '600' },
  profileImage: { width: 100, height: 100, borderRadius: 50 },

  subToggleContainer: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 15 },
  subToggleBtn: { paddingVertical: 8, paddingHorizontal: 15, backgroundColor: '#eee', borderRadius: 6, flex: 0.48, alignItems: 'center' },
  subToggleBtnActive: { backgroundColor: '#2E8B57' },
  subToggleText: { color: '#333', fontWeight: 'bold' },
  subToggleTextActive: { color: '#fff' },
  label: { fontSize: 14, fontWeight: '600', marginTop: 10, color: '#555' },
  input: { borderBottomWidth: 1, borderColor: '#ccc', paddingVertical: 8, marginBottom: 10, fontSize: 16 },
  button: { backgroundColor: '#2E8B57', padding: 15, borderRadius: 8, marginTop: 20 },
  buttonText: { color: '#fff', textAlign: 'center', fontWeight: 'bold', fontSize: 16 },
  statusBox: { marginTop: 20, marginBottom: 30, padding: 15, backgroundColor: '#ffe4b5', borderRadius: 8 },
  statusText: { textAlign: 'center', fontWeight: '600', color: '#b8860b' }
});