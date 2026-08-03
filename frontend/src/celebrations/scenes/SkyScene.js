/**
 * Sky — an open sky with kites, balloons and drifting cloud.
 *
 * Sankranti and Pongal (kites), Children's Day (balloons). The one scene with
 * a horizon: a light band top, the field below, and a soft sun.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Band, Drifter, Riser, SoftGlow, lanes } from '../particles';
import { lighten, randIn, randPick, withAlpha } from '../palette';
import { Body, particlePalette, particleBudget, useLoop } from './shared';

export default function SkyScene({ occasion, look, width, height, paused }) {
  const cross = useLoop(17000, paused);
  const rise = useLoop(13000, paused);
  const drift = useLoop(38000, paused);

  const kind = occasion.particles || 'kites';
  const colours = particlePalette(look);

  // Kites cross; balloons rise. Both read as "up", which is the point.
  const rising = kind === 'balloons';
  const count = particleBudget(width, 0.45);
  const slots = lanes(count, rising ? width : height * 0.55, 73, 0.85);
  const cloudCount = Math.max(2, Math.round(width / 190));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, { backgroundColor: look.field }]} />
      {/* A lighter lid on the sky, so the frame has a horizon rather than a
          flat wash. */}
      <Band top={0} height={height * 0.55} color={lighten(look.field, 0.22)} feather={16} />

      <SoftGlow x={width * 0.78} y={height * 0.22} size={width * 0.5} color={look.accent} intensity={0.34} />

      {/* Cloud, moving slowest — the parallax floor of the scene. */}
      {Array.from({ length: cloudCount }, (_, i) => {
        const size = randIn(i * 11.3, 22, 34);
        return (
          <Drifter
            key={`c${i}`}
            driver={drift}
            phase={randIn(i * 6.7, 0, 1)}
            laneY={randIn(i * 13.1, height * 0.08, height * 0.42)}
            travel={width + size * 4}
            size={size * 2}
            speed={1}
            direction={1}
            bob={1}
            bobAmp={2}
            paused={paused}
          >
            <Body kind="clouds" size={size} color={withAlpha('#FFFFFF', 0.28)} />
          </Drifter>
        );
      })}

      {slots.map((slot, i) => {
        const size = randIn(i * 3.1, 18, 30);
        if (rising) {
          return (
            <Riser
              key={i}
              driver={rise}
              phase={randIn(i * 2.1, 0, 1)}
              x={slot}
              riseHeight={height}
              size={size * 1.6}
              speed={1}
              drift={2}
              driftAmp={randIn(i * 8.9, 6, 18)}
              paused={paused}
            >
              <Body kind="balloons" size={size} color={randPick(i * 5.3, colours)} />
            </Riser>
          );
        }
        const dir = i % 3 === 0 ? -1 : 1;
        return (
          <Drifter
            key={i}
            driver={cross}
            phase={randIn(i * 2.1, 0, 1)}
            laneY={slot + height * 0.06}
            travel={width + size * 2}
            size={size}
            speed={1}
            direction={dir}
            bob={3}
            bobAmp={randIn(i * 7.3, 6, 16)}
            paused={paused}
          >
            <Body kind={kind} size={size} color={randPick(i * 5.3, colours)} accent={look.accent} />
          </Drifter>
        );
      })}
    </View>
  );
}
