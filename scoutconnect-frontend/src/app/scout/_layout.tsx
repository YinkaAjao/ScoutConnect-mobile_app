// src/app/scout/_layout.tsx
import { Tabs } from 'expo-router';
import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useColors, useTabBarOptions } from '../../theme/theme';

export default function ScoutLayout() {
  const Colors = useColors();
  const screenOptions = useTabBarOptions(Colors.secondary);
  return (
    <Tabs screenOptions={screenOptions}>
      <Tabs.Screen 
        name="index" 
        options={{ 
          title: 'Discover', 
          tabBarIcon: ({ color, size }) => <Ionicons name="compass-outline" size={size || 22} color={color} /> 
        }} 
      />
      <Tabs.Screen 
        name="shortlist" 
        options={{ 
          title: 'Shortlist', 
          tabBarIcon: ({ color, size }) => <Ionicons name="star-outline" size={size || 22} color={color} /> 
        }} 
      />
      <Tabs.Screen
        name="requests"
        options={{
          title: 'Requests',
          tabBarIcon: ({ color, size }) => <Ionicons name="mail-outline" size={size || 22} color={color} />
        }}
      />
      <Tabs.Screen 
        name="profile" 
        options={{ 
          title: 'Profile', 
          tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" size={size || 22} color={color} /> 
        }} 
      />
      {/* Athlete detail opens on top of the tabs; it is not a tab itself */}
      <Tabs.Screen name="player/[id]" options={{ href: null }} />
    </Tabs>
  );
}