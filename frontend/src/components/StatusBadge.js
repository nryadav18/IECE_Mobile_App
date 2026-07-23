import React from 'react';
import { View, Text } from 'react-native';

// Status → colour. These are intentionally literal (not theme) so a status
// reads the same in light and dark mode, matching the rest of the app.
const STATUS_COLORS = {
  pending: '#F59E0B',
  approved: '#27AE60',
  active: '#27AE60',
  completed: '#10B981',
  rejected: '#F44336',
  cancelled: '#888888',
};

const LABELS = {
  pending: 'Pending',
  approved: 'Approved',
  active: 'Active',
  completed: 'Completed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

export default function StatusBadge({ status, style }) {
  const color = STATUS_COLORS[status] || '#888888';
  return (
    <View
      style={[
        { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: color + '20', alignSelf: 'flex-start' },
        style,
      ]}
    >
      <Text style={{ fontSize: 10, fontWeight: '800', color, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {LABELS[status] || status}
      </Text>
    </View>
  );
}
