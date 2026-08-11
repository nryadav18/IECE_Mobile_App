import React, { memo, useContext, useMemo } from 'react';
import { View, Text } from 'react-native';
import { ThemeContext } from '../../context/ThemeContext';

// ---------------------------------------------------------------------------
// Chart primitives for the Monitoring dashboard, drawn with nothing but Views.
//
// The project rule is no react-native-svg and no expo-linear-gradient, so every
// shape here is composed from plain Views and transforms. That is not a
// compromise: these are static shapes that re-render only when the numbers
// change, so they cost less than a chart library would and they inherit theme
// colours for free.
//
// All of them are memo()'d because the dashboard's snapshot can arrive once a
// second — a component whose numbers did not change must not re-render.
// ---------------------------------------------------------------------------

/**
 * A single horizontal bar split into coloured segments — the headline "where is
 * everyone" strip. Segments with a zero value are dropped rather than rendered
 * at 0 width, which would still cost a View and a border radius.
 */
export const SegmentBar = memo(function SegmentBar({ segments = [], height = 14, style }) {
  const { theme } = useContext(ThemeContext);
  const live = segments.filter((s) => s.value > 0);
  const total = live.reduce((a, s) => a + s.value, 0);

  if (total === 0) {
    return (
      <View style={[{ height, borderRadius: height / 2, backgroundColor: theme.colors.border }, style]} />
    );
  }

  return (
    <View style={[{ height, borderRadius: height / 2, flexDirection: 'row', overflow: 'hidden' }, style]}>
      {live.map((s, i) => (
        <View
          key={s.key || i}
          style={{
            flexGrow: s.value,
            flexBasis: 0,
            backgroundColor: s.color,
            // Hairline separators read as distinct segments without the
            // overdraw of stacking translucent layers on top.
            borderRightWidth: i < live.length - 1 ? 1 : 0,
            borderRightColor: theme.colors.surface,
          }}
        />
      ))}
    </View>
  );
});

/**
 * A multi-segment donut, built from N small rounded bars laid around a circle.
 *
 * Each tick is a full-height strip rotated about the centre with its coloured
 * cap at the top, so the cap lands exactly on the circumference. This is the
 * only approach that gives true multi-colour arcs without SVG, and the small
 * gaps between ticks are deliberate — they make the ring read as a gauge rather
 * than a flat pie.
 */
export const DonutRing = memo(function DonutRing({
  size = 168,
  thickness = 13,
  ticks = 60,
  segments = [],
  centerValue,
  centerLabel,
  centerSub,
  centerColor,
}) {
  const { theme } = useContext(ThemeContext);

  const tickColors = useMemo(() => {
    const total = segments.reduce((a, s) => a + (s.value || 0), 0);
    if (total <= 0) return new Array(ticks).fill(null);

    // Walk the ring once, handing each tick to whichever segment covers it.
    const out = new Array(ticks);
    let cursor = 0;
    let acc = 0;
    for (let i = 0; i < segments.length; i += 1) {
      acc += segments[i].value || 0;
      const upto = Math.round((acc / total) * ticks);
      for (; cursor < upto && cursor < ticks; cursor += 1) out[cursor] = segments[i].color;
    }
    for (; cursor < ticks; cursor += 1) out[cursor] = segments[segments.length - 1]?.color || null;
    return out;
  }, [segments, ticks]);

  // Width that leaves a ~1px gap between neighbouring caps on the outer edge.
  const tickW = Math.max(3, (Math.PI * size) / ticks - 1.5);
  const trackColor = theme.isDark ? '#FFFFFF14' : '#0000000D';

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {tickColors.map((color, i) => (
        <View
          key={i}
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: (size - tickW) / 2,
            top: 0,
            width: tickW,
            height: size,
            transform: [{ rotate: `${(i / ticks) * 360}deg` }],
          }}
        >
          <View
            style={{
              width: tickW,
              height: thickness,
              borderRadius: tickW / 2,
              backgroundColor: color || trackColor,
            }}
          />
        </View>
      ))}

      <View style={{ alignItems: 'center', paddingHorizontal: thickness + 6 }}>
        <Text
          numberOfLines={1}
          style={{ fontSize: 34, fontWeight: '900', color: centerColor || theme.colors.textPrimary, letterSpacing: -1 }}
        >
          {centerValue}
        </Text>
        {!!centerLabel && (
          <Text style={{ fontSize: 11, fontWeight: '800', color: theme.colors.textSecondary, letterSpacing: 0.6, marginTop: 1 }}>
            {centerLabel}
          </Text>
        )}
        {!!centerSub && (
          <Text numberOfLines={1} style={{ fontSize: 10.5, color: theme.colors.textSecondary, marginTop: 3 }}>
            {centerSub}
          </Text>
        )}
      </View>
    </View>
  );
});

/** One labelled horizontal bar — used for the team and school rankings. */
export const BarRow = memo(function BarRow({ label, sub, value, max, color, valueLabel, onPress, right }) {
  const { theme } = useContext(ThemeContext);
  const pct = max > 0 ? Math.max(0.02, value / max) : 0;

  return (
    <View style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 5 }}>
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, fontWeight: '700', color: theme.colors.textPrimary }}>
          {label}
        </Text>
        {!!sub && (
          <Text style={{ fontSize: 11, color: theme.colors.textSecondary, marginRight: 8 }} numberOfLines={1}>
            {sub}
          </Text>
        )}
        <Text style={{ fontSize: 13, fontWeight: '800', color }}>{valueLabel ?? value}</Text>
        {right}
      </View>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: theme.isDark ? '#FFFFFF12' : '#0000000A', overflow: 'hidden' }}>
        <View style={{ width: `${Math.min(100, pct * 100)}%`, height: '100%', borderRadius: 4, backgroundColor: color }} />
      </View>
    </View>
  );
});

/**
 * Vertical bars for the check-in timeline. Hours with no check-ins keep a
 * one-pixel stub so the axis stays readable instead of collapsing to gaps.
 */
export const HourBars = memo(function HourBars({ data = [], color, height = 64, markerHour }) {
  const { theme } = useContext(ThemeContext);
  const max = data.reduce((a, d) => Math.max(a, d.count), 0) || 1;

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height }}>
        {data.map((d) => {
          const isMarker = markerHour != null && d.hour === markerHour;
          return (
            <View key={d.hour} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end' }}>
              <View
                style={{
                  width: '62%',
                  height: Math.max(2, (d.count / max) * height),
                  borderRadius: 3,
                  backgroundColor: d.count === 0
                    ? (theme.isDark ? '#FFFFFF14' : '#0000000D')
                    : isMarker ? theme.colors.primary : color,
                }}
              />
            </View>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', marginTop: 4 }}>
        {data.map((d) => (
          <View key={d.hour} style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ fontSize: 8.5, color: theme.colors.textSecondary }}>
              {d.hour % 3 === 0 ? d.hour : ''}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
});

/** A compact number + caption used inside cards. */
export const MiniStat = memo(function MiniStat({ value, label, color, flex = 1 }) {
  const { theme } = useContext(ThemeContext);
  return (
    <View style={{ flex, alignItems: 'center', paddingVertical: 2 }}>
      <Text style={{ fontSize: 19, fontWeight: '900', color: color || theme.colors.textPrimary }}>{value}</Text>
      <Text numberOfLines={1} style={{ fontSize: 10.5, color: theme.colors.textSecondary, marginTop: 2, textAlign: 'center' }}>
        {label}
      </Text>
    </View>
  );
});
