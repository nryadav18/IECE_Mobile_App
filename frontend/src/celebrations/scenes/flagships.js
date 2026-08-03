/**
 * The four hand-built scenes.
 *
 * Each one composes an engine and then adds the detail that makes that
 * particular day itself — the flypast for Independence Day, the chakra and the
 * parade for Republic Day, the diya row and fireworks for Diwali, the logo and
 * the year count for IECE's own anniversary.
 *
 * They stay thin on purpose. Everything expensive (the particle budget, the
 * loop drivers, the pause contract) lives in the engine they wrap, so a
 * flagship can never quietly cost more than a regular scene.
 */

import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import FlagScene, { Chakra } from './FlagScene';
import LightsScene from './LightsScene';
import { Burst, Drifter, Faller, SoftGlow, Twinkle, lanes } from '../particles';
import { randIn, randPick, withAlpha } from '../palette';
import { particleBudget, useLoop } from './shared';
import { TRICOLOUR } from '../occasions';
import { yearsSinceFounding } from '../../utils/org';

/* ------------------------------------------------------------------ *
 * Independence Day — the flypast                                      *
 * ------------------------------------------------------------------ */

/** A jet trailing tricolour smoke. The trail is static; the jet carries it. */
function Jet({ size }) {
  return (
    <View style={styles.jet}>
      {/* Smoke first, so it sits behind the aircraft. */}
      <View style={styles.trail}>
        {TRICOLOUR.map((c, i) => (
          <View
            key={c}
            style={{
              width: size * (5.5 - i * 0.9),
              height: size * 0.13,
              marginVertical: size * 0.045,
              borderRadius: size * 0.1,
              backgroundColor: withAlpha(c, 0.5),
            }}
          />
        ))}
      </View>
      <View
        style={{
          width: 0, height: 0,
          borderTopWidth: size * 0.3,
          borderBottomWidth: size * 0.3,
          borderLeftWidth: size * 0.85,
          borderTopColor: 'transparent',
          borderBottomColor: 'transparent',
          borderLeftColor: '#FFFFFF',
        }}
      />
    </View>
  );
}

