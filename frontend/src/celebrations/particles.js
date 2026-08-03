/**
 * The motion leaves every celebration scene is built from.
 *
 * Five shapes — things that cross, fall, rise, twinkle and burst — plus two
 * static helpers. Scenes compose these; scenes never write their own worklets.
 * Keeping the whole system's animation in one file is what makes the
 * performance budget enforceable rather than aspirational.
 *
 * Four rules every primitive here holds to:
 *
 *   1. **One `useAnimatedStyle` per instance, never shared.** Reanimated
 *      supports a style driving a single component; reusing one object across
 *      siblings is a bug the hero already had once (`BrandHero.js:109-123`).
 *
 *   2. **No animated `opacity` on anything with children.** Fading a view that
 *      has children forces an offscreen buffer every frame. Travelling
 *      particles therefore enter and exit *outside* the scene's clip box
 *      instead of fading — which costs nothing and looks better anyway. The one
 *      primitive that does animate opacity, `Burst`, is a childless ring.
 *
 *   3. **Integer frequencies only.** Every primitive samples a single linear
 *      0→1 driver that repeats forever. `(driver * speed + phase) % 1` is
 *      continuous across the driver's wrap *only* when `speed` is a whole
 *      number — otherwise every particle visibly jumps once per cycle. Same for
 *      `sin(driver * 2π * k)` and for rotation turns. This is the same
 *      phase-continuity contract the hero holds to.
 *
 *   4. **Paused means gone, not frozen.** When `paused`, primitives render a
 *      plain static `View` at their phase position — no worklet stays live, and
 *      the still composition is still scattered and legible. This is the
 *      convention `KnowledgeNetwork` established.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { interpolate, useAnimatedStyle } from 'react-native-reanimated';
import { rand, withAlpha } from './palette';

/* ------------------------------------------------------------------ *
 * Crossing — planes, kites, clouds, birds.                            *
 * Enters fully off one edge and leaves fully off the other, bobbing   *
 * as it goes.                                                         *
 * ------------------------------------------------------------------ */
export function Drifter({
  driver,
  phase = 0,
  laneY,
  travel,
  size = 24,
  speed = 1, // MUST be a whole number — see rule 3
  direction = 1, // 1 → left-to-right, -1 → right-to-left
  bob = 2, // whole-number bob frequency
  bobAmp = 6,
  tilt = 0,
  paused,
  style,
  children,
}) {
  // The lane runs from one full body-width off the left edge to one off the
  // right, so a particle is never partly visible at the moment its cycle wraps.
  const animated = useAnimatedStyle(() => {
    const t = (driver.value * speed + phase) % 1;
    const p = direction > 0 ? t : 1 - t;
    return {
      transform: [
        { translateX: -size + p * travel },
        { translateY: Math.sin((driver.value * bob + phase) * Math.PI * 2) * bobAmp },
        { rotate: `${tilt}deg` },
      ],
    };
  });

  if (paused) {
    const t = phase % 1;
    const p = direction > 0 ? t : 1 - t;
    return (
      <View
        pointerEvents="none"
        style={[
          styles.leaf,
          { top: laneY, left: 0, transform: [{ translateX: -size + p * travel }, { rotate: `${tilt}deg` }] },
          style,
        ]}
      >
        {children}
      </View>
    );
  }

  return (
    <Animated.View pointerEvents="none" style={[styles.leaf, { top: laneY, left: 0 }, style, animated]}>
      {children}
    </Animated.View>
  );
}

/* ------------------------------------------------------------------ *
 * Falling — petals, confetti, snow.                                   *
 * Top to bottom, swaying sideways and spinning.                       *
 * ------------------------------------------------------------------ */
export function Faller({
  driver,
  phase = 0,
  x,
  fallHeight,
  size = 10,
  speed = 1,
  sway = 2,
  swayAmp = 14,
  spin = 1, // whole turns per driver cycle
  paused,
  style,
  children,
}) {
  const animated = useAnimatedStyle(() => {
    const t = (driver.value * speed + phase) % 1;
    return {
      transform: [
        { translateX: Math.sin((driver.value * sway + phase) * Math.PI * 2) * swayAmp },
        { translateY: -size + t * (fallHeight + size * 2) },
        { rotate: `${(driver.value * spin + phase) * 360}deg` },
      ],
    };
  });

  if (paused) {
    return (
      <View
        pointerEvents="none"
        style={[
          styles.leaf,
          { left: x, top: -size + (phase % 1) * (fallHeight + size * 2) },
          style,
        ]}
      >
        {children}
      </View>
    );
  }

  return (
    <Animated.View pointerEvents="none" style={[styles.leaf, { left: x, top: 0 }, style, animated]}>
      {children}
    </Animated.View>
  );
}

/* ------------------------------------------------------------------ *
 * Rising — diyas, lanterns, balloons, embers.                         *
 * Bottom to top, drifting.                                            *
 * ------------------------------------------------------------------ */
