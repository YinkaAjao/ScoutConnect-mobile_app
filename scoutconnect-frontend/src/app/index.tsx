// src/app/index.tsx
import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, KeyboardAvoidingView, Platform, ActivityIndicator, Modal, FlatList, ScrollView, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { API_BASE, Colors, CardSpec } from '../constants/designSystem';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';

WebBrowser.maybeCompleteAuthSession();


interface ClubOption { id: string; name: string; region: string; }

// --- ERROR MAPPING UTILITY ---
const getFriendlyErrorMessage = (error: any): string => {
  const msg = error?.message?.toLowerCase() || '';
  if (msg.includes('invalid login credentials')) return 'The email or passcode you entered is incorrect. Please try again.';
  if (msg.includes('user already registered')) return 'An account with this email already exists. Try signing in instead.';
  if (msg.includes('password should be at least')) return 'Your passcode must be at least 6 characters long.';
  if (msg.includes('email not confirmed')) return 'Please verify your email address before signing in. Check your inbox for the verification link.';
  if (msg.includes('email rate limit exceeded')) return 'You have attempted to sign up or log in too many times. Please wait a few minutes before trying again.';
  if (msg.includes('network request failed') || msg.includes('failed to fetch')) return 'Network error. Please check your internet connection and try again.';
  return error?.message || 'An unexpected error occurred. Please try again.';
};

