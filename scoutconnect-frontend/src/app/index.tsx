import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, KeyboardAvoidingView, Platform, ActivityIndicator, Modal, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';

const API_BASE = 'https://scoutconnect.onrender.com/';

interface ClubOption { id: string; name: string; region: string; }

export default function AuthScreen() {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState('Coach'); 
  const [isLoading, setIsLoading] = useState(false);
  
  // Club Selection State
  const [clubs, setClubs] = useState<ClubOption[]>([]);
  const [selectedClub, setSelectedClub] = useState<ClubOption | null>(null);
  const [showClubModal, setShowClubModal] = useState(false);
  
  const router = useRouter();

  useEffect(() => {
    fetchClubs();
  }, []);

  const fetchClubs = async () => {
    try {
      const response = await fetch(`${API_BASE}/clubs/public`);
      const data = await response.json();
      if (response.ok) setClubs(data);
    } catch (error) {
      console.log('Could not fetch clubs:', error);
    }
  };

  const validateInputs = () => {
    if (!username.trim() || !password.trim()) {
      Alert.alert('Validation Error', 'Username and password cannot be empty.');
      return false;
    }
    if (username.length < 3) {
      Alert.alert('Validation Error', 'Username must be at least 3 characters long.');
      return false;
    }
    if (password.length < 6) {
      Alert.alert('Validation Error', 'Password must be at least 6 characters long.');
      return false;
    }
    if (!isLogin && password !== confirmPassword) {
      Alert.alert('Validation Error', 'Passwords do not match.');
      return false;
    }
    if (!isLogin && role === 'Coach' && !selectedClub) {
      Alert.alert('Validation Error', 'Coaches must select a club to register.');
      return false;
    }
    return true;
  };

  const handleAuth = async () => {
    if (!validateInputs()) return;

    setIsLoading(true);
    const endpoint = isLogin ? '/auth/login' : '/auth/register';
    
    // Assigns null clubId to Scouts, and the selected ID to Coaches
    const payload = isLogin 
      ? { username: username.trim(), password } 
      : { 
          username: username.trim(), 
          password, 
          role, 
          clubId: role === 'Coach' ? selectedClub?.id : null 
        };

    try {
      const response = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (!response.ok) throw new Error(data.error || 'Authentication failed.');

      if (isLogin) {
        await SecureStore.setItemAsync('userToken', data.token);
        if (data.role === 'Coach') router.replace('/coach');
        else if (data.role === 'Scout') router.replace('/scout');
      } else {
        Alert.alert('Success', 'Account created! You can now log in.');
        setIsLogin(true);
        setPassword('');
        setConfirmPassword('');
      }
    } catch (error) {
      Alert.alert('Connection Error', (error as Error).message || 'Could not connect to the server.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.formContainer}>
        
        <Text style={styles.title}>ScoutConnect</Text>
        <Text style={styles.subtitle}>{isLogin ? 'Sign in to your account' : 'Create a new account'}</Text>

        {!isLogin && (
          <View style={styles.roleToggle}>
            <TouchableOpacity onPress={() => setRole('Coach')} style={[styles.roleBtn, role === 'Coach' && styles.roleBtnActive]}>
              <Text style={[styles.roleText, role === 'Coach' && styles.roleTextActive]}>Coach</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setRole('Scout')} style={[styles.roleBtn, role === 'Scout' && styles.roleBtnActive]}>
              <Text style={[styles.roleText, role === 'Scout' && styles.roleTextActive]}>Scout</Text>
            </TouchableOpacity>
          </View>
        )}

        <TextInput style={styles.input} placeholder="Username" value={username} onChangeText={setUsername} autoCapitalize="none" editable={!isLoading} />
        <TextInput style={styles.input} placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry editable={!isLoading} />

        {!isLogin && (
          <TextInput style={styles.input} placeholder="Confirm Password" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry editable={!isLoading} />
        )}

        {/* Club Selection UI (Only shows for registering Coaches) */}
        {!isLogin && role === 'Coach' && (
          <TouchableOpacity style={styles.clubSelector} onPress={() => setShowClubModal(true)}>
            <Text style={selectedClub ? styles.clubSelectorTextActive : styles.clubSelectorText}>
              {selectedClub ? selectedClub.name : "Tap to Select Your Club"}
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={[styles.primaryBtn, isLoading && styles.primaryBtnDisabled]} onPress={handleAuth} disabled={isLoading}>
          {isLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>{isLogin ? 'Log In' : 'Register'}</Text>}
        </TouchableOpacity>

        <TouchableOpacity style={styles.switchBtn} onPress={() => { setIsLogin(!isLogin); setPassword(''); setConfirmPassword(''); }} disabled={isLoading}>
          <Text style={styles.switchBtnText}>{isLogin ? "Don't have an account? Sign Up" : "Already have an account? Log In"}</Text>
        </TouchableOpacity>

      </KeyboardAvoidingView>

      {/* Club Selection Modal */}
      <Modal visible={showClubModal} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Select Your Club</Text>
            <FlatList
              data={clubs}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity 
                  style={styles.modalItem}
                  onPress={() => { setSelectedClub(item); setShowClubModal(false); }}
                >
                  <Text style={styles.modalItemName}>{item.name}</Text>
                  <Text style={styles.modalItemRegion}>{item.region}</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={<Text style={{textAlign: 'center', padding: 20}}>No clubs available. Ensure backend is running.</Text>}
            />
            <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setShowClubModal(false)}>
              <Text style={styles.modalCloseText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f4f4', justifyContent: 'center' },
  formContainer: { padding: 20, backgroundColor: '#fff', margin: 20, borderRadius: 12, elevation: 5 },
  title: { fontSize: 32, fontWeight: 'bold', textAlign: 'center', color: '#2E8B57', marginBottom: 5 },
  subtitle: { fontSize: 16, textAlign: 'center', color: '#666', marginBottom: 30 },
  roleToggle: { flexDirection: 'row', marginBottom: 20, backgroundColor: '#eee', borderRadius: 8, padding: 4 },
  roleBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 6 },
  roleBtnActive: { backgroundColor: '#2E8B57' },
  roleText: { color: '#555', fontWeight: 'bold' },
  roleTextActive: { color: '#fff' },
  input: { borderBottomWidth: 1, borderColor: '#ccc', paddingVertical: 10, marginBottom: 20, fontSize: 16 },
  primaryBtn: { backgroundColor: '#2E8B57', padding: 15, borderRadius: 8, alignItems: 'center', marginTop: 10 },
  primaryBtnDisabled: { backgroundColor: '#8fcba8' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  switchBtn: { marginTop: 20, alignItems: 'center' },
  switchBtnText: { color: '#0056b3', fontSize: 14, fontWeight: '600' },
  
  // Club Selection Styles
  clubSelector: { padding: 15, backgroundColor: '#eef5fe', borderRadius: 8, borderWidth: 1, borderColor: '#d0e3ff', marginBottom: 20, alignItems: 'center' },
  clubSelectorText: { color: '#0056b3', fontWeight: '600' },
  clubSelectorTextActive: { color: '#111', fontWeight: 'bold' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '80%' },
  modalTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 15, textAlign: 'center' },
  modalItem: { paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: '#eee' },
  modalItemName: { fontSize: 16, fontWeight: 'bold', color: '#333' },
  modalItemRegion: { fontSize: 13, color: '#888' },
  modalCloseBtn: { marginTop: 15, padding: 15, backgroundColor: '#ff4444', borderRadius: 8, alignItems: 'center' },
  modalCloseText: { color: '#fff', fontWeight: 'bold', fontSize: 16 }
});