/**
 * Confetti — falling ribbon over a dark field, with bursts behind it.
 *
 * New Year, Holi (where the "confetti" is powder), Friendship Day, Sports Day
 * and every admin-authored custom occasion, which defaults here because it
 * reads as "celebration" without claiming to be any particular one.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Burst, Faller, SoftGlow, lanes } from '../particles';
import { randIn, randPick, withAlpha } from '../palette';
import { Body, particlePalette, particleBudget, useLoop } from './shared';

export default function ConfettiScene({ occasion, look, width, height, paused }) {
  const fall = useLoop(7600, paused);
  const pop = useLoop(5200, paused);

  const kind = occasion.particles || 'confetti';
  const colours = particlePalette(look);
  const count = particleBudget(width, 0.85);
  const xs = lanes(count, width, 97, 0.95);

  // Three bursts on offset phases — enough to feel continuous, few enough
  // that the only opacity animation in the scene stays cheap.
  const bursts = [0, 0.34, 0.67];

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, { backgroundColor: look.field }]} />
      <SoftGlow x={width * 0.5} y={height * 0.45} size={width} color={look.accent} intensity={0.18} />

      {bursts.map((phase, i) => (
        <Burst
          key={`b${i}`}
          driver={pop}
          phase={phase}
          x={width * (0.24 + i * 0.26)}
          y={height * (0.26 + (i % 2) * 0.16)}
          size={Math.min(width, height) * 0.62}
          color={withAlpha(colours[i % colours.length], 0.8)}
          speed={1}
          paused={paused}
        />
      ))}

      {xs.map((x, i) => {
        const size = randIn(i * 2.7, 9, 17);
        return (
          <Faller
            key={i}
            driver={fall}
            phase={randIn(i * 1.3, 0, 1)}
            x={x}
            fallHeight={height}
            size={size}
            speed={1}
            sway={3}
            swayAmp={randIn(i * 6.9, 6, 18)}
            spin={i % 3 === 0 ? 2 : i % 2 ? 1 : -1}
            paused={paused}
          >
            <Body kind={kind} size={size} color={randPick(i * 3.7, colours)} accent={look.accent} />
          </Faller>
        );
      })}
    </View>
  );
}
