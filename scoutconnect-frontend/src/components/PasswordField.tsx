// src/components/PasswordField.tsx
import React, { useState } from 'react';
import { StyleSheet, TextInput, TouchableOpacity, View, type TextInputProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '../theme/theme';

/**
 * Passcode input with an eye button to reveal what was typed. Pass the screen's normal input style: its outer margin
 * moves to the wrapper so the eye stays centred on the field.
 */
export default function PasswordField({ style, ...props }: TextInputProps) {
  const Colors = useColors();
  const [visible, setVisible] = useState(false);
  const { marginBottom, marginTop, marginVertical, margin, ...inputStyle } = StyleSheet.flatten(style) || {};

  return (
    <View style={{ marginBottom, marginTop, marginVertical, margin, justifyContent: 'center' }}>
      <TextInput
        placeholderTextColor="#9CA3AF"
        autoCapitalize="none"
        autoCorrect={false}
        {...props}
        secureTextEntry={!visible}
        style={[inputStyle, { color: Colors.textPrimary, paddingRight: 46, marginBottom: 0 }]}
      />
      <TouchableOpacity
        onPress={() => setVisible((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={visible ? 'Hide passcode' : 'Show passcode'}
        hitSlop={8}
        style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 46, alignItems: 'center', justifyContent: 'center' }}
      >
        <Ionicons name={visible ? 'eye-off-outline' : 'eye-outline'} size={20} color={Colors.textSecondary} />
      </TouchableOpacity>
    </View>
  );
}
