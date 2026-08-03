/**
 * Flag — horizontal colour bands with something crossing the sky above them.
 *
 * The workhorse behind Independence Day, Republic Day and every state
 * formation day. The bands are static Views (a flag is a flag; animating the
 * fill would just be overdraw), and all the life comes from what flies across
 * them and from an optional slow-turning chakra.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { Band, Drifter, SoftGlow, lanes } from '../particles';
import { randIn, withAlpha } from '../palette';
import { Body, particleBudget, useLoop } from './shared';

/**
 * The Ashoka Chakra, built from 24 spokes.
 *
 * 24 plain Views inside one rotating parent: the parent is the only thing
 * animated, so the spoke count costs layout once and nothing per frame.
 */
export function Chakra({ size, color, driver, paused, spokes = 24 }) {
  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${driver.value * 360}deg` }],
  }));

  const ring = (
    <>
      <View
        style={{
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: Math.max(1.5, size * 0.035),
          borderColor: color,
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: size / 2 - size * 0.07,
          top: size / 2 - size * 0.07,
          width: size * 0.14,
          height: size * 0.14,
          borderRadius: size * 0.07,
          backgroundColor: color,
        }}
      />
      {Array.from({ length: spokes }, (_, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: size / 2 - 0.75,
            top: size * 0.06,
            width: 1.5,
            height: size * 0.44,
            backgroundColor: color,
            // Bottom-centre of the spoke sits exactly on the hub, so rotating
            // about it fans the spokes out of the centre.
            transformOrigin: '50% 100%',
            transform: [{ rotate: `${(360 / spokes) * i}deg` }],
          }}
        />
      ))}
    </>
  );

  if (paused) {
    return <View style={{ width: size, height: size }}>{ring}</View>;
  }
  return <Animated.View style={[{ width: size, height: size }, style]}>{ring}</Animated.View>;
}

export default function FlagScene({ occasion, look, width, height, paused, chakra = false }) {
  // One driver for everything that crosses, one much slower for the chakra.
  const cross = useLoop(14000, paused);
  const spin = useLoop(46000, paused);

  const bands = look.palette;
  const bandH = height / bands.length;
  const flyer = occasion.particles || 'birds';

  // Flyers get the upper third of the frame — clear of the wish text, which
  // sits in the lower half.
  const count = particleBudget(width, flyer === 'planes' ? 0.32 : 0.5);
  const laneYs = lanes(count, height * 0.42, 11, 0.9);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {bands.map((color, i) => (
        <Band key={color + i} top={i * bandH} height={bandH + 1} color={color} feather={0} />
      ))}

      {/* A soft bloom behind the middle band lifts the composition off flat
          colour without a gradient. */}
      <SoftGlow
        x={width * 0.5}
        y={height * 0.42}
        size={Math.min(width, height) * 1.1}
        color={look.accent}
        intensity={0.16}
      />

      {chakra && (
        <View style={[styles.chakraSlot, { top: height * 0.3 }]}>
          <Chakra
            size={Math.min(width * 0.3, height * 0.34)}
            color={withAlpha(look.accent, 0.55)}
            driver={spin}
            paused={paused}
          />
        </View>
      )}

      {laneYs.map((y, i) => {
        const size = randIn(i * 5.1, 13, 22);
        const dir = i % 3 === 0 ? -1 : 1;
        return (
          <Drifter
            key={i}
            driver={cross}
            phase={randIn(i * 2.3, 0, 1)}
            laneY={y + height * 0.05}
            travel={width + size * 2}
            size={size}
            speed={1}
            direction={dir}
            bob={2}
            bobAmp={randIn(i * 7.7, 3, 9)}
            tilt={dir > 0 ? 0 : 180}
            paused={paused}
          >
            <Body kind={flyer} size={size} color={withAlpha(look.ink, 0.72)} accent={look.accent} />
          </Drifter>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  chakraSlot: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
});
