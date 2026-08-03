/**
 * Emblem — a single mark with light radiating from it.
 *
 * For the days that are about a person or an idea rather than a spectacle:
 * Gandhi Jayanti, Ambedkar Jayanti, Kalam's birthday, Teachers' Day, Yoga Day,
 * Constitution Day. Quiet on purpose — a portrait day with confetti on it
 * would read as tone-deaf.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { SoftGlow, Twinkle, lanes } from '../particles';
import { randIn, withAlpha } from '../palette';
import { particleBudget, useLoop } from './shared';

/** A fan of tapering rays in one slowly-turning parent. */
function Rays({ size, color, driver, paused, count = 16 }) {
  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${driver.value * 360}deg` }],
  }));

  const inner = Array.from({ length: count }, (_, i) => (
    <View
      key={i}
      style={{
        position: 'absolute',
        left: size / 2 - 1.25,
        top: 0,
        width: 2.5,
        height: size / 2,
        transformOrigin: '50% 100%',
        transform: [{ rotate: `${(360 / count) * i}deg` }],
      }}
    >
      <View
        style={{
          width: 2.5,
          // Alternating lengths give the fan a rhythm without a second colour.
          height: size * (i % 2 ? 0.16 : 0.24),
          borderRadius: 2,
          backgroundColor: withAlpha(color, i % 2 ? 0.28 : 0.5),
        }}
      />
    </View>
  ));

  if (paused) return <View style={{ width: size, height: size }}>{inner}</View>;
  return <Animated.View style={[{ width: size, height: size }, style]}>{inner}</Animated.View>;
}

export default function EmblemScene({ occasion, look, width, height, paused }) {
  const turn = useLoop(60000, paused);
  const breathe = useLoop(5200, paused);

  const markSize = Math.min(width * 0.34, height * 0.36);
  const rays = markSize * 2.1;

  const sparkCount = particleBudget(width, 0.35);
  const xs = lanes(sparkCount, width, 131, 1);

  // The mark itself breathes — scale only, so the icon inside is never
  // composited into an offscreen buffer.
  const markStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + Math.sin(breathe.value * Math.PI * 2) * 0.035 }],
  }));

  const centreY = height * 0.34;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, { backgroundColor: look.field }]} />
      <SoftGlow x={width * 0.5} y={centreY} size={width * 0.9} color={look.accent} intensity={0.24} />

      {xs.map((x, i) => (
        <Twinkle
          key={i}
          driver={breathe}
          phase={randIn(i * 3.3, 0, 1)}
          x={x}
          y={randIn(i * 5.9, height * 0.08, height * 0.62)}
          size={randIn(i * 7.1, 2, 4)}
          color={withAlpha(look.accent, 0.7)}
          freq={2}
          paused={paused}
        />
      ))}

      <View style={[styles.centre, { top: centreY - rays / 2, height: rays }]}>
        <Rays size={rays} color={look.accent} driver={turn} paused={paused} />

        <View style={[styles.markSlot, { width: rays, height: rays }]}>
          <Animated.View style={paused ? undefined : markStyle}>
            <View
              style={{
                width: markSize,
                height: markSize,
                borderRadius: markSize / 2,
                borderWidth: 1,
                borderColor: withAlpha(look.ink, 0.28),
                backgroundColor: withAlpha(look.accent, 0.14),
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons
                name={occasion.emblem || 'sparkles-outline'}
                size={markSize * 0.5}
                color={look.ink}
              />
            </View>
          </Animated.View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  centre: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  markSlot: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
});
