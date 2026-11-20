// src/app/index.tsx
import React, { useState, useEffect, useMemo } from 'react';
import ModalBackdrop from '../components/ModalBackdrop';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, KeyboardAvoidingView, ActivityIndicator, Modal, FlatList, ScrollView, Image } from 'react-native';
import PasswordField from '../components/PasswordField';
import { ThemeQuickToggle } from '../components/AppearanceToggle';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { apiFetch } from '../lib/api';
import { ENTITY_TYPES } from '../constants/entityTypes';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import { useColors, makeCardSpec, useSheetPad, type ThemeColors } from '../theme/theme';

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
  const Colors = useColors();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const sheetPad = useSheetPad();
  const [isLogin, setIsLogin] = useState(true);
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<'Coach' | 'Scout'>('Coach'); 
  
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingClubs, setIsFetchingClubs] = useState(false);
  const [clubsError, setClubsError] = useState<string | null>(null);
  
  const [clubs, setClubs] = useState<ClubOption[]>([]);
  const [selectedClub, setSelectedClub] = useState<ClubOption | null>(null);
  const [showClubModal, setShowClubModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreatingNewClub, setIsCreatingNewClub] = useState(false);
  const [newClubName, setNewClubName] = useState('');
  const [newClubRegion, setNewClubRegion] = useState('');
  const [newClubEntityType, setNewClubEntityType] = useState('');
  const [newClubContactEmail, setNewClubContactEmail] = useState('');
  const [newClubContactPhone, setNewClubContactPhone] = useState('');

  const [showForgot, setShowForgot] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetSending, setResetSending] = useState(false);

  const router = useRouter();

  useEffect(() => {
    checkExistingSession();
    fetchClubs();
  }, []);

  /** Registration answers, stored in the Supabase account's metadata and read by the backend on first sign-in. */
  const buildRegistrationMetadata = (fallbackName?: string) => ({
    username: username.trim() || fallbackName || '',
    phone: phone.trim() || undefined,
    role,
    clubId: role === 'Coach' ? selectedClub?.id : undefined,
    newClubName: role === 'Coach' && !selectedClub ? newClubName.trim() || undefined : undefined,
    newClubRegion: newClubRegion.trim() || undefined,
    newClubEntityType: role === 'Coach' && !selectedClub && newClubName.trim() ? newClubEntityType : undefined,
    newClubContactEmail: newClubContactEmail.trim() || undefined,
    newClubContactPhone: newClubContactPhone.trim() || undefined,
  });

  // Admins are flagged in the account's app_metadata, which users cannot edit; the server re-checks it on every call.
  const isAdminUser = (user?: { app_metadata?: Record<string, any> } | null) => user?.app_metadata?.role === 'admin';

  const checkExistingSession = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        if (isAdminUser(session.user)) {
          router.replace('/admin' as Href);
          return;
        }
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
    setClubsError(null);
    try {
      const data = await apiFetch('/clubs/public', { auth: false });
      if (Array.isArray(data)) setClubs(data);
    } catch (error: any) {
      console.log('Could not fetch clubs:', error);
      setClubsError(error?.message || 'Could not load academies.');
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

  const sendResetLink = async () => {
    const address = resetEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      Alert.alert('Invalid Email', 'Please enter a valid email address.');
      return;
    }
    setResetSending(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(address, {
        redirectTo: AuthSession.makeRedirectUri({ scheme: 'scoutconnectfrontend', path: 'reset-password' }),
      });
      if (error && /rate limit/i.test(error.message)) throw error;
      // Same answer whether or not the address has an account, so this cannot be used to find out who is registered.
      setShowForgot(false);
      setResetEmail('');
      Alert.alert('Check your email', 'If that address has an account, we have sent a link to reset your passcode. It expires after a while and works once.');
    } catch (error) {
      Alert.alert('Could not send the link', getFriendlyErrorMessage(error));
    } finally {
      setResetSending(false);
    }
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
            const googleUser = sessionData.session.user;
            if (isAdminUser(googleUser)) {
              router.replace('/admin' as Href);
              return;
            }
            if (!googleUser.user_metadata?.role) {
              // A first-time coach must name an academy, as in the email form; otherwise the server cannot build the profile.
              if (role === 'Coach' && !selectedClub && !newClubName.trim()) {
                await supabase.auth.signOut();
                Alert.alert(
                  'Choose your academy first',
                  'New coaches must pick or register an academy. Tap "Create credentials", choose the academy, then continue with Google.'
                );
                return;
              }
              const { error: metaError } = await supabase.auth.updateUser({
                data: buildRegistrationMetadata(googleUser.user_metadata?.full_name || googleUser.email?.split('@')[0]),
              });
              if (metaError) throw metaError;
              await supabase.auth.refreshSession(); // new token carries the saved answers
            }
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

        if (isAdminUser(data.user)) {
          router.replace('/admin' as Href);
          return;
        }

        await SecureStore.setItemAsync('userToken', data.session.access_token);
        await SecureStore.setItemAsync('userRole', role);
        if (role === 'Coach') router.replace('/coach');
        else router.replace('/scout');

      } else {
        const { data: authData, error: authError } = await supabase.auth.signUp({
          email: email.trim(),
          password: password,
          options: {
            data: buildRegistrationMetadata(),
            // After confirming the email, the link opens the app instead of a dead web page.
            emailRedirectTo: AuthSession.makeRedirectUri({ scheme: 'scoutconnectfrontend' }),
          },
        });

        if (authError) throw authError;
        if (!authData.user) throw new Error('Failed to create account. Please try again.');

        Alert.alert(
          'Registration Successful', 
          selectedClub
            ? `Your account has been created! Please verify your email, then sign in. The owner of ${selectedClub.name} must approve your request before you can access its roster.`
            : 'Your account has been created! Please check your email to verify your account before signing in.'
        );
        
        setIsLogin(true);
        setPassword('');
        setConfirmPassword('');
        setNewClubName('');
        setNewClubRegion('');
        setNewClubEntityType('');
        setNewClubContactEmail('');
        setNewClubContactPhone('');
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
      {/* Android is edge-to-edge, so the OS no longer resizes for the keyboard: 'padding' is needed on both platforms. */}
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <ThemeQuickToggle />
      <View style={styles.formCard}>

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

        <View>
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
          <PasswordField 
            style={styles.input} 
            placeholder="••••••••" 
            placeholderTextColor="#9CA3AF"
            value={password} 
            onChangeText={setPassword} 
             
            editable={!isLoading} 
          />

          {isLogin && (
            <TouchableOpacity onPress={() => { setResetEmail(email); setShowForgot(true); }} accessibilityRole="button" style={{ alignSelf: 'flex-end', marginTop: -8, marginBottom: 12 }}>
              <Text style={{ color: Colors.secondary, fontSize: 12, fontWeight: 'bold' }}>Forgot passcode?</Text>
            </TouchableOpacity>
          )}

          {!isLogin && (
            <>
              <Text style={styles.inputLabel}>Confirm Passcode *</Text>
              <PasswordField 
                style={styles.input} 
                placeholder="••••••••" 
                placeholderTextColor="#9CA3AF"
                value={confirmPassword} 
                onChangeText={setConfirmPassword} 
                 
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
                  {selectedClub ? `${selectedClub.name} (${selectedClub.region})` : newClubName ? `${newClubName} (${newClubEntityType})` : "Tap to Select or Register Academy"}
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

          <TouchableOpacity onPress={() => router.push('/privacy' as Href)} accessibilityRole="link" style={{ alignItems: 'center', marginBottom: 6 }}>
            <Text style={{ fontSize: 12, color: Colors.textSecondary, textAlign: 'center' }}>
              {isLogin ? 'By signing in you accept our ' : 'By creating credentials you accept our '}
              <Text style={{ color: Colors.secondary, fontWeight: 'bold' }}>Privacy Policy & Terms</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </View>

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
      </ScrollView>
      </KeyboardAvoidingView>

      <Modal statusBarTranslucent navigationBarTranslucent visible={showForgot} animationType="slide" transparent={true} onRequestClose={() => setShowForgot(false)}>
        <View style={styles.modalOverlay}>
          <ModalBackdrop onPress={() => !resetSending && setShowForgot(false)} />
          <View style={[styles.modalContent, sheetPad]}>
            <Text style={styles.modalTitle}>Reset your passcode</Text>
            <Text style={{ fontSize: 13, color: Colors.textSecondary, marginBottom: 12 }}>
              Enter your account email. We will send a link that opens this app so you can choose a new passcode.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. coach@academy.rw"
              placeholderTextColor="#9CA3AF"
              keyboardType="email-address"
              autoCapitalize="none"
              value={resetEmail}
              onChangeText={setResetEmail}
              editable={!resetSending}
            />
            <TouchableOpacity style={[styles.primaryBtn, resetSending && styles.primaryBtnDisabled]} onPress={sendResetLink} disabled={resetSending}>
              {resetSending ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Send reset link</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={{ alignItems: 'center', marginTop: 14 }} onPress={() => setShowForgot(false)} disabled={resetSending}>
              <Text style={{ color: Colors.textSecondary }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal statusBarTranslucent navigationBarTranslucent visible={showClubModal} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <ModalBackdrop onPress={() => setShowClubModal(false)} />
          <View style={[styles.modalContent, sheetPad]}>
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
                        <Text style={{ color: clubsError ? Colors.danger : Colors.textSecondary, marginBottom: 10, textAlign: 'center' }}>
                          {clubsError ? `Couldn't load academies: ${clubsError}` : 'No matching academy found.'}
                        </Text>
                        {clubsError && (
                          <TouchableOpacity onPress={fetchClubs} accessibilityRole="button">
                            <Text style={{ color: Colors.secondary, fontWeight: 'bold' }}>Try again</Text>
                          </TouchableOpacity>
                        )}
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

                <Text style={styles.inputLabel}>Entity Classification *</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                  {ENTITY_TYPES.map((type) => (
                    <TouchableOpacity
                      key={type}
                      onPress={() => setNewClubEntityType(type)}
                      style={{
                        paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1,
                        borderColor: newClubEntityType === type ? Colors.primary : Colors.borderStrong,
                        backgroundColor: newClubEntityType === type ? Colors.primary : 'transparent',
                      }}
                    >
                      <Text style={{ fontSize: 12, fontWeight: '600', color: newClubEntityType === type ? '#fff' : Colors.textPrimary }}>{type}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.inputLabel}>Official Contact Email (Optional)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. info@kimironkocity.rw"
                  value={newClubContactEmail}
                  onChangeText={setNewClubContactEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />

                <Text style={styles.inputLabel}>Contact Phone (Optional)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. +250 7xx xxx xxx"
                  value={newClubContactPhone}
                  onChangeText={setNewClubContactPhone}
                  keyboardType="phone-pad"
                />

                <TouchableOpacity 
                  style={[styles.primaryBtn, { marginTop: 10 }]}
                  onPress={() => {
                    if (!newClubName.trim()) {
                      Alert.alert('Error', 'Please enter a club name.');
                      return;
                    }
                    if (!newClubEntityType) {
                      Alert.alert('Error', 'Please choose an entity classification.');
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

const makeStyles = (Colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.canvas },
  scrollContent: { flexGrow: 1, justifyContent: 'center', padding: 15 },
  formCard: { ...makeCardSpec(Colors), padding: 20, marginHorizontal: 5, marginTop: 20 },
  logoContainer: { alignItems: 'center', marginBottom: 20 },
  logoCircle: { width: 50, height: 50, borderRadius: 25, backgroundColor: Colors.primary, justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  title: { fontSize: 26, fontWeight: 'bold', color: Colors.textPrimary },
  subtitle: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  roleToggle: { flexDirection: 'row', marginBottom: 20, backgroundColor: Colors.surfaceMuted, borderRadius: 8, padding: 4 },
  roleBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 6 },
  roleBtnActive: { backgroundColor: Colors.primary },
  roleText: { color: Colors.textSecondary, fontWeight: 'bold' },
  roleTextActive: { color: '#FFF' },
  inputLabel: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary, marginBottom: 4 },
  input: { backgroundColor: Colors.inputBg, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 15, fontSize: 15, color: Colors.textPrimary },
  primaryBtn: { backgroundColor: Colors.primary, padding: 14, borderRadius: 8, alignItems: 'center', marginTop: 5 },
  primaryBtnDisabled: { backgroundColor: '#9CA3AF' },
  primaryBtnText: { color: '#FFF', fontSize: 15, fontWeight: 'bold' },
  
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 15 },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  googleBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, padding: 14, borderRadius: 8, gap: 10 },
  googleIcon: { width: 20, height: 20 },
  googleBtnText: { color: Colors.textPrimary, fontWeight: '600', fontSize: 14 },
  
  switchBtn: { marginTop: 20, marginBottom: 10, alignItems: 'center' },
  switchBtnText: { color: Colors.textSecondary, fontSize: 13 },
  clubSelector: { backgroundColor: Colors.inputBg, borderWidth: 1, borderColor: Colors.border, padding: 12, borderRadius: 8, marginBottom: 15 },
  clubSelectorText: { color: Colors.textSecondary },
  clubSelectorTextActive: { color: Colors.textPrimary, fontWeight: 'bold' },
  
  footerRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 15, paddingHorizontal: 5 },
  footerBadge: { flex: 0.48, backgroundColor: Colors.card, padding: 10, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 8, elevation: 1 },
  footerBadgeTitle: { fontSize: 11, fontWeight: 'bold', color: Colors.textPrimary },
  footerBadgeSub: { fontSize: 10, color: Colors.textSecondary },
  
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: Colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '80%' },
  modalTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 15, textAlign: 'center', color: Colors.textPrimary },
  modalSearchInput: { backgroundColor: Colors.inputBg, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 10, fontSize: 14, color: Colors.textPrimary },
  modalItem: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.border },
  modalItemName: { fontSize: 16, fontWeight: 'bold', color: Colors.textPrimary },
  modalItemRegion: { fontSize: 12, color: Colors.textSecondary },
  createNewClubToggle: { backgroundColor: Colors.secondaryLight, padding: 10, borderRadius: 8, marginTop: 10 },
  modalCloseBtn: { marginTop: 15, padding: 12, backgroundColor: Colors.danger, borderRadius: 8, alignItems: 'center' },
  modalCloseText: { color: '#FFF', fontWeight: 'bold' }
});