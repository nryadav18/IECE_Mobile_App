import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import PressableScale from './PressableScale';

/**
 * The primary call to action.
 *
 * Deliberately plain. The previous version stacked a breathing halo behind the
 * button and swept a translucent sheen across its face; both were overlays sat
 * on top of / around the label, both animated forever even when the screen was
 * nowhere near the viewport, and between them the label stopped being readable.
 *
 * A solid fill, a real label, and a spring under the finger is all this needs —
 * the hero above it is where the motion budget belongs.
 */
export default function PortalButton({ label, icon = 'apps-outline', onPress, theme, style }) {
  return (
    <View style={style}>
      <PressableScale
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={[styles.button, { backgroundColor: theme.colors.primary }]}
      >
        <Ionicons name={icon} size={19} color="#FFFFFF" />
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
        <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.9)" />
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    paddingVertical: 17,
    paddingHorizontal: 20,
    borderRadius: 16,
    // No `overflow: 'hidden'` and no elevation/shadow: there is nothing left to
    // clip, and a shadow on this view was being redrawn under the entrance
    // animation for no visual gain.
  },
  label: {
    color: '#FFFFFF',
    fontSize: 15.5,
    fontWeight: '800',
    letterSpacing: 0.2,
    // Never let the row's centring squeeze the label to nothing.
    flexShrink: 0,
  },
});
