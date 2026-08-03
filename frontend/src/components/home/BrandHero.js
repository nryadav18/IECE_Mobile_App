import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { AnimatePresence, MotiView } from 'moti';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import KnowledgeNetwork from './KnowledgeNetwork';
import { SPRING, clamp, withAlpha } from './motion';

/**
 * "IECE Pulse" — the signature animation of the app.
 *
 * This is the one thing on the home screen that exists purely to be watched.
 * It is a single continuous system rather than a set of separate effects:
 *
 *   · a connected network of schools drifting behind everything, with signals
 *     travelling the links between them
 *   · three radar pings expanding out of the mark, forever, on offset phases
 *   · two counter-rotating orbits carrying the six things IECE actually does,
 *     each satellite counter-rotating so its icon always stays upright
 *   · the logo core floating and breathing at its own slower rhythm
 *   · a travelling wave running through the I-E-C-E wordmark, lifting each
 *     letter and washing brand colour through it in turn
 *   · the motto cycling with a clean vertical hand-off
 *   · a hairline of light sweeping the base of the hero
 *
 * It is also *playable*, which is what actually brings people back: drag it
 * and the whole stage tilts in 3D with layered parallax (the network moves
 * least, orbits most), then springs home. Tap the mark and it fires a burst.
 *
 * Performance contract:
 *   · every loop is a Reanimated shared value evaluated in a worklet on the
 *     UI thread — the JS thread is untouched, so the animation stays perfectly
 *     smooth even while the dashboard is fetching, parsing and re-rendering.
 *   · every loop is phase-continuous (whole-number sine frequencies over a
 *     linear 0→1 driver), so nothing ever visibly snaps back to its start.
 *   · `useReducedMotion` collapses the whole thing to a still, fully legible
 *     composition for users who have asked the OS for less motion.
 */

/* The six pillars, split across the two orbits. Icons only — the ring is
   decorative, so nothing here is load-bearing information. */
const OUTER_SATELLITES = ['school-outline', 'people-outline', 'ribbon-outline', 'sparkles-outline'];
const INNER_SATELLITES = ['chatbubbles-outline', 'trophy-outline', 'bulb-outline'];

const WORDMARK = ['I', 'E', 'C', 'E'];

export const MOTTOS = [
  'Empowering Education Professionals',
  'Inspire · Educate · Connect · Empower',
  'Every school. Every session. Every child.',
  'Training India’s classrooms, one visit at a time',
];

const MOTTO_INTERVAL = 3600;

/* ------------------------------------------------------------------ *
 * Radar ping — one expanding ring. Three of these on offset phases    *
 * read as a heartbeat coming out of the brand mark.                   *
 * ------------------------------------------------------------------ */
function Ping({ size, color, delay, still }) {
  const p = useSharedValue(0);

  useEffect(() => {
    if (still) {
      cancelAnimation(p);
      p.value = 0;
      return undefined;
    }
    p.value = withDelay(
      delay,
      withRepeat(withTiming(1, { duration: 2900, easing: Easing.out(Easing.quad) }), -1, false)
    );
    return () => cancelAnimation(p);
  }, [still, delay, p]);

  const style = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 0.08, 1], [0, 0.5, 0]),
    transform: [{ scale: interpolate(p.value, [0, 1], [0.62, 1.55]) }],
  }));

  if (still) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ping,
        { width: size, height: size, borderRadius: size / 2, borderColor: color },
        style,
      ]}
    />
  );
}

/* ------------------------------------------------------------------ *
 * Orbit — satellites travelling a static ring.                        *
 *                                                                     *
 * The previous version rotated the ring view and counter-rotated the  *
 * satellites to keep their glyphs upright. That was wrong twice over: *
 * rotating a perfect circle is invisible, so the ring transform was   *
 * pure waste, and the counter-rotation reused ONE animated style      *
 * object across four sibling views — something Reanimated explicitly  *
 * does not support (a style may drive a single component).            *
 *                                                                     *
 * Now the ring is a plain static circle and each satellite orbits by  *
 * translation, so it stays upright for free. One shared value per     *
 * ring; one animated style per satellite; nothing shared, nothing     *
 * redundant.                                                          *
 * ------------------------------------------------------------------ */
