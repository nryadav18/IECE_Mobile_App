import React, { useCallback, useContext, useState } from 'react';
import { TouchableOpacity, View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { ThemeContext } from '../context/ThemeContext';
import { getUnreadCount } from '../services/inbox';

/**
 * Header bell that shows the caller's unread notification count and opens the
 * inbox. Refreshes the count every time the host screen regains focus (e.g.
 * after returning from the inbox), so the badge stays current.
 *
 * Props: navigation (required), color (optional icon colour), size (optional)
 */
export default function NotificationBell({ navigation, color, size = 24, style }) {
  const { theme } = useContext(ThemeContext);
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(() => {
    let active = true;
    getUnreadCount()
      .then((res) => {
        if (active) setUnread(res?.unreadCount || 0);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useFocusEffect(refresh);

  const iconColor = color || theme.colors.textPrimary;

  return (
    <TouchableOpacity
      onPress={() => navigation.navigate('Notifications')}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={[{ padding: 4 }, style]}
      accessibilitylabel="Notifications"
    >
      <Ionicons name="notifications-outline" size={size} color={iconColor} />
      {unread > 0 && (
        <View
          style={{
            position: 'absolute',
            top: -2,
            right: -2,
            minWidth: 18,
            height: 18,
            borderRadius: 9,
            backgroundColor: theme.colors.primary,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 4,
            borderWidth: 1.5,
            borderColor: theme.colors.surface,
          }}
        >
          <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>
            {unread > 99 ? '99+' : unread}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}
