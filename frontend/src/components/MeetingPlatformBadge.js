import React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { platformMeta } from '../utils/meetingPlatform';

/**
 * A branded badge identifying a meeting platform: a rounded tile in the
 * platform's brand colour with an icon, plus (optionally) its name. Used both in
 * the Meeting Corner feed and as a live preview while pasting a link.
 *
 * Props:
 *  - platform: 'google_meet' | 'zoom' | 'teams' | 'webex' | 'other'
 *  - size: 'sm' | 'md' | 'lg'  (icon tile size)
 *  - showLabel: boolean (default true)
 */
export default function MeetingPlatformBadge({ platform, size = 'md', showLabel = true }) {
  const meta = platformMeta(platform);
  const dim = size === 'lg' ? 52 : size === 'sm' ? 34 : 44;
  const iconSize = size === 'lg' ? 26 : size === 'sm' ? 18 : 22;
  const fontSize = size === 'lg' ? 15 : size === 'sm' ? 12 : 13.5;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <View
        style={{
          width: dim,
          height: dim,
          borderRadius: dim * 0.28,
          backgroundColor: meta.color,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={meta.icon} size={iconSize} color="#fff" />
      </View>
      {showLabel && (
        <Text style={{ marginLeft: 10, fontSize, fontWeight: '700', color: meta.color }}>
          {meta.label}
        </Text>
      )}
    </View>
  );
}
