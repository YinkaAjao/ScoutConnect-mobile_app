// src/app/scout/_layout.tsx
import { Tabs } from 'expo-router';
import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/designSystem';

export default function ScoutLayout() {
  return (
    <Tabs 
      screenOptions={{ 
        tabBarActiveTintColor: Colors.secondary, 
        tabBarInactiveTintColor: Colors.textSecondary,
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopColor: Colors.border,
          height: 60,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
      }}
    >
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
        name="profile" 
        options={{ 
          title: 'Profile', 
          tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" size={size || 22} color={color} /> 
        }} 
      />
    </Tabs>
  );
}