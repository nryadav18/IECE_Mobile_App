import React, { useContext } from 'react';
import { View, Text } from 'react-native';
import { ThemeContext } from '../context/ThemeContext';
import { CALENDAR_LEGEND } from '../utils/calendarColors';

/**
 * The colour guide shown at the bottom of every attendance calendar. Reads the
 * canonical legend from calendarColors so it can never drift from the marks that
 * are actually painted. Pass `items` to show a subset (same colours, fewer rows).
 */
export default function CalendarLegend({ items = CALENDAR_LEGEND, style }) {
  const { theme } = useContext(ThemeContext);
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          flexWrap: 'wrap',
          justifyContent: 'center',
          paddingHorizontal: 12,
          paddingVertical: 10,
          borderTopWidth: 1,
          borderTopColor: theme.colors.border,
          backgroundColor: theme.colors.background,
        },
        style,
      ]}
    >
      {items.map((it) => (
        <View key={it.key} style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 7, marginVertical: 3 }}>
          <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: it.color, marginRight: 5 }} />
          <Text style={{ color: theme.colors.textSecondary, fontSize: 11.5 }}>{it.label}</Text>
        </View>
      ))}
    </View>
  );
}
