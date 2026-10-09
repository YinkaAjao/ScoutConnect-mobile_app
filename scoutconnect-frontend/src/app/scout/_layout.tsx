import { Tabs } from 'expo-router';
import React from 'react';

export default function ScoutLayout() {
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: '#0056b3', headerShown: false }}>
      <Tabs.Screen name="index" options={{ title: 'Discover', tabBarIcon: () => <Text>🔍</Text> }} />
      <Tabs.Screen name="shortlist" options={{ title: 'Shortlist', tabBarIcon: () => <Text>⭐</Text> }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: () => <Text>👤</Text> }} />
    </Tabs>
  );
}