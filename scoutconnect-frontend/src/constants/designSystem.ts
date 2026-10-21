// src/constants/designSystem.ts

export const API_BASE = 'https://scoutconnect.onrender.com/api';

export const Colors = {
  primary: '#2E8B57',       // Sea Green - Coach UI, hero cards, active toggles
  primaryDark: '#065F46',   // Deep pitch green for headers/badges
  primaryLight: '#E8F5E9',  // Surface tint for active green badges
  secondary: '#0056B3',     // Scout Blue - Shortlist buttons, links, club contact
  secondaryLight: '#EEF5FE',// Light blue surface for Verified Club Rep box
  secondaryBorder: '#D0E3FF',
  canvas: '#F4F4F4',        // Level 0 Global viewport background
  card: '#FFFFFF',          // Level 1 Elevated data cards
  warningBg: '#FFE4B5',     // Offline queue banner background
  warningText: '#855B00',   // High-visibility offline typography
  textPrimary: '#111827',
  textSecondary: '#6B7280',
  border: '#E5E7EB',
  danger: '#D9534F',
};

export const Typography = {
  h1: { fontSize: 24, fontWeight: '700' as const, color: Colors.textPrimary },
  body: { fontSize: 16, fontWeight: '400' as const, color: Colors.textPrimary },
  label: { fontSize: 14, fontWeight: '600' as const, color: Colors.textSecondary },
  badge: { fontSize: 12, fontWeight: '700' as const },
};

export const CardSpec = {
  backgroundColor: Colors.card,
  borderRadius: 14,
  padding: 16,
  elevation: 2,
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.08,
  shadowRadius: 4,
};