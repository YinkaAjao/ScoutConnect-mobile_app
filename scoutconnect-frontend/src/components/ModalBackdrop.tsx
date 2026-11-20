// src/components/ModalBackdrop.tsx
import React from 'react';
import { Pressable, StyleSheet } from 'react-native';

/**
 * Put this as the FIRST child of a modal's dimmed overlay, before the content card.
 * It fills the overlay behind the card, so tapping an empty area closes the modal
 * while taps on the card itself are unaffected.
 */
export default function ModalBackdrop({ onPress }: { onPress: () => void }) {
  return <Pressable style={StyleSheet.absoluteFill} onPress={onPress} accessibilityRole="button" accessibilityLabel="Close" />;
}
