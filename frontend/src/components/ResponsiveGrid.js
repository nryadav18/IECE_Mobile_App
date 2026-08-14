import React from 'react';
import { View } from 'react-native';
import { isWeb } from '../utils/platform';
import useResponsiveLayout from '../hooks/useResponsiveLayout';

/**
 * Reflows a stack of cards into columns when there is width to spend.
 *
 * The app's lists are all one-card-per-row, which is right on a phone and looks
 * wrong on a 1440px monitor: a card stretches into a slab with a few words
 * floating at the left edge. This wraps those same cards — unchanged — into as
 * many columns as the viewport can hold.
 *
 * On native it returns the children exactly as they were passed, with no extra
 * View and no measurement, so the mobile app renders the identical tree it did
 * before. Everything here is opt-in per call site and web-only in effect.
 */
export default function ResponsiveGrid({ children, gap = 14, style, minColumnWidth = 320 }) {
  const { columns, width } = useResponsiveLayout();

  const items = React.Children.toArray(children).filter(Boolean);

  // Never let a narrow window be forced into columns it cannot fit — a 2-column
  // layout at 760px would squeeze cards below their readable width.
  const fit = Math.max(1, Math.floor(width / minColumnWidth));
  const cols = Math.min(columns, fit);

  if (!isWeb || cols < 2 || items.length < 2) {
    return <>{children}</>;
  }

  const basis = `calc((100% - ${(cols - 1) * gap}px) / ${cols})`;

  return (
    <View style={[{ flexDirection: 'row', flexWrap: 'wrap', gap }, style]}>
      {items.map((child, i) => (
        // A calc() basis (rather than a measured pixel width) keeps the columns
        // correct through a live window resize without re-measuring — and it has
        // to subtract the gaps, or `cols` items at 100/cols% plus the gap between
        // them would overflow the row and wrap one card per line.
        <View
          key={child.key ?? i}
          style={{ flexBasis: basis, maxWidth: basis, flexGrow: 1, minWidth: 0 }}
        >
          {child}
        </View>
      ))}
    </View>
  );
}