export default function AuthScreen() {
  const [isLogin, setIsLogin] = useState(true);
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<'Coach' | 'Scout'>('Coach'); 
  
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingClubs, setIsFetchingClubs] = useState(false);
  
  const [clubs, setClubs] = useState<ClubOption[]>([]);
  const [selectedClub, setSelectedClub] = useState<ClubOption | null>(null);
  const [showClubModal, setShowClubModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreatingNewClub, setIsCreatingNewClub] = useState(false);
  const [newClubName, setNewClubName] = useState('');
  const [newClubRegion, setNewClubRegion] = useState('');
  
  const router = useRouter();

  useEffect(() => {
    checkExistingSession();
    fetchClubs();
  }, []);

  const checkExistingSession = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        await SecureStore.setItemAsync('userToken', session.access_token);
        const savedRole = await SecureStore.getItemAsync('userRole');
        if (savedRole === 'Coach') router.replace('/coach');
        else if (savedRole === 'Scout') router.replace('/scout');
      }
    } catch (e) {
      console.log('Session check error:', e);
    }
  };

  const fetchClubs = async () => {
    setIsFetchingClubs(true);
    try {
      const response = await fetch(`${API_BASE}/clubs/public`);
      const text = await response.text();
      try {
        const data = JSON.parse(text);
        if (response.ok && Array.isArray(data)) {
          setClubs(data);
        }
      } catch (parseError) {
        console.log('Backend returned invalid JSON for clubs. Is the server running?', text.substring(0, 50));
      }
    } catch (error) {
      console.log('Could not fetch clubs:', error);
    } finally {
      setIsFetchingClubs(false);
    }
  };

  const filteredClubs = clubs.filter(c => 
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.region.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const validateInputs = () => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!email.trim() || !password.trim()) {
      Alert.alert('Missing Information', 'Please enter both your email and passcode.');
      return false;
    }
    if (!emailRegex.test(email.trim())) {
      Alert.alert('Invalid Email', 'Please enter a valid email address.');
      return false;
    }
    if (password.length < 6) {
      Alert.alert('Weak Passcode', 'Your passcode must be at least 6 characters long.');
      return false;
    }
    if (!isLogin) {
      if (!username.trim()) {
        Alert.alert('Missing Username', 'Please provide a full name or username for your profile.');
        return false;
      }
      if (password !== confirmPassword) {
        Alert.alert('Passcode Mismatch', 'The passcodes you entered do not match. Please try again.');
        return false;
      }
      if (role === 'Coach' && !selectedClub && !newClubName.trim()) {
        Alert.alert('Academy Required', 'Coaches must select an existing academy or register a new one.');
        return false;
      }
    }
    return true;
  };

  const handleGoogleAuth = async () => {
    setIsLoading(true);
    try {
      const redirectUrl = AuthSession.makeRedirectUri({
        scheme: 'scoutconnectfrontend',
        path: 'auth/callback',
      });

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          skipBrowserRedirect: true,
        },
      });

      if (error) throw error;
      if (!data?.url) throw new Error('No OAuth URL returned from Supabase.');

      const browserResult = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl);

      if (browserResult.type === 'success') {
        const queryOrFragment = browserResult.url.split('#')[1] || browserResult.url.split('?')[1] || '';
        const params = queryOrFragment.split('&').reduce((acc, current) => {
          const [key, value] = current.split('=');
          if (key && value) acc[key] = decodeURIComponent(value);
          return acc;
        }, {} as Record<string, string>);

        if (params.access_token && params.refresh_token) {
          const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
            access_token: params.access_token,
            refresh_token: params.refresh_token
          });
          
          if (sessionError) throw sessionError;
          
          if (sessionData.session) {
            await SecureStore.setItemAsync('userToken', sessionData.session.access_token);
            
            await SecureStore.setItemAsync('userRole', role);
            if (role === 'Coach') router.replace('/coach');
            else router.replace('/scout');
          }
        } else if (params.error_description) {
          throw new Error(params.error_description.replace(/\+/g, ' '));
        } else {
          throw new Error('Authentication failed: No tokens returned.');
        }
      }
    } catch (error) {
      Alert.alert('Google Sign-In Error', getFriendlyErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  const handleAuth = async () => {
    if (!validateInputs()) return;
    setIsLoading(true);

    try {
      if (isLogin) {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password: password
        });

        if (error) throw error;

        await SecureStore.setItemAsync('userToken', data.session.access_token);
        await SecureStore.setItemAsync('userRole', role);
        if (role === 'Coach') router.replace('/coach');
        else router.replace('/scout');

      } else {
        const { data: authData, error: authError } = await supabase.auth.signUp({
          email: email.trim(),
          password: password,
        });

        if (authError) throw authError;
        if (!authData.user) throw new Error('Failed to create account. Please try again.');

        const syncPayload = {
          id: authData.user.id,
          username: username.trim(),
          email: email.trim(),
          phone: phone.trim() || undefined,
          role: role,
          clubId: selectedClub?.id,
          newClubName: newClubName.trim() || undefined,
          newClubRegion: newClubRegion.trim() || 'Kigali'
        };

        const response = await fetch(`${API_BASE}/auth/sync-profile`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(syncPayload)
        });

        const responseText = await response.text();
        let resData;
        try {
          resData = JSON.parse(responseText);
        } catch (parseError) {
          console.error("Backend HTML response:", responseText.substring(0, 100));
          throw new Error('The backend server is unreachable. Please verify your API_BASE network address and ensure the server is running.');
        }

        if (!response.ok) throw new Error(resData.error || 'Failed to sync profile to the database.');

        Alert.alert(
          'Registration Successful', 
          'Your account has been created! Please check your email to verify your account before signing in.'
        );
        
        setIsLogin(true);
        setPassword('');
        setConfirmPassword('');
        setNewClubName('');
        setSelectedClub(null);
      }
    } catch (error) {
      Alert.alert('Authentication Error', getFriendlyErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.formCard}>
        
        <View style={styles.logoContainer}>
          <View style={styles.logoCircle}>
            <Ionicons name="football" size={28} color="#FFF" />
          </View>
          <Text style={styles.title}>ScoutConnect</Text>
          <Text style={styles.subtitle}>Grassroots Football Portal</Text>
        </View>

        <View style={styles.roleToggle}>
          <TouchableOpacity onPress={() => setRole('Coach')} style={[styles.roleBtn, role === 'Coach' && styles.roleBtnActive]}>
            <Text style={[styles.roleText, role === 'Coach' && styles.roleTextActive]}>Coach</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setRole('Scout')} style={[styles.roleBtn, role === 'Scout' && styles.roleBtnActive]}>
            <Text style={[styles.roleText, role === 'Scout' && styles.roleTextActive]}>Scout</Text>
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 380 }}>
          <Text style={styles.inputLabel}>Email Address *</Text>
          <TextInput 
            style={styles.input} 
            placeholder="e.g. coach@academy.rw" 
            placeholderTextColor="#9CA3AF"
            keyboardType="email-address"
            autoCapitalize="none"
            value={email} 
            onChangeText={setEmail} 
            editable={!isLoading} 
          />

          {!isLogin && (
            <>
              <Text style={styles.inputLabel}>Full Name / Username *</Text>
              <TextInput 
                style={styles.input} 
                placeholder="e.g. Coach Kigali" 
                placeholderTextColor="#9CA3AF"
                value={username} 
                onChangeText={setUsername} 
                editable={!isLoading} 
              />

              <Text style={styles.inputLabel}>Phone Number (Optional)</Text>
              <TextInput 
                style={styles.input} 
                placeholder="e.g. +250 788 000 000" 
                placeholderTextColor="#9CA3AF"
                keyboardType="phone-pad"
                value={phone} 
                onChangeText={setPhone} 
                editable={!isLoading} 
              />
            </>
          )}

          <Text style={styles.inputLabel}>Passcode *</Text>
          <TextInput 
            style={styles.input} 
            placeholder="••••••••" 
            placeholderTextColor="#9CA3AF"
            value={password} 
            onChangeText={setPassword} 
            secureTextEntry 
            editable={!isLoading} 
          />

          {!isLogin && (
            <>
              <Text style={styles.inputLabel}>Confirm Passcode *</Text>
              <TextInput 
                style={styles.input} 
                placeholder="••••••••" 
                placeholderTextColor="#9CA3AF"
                value={confirmPassword} 
                onChangeText={setConfirmPassword} 
                secureTextEntry 
                editable={!isLoading} 
              />
            </>
          )}

          {(!isLogin && role === 'Coach') && (
            <>
              <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6}}>
                <Text style={styles.inputLabel}>Assigned Club / Academy</Text>
                <Text style={{fontSize: 12, color: Colors.primary, fontWeight: 'bold'}}>Required</Text>
              </View>
              <TouchableOpacity style={styles.clubSelector} onPress={() => { fetchClubs(); setShowClubModal(true); }}>
                <Text style={(selectedClub || newClubName) ? styles.clubSelectorTextActive : styles.clubSelectorText}>
                  {selectedClub ? `${selectedClub.name} (${selectedClub.region})` : newClubName ? `${newClubName} (Provisional)` : "Tap to Select or Register Academy"}
                </Text>
              </TouchableOpacity>
            </>
          )}

          <TouchableOpacity style={[styles.primaryBtn, isLoading && styles.primaryBtnDisabled]} onPress={handleAuth} disabled={isLoading}>
            {isLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>{isLogin ? 'Sign In' : 'Complete Registration'}</Text>}
          </TouchableOpacity>

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={{ marginHorizontal: 10, color: Colors.textSecondary, fontSize: 12, fontWeight: 'bold' }}>OR</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity style={styles.googleBtn} onPress={handleGoogleAuth} disabled={isLoading}>
            <Image source={{ uri: 'https://img.icons8.com/color/48/000000/google-logo.png' }} style={styles.googleIcon} />
            <Text style={styles.googleBtnText}>Continue with Google</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.switchBtn} onPress={() => { setIsLogin(!isLogin); setPassword(''); setConfirmPassword(''); }} disabled={isLoading}>
            <Text style={styles.switchBtnText}>
              {isLogin ? "First time scout or coach? " : "Already have credentials? "}
              <Text style={{ color: Colors.primary, fontWeight: 'bold' }}>{isLogin ? "Create credentials" : "Sign In"}</Text>
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Dynamic Footer Badges Based on Selected Role */}
      <View style={styles.footerRow}>
        {role === 'Coach' ? (
          <>
            <View style={styles.footerBadge}>
              <Ionicons name="clipboard-outline" size={16} color={Colors.primary} />
              <View>
                <Text style={styles.footerBadgeTitle}>Academy Portal</Text>
                <Text style={styles.footerBadgeSub}>Pitchside toolkit</Text>
              </View>
            </View>
            <View style={styles.footerBadge}>
              <Ionicons name="sync" size={16} color={Colors.secondary} />
              <View>
                <Text style={styles.footerBadgeTitle}>Offline Sync</Text>
                <Text style={styles.footerBadgeSub}>Instant queue</Text>
              </View>
            </View>
          </>
        ) : (
          <>
            <View style={styles.footerBadge}>
              <Ionicons name="globe-outline" size={16} color={Colors.primary} />
              <View>
                <Text style={styles.footerBadgeTitle}>Talent Hub</Text>
                <Text style={styles.footerBadgeSub}>Discover prospects</Text>
              </View>
            </View>
            <View style={styles.footerBadge}>
              <Ionicons name="shield-checkmark" size={16} color={Colors.secondary} />
              <View>
                <Text style={styles.footerBadgeTitle}>Verified Data</Text>
                <Text style={styles.footerBadgeSub}>Telemetry access</Text>
              </View>
            </View>
          </>
        )}
      </View>

      <Modal visible={showClubModal} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Select or Register Academy</Text>
            
            {!isCreatingNewClub ? (
              <>
                <TextInput 
                  style={styles.modalSearchInput}
                  placeholder="Search academy by name or region..."
                  placeholderTextColor="#9CA3AF"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                />

                {isFetchingClubs ? (
                  <ActivityIndicator size="large" color={Colors.primary} style={{ marginVertical: 20 }} />
                ) : (
                  <FlatList
                    data={filteredClubs}
                    keyExtractor={(item) => item.id}
                    renderItem={({ item }) => (
                      <TouchableOpacity 
                        style={styles.modalItem}
                        onPress={() => { 
                          setSelectedClub(item); 
                          setNewClubName('');
                          setShowClubModal(false); 
                        }}
                      >
                        <Text style={styles.modalItemName}>{item.name}</Text>
                        <Text style={styles.modalItemRegion}>{item.region}</Text>
                      </TouchableOpacity>
                    )}
                    ListEmptyComponent={
                      <View style={{ padding: 20, alignItems: 'center' }}>
                        <Text style={{ color: Colors.textSecondary, marginBottom: 10 }}>No matching academy found.</Text>
                      </View>
                    }
                  />
                )}

                <TouchableOpacity 
                  style={styles.createNewClubToggle} 
                  onPress={() => setIsCreatingNewClub(true)}
                >
                  <Text style={{ color: Colors.secondary, fontWeight: 'bold', textAlign: 'center', marginVertical: 10 }}>+ Register a New Grassroots Academy</Text>
                </TouchableOpacity>
              </>
            ) : (
              <View style={{ paddingVertical: 10 }}>
                <Text style={{ fontSize: 13, color: Colors.textSecondary, marginBottom: 15 }}>
                  Can't find your club? Enter its details below to create a provisional academy profile.
                </Text>

                <Text style={styles.inputLabel}>Academy / Club Name</Text>
                <TextInput 
                  style={styles.input}
                  placeholder="e.g. Kimironko City FC"
                  value={newClubName}
                  onChangeText={setNewClubName}
                />

                <Text style={styles.inputLabel}>District / Region</Text>
                <TextInput 
                  style={styles.input}
                  placeholder="e.g. Kigali (Gasabo)"
                  value={newClubRegion}
                  onChangeText={setNewClubRegion}
                />

                <TouchableOpacity 
                  style={[styles.primaryBtn, { marginTop: 10 }]}
                  onPress={() => {
                    if (!newClubName.trim()) {
                      Alert.alert('Error', 'Please enter a club name.');
                      return;
                    }
                    setSelectedClub(null);
                    setIsCreatingNewClub(false);
                    setShowClubModal(false);
                  }}
                >
                  <Text style={styles.primaryBtnText}>Confirm New Academy</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={{ marginTop: 15, alignItems: 'center' }} 
                  onPress={() => setIsCreatingNewClub(false)}
                >
                  <Text style={{ color: Colors.textSecondary }}>← Back to Search</Text>
                </TouchableOpacity>
              </View>
            )}

            {!isCreatingNewClub && (
              <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setShowClubModal(false)}>
                <Text style={styles.modalCloseText}>Cancel</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.canvas, justifyContent: 'center', padding: 15 },
  formCard: { ...CardSpec, padding: 20, marginHorizontal: 5, marginTop: 20 },
  logoContainer: { alignItems: 'center', marginBottom: 20 },
  logoCircle: { width: 50, height: 50, borderRadius: 25, backgroundColor: Colors.primary, justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  title: { fontSize: 26, fontWeight: 'bold', color: Colors.textPrimary },
  subtitle: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  roleToggle: { flexDirection: 'row', marginBottom: 20, backgroundColor: '#F3F4F6', borderRadius: 8, padding: 4 },
  roleBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 6 },
  roleBtnActive: { backgroundColor: Colors.primary },
  roleText: { color: Colors.textSecondary, fontWeight: 'bold' },
  roleTextActive: { color: '#FFF' },
  inputLabel: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary, marginBottom: 4 },
  input: { backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 15, fontSize: 15 },
  primaryBtn: { backgroundColor: Colors.primary, padding: 14, borderRadius: 8, alignItems: 'center', marginTop: 5 },
  primaryBtnDisabled: { backgroundColor: '#9CA3AF' },
  primaryBtnText: { color: '#FFF', fontSize: 15, fontWeight: 'bold' },
  
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 15 },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  googleBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF', borderWidth: 1, borderColor: Colors.border, padding: 14, borderRadius: 8, gap: 10 },
  googleIcon: { width: 20, height: 20 },
  googleBtnText: { color: Colors.textPrimary, fontWeight: '600', fontSize: 14 },
  
  switchBtn: { marginTop: 20, marginBottom: 10, alignItems: 'center' },
  switchBtnText: { color: Colors.textSecondary, fontSize: 13 },
  clubSelector: { backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: Colors.border, padding: 12, borderRadius: 8, marginBottom: 15 },
  clubSelectorText: { color: Colors.textSecondary },
  clubSelectorTextActive: { color: Colors.textPrimary, fontWeight: 'bold' },
  
  footerRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 15, paddingHorizontal: 5 },
  footerBadge: { flex: 0.48, backgroundColor: '#FFF', padding: 10, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 8, elevation: 1 },
  footerBadgeTitle: { fontSize: 11, fontWeight: 'bold', color: Colors.textPrimary },
  footerBadgeSub: { fontSize: 10, color: Colors.textSecondary },
  
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#FFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '80%' },
  modalTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 15, textAlign: 'center' },
  modalSearchInput: { backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 10, fontSize: 14 },
  modalItem: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.border },
  modalItemName: { fontSize: 16, fontWeight: 'bold', color: Colors.textPrimary },
  modalItemRegion: { fontSize: 12, color: Colors.textSecondary },
  createNewClubToggle: { backgroundColor: Colors.secondaryLight, padding: 10, borderRadius: 8, marginTop: 10 },
  modalCloseBtn: { marginTop: 15, padding: 12, backgroundColor: Colors.danger, borderRadius: 8, alignItems: 'center' },
  modalCloseText: { color: '#FFF', fontWeight: 'bold' }
});