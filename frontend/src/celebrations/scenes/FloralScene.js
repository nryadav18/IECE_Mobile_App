/**
 * Floral — petals falling over a slow-turning rangoli.
 *
 * Onam, Ugadi, Ganesh Chaturthi, Women's Day, Mother's Day, Easter, Kerala
 * Piravi, Earth Day. Soft, warm, and the one scene that reads well in a light
 * palette as easily as a dark one.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { Faller, SoftGlow, lanes } from '../particles';
import { randIn, randPick, withAlpha } from '../palette';
import { Body, particlePalette, particleBudget, useLoop } from './shared';

/**
 * A rangoli: concentric rings with petals set around them.
 *
 * One rotating parent, everything inside static — same trick as the chakra.
 * It turns once every 80 seconds, slow enough to register as alive rather
 * than as a spinning wheel.
 */
function Rangoli({ size, colours, driver, paused }) {
  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${driver.value * 360}deg` }],
  }));

  const petals = 12;
  const inner = (
    <>
      {[1, 0.68, 0.4].map((k, ring) => (
        <View
          key={k}
          style={{
            position: 'absolute',
            left: (size - size * k) / 2,
            top: (size - size * k) / 2,
            width: size * k,
            height: size * k,
            borderRadius: (size * k) / 2,
            borderWidth: 1,
            borderColor: withAlpha(colours[ring % colours.length], 0.45),
          }}
        />
      ))}
      {Array.from({ length: petals }, (_, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: size / 2 - 3,
            top: 0,
            width: 6,
            height: size / 2,
            transformOrigin: '50% 100%',
            transform: [{ rotate: `${(360 / petals) * i}deg` }],
          }}
        >
          <View
            style={{
              width: 6,
              height: 12,
              borderRadius: 3,
              backgroundColor: withAlpha(colours[i % colours.length], 0.6),
            }}
          />
        </View>
      ))}
    </>
  );

  if (paused) return <View style={{ width: size, height: size }}>{inner}</View>;
  return <Animated.View style={[{ width: size, height: size }, style]}>{inner}</Animated.View>;
}

export default function FloralScene({ occasion, look, width, height, paused }) {
  const fall = useLoop(9000, paused);
  const turn = useLoop(80000, paused);

  const kind = occasion.particles || 'petals';
  const colours = particlePalette(look);
  const count = particleBudget(width, 0.7);
  const xs = lanes(count, width, 57, 0.9);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, { backgroundColor: look.field }]} />

      <SoftGlow x={width * 0.5} y={height * 0.4} size={width * 0.95} color={look.accent} intensity={0.2} />

      <View style={[styles.rangoliSlot, { top: height * 0.16 }]}>
        <Rangoli
          size={Math.min(width * 0.5, height * 0.5)}
          colours={colours}
          driver={turn}
          paused={paused}
        />
      </View>

      {xs.map((x, i) => {
        const size = randIn(i * 3.3, 11, 19);
        return (
          <Faller
            key={i}
            driver={fall}
            phase={randIn(i * 1.9, 0, 1)}
            x={x}
            fallHeight={height}
            size={size}
            speed={1}
            sway={2}
            swayAmp={randIn(i * 5.5, 8, 22)}
            spin={i % 2 ? 1 : -1}
            paused={paused}
          >
            <Body kind={kind} size={size} color={randPick(i * 4.1, colours)} accent={look.accent} />
          </Faller>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  rangoliSlot: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
});
