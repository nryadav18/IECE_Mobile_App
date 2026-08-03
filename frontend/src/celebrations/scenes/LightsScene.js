/**
 * Lights — a dark field with things rising through it and glowing.
 *
 * Diwali, Eid, Karthika Deepam, Janmashtami, Dussehra, Gurpurab. The look is
 * warm points of light climbing a night sky; the occasion's palette decides
 * whether that reads as diyas, lanterns or embers.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Riser, SoftGlow, Twinkle, lanes } from '../particles';
import { randIn, randPick, withAlpha } from '../palette';
import { Body, particlePalette, particleBudget, useLoop } from './shared';

export default function LightsScene({ occasion, look, width, height, paused, glowRow = false }) {
  const rise = useLoop(11000, paused);
  const shimmer = useLoop(4200, paused);

  const kind = occasion.particles || 'lanterns';
  const colours = particlePalette(look);

  const risingCount = particleBudget(width, 0.55);
  const twinkleCount = particleBudget(width, 0.4);
  const riseLanes = lanes(risingCount, width, 23, 0.85);
  const twinkleLanes = lanes(twinkleCount, width, 41, 1);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, { backgroundColor: look.field }]} />

      {/* Two warm blooms — one low, one off-centre — so the field has depth
          before anything moves. Stacked circles, no gradient. */}
      <SoftGlow x={width * 0.5} y={height * 0.92} size={width * 1.25} color={look.accent} intensity={0.3} />
      <SoftGlow x={width * 0.2} y={height * 0.3} size={width * 0.6} color={colours[0]} intensity={0.16} />

      {/* Distant stars. Scale-pulsed, never opacity-faded. */}
      {twinkleLanes.map((x, i) => (
        <Twinkle
          key={`t${i}`}
          driver={shimmer}
          phase={randIn(i * 3.9, 0, 1)}
          x={x}
          y={randIn(i * 6.1, height * 0.06, height * 0.5)}
          size={randIn(i * 8.3, 2, 4)}
          color={withAlpha(look.accent, 0.85)}
          freq={3}
          paused={paused}
        />
      ))}

      {/* The climb. */}
      {riseLanes.map((x, i) => {
        const size = randIn(i * 4.7, 14, 24);
        return (
          <Riser
            key={`r${i}`}
            driver={rise}
            phase={randIn(i * 1.7, 0, 1)}
            x={x}
            riseHeight={height}
            size={size}
            speed={1}
            drift={2}
            driftAmp={randIn(i * 9.1, 5, 16)}
            paused={paused}
          >
            <Body kind={kind} size={size} color={randPick(i * 2.9, colours)} accent={look.accent} />
          </Riser>
        );
      })}

      {/* A row of diyas along the base — the ground the lights leave from.
          Static; the glow above does the moving. */}
      {glowRow && (
        <View style={[styles.row, { bottom: height * 0.06 }]}>
          {Array.from({ length: Math.max(4, Math.round(width / 64)) }, (_, i) => (
            <View key={i} style={styles.diya}>
              <View
                style={{
                  width: 20, height: 9,
                  borderBottomLeftRadius: 10, borderBottomRightRadius: 10,
                  backgroundColor: withAlpha(look.accent, 0.5),
                }}
              />
              <View
                style={{
                  position: 'absolute', top: -7, left: 7,
                  width: 6, height: 10, borderRadius: 3,
                  backgroundColor: look.accent,
                }}
              />
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'flex-end',
  },
  diya: { alignItems: 'center' },
});
