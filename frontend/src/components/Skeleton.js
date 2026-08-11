import React, { useContext, useState } from 'react';
import { View } from 'react-native';
import { MotiView } from 'moti';
import { Easing } from 'react-native-reanimated';
import { ThemeContext } from '../context/ThemeContext';

/**
 * ============================================================================
 *  Skeleton loader kit — aesthetic, smooth, flexible, professional.
 * ============================================================================
 *
 * Built purely on `moti` + `reanimated` (NO gradient package → no native
 * rebuild). Two design rules keep it buttery smooth even on big screens:
 *
 *   1. Bars are CHEAP. `<Skeleton plain />` is a static box (zero animation).
 *      Use plain bars everywhere inside lists/cards so mounting a full screen
 *      of them is instant — never per-box animation (that caused jank before).
 *
 *   2. Motion comes from ONE `<ShineSweep />` per card/container. A single soft
 *      diagonal light band auto-measures its parent and sweeps across it, so an
 *      entire card (or a whole table) shimmers as one coherent, premium motion.
 *
 * ---- Primitives -----------------------------------------------------------
 *   <Skeleton width={120} height={16} radius={8} plain />
 *   <SkeletonCircle size={40} plain />
 *   <SkeletonText lines={3} plain />
 *   <ShineSweep />                         // drop inside an overflow:'hidden' box
 *
 * ---- Ready-made presets (self-contained, theme-aware) ---------------------
 *   <SkeletonCard> ...bars... </SkeletonCard>
 *   <SkeletonList count={6} avatar lines={2} trailing />
 *   <SkeletonStatCards count={3} />
 *   <SkeletonProfile />
 *   <SkeletonDetail />
 *
 * Everything adapts to light / dark automatically.
 */

const getTones = (isDark) =>
  isDark
    ? { base: '#242424', highlight: '#333333', shinePeak: 0.12 }
    : { base: '#E4E7EB', highlight: '#EEF1F4', shinePeak: 0.42 };

const PULSE_TRANSITION = {
  type: 'timing',
  duration: 1000,
  loop: true,
  repeatReverse: true,
  easing: Easing.inOut(Easing.ease),
};

const BAND_WIDTH = 130; // width of the moving light band
const SLICES = 10;      // slices → soft, gradient-like light edges

/* -------------------------------------------------------------------------- */
/*  ShineSweep — the single animated node that lights up a whole container.    */
/* -------------------------------------------------------------------------- */

export function ShineSweep({ duration = 1400, peak }) {
  const { theme } = useContext(ThemeContext);
  const p = peak ?? getTones(theme.isDark).shinePeak;
  // Auto-measure the parent so the band sweeps exactly across it — correctly
  // paced for a tiny card or a wide scrollable table alike.
  const [w, setW] = useState(0);

  return (
    <View
      pointerEvents="none"
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, overflow: 'hidden' }}
    >
      {w > 0 && (
        <MotiView
          key={w}
          from={{ translateX: -BAND_WIDTH }}
          animate={{ translateX: w }}
          transition={{ type: 'timing', duration, loop: true, repeatReverse: false, easing: Easing.linear }}
          style={{
            position: 'absolute',
            top: -8,
            bottom: -8,
            width: BAND_WIDTH,
            flexDirection: 'row',
            transform: [{ skewX: '-18deg' }],
          }}
        >
          {Array.from({ length: SLICES }).map((_, i) => {
            const op = Math.sin((i / (SLICES - 1)) * Math.PI) * p;
            return <View key={i} style={{ flex: 1, backgroundColor: `rgba(255,255,255,${op})` }} />;
          })}
        </MotiView>
      )}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/*  Primitives                                                                 */
/* -------------------------------------------------------------------------- */

export function Skeleton({ width = '100%', height = 14, radius = 8, style, plain = false }) {
  const { theme } = useContext(ThemeContext);
  const { base, highlight } = getTones(theme.isDark);

  if (plain) {
    return <View style={[{ width, height, borderRadius: radius, backgroundColor: base }, style]} />;
  }

  return (
    <MotiView
      from={{ backgroundColor: base }}
      animate={{ backgroundColor: highlight }}
      transition={PULSE_TRANSITION}
      style={[{ width, height, borderRadius: radius }, style]}
    />
  );
}

export function SkeletonCircle({ size = 40, style, plain = false }) {
  return <Skeleton plain={plain} width={size} height={size} radius={size / 2} style={style} />;
}

