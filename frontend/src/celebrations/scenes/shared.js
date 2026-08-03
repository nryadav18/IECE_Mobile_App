/**
 * The pieces every scene shares: the loop driver, the particle budget, and the
 * little bodies that fly, fall and rise.
 */

import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  Easing,
  cancelAnimation,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { clamp, withAlpha } from '../../components/home/motion';

/**
 * One linear 0→1 driver, repeating forever.
 *
 * Every animated thing in a scene samples one of these rather than owning a
 * timeline, which is what keeps a whole scene down to two or three actual
 * animations no matter how many particles are on screen.
 *
 * Paused cancels rather than freezes — a frozen `withRepeat` still holds a
 * live animation on the UI thread. This is the convention `KnowledgeNetwork`
 * and `BrandHero` already follow.
 */
export function useLoop(duration, paused) {
  const v = useSharedValue(0);
  useEffect(() => {
    if (paused) {
      cancelAnimation(v);
      v.value = 0;
      return undefined;
    }
    v.value = withRepeat(withTiming(1, { duration, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(v);
  }, [paused, duration, v]);
  return v;
}

/**
 * How many animated leaves a scene may draw.
 *
 * Scaled to the width so a tablet doesn't look sparse and a small phone
 * doesn't get crowded — and hard-capped, because this is the single number
 * that decides whether the header is free or expensive. The admin preview
 * renders at a smaller width and therefore automatically draws fewer.
 */
export function particleBudget(width, share = 1) {
  return Math.round(clamp(width / 26, 7, 16) * share);
}

/* ------------------------------------------------------------------ *
 * Bodies                                                              *
 *                                                                     *
 * Deliberately simple: plain Views and a handful of Ionicons. Nothing *
 * here needs an SVG or an image asset, so scenes cost nothing to load *
 * and tint themselves from the occasion palette.                      *
 * ------------------------------------------------------------------ */
export function Body({ kind, size, color, accent }) {
  switch (kind) {
    case 'planes':
      return <Ionicons name="airplane" size={size} color={color} />;

    case 'birds':
      // A gull silhouette: two thin bars meeting at an angle.
      return (
        <View style={{ width: size, height: size * 0.5 }}>
          <View style={[styles.wing, { width: size * 0.55, backgroundColor: color, left: 0, transform: [{ rotate: '-22deg' }] }]} />
          <View style={[styles.wing, { width: size * 0.55, backgroundColor: color, right: 0, transform: [{ rotate: '22deg' }] }]} />
        </View>
      );

    case 'kites':
      return (
        <View style={{ width: size, height: size * 1.9, alignItems: 'center' }}>
          <View
            style={{
              width: size * 0.72,
              height: size * 0.72,
              backgroundColor: color,
              transform: [{ rotate: '45deg' }],
              borderRadius: 2,
            }}
          />
          {/* Tail: three shrinking ticks. Static — the kite's own drift sells it. */}
          {[0, 1, 2].map((i) => (
            <View
              key={i}
              style={{
                width: size * (0.3 - i * 0.07),
                height: 2.5,
                marginTop: size * 0.16,
                borderRadius: 2,
                backgroundColor: withAlpha(accent || color, 0.75 - i * 0.2),
                transform: [{ translateX: (i % 2 ? 1 : -1) * size * 0.16 }],
              }}
            />
          ))}
        </View>
      );

    case 'balloons':
      return (
        <View style={{ width: size * 0.78, alignItems: 'center' }}>
          <View
            style={{
              width: size * 0.78,
              height: size,
              borderRadius: size * 0.39,
              backgroundColor: color,
            }}
          />
          <View style={{ width: 1.5, height: size * 0.55, backgroundColor: withAlpha(color, 0.5) }} />
        </View>
      );

    case 'clouds':
      // Three overlapping discs — the stacked-shape trick the home screen
      // already uses instead of reaching for a gradient or an SVG.
      return (
        <View style={{ width: size * 1.9, height: size }}>
          <View style={[styles.puff, { width: size, height: size, borderRadius: size / 2, backgroundColor: color, left: 0, bottom: 0 }]} />
          <View style={[styles.puff, { width: size * 1.15, height: size * 1.15, borderRadius: size * 0.58, backgroundColor: color, left: size * 0.45, bottom: 0 }]} />
          <View style={[styles.puff, { width: size * 0.85, height: size * 0.85, borderRadius: size * 0.43, backgroundColor: color, right: 0, bottom: 0 }]} />
        </View>
      );

    case 'petals':
      return (
        <View
          style={{
            width: size,
            height: size * 0.62,
            backgroundColor: color,
            borderTopLeftRadius: size,
            borderBottomRightRadius: size,
            borderTopRightRadius: size * 0.2,
            borderBottomLeftRadius: size * 0.2,
          }}
        />
      );

    case 'leaves':
      return <Ionicons name="leaf" size={size} color={color} />;

    case 'confetti':
      return (
        <View style={{ width: size * 0.42, height: size, backgroundColor: color, borderRadius: 1.5 }} />
      );

    case 'colour':
      // A puff of Holi powder: a soft disc, no hard edge.
      return (
        <View style={{ width: size, height: size }}>
          <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, borderRadius: size / 2, backgroundColor: withAlpha(color, 0.5) }} />
          <View
            style={{
              position: 'absolute',
              left: size * 0.2, top: size * 0.2,
              width: size * 0.6, height: size * 0.6,
              borderRadius: size * 0.3,
              backgroundColor: withAlpha(color, 0.85),
            }}
          />
        </View>
      );

    case 'diyas':
      return <Ionicons name="flame" size={size} color={color} />;

    case 'lanterns':
      return (
        <View style={{ width: size * 0.7, alignItems: 'center' }}>
          <View style={{ width: size * 0.34, height: 2, backgroundColor: withAlpha(color, 0.6), borderRadius: 1 }} />
          <View
            style={{
              width: size * 0.7,
              height: size * 0.92,
              borderRadius: size * 0.24,
              backgroundColor: color,
            }}
          />
        </View>
      );

    case 'embers':
    default:
      return (
        <View style={{ width: size * 0.4, height: size * 0.4, borderRadius: size * 0.2, backgroundColor: color }} />
      );
  }
}

/**
 * Which palette colour a given particle takes.
 *
 * Skips the darkest entry — that is almost always the backdrop colour, and a
 * particle painted in it is an invisible particle that still costs a frame.
 */
export function particlePalette(look) {
  const usable = look.palette.filter((c) => c !== look.field);
  return usable.length ? usable : look.palette;
}

const styles = StyleSheet.create({
  wing: { position: 'absolute', top: 0, height: 2, borderRadius: 2 },
  puff: { position: 'absolute' },
});
