import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function CoachLayout() {
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: '#2E8B57', headerShown: false }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Evaluate',
          tabBarIcon: ({ color, size }) => <Ionicons name="clipboard-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="players"
        options={{
          title: 'My Roster',
          tabBarIcon: ({ color, size }) => <Ionicons name="people-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="club"
        options={{
          title: 'Club',
          tabBarIcon: ({ color, size }) => <Ionicons name="shield-half-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => <Ionicons name="person-circle-outline" size={size} color={color} />,
        }}
      />
      {/* Hide dynamic player detail route from appearing as a tab button */}
      <Tabs.Screen
        name="player/[id]"
        options={{
          href: null,
        }}
      />
    </Tabs>
  );
}