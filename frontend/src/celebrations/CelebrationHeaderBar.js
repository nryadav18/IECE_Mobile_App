/**
 * What the floating bar says on a celebration day.
 *
 * The bar has two title layers that cross-fade as the page scrolls: expanded
 * while the hero is visible, compact once it has scrolled away. On an ordinary
 * day those read "Good afternoon / Kiran" and "Global Dashboard / Welcome…".
 *
 * On a celebration day the greeting goes, because the hero right below is
 * already saying it far better — the expanded layer shrinks to a quiet label,
 * and the compact layer inherits the wish for when the hero is out of sight.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { withAlpha } from './palette';

export default function CelebrationBarTitle({ occasion, look, compact = false, count = 1 }) {
  if (compact) {
    return (
      <View style={styles.compactRow}>
        <View style={[styles.badge, { backgroundColor: withAlpha(look.accent, 0.22) }]}>
          <Ionicons name={occasion.emblem || 'sparkles-outline'} size={15} color={look.barInk} />
        </View>
        <View style={styles.compactText}>
          <Text style={[styles.title, { color: look.barInk }]} numberOfLines={1}>
            {occasion.wish || occasion.name}
          </Text>
          <Text style={[styles.sub, { color: withAlpha(look.barInk, 0.7) }]} numberOfLines={1}>
            {occasion.name}
            {count > 1 ? ` · +${count - 1} more today` : ''}
          </Text>
        </View>
      </View>
    );
  }

  // Expanded. Sits directly on the artwork, so it uses the scene's ink and
  // stays deliberately small — the hero underneath carries the message.
  return (
    <View style={styles.expandedRow}>
      <View style={[styles.badge, { backgroundColor: look.chip }]}>
        <Ionicons name={occasion.emblem || 'sparkles-outline'} size={15} color={look.ink} />
      </View>
      <Text style={[styles.label, { color: look.ink }]} numberOfLines={1}>
        {occasion.name}
        {count > 1 ? ` · +${count - 1}` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  expandedRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  compactRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  compactText: { flex: 1 },
  badge: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 13.5, fontWeight: '800', letterSpacing: 0.2, flexShrink: 1 },
  title: { fontSize: 16.5, fontWeight: '800', letterSpacing: -0.2 },
  sub: { fontSize: 11.5, fontWeight: '600', letterSpacing: 0.2 },
});
