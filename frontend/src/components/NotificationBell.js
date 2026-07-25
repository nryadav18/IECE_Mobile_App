import React, { useContext } from 'react';
import { TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemeContext } from '../context/ThemeContext';
import { useBadges } from '../context/BadgeContext';
import CountBadge from './CountBadge';

/**
 * Header bell showing the caller's unread notification count and opening the
 * inbox. The count comes from the app-wide BadgeContext, so it stays in sync
 * (polling + app-foreground) across every screen without each bell fetching.
 *
 * Props: navigation (required), color (optional icon colour), size (optional)
 */
export default function NotificationBell({ navigation, color, size = 24, style }) {
  const { theme } = useContext(ThemeContext);
  const { unread } = useBadges();

  const iconColor = color || theme.colors.textPrimary;

  return (
    <TouchableOpacity
      onPress={() => navigation.navigate('Notifications')}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={[{ padding: 4 }, style]}
      accessibilityLabel="Notifications"
    >
      <Ionicons name="notifications-outline" size={size} color={iconColor} />
      <CountBadge count={unread} overlay />
    </TouchableOpacity>
  );
}
