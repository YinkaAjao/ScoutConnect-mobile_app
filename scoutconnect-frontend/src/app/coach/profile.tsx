import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';

export default function ProfileScreen() {
  const router = useRouter();

  const handleLogout = async () => {
    await SecureStore.deleteItemAsync('userToken');
    router.replace('/');
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.header}>My Profile</Text>
      
      <View style={styles.menuCard}>
        <Text style={styles.menuItem}>Account Settings</Text>
        <Text style={styles.menuItem}>Help & Support</Text>
        <View style={styles.divider} />
        
        <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn}>
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f4f4', padding: 20 },
  header: { fontSize: 24, fontWeight: 'bold', marginBottom: 20, marginTop: 20, color: '#333' },
  menuCard: { backgroundColor: '#fff', borderRadius: 10, padding: 15, elevation: 3 },
  menuItem: { fontSize: 16, paddingVertical: 15, color: '#333' },
  divider: { height: 1, backgroundColor: '#eee', marginVertical: 5 },
  logoutBtn: { paddingVertical: 15, alignItems: 'center' },
  logoutText: { color: '#d9534f', fontSize: 16, fontWeight: 'bold' }
});