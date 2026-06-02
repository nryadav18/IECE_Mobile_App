import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';

const COLORS = [
  '#FF4B5C', '#2ECC71', '#3498DB', '#9B59B6', 
  '#F1C40F', '#E67E22', '#E74C3C', '#1ABC9C'
];

export default function Avatar({ name, size = 40, style }) {
  // Memoize initials and color to stay consistent for the same name
  const { initials, color } = useMemo(() => {
    const fallback = 'U';
    if (!name || typeof name !== 'string') return { initials: fallback, color: COLORS[0] };
    
    const parts = name.trim().split(' ').filter(Boolean);
    let i = '';
    if (parts.length >= 2) {
      i = (parts[0][0] + parts[1][0]).toUpperCase();
    } else if (parts.length === 1) {
      i = parts[0].substring(0, 2).toUpperCase();
    } else {
      i = fallback;
    }

    // Hash the name to pick a consistent color
    let hash = 0;
    for (let j = 0; j < name.length; j++) {
      hash = name.charCodeAt(j) + ((hash << 5) - hash);
    }
    const colorIndex = Math.abs(hash) % COLORS.length;

    return { initials: i, color: COLORS[colorIndex] };
  }, [name]);

  const fontSize = size * 0.4;

  return (
    <View style={[
      styles.container, 
      { 
        width: size, 
        height: size, 
        borderRadius: size / 2, 
        backgroundColor: color 
      },
      style
    ]}>
      <Text style={[styles.text, { fontSize }]}>{initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  text: {
    color: '#FFFFFF',
    fontWeight: '700',
    letterSpacing: 1,
  }
});