export function SkeletonText({ lines = 3, spacing = 8, lastLineWidth = '60%', lineHeight = 12, style, plain = false }) {
  return (
    <View style={style}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          plain={plain}
          height={lineHeight}
          width={i === lines - 1 ? lastLineWidth : '100%'}
          style={{ marginBottom: i === lines - 1 ? 0 : spacing }}
        />
      ))}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/*  Presets                                                                    */
/* -------------------------------------------------------------------------- */

/** A themed card that clips its content and (by default) carries its own shine. */
export function SkeletonCard({ children, style, padding = 16, radius = 16, sweep = true }) {
  const { theme } = useContext(ThemeContext);
  return (
    <View
      style={[
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderWidth: 1,
          borderRadius: radius,
          padding,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {children}
      {sweep ? <ShineSweep /> : null}
    </View>
  );
}

/** A single list-row layout: optional avatar, a couple of text lines, optional trailing chip. */
export function SkeletonRow({ avatar = true, lines = 2, trailing = false, avatarSize = 44 }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {avatar ? <SkeletonCircle plain size={avatarSize} style={{ marginRight: 12 }} /> : null}
      <View style={{ flex: 1 }}>
        <Skeleton plain width={'55%'} height={13} radius={7} style={{ marginBottom: 9 }} />
        <Skeleton plain width={'82%'} height={11} radius={6} />
        {lines > 2 ? <Skeleton plain width={'40%'} height={11} radius={6} style={{ marginTop: 9 }} /> : null}
      </View>
      {trailing ? <Skeleton plain width={54} height={24} radius={12} style={{ marginLeft: 12 }} /> : null}
    </View>
  );
}

/** A list of card rows. One shared ShineSweep lights the whole list (cheap + coherent). */
export function SkeletonList({ count = 6, avatar = true, lines = 2, trailing = false, gap = 12, style, itemStyle }) {
  return (
    <View style={[{ overflow: 'hidden' }, style]}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} sweep={false} style={[{ marginBottom: gap }, itemStyle]}>
          <SkeletonRow avatar={avatar} lines={lines} trailing={trailing} />
        </SkeletonCard>
      ))}
      <ShineSweep />
    </View>
  );
}

/** A row of stat / summary tiles. One shared ShineSweep across the whole row. */
export function SkeletonStatCards({ count = 3, style }) {
  return (
    <View style={[{ flexDirection: 'row', gap: 12, overflow: 'hidden' }, style]}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} sweep={false} padding={14} style={{ flex: 1 }}>
          <SkeletonCircle plain size={30} style={{ marginBottom: 12 }} />
          <Skeleton plain width={'60%'} height={18} radius={7} style={{ marginBottom: 8 }} />
          <Skeleton plain width={'88%'} height={10} radius={5} />
        </SkeletonCard>
      ))}
      <ShineSweep />
    </View>
  );
}

/** A centered profile header: big avatar, name, subtitle. */
export function SkeletonProfile({ style }) {
  return (
    <SkeletonCard style={[{ alignItems: 'center' }, style]} padding={22}>
      <SkeletonCircle plain size={90} style={{ marginBottom: 16 }} />
      <Skeleton plain width={160} height={18} radius={9} style={{ marginBottom: 10 }} />
      <Skeleton plain width={210} height={12} radius={6} />
    </SkeletonCard>
  );
}

/** A detail screen: hero image block + a title and paragraph lines. */
export function SkeletonDetail({ style }) {
  return (
    <View style={style}>
      <SkeletonCard padding={0} style={{ marginBottom: 16 }}>
        <Skeleton plain width={'100%'} height={190} radius={0} />
      </SkeletonCard>
      <SkeletonCard>
        <Skeleton plain width={'70%'} height={20} radius={9} style={{ marginBottom: 14 }} />
        <SkeletonText plain lines={4} spacing={10} />
      </SkeletonCard>
    </View>
  );
}

/** A create/edit FORM: title, labelled input fields, and a submit button. */
export function SkeletonForm({ fields = 4, style }) {
  return (
    <SkeletonCard style={style}>
      <Skeleton plain width={'50%'} height={20} radius={9} style={{ marginBottom: 18 }} />
      {Array.from({ length: fields }).map((_, i) => (
        <View key={i} style={{ marginBottom: 16 }}>
          <Skeleton plain width={'32%'} height={11} radius={6} style={{ marginBottom: 8 }} />
          <Skeleton plain width={'100%'} height={46} radius={10} />
        </View>
      ))}
      <Skeleton plain width={'100%'} height={50} radius={12} style={{ marginTop: 4 }} />
    </SkeletonCard>
  );
}