export function Riser({
  driver,
  phase = 0,
  x,
  riseHeight,
  size = 12,
  speed = 1,
  drift = 1,
  driftAmp = 10,
  paused,
  style,
  children,
}) {
  const animated = useAnimatedStyle(() => {
    const t = (driver.value * speed + phase) % 1;
    return {
      transform: [
        { translateX: Math.sin((driver.value * drift + phase) * Math.PI * 2) * driftAmp },
        { translateY: riseHeight + size - t * (riseHeight + size * 2) },
        // Lanterns shrink very slightly as they climb — cheap aerial
        // perspective, and it stops the top of the scene feeling crowded.
        { scale: interpolate(t, [0, 1], [1, 0.72]) },
      ],
    };
  });

  if (paused) {
    return (
      <View
        pointerEvents="none"
        style={[styles.leaf, { left: x, top: riseHeight + size - (phase % 1) * (riseHeight + size * 2) }, style]}
      >
        {children}
      </View>
    );
  }

  return (
    <Animated.View pointerEvents="none" style={[styles.leaf, { left: x, top: 0 }, style, animated]}>
      {children}
    </Animated.View>
  );
}

/* ------------------------------------------------------------------ *
 * Twinkle — a fixed point of light that breathes.                     *
 * Scale, not opacity, so this stays valid even wrapping a glyph.      *
 * ------------------------------------------------------------------ */
export function Twinkle({ driver, phase = 0, x, y, size, color, freq = 3, paused, style }) {
  const animated = useAnimatedStyle(() => {
    const s = Math.sin((driver.value * freq + phase) * Math.PI * 2);
    return { transform: [{ scale: 0.55 + (s + 1) * 0.32 }] };
  });

  const base = [
    styles.leaf,
    { left: x, top: y, width: size, height: size, borderRadius: size / 2, backgroundColor: color },
    style,
  ];

  if (paused) return <View pointerEvents="none" style={base} />;
  return <Animated.View pointerEvents="none" style={[...base, animated]} />;
}

/* ------------------------------------------------------------------ *
 * Burst — an expanding ring. Fireworks, and the beat under a flag.    *
 * The one primitive that animates opacity, and it has no children.    *
 * ------------------------------------------------------------------ */
export function Burst({ driver, phase = 0, x, y, size, color, speed = 1, thickness = 2, paused }) {
  const animated = useAnimatedStyle(() => {
    const t = (driver.value * speed + phase) % 1;
    return {
      opacity: interpolate(t, [0, 0.08, 1], [0, 0.7, 0]),
      transform: [{ scale: interpolate(t, [0, 1], [0.2, 1]) }],
    };
  });

  if (paused) {
    return (
      <View
        pointerEvents="none"
        style={[
          styles.leaf,
          {
            left: x - size / 2,
            top: y - size / 2,
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: thickness,
            borderColor: color,
            opacity: 0.35,
          },
        ]}
      />
    );
  }

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.leaf,
        {
          left: x - size / 2,
          top: y - size / 2,
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: thickness,
          borderColor: color,
        },
        animated,
      ]}
    />
  );
}

/* ------------------------------------------------------------------ *
 * Static helpers                                                      *
 * ------------------------------------------------------------------ */

/**
 * A soft radial glow, faked with stacked translucent circles.
 *
 * The app deliberately carries no gradient or SVG dependency, and this is how
 * the rest of the home screen already gets soft edges. Three rings is the
 * sweet spot: fewer reads as a hard disc, more is pure overdraw.
 */
export function SoftGlow({ x, y, size, color, intensity = 0.3, rings = 3 }) {
  return (
    <View pointerEvents="none" style={[styles.leaf, { left: x - size / 2, top: y - size / 2 }]}>
      {Array.from({ length: rings }, (_, i) => {
        const k = (i + 1) / rings;
        const d = size * k;
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: (size - d) / 2,
              top: (size - d) / 2,
              width: d,
              height: d,
              borderRadius: d / 2,
              backgroundColor: withAlpha(color, intensity * (1 - k * 0.62)),
            }}
          />
        );
      })}
    </View>
  );
}

/**
 * A soft-edged horizontal band — a flat fill with two feathered lips built the
 * same stacked-translucency way, so tricolour bands meet without a hard seam.
 */
export function Band({ top, height, color, feather = 10, style }) {
  return (
    <View
      pointerEvents="none"
      style={[{ position: 'absolute', left: 0, right: 0, top, height, backgroundColor: color }, style]}
    >
      <View
        style={{
          position: 'absolute', left: 0, right: 0, top: -feather, height: feather,
          backgroundColor: withAlpha(color, 0.45),
        }}
      />
      <View
        style={{
          position: 'absolute', left: 0, right: 0, bottom: -feather, height: feather,
          backgroundColor: withAlpha(color, 0.45),
        }}
      />
    </View>
  );
}

/**
 * Scatter `count` items across a width, jittered but deterministically so.
 *
 * Evenly spaced particles read as a grid; purely random ones clump and leave
 * holes. Slot-plus-jitter gives coverage *and* irregularity, and because the
 * jitter comes from `rand(seed)` the same date always draws the same picture —
 * which matters a lot when an admin is previewing.
 */
export function lanes(count, span, seedBase = 0, jitter = 0.7) {
  const slot = span / count;
  return Array.from({ length: count }, (_, i) => {
    const j = (rand(seedBase + i * 3.7) - 0.5) * slot * jitter;
    return slot * (i + 0.5) + j;
  });
}

const styles = StyleSheet.create({
  leaf: { position: 'absolute' },
});