export function IndependenceScene({ occasion, look, width, height, paused }) {
  const fly = useLoop(15000, paused);

  // Three jets in loose formation. Deliberately few — a flypast is a formation,
  // not a swarm, and each one carries four sub-views.
  const jets = [
    { lane: 0.1, size: 20, phase: 0.0 },
    { lane: 0.17, size: 16, phase: 0.06 },
    { lane: 0.04, size: 15, phase: 0.09 },
  ];

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <FlagScene
        occasion={{ ...occasion, particles: 'birds' }}
        look={look}
        width={width}
        height={height}
        paused={paused}
        chakra
      />

      {jets.map((j, i) => (
        <Drifter
          key={i}
          driver={fly}
          phase={j.phase}
          laneY={height * j.lane}
          travel={width + j.size * 8}
          size={j.size * 6}
          speed={1}
          direction={1}
          bob={2}
          bobAmp={3}
          paused={paused}
        >
          <Jet size={j.size} />
        </Drifter>
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * Republic Day — the chakra and the parade                            *
 * ------------------------------------------------------------------ */
export function RepublicScene({ occasion, look, width, height, paused }) {
  const spin = useLoop(52000, paused);
  const shimmer = useLoop(4600, paused);

  const chakraSize = Math.min(width * 0.42, height * 0.44);
  const flagCount = Math.max(5, Math.round(width / 56));
  const sparks = particleBudget(width, 0.3);
  const xs = lanes(sparks, width, 211, 1);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, { backgroundColor: look.field }]} />
      <SoftGlow x={width * 0.5} y={height * 0.34} size={width} color="#FFFFFF" intensity={0.12} />

      {xs.map((x, i) => (
        <Twinkle
          key={i}
          driver={shimmer}
          phase={randIn(i * 4.4, 0, 1)}
          x={x}
          y={randIn(i * 6.6, height * 0.06, height * 0.55)}
          size={randIn(i * 8.8, 2, 3.5)}
          color={withAlpha('#FFFFFF', 0.7)}
          freq={2}
          paused={paused}
        />
      ))}

      {/* The chakra carries this scene — full navy blue, large, centred. */}
      <View style={[styles.centre, { top: height * 0.13 }]}>
        <Chakra size={chakraSize} color="#FFFFFF" driver={spin} paused={paused} />
      </View>

      {/* A row of hand flags along the base — the parade. Static; the row's
          job is to frame the wish, not to compete with the chakra. */}
      <View style={[styles.parade, { bottom: 0, height: height * 0.16 }]}>
        {Array.from({ length: flagCount }, (_, i) => (
          <View key={i} style={styles.flagStick}>
            <View style={styles.flagBody}>
              {TRICOLOUR.map((c) => (
                <View key={c} style={{ height: 4, backgroundColor: c }} />
              ))}
            </View>
            <View style={[styles.pole, { backgroundColor: withAlpha('#FFFFFF', 0.4) }]} />
          </View>
        ))}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * Diwali — the diya row and the fireworks                             *
 * ------------------------------------------------------------------ */
export function DiwaliScene({ occasion, look, width, height, paused }) {
  const pop = useLoop(6400, paused);

  // Fireworks: three rings on offset phases, high in the frame so they read as
  // sky rather than as haloes around the wish.
  const shells = [
    { x: 0.2, y: 0.2, phase: 0.0, color: look.palette[0] },
    { x: 0.78, y: 0.15, phase: 0.38, color: look.palette[1] || look.accent },
    { x: 0.52, y: 0.3, phase: 0.7, color: look.accent },
  ];

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LightsScene occasion={occasion} look={look} width={width} height={height} paused={paused} glowRow />

      {shells.map((s, i) => (
        <React.Fragment key={i}>
          <Burst
            driver={pop}
            phase={s.phase}
            x={width * s.x}
            y={height * s.y}
            size={Math.min(width, height) * 0.5}
            color={withAlpha(s.color, 0.85)}
            speed={1}
            thickness={2}
            paused={paused}
          />
          {/* A second, tighter ring a beat behind gives each shell a core. */}
          <Burst
            driver={pop}
            phase={(s.phase + 0.05) % 1}
            x={width * s.x}
            y={height * s.y}
            size={Math.min(width, height) * 0.28}
            color={withAlpha('#FFFFFF', 0.7)}
            speed={1}
            thickness={1.5}
            paused={paused}
          />
        </React.Fragment>
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * IECE Anniversary — the most important day in the catalogue          *
 *                                                                     *
 * This one gets more than the others, deliberately. It is the only    *
 * day of the year that is about the app's own company, so it is built *
 * as a full composition rather than an engine plus a garnish:         *
 *                                                                     *
 *   · a golden ray fan turning slowly behind everything               *
 *   · the year count as a huge watermark numeral, so "9" reads from   *
 *     across a room and rolls to "10" by itself next year             *
 *   · two counter-rotating orbits of sparks around the mark           *
 *   · the IECE logo in a white core, floating and breathing, with a   *
 *     halo and two heartbeat pings — a direct nod to the IECE Pulse   *
 *     hero this is standing in for                                    *
 *   · fireworks overhead and streamers falling through                *
 *                                                                     *
 * Still one animation per moving part and ~18 animated leaves total:  *
 * every orbit is ONE rotating parent carrying static children, which  *
 * is the trick that keeps a composition this dense cheap.             *
 * ------------------------------------------------------------------ */
export function AnniversaryScene({
  occasion,
  look,
  width,
  height,
  paused,
  logoSource,
  date = new Date(),
}) {
  const rayTurn = useLoop(70000, paused);
  const orbitOut = useLoop(28000, paused);
  const orbitIn = useLoop(19000, paused);
  const breathe = useLoop(5600, paused);
  const pop = useLoop(6800, paused);
  const fall = useLoop(8200, paused);

  // Counted from the founding date, from the date being *rendered* — so the
  // admin previewing 21 June 2031 correctly sees "14th", not this year's number.
  const years = Math.max(1, yearsSinceFounding(date));

  const centreY = height * 0.34;
  const outerR = Math.min(width * 0.22, height * 0.24);
  const innerR = outerR * 0.66;
  const core = outerR * 1.05;
  const rayBox = Math.min(width * 1.5, height * 2);
  const numeral = Math.min(width * 0.58, height * 0.66);

  const gold = look.accent || '#FFD166';

  const coreStyle = useAnimatedStyle(() => {
    const a = breathe.value * Math.PI * 2;
    return {
      transform: [
        { translateY: Math.sin(a) * 5 },
        { scale: 1 + Math.sin(a * 2) * 0.03 },
      ],
    };
  });

  const haloStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1.1 + Math.sin(breathe.value * Math.PI * 4) * 0.07 }],
  }));

  const rayStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rayTurn.value * 360}deg` }],
  }));

  const confettiCount = particleBudget(width, 0.5);
  const xs = lanes(confettiCount, width, 307, 0.95);
  const shells = [
    { x: 0.16, y: 0.16, phase: 0.0 },
    { x: 0.84, y: 0.12, phase: 0.4 },
    { x: 0.5, y: 0.06, phase: 0.72 },
  ];

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, { backgroundColor: look.field }]} />
      <SoftGlow x={width * 0.5} y={centreY} size={width * 1.1} color={gold} intensity={0.26} />
      <SoftGlow x={width * 0.5} y={height * 0.96} size={width * 1.2} color={look.palette[0]} intensity={0.3} />

      {/* Ray fan — the slowest thing on screen, and the reason the whole
          composition feels like it is radiating rather than sitting still. */}
      <View style={[styles.centre, { top: centreY - rayBox / 2, height: rayBox }]}>
        {paused ? (
          <View style={{ width: rayBox, height: rayBox }}>
            <RayFan size={rayBox} colour={gold} />
          </View>
        ) : (
          <Animated.View style={[{ width: rayBox, height: rayBox }, rayStyle]}>
            <RayFan size={rayBox} colour={gold} />
          </Animated.View>
        )}
      </View>

      {/* The year, as a watermark. Static — a number this large has no business
          moving, and it costs nothing. */}
      <View style={[styles.centre, { top: centreY - numeral * 0.62 }]} pointerEvents="none">
        <Text
          style={{
            fontSize: numeral,
            lineHeight: numeral * 1.12,
            fontWeight: '900',
            letterSpacing: -numeral * 0.05,
            color: withAlpha(gold, 0.13),
            includeFontPadding: false,
          }}
        >
          {years}
        </Text>
      </View>

      {/* Heartbeat pings out of the mark. */}
      {[0, 0.5].map((phase) => (
        <Burst
          key={`p${phase}`}
          driver={breathe}
          phase={phase}
          x={width * 0.5}
          y={centreY}
          size={outerR * 3.2}
          color={withAlpha(gold, 0.5)}
          speed={1}
          thickness={1.5}
          paused={paused}
        />
      ))}

      {/* Fireworks. */}
      {shells.map((s, i) => (
        <Burst
          key={`s${i}`}
          driver={pop}
          phase={s.phase}
          x={width * s.x}
          y={height * s.y}
          size={Math.min(width, height) * 0.45}
          color={withAlpha(i % 2 ? '#FFFFFF' : gold, 0.8)}
          speed={1}
          thickness={2}
          paused={paused}
        />
      ))}

      {/* Streamers. */}
      {xs.map((x, i) => {
        const size = randIn(i * 2.4, 10, 18);
        return (
          <Faller
            key={`c${i}`}
            driver={fall}
            phase={randIn(i * 1.6, 0, 1)}
            x={x}
            fallHeight={height}
            size={size}
            speed={1}
            sway={3}
            swayAmp={randIn(i * 5.2, 7, 20)}
            spin={i % 3 === 0 ? 2 : i % 2 ? 1 : -1}
            paused={paused}
          >
            <View
              style={{
                width: size * 0.4,
                height: size,
                borderRadius: 1.5,
                backgroundColor: randPick(i * 3.4, [gold, '#FFFFFF', look.palette[0], look.palette[1] || gold]),
              }}
            />
          </Faller>
        );
      })}

      {/* The mark. */}
      <View style={[styles.centre, { top: centreY - outerR, height: outerR * 2 }]}>
        <View style={{ width: outerR * 2, height: outerR * 2, alignItems: 'center', justifyContent: 'center' }}>
          <OrbitRing driver={orbitOut} radius={outerR} count={8} direction={1} dotSize={6} colour={gold} paused={paused} />
          <OrbitRing driver={orbitIn} radius={innerR} count={5} direction={-1} dotSize={4.5} colour={gold} paused={paused} />

          <Animated.View
            style={[
              {
                position: 'absolute',
                width: core * 1.5,
                height: core * 1.5,
                borderRadius: core * 0.75,
                backgroundColor: withAlpha(gold, 0.22),
              },
              paused ? undefined : haloStyle,
            ]}
          />

          <Animated.View style={paused ? undefined : coreStyle}>
            <View
              style={{
                width: core,
                height: core,
                borderRadius: core / 2,
                backgroundColor: withAlpha('#FFFFFF', 0.95),
                borderWidth: 1,
                borderColor: withAlpha(gold, 0.7),
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {!!logoSource && (
                <Image
                  source={logoSource}
                  style={{ width: core * 0.62, height: core * 0.62 }}
                  resizeMode="contain"
                />
              )}
            </View>
          </Animated.View>
        </View>
      </View>
    </View>
  );
}

/**
 * One orbit: a rotating parent carrying static sparks.
 *
 * Defined at module scope, not inside `AnniversaryScene`. A component declared
 * in a render body is a *new component type* on every render, so React would
 * unmount and remount it — restarting the rotation from zero each time and
 * throwing away the shared value's phase. That is the kind of bug that only
 * shows up as "the animation stutters sometimes".
 */
function OrbitRing({ driver, radius, count, direction, dotSize, colour, paused }) {
  const box = radius * 2;

  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${driver.value * 360 * direction}deg` }],
  }));

  const dots = Array.from({ length: count }, (_, i) => (
    <View
      key={i}
      style={{
        position: 'absolute',
        left: radius - dotSize / 2,
        top: radius - dotSize / 2,
        width: dotSize,
        height: dotSize,
        borderRadius: dotSize / 2,
        backgroundColor: i % 2 ? colour : '#FFFFFF',
        transform: [{ rotate: `${(360 / count) * i}deg` }, { translateY: -radius }],
      }}
    />
  ));

  const ring = (
    <View
      style={{
        position: 'absolute',
        width: box,
        height: box,
        borderRadius: box / 2,
        borderWidth: 1,
        borderColor: withAlpha(colour, 0.28),
      }}
    />
  );

  if (paused) {
    return (
      <View style={{ position: 'absolute', width: box, height: box }}>
        {ring}
        {dots}
      </View>
    );
  }

  return (
    <>
      {ring}
      <Animated.View style={[{ position: 'absolute', width: box, height: box }, style]}>
        {dots}
      </Animated.View>
    </>
  );
}

/** 24 tapering rays. Static children of one rotating parent. */
function RayFan({ size, colour }) {
  const count = 24;
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: size / 2 - 2,
            top: 0,
            width: 4,
            height: size / 2,
            transformOrigin: '50% 100%',
            transform: [{ rotate: `${(360 / count) * i}deg` }],
          }}
        >
          <View
            style={{
              width: 4,
              height: size * (i % 2 ? 0.2 : 0.32),
              borderRadius: 3,
              backgroundColor: withAlpha(colour, i % 2 ? 0.07 : 0.13),
            }}
          />
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  centre: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  jet: { flexDirection: 'row', alignItems: 'center' },
  trail: { alignItems: 'flex-end' },
  parade: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'flex-end',
  },
  flagStick: { alignItems: 'center' },
  flagBody: { width: 18, overflow: 'hidden', borderRadius: 1.5 },
  pole: { width: 1.5, height: 16 },
});
