import { Tabs } from 'expo-router';
import React from 'react';

export default function CoachLayout() {
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: '#2E8B57', headerShown: false }}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: () => <Text>🏠</Text> }} />
      <Tabs.Screen name="players" options={{ title: 'My Players', tabBarIcon: () => <Text>⚽</Text> }} />
      <Tabs.Screen name="club" options={{ title: 'Club', tabBarIcon: () => <Text>🛡️</Text> }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: () => <Text>👤</Text> }} />
    </Tabs>
  );
}
// Note: You can replace the emoji text with actual icons from @expo/vector-icons later