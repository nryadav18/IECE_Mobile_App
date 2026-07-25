import React, { useContext } from 'react';
import { View, Text } from 'react-native';
import { ThemeContext } from '../context/ThemeContext';

/**
 * A small count pill used everywhere counts appear (bell, hamburger, sidebar
 * rows, section tabs). Renders nothing when count <= 0.
 *
 * Props:
 *  - count: number
 *  - overlay: boolean — absolutely position it at the top-right of a parent icon
 *  - color / textColor: overrides
 *  - borderColor: ring colour (defaults to the surface, so it reads over icons)
 *  - size: 'sm' | 'md'
 */
export default function CountBadge({ count = 0, overlay = false, color, textColor = '#fff', borderColor, size = 'md', style }) {
  const { theme } = useContext(ThemeContext);
  if (!count || count <= 0) return null;

  const h = size === 'sm' ? 16 : 18;
  const label = count > 99 ? '99+' : String(count);

  return (
    <View
      style={[
        {
          minWidth: h,
          height: h,
          borderRadius: h / 2,
          backgroundColor: color || theme.colors.primary,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 5,
        },
        overlay && {
          position: 'absolute',
          top: -6,
          right: -8,
          borderWidth: 1.5,
          borderColor: borderColor || theme.colors.surface,
        },
        style,
      ]}
    >
      <Text style={{ color: textColor, fontSize: size === 'sm' ? 9.5 : 10.5, fontWeight: '800' }}>{label}</Text>
    </View>
  );
}