/**
 * MONITORING: the live dashboard's shape — a status strip, the hero ring with
 * its legend, then the 2-column grid of tappable count tiles. Mirrors
 * MonitoringDashboard so the loader predicts the layout that follows.
 */
export function SkeletonMonitoring({ tiles = 6, style }) {
  return (
    <View style={[{ overflow: 'hidden' }, style]}>
      <Skeleton plain width={'100%'} height={46} radius={15} style={{ marginBottom: 12 }} />
      <Skeleton plain width={'100%'} height={38} radius={13} style={{ marginBottom: 14 }} />

      <SkeletonCard sweep={false} style={{ marginBottom: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <SkeletonCircle plain size={140} />
          <View style={{ flex: 1, marginLeft: 14 }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} plain width={'85%'} height={11} radius={6} style={{ marginBottom: 10 }} />
            ))}
          </View>
        </View>
        <Skeleton plain width={'100%'} height={10} radius={5} style={{ marginTop: 12 }} />
      </SkeletonCard>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {Array.from({ length: tiles }).map((_, i) => (
          <SkeletonCard key={i} sweep={false} style={{ width: '47%', flexGrow: 1 }}>
            <Skeleton plain width={'60%'} height={10} radius={5} style={{ marginBottom: 10 }} />
            <Skeleton plain width={'40%'} height={22} radius={8} style={{ marginBottom: 8 }} />
            <Skeleton plain width={'70%'} height={9} radius={5} />
          </SkeletonCard>
        ))}
      </View>
      <ShineSweep />
    </View>
  );
}

/** STATS panel: a row of summary tiles above a details card of label/value rows. */
export function SkeletonStatsPanel({ stats = 2, rows = 5, style }) {
  return (
    <View style={style}>
      <SkeletonStatCards count={stats} style={{ marginBottom: 16 }} />
      <SkeletonCard>
        <Skeleton plain width={'55%'} height={18} radius={9} style={{ marginBottom: 16 }} />
        {Array.from({ length: rows }).map((_, i) => (
          <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: i === rows - 1 ? 0 : 14 }}>
            <Skeleton plain width={'35%'} height={12} radius={6} />
            <Skeleton plain width={'40%'} height={12} radius={6} />
          </View>
        ))}
      </SkeletonCard>
    </View>
  );
}

/** CALENDAR: a month grid card (weekday row + day cells) plus a legend row. */
export function SkeletonCalendar({ style }) {
  return (
    <View style={style}>
      <SkeletonCard>
        {/* Month header */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <SkeletonCircle plain size={28} />
          <Skeleton plain width={120} height={16} radius={8} />
          <SkeletonCircle plain size={28} />
        </View>
        {/* Weekday labels */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} plain width={22} height={10} radius={5} />
          ))}
        </View>
        {/* 5 weeks × 7 day cells */}
        {Array.from({ length: 5 }).map((_, r) => (
          <View key={r} style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: r === 4 ? 0 : 12 }}>
            {Array.from({ length: 7 }).map((_, c) => (
              <SkeletonCircle key={c} plain size={30} />
            ))}
          </View>
        ))}
      </SkeletonCard>
      {/* Legend */}
      <View style={{ flexDirection: 'row', gap: 14, marginTop: 16, overflow: 'hidden' }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center' }}>
            <SkeletonCircle plain size={12} style={{ marginRight: 6 }} />
            <Skeleton plain width={48} height={10} radius={5} />
          </View>
        ))}
        <ShineSweep />
      </View>
    </View>
  );
}

/**
 * Dispatcher — renders the skeleton that matches a section's real structure.
 * `kind`: 'form' | 'monitoring' | 'stats' | 'calendar' | 'list' | 'profile' | 'detail'.
 * Wrapped in a padded, flex container so screens can drop it straight in.
 */
export function SectionSkeleton({ kind = 'list', style }) {
  let content;
  switch (kind) {
    case 'form': content = <SkeletonForm />; break;
    case 'monitoring': content = <SkeletonMonitoring />; break;
    case 'stats': content = <SkeletonStatsPanel />; break;
    case 'calendar': content = <SkeletonCalendar />; break;
    case 'profile': content = <SkeletonProfile />; break;
    case 'detail': content = <SkeletonDetail />; break;
    case 'list':
    default: content = <SkeletonList count={5} />; break;
  }
  return <View style={[{ flex: 1, padding: 16 }, style]}>{content}</View>;
}

export default Skeleton;