function Satellite({ icon, spin, angle0, radius, direction, size, theme, still }) {
  const style = useAnimatedStyle(() => {
    const a = angle0 + spin.value * Math.PI * 2 * direction;
    return {
      transform: [{ translateX: Math.cos(a) * radius }, { translateY: Math.sin(a) * radius }],
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.satellite,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: withAlpha(theme.colors.surface, theme.isDark ? 0.9 : 0.96),
          borderColor: withAlpha(theme.colors.primary, 0.3),
        },
        style,
      ]}
    >
      <Ionicons name={icon} size={size * 0.5} color={theme.colors.primary} />
    </Animated.View>
  );
}

function Orbit({ radius, icons, period, direction, dotSize, theme, still, startAngle = 0 }) {
  const spin = useSharedValue(0);
  const box = radius * 2;

  useEffect(() => {
    if (still) {
      cancelAnimation(spin);
      spin.value = 0;
      return undefined;
    }
    spin.value = withRepeat(
      withTiming(1, { duration: period, easing: Easing.linear }),
      -1,
      false
    );
    return () => cancelAnimation(spin);
  }, [still, period, spin]);

  return (
    <>
      <View
        pointerEvents="none"
        style={[
          styles.orbit,
          {
            width: box,
            height: box,
            borderRadius: radius,
            borderColor: withAlpha(theme.colors.primary, theme.isDark ? 0.24 : 0.18),
          },
        ]}
      />
      {icons.map((icon, i) => (
        <Satellite
          key={icon}
          icon={icon}
          spin={spin}
          angle0={startAngle + (i / icons.length) * Math.PI * 2}
          radius={radius}
          direction={direction}
          size={dotSize}
          theme={theme}
          still={still}
        />
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Wordmark letter — rides a travelling wave shared by all four.       *
 * ------------------------------------------------------------------ */
function WaveLetter({ char, index, wave, size, theme, still }) {
  // Each letter samples the same wave a little later than the one before it,
  // which is what turns four independent letters into one motion.
  const offset = index * 0.13;
  // Capture plain strings, not the theme object — worklets copy what they
  // close over, and there is no reason to ship the whole theme to the UI thread.
  const restColor = theme.colors.textPrimary;
  const peakColor = theme.colors.primary;

  const style = useAnimatedStyle(() => {
    const t = Math.sin((wave.value - offset) * Math.PI * 2);
    return {
      transform: [{ translateY: t * size * 0.07 }, { scale: 1 + t * 0.035 }],
      color: interpolateColor((t + 1) / 2, [0, 1], [restColor, peakColor]),
    };
  });

  if (still) {
    return (
      <Text style={[styles.wordmarkLetter, { fontSize: size, color: theme.colors.textPrimary }]}>
        {char}
      </Text>
    );
  }

  return (
    <Animated.Text style={[styles.wordmarkLetter, { fontSize: size }, style]}>
      {char}
    </Animated.Text>
  );
}

/* ------------------------------------------------------------------ *
 * The hero                                                            *
 * ------------------------------------------------------------------ */
export default function BrandHero({ theme, isDark, width, height, logoSource, onPressCore, paused = false }) {
  const reduced = useReducedMotion();
  // A single gate for every loop in the hero. `paused` is driven by navigation
  // focus: this screen stays mounted while the user works inside a portal, and
  // without this every animation below kept running against the UI thread for
  // the entire session — which is what made the REST of the app feel heavy.
  const still = reduced || paused;

  /* --- responsive geometry: everything derives from the hero box, so this
         composes correctly on a small phone, a tablet, and after a rotation. */
  // The orbit diameter, the ring box that reserves room for it, and the
  // wordmark are all fractions of the hero box. Sized so the widest ping
  // (1.55×) still clears the hero's top edge on a small phone, and so the
  // whole composition stays inside `height` without clipping on a tablet.
  const stage = clamp(Math.min(height * 0.42, width * 0.55), 128, 220);
  const stageBox = stage * 1.35;
  const outerR = stage / 2;
  const innerR = outerR * 0.63;
  const core = stage * 0.44;
  const dot = clamp(stage * 0.15, 22, 34);
  const letterSize = clamp(width * 0.11, 34, 56);

  /* --- continuous drivers ------------------------------------------------ */
  const float = useSharedValue(0); // core breathing / floating
  const wave = useSharedValue(0); // wordmark travelling wave
  const sweep = useSharedValue(0); // hairline of light along the base

  /* --- interaction drivers ----------------------------------------------- */
  const tiltX = useSharedValue(0);
  const tiltY = useSharedValue(0);
  const burst = useSharedValue(0);
  const corePop = useSharedValue(1);

  useEffect(() => {
    if (still) {
      cancelAnimation(float);
      cancelAnimation(wave);
      cancelAnimation(sweep);
      float.value = 0;
      wave.value = 0;
      sweep.value = 0;
      return undefined;
    }
    float.value = withRepeat(withTiming(1, { duration: 5200, easing: Easing.linear }), -1, false);
    wave.value = withRepeat(withTiming(1, { duration: 3400, easing: Easing.linear }), -1, false);
    sweep.value = withRepeat(withTiming(1, { duration: 4200, easing: Easing.linear }), -1, false);
    return () => {
      cancelAnimation(float);
      cancelAnimation(wave);
      cancelAnimation(sweep);
    };
  }, [still, float, wave, sweep]);

  /* --- motto rotator ------------------------------------------------------
     One `setState` every 3.6s is the only JS-thread work this component ever
     does after mount; the swap itself is animated by Moti on the UI thread. */
  const [mottoIndex, setMottoIndex] = useState(0);
  const mottoTimer = useRef(null);
  useEffect(() => {
    if (still) return undefined;
    mottoTimer.current = setInterval(
      () => setMottoIndex((i) => (i + 1) % MOTTOS.length),
      MOTTO_INTERVAL
    );
    return () => clearInterval(mottoTimer.current);
  }, [still]);

  /* --- drag-to-tilt -------------------------------------------------------
     The hero lives inside a vertical ScrollView, so the pan only claims
     horizontally-dominant gestures (`failOffsetY`). A vertical drag scrolls
     the page exactly as it always did — the toy never fights the app. */
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-10, 10])
        .failOffsetY([-14, 14])
        .onUpdate((e) => {
          tiltX.value = e.translationX;
          tiltY.value = e.translationY;
        })
        .onFinalize(() => {
          tiltX.value = withSpring(0, SPRING.settle);
          tiltY.value = withSpring(0, SPRING.settle);
        }),
    [tiltX, tiltY]
  );

  const handleCorePress = () => {
    if (!still) {
      burst.value = 0;
      burst.value = withTiming(1, { duration: 620, easing: Easing.out(Easing.cubic) });
      corePop.value = withSequence(
        withSpring(1.14, SPRING.press),
        withSpring(1, SPRING.settle)
      );
    }
    onPressCore?.();
  };

  /* --- derived styles ---------------------------------------------------- */

  // Depth parallax: the further "forward" a layer sits, the harder it reacts
  // to the drag. The network barely moves, the orbits move fully and also
  // rotate in 3D, the text sits in between — which is what sells it as depth
  // rather than as three things sliding.
  const backdropTilt = useAnimatedStyle(() => {
    const dx = clamp(tiltX.value / width, -1, 1);
    const dy = clamp(tiltY.value / height, -1, 1);
    return { transform: [{ translateX: dx * 9 }, { translateY: dy * 6 }] };
  });

  const stageTilt = useAnimatedStyle(() => {
    const dx = clamp(tiltX.value / width, -1, 1);
    const dy = clamp(tiltY.value / height, -1, 1);
    return {
      transform: [
        { perspective: 900 },
        { translateX: dx * 26 },
        { translateY: dy * 16 },
        { rotateY: `${dx * 14}deg` },
        { rotateX: `${-dy * 12}deg` },
      ],
    };
  });

  const textTilt = useAnimatedStyle(() => {
    const dx = clamp(tiltX.value / width, -1, 1);
    const dy = clamp(tiltY.value / height, -1, 1);
    return { transform: [{ translateX: dx * 14 }, { translateY: dy * 9 }] };
  });

  const coreStyle = useAnimatedStyle(() => {
    const a = float.value * Math.PI * 2;
    return {
      transform: [
        { translateY: Math.sin(a) * (still ? 0 : 6) },
        { scale: corePop.value * (1 + (still ? 0 : Math.sin(a * 2) * 0.022)) },
      ],
    };
  });

  const haloStyle = useAnimatedStyle(() => {
    const a = float.value * Math.PI * 2;
    return {
      opacity: still ? 0.35 : 0.28 + Math.sin(a * 2) * 0.12,
      transform: [{ scale: still ? 1.1 : 1.1 + Math.sin(a * 2) * 0.06 }],
    };
  });

  const burstStyle = useAnimatedStyle(() => ({
    opacity: interpolate(burst.value, [0, 0.1, 1], [0, 0.55, 0]),
    transform: [{ scale: interpolate(burst.value, [0, 1], [0.5, 2.1]) }],
  }));

  const sweepStyle = useAnimatedStyle(() => ({
    opacity: interpolate(sweep.value, [0, 0.1, 0.5, 0.9, 1], [0, 1, 1, 0, 0]),
    transform: [{ translateX: interpolate(sweep.value, [0, 1], [-width * 0.45, width * 1.45]) }],
  }));

  const pingColor = withAlpha(theme.colors.primary, isDark ? 0.5 : 0.4);

  return (
    <View style={[styles.hero, { height }]}>
      {/* Layer 0 — the connected-network texture, moves least. */}
      <Animated.View style={[StyleSheet.absoluteFill, backdropTilt]}>
        <KnowledgeNetwork
          width={width}
          height={height}
          color={theme.colors.primary}
          isDark={isDark}
          paused={still}
        />
      </Animated.View>

      <GestureDetector gesture={pan}>
        <View style={styles.heroBody} collapsable={false}>
          {/* Layer 2 — the orbit stage, moves most. */}
          <Animated.View
            style={[
              styles.stage,
              { width: stageBox, height: stageBox },
              stageTilt,
            ]}
          >
            <Ping size={stage} color={pingColor} delay={0} still={still} />
            <Ping size={stage} color={pingColor} delay={1450} still={still} />

            <Orbit
              radius={outerR}
              icons={OUTER_SATELLITES}
              period={30000}
              direction={1}
              dotSize={dot}
              theme={theme}
              still={still}
            />
            <Orbit
              radius={innerR}
              icons={INNER_SATELLITES}
              period={21000}
              direction={-1}
              dotSize={dot * 0.82}
              theme={theme}
              still={still}
              startAngle={Math.PI / 3}
            />

            {/* Tap burst, drawn behind the mark so it reads as energy leaving it. */}
            <Animated.View
              pointerEvents="none"
              style={[
                styles.ping,
                {
                  width: stage,
                  height: stage,
                  borderRadius: stage / 2,
                  borderWidth: 2,
                  borderColor: theme.colors.primary,
                },
                burstStyle,
              ]}
            />

            {/* Soft halo directly under the mark. */}
            <Animated.View
              pointerEvents="none"
              style={[
                styles.halo,
                {
                  width: core * 1.5,
                  height: core * 1.5,
                  borderRadius: core * 0.75,
                  backgroundColor: withAlpha(theme.colors.primary, isDark ? 0.3 : 0.18),
                },
                haloStyle,
              ]}
            />

            <Animated.View style={coreStyle}>
              <Pressable
                onPress={handleCorePress}
                accessibilityRole="imagebutton"
                accessibilityLabel="IECE"
                hitSlop={8}
                style={[
                  styles.core,
                  {
                    width: core,
                    height: core,
                    borderRadius: core / 2,
                    backgroundColor: withAlpha(theme.colors.surface, isDark ? 0.86 : 0.94),
                    borderColor: withAlpha(theme.colors.primary, 0.28),
                    shadowColor: theme.colors.primary,
                  },
                ]}
              >
                <Image
                  source={logoSource}
                  style={{ width: core * 0.66, height: core * 0.66 }}
                  resizeMode="contain"
                />
              </Pressable>
            </Animated.View>
          </Animated.View>

          {/* Layer 1 — wordmark + motto, moderate parallax. */}
          <Animated.View style={[styles.textBlock, textTilt]}>
            <View style={styles.wordmark}>
              {WORDMARK.map((char, i) => (
                <WaveLetter
                  key={`${char}-${i}`}
                  char={char}
                  index={i}
                  wave={wave}
                  size={letterSize}
                  theme={theme}
                  still={still}
                />
              ))}
            </View>

            <View style={[styles.mottoSlot, { height: letterSize * 0.62 }]}>
              {still ? (
                <Text style={[styles.motto, { color: theme.colors.textSecondary }]}>
                  {MOTTOS[0]}
                </Text>
              ) : (
                <AnimatePresence exitBeforeEnter>
                  <MotiView
                    key={mottoIndex}
                    from={{ opacity: 0, translateY: 12 }}
                    animate={{ opacity: 1, translateY: 0 }}
                    exit={{ opacity: 0, translateY: -12 }}
                    transition={{ type: 'timing', duration: 420 }}
                    style={styles.mottoLine}
                  >
                    <Text
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      style={[styles.motto, { color: theme.colors.textSecondary }]}
                    >
                      {MOTTOS[mottoIndex]}
                    </Text>
                  </MotiView>
                </AnimatePresence>
              )}
            </View>
          </Animated.View>
        </View>
      </GestureDetector>

      {/* A hairline of light travelling along the base — the seam between the
          hero and the content below, made into part of the animation. */}
      <View
        style={[styles.baseline, { backgroundColor: withAlpha(theme.colors.border, 0.5) }]}
        pointerEvents="none"
      >
        {!still && (
          <Animated.View
            style={[
              styles.baselineGlow,
              { width: width * 0.4, backgroundColor: theme.colors.primary },
              sweepStyle,
            ]}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    width: '100%',
    overflow: 'hidden',
    justifyContent: 'center',
  },
  heroBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stage: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ping: {
    position: 'absolute',
    borderWidth: 1.5,
  },
  orbit: {
    position: 'absolute',
    borderWidth: 1,
  },
  satellite: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  halo: {
    position: 'absolute',
  },
  core: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    // Kept modest on purpose: this view floats and breathes continuously, and
    // a large blur radius / high elevation means the platform re-renders the
    // shadow on every one of those frames. The halo behind it does most of the
    // lifting visually, for free.
    ...Platform.select({
      ios: { shadowOpacity: 0.2, shadowRadius: 9, shadowOffset: { width: 0, height: 5 } },
      android: { elevation: 3 },
      default: {},
    }),
  },
  textBlock: {
    alignItems: 'center',
    marginTop: 2,
  },
  wordmark: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  wordmarkLetter: {
    fontWeight: '900',
    letterSpacing: 2,
    includeFontPadding: false,
  },
  mottoSlot: {
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
    paddingHorizontal: 24,
    alignSelf: 'stretch',
  },
  mottoLine: {
    width: '100%',
  },
  motto: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  baseline: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: StyleSheet.hairlineWidth * 2,
    overflow: 'hidden',
  },
  baselineGlow: {
    position: 'absolute',
    top: 0,
    bottom: 0,
  },
});
