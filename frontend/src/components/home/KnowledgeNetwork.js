import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { withAlpha } from './motion';

/**
 * The connected network behind the brand mark.
 *
 * Design goal: look alive while touching as few pixels and as few views per
 * frame as possible.
 *
 *   · **The mesh itself never moves.** Links and nodes are laid out once and
 *     then are completely static. An earlier version drifted the whole group
 *     with a single transform, which sounds cheap — but a transform on a parent
 *     re-composites its entire subtree every frame, so "one animated view" was
 *     really 33 views being re-drawn 60 times a second. The life comes from the
 *     signals instead, and it reads the same.
 *   · **Only leaf views animate.** Three signal dots travelling their links and
 *     three nodes breathing. Six tiny views, each 5–7px across. Nothing with
 *     children ever animates its opacity, so no offscreen buffer is ever
 *     allocated.
 *   · **It stops when it is not being looked at.** `paused` is driven by
 *     navigation focus, so nothing here burns a frame while the user is inside
 *     a portal screen.
 */

/**
 * Normalised node positions, deliberately hand-placed rather than random:
 * they form a loose ring that frames the orbit system in the centre instead of
 * colliding with it, and they are deterministic, so the layout never "jumps"
 * between renders the way `Math.random()` seeding would.
 */
const NODES = [
  [0.05, 0.10], [0.20, 0.26], [0.08, 0.48], [0.16, 0.74],
  [0.34, 0.88], [0.55, 0.95], [0.76, 0.84], [0.92, 0.66],
  [0.95, 0.34], [0.80, 0.13], [0.60, 0.05], [0.38, 0.12],
  [0.26, 0.52], [0.74, 0.47],
];

/** Nodes that gently pulse. Every extra one is another live worklet. */
const TWINKLES = [1, 5, 8];

/** How many signal dots travel the links at once. */
const SIGNALS = 3;

/* ------------------------------------------------------------------ *
 * A dot travelling along one link.                                    *
 * ------------------------------------------------------------------ */
function Signal({ length, color, duration, delay, paused }) {
  const p = useSharedValue(0);

  useEffect(() => {
    if (paused) {
      cancelAnimation(p);
      p.value = 0;
      return undefined;
    }
    p.value = withDelay(
      delay,
      withRepeat(withTiming(1, { duration, easing: Easing.inOut(Easing.quad) }), -1, false)
    );
    return () => cancelAnimation(p);
  }, [paused, duration, delay, p]);

  // A leaf view: animating its opacity costs nothing, because there is no
  // child tree to rasterise into a buffer first.
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 0.15, 0.85, 1], [0, 1, 1, 0]),
    transform: [{ translateX: p.value * length }],
  }));

  if (paused) return null;

  return (
    <Animated.View pointerEvents="none" style={[styles.signal, { backgroundColor: color }, style]} />
  );
}

/* ------------------------------------------------------------------ *
 * A node that breathes.                                               *
 * ------------------------------------------------------------------ */
function Twinkle({ size, color, phase, paused }) {
  const p = useSharedValue(0);

  useEffect(() => {
    if (paused) {
      cancelAnimation(p);
      p.value = 0;
      return undefined;
    }
    p.value = withRepeat(withTiming(1, { duration: 4200, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(p);
  }, [paused, p]);

  const style = useAnimatedStyle(() => {
    const a = p.value * Math.PI * 2 + phase;
    return {
      opacity: 0.55 + Math.sin(a) * 0.45,
      transform: [{ scale: 1 + Math.sin(a) * 0.35 }],
    };
  });

  const box = { width: size, height: size, borderRadius: size / 2, backgroundColor: color };

  if (paused) return <View pointerEvents="none" style={box} />;

  return <Animated.View pointerEvents="none" style={[box, style]} />;
}

/* ------------------------------------------------------------------ *
 * The network                                                         *
 * ------------------------------------------------------------------ */
export default function KnowledgeNetwork({ width, height, color, isDark = false, paused = false, style }) {
  const nodes = useMemo(
    () => NODES.map(([nx, ny], i) => ({ i, x: nx * width, y: ny * height })),
    [width, height]
  );

  /**
   * Links: every node to its two nearest neighbours, de-duplicated. Derived
   * from the real pixel positions rather than hard-coded, so the mesh stays
   * sensible on a tall phone and a wide tablet alike.
   */
  const links = useMemo(() => {
    const seen = new Set();
    const out = [];
    nodes.forEach((p) => {
      nodes
        .filter((q) => q.i !== p.i)
        .map((q) => ({ q, d: Math.hypot(q.x - p.x, q.y - p.y) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 2)
        .forEach(({ q, d }) => {
          const key = p.i < q.i ? `${p.i}-${q.i}` : `${q.i}-${p.i}`;
          if (seen.has(key)) return;
          seen.add(key);
          out.push({
            key,
            left: p.x,
            top: p.y,
            length: d,
            angle: (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI,
          });
        });
    });
    return out;
  }, [nodes]);

  // Spread the signals across the mesh instead of bunching them together.
  const signalOn = useMemo(() => {
    if (links.length === 0) return [];
    const step = Math.max(1, Math.floor(links.length / SIGNALS));
    return Array.from({ length: SIGNALS }, (_, k) => (k * step) % links.length);
  }, [links.length]);

  const lineColor = withAlpha(color, isDark ? 0.2 : 0.14);
  const nodeColor = withAlpha(color, isDark ? 0.55 : 0.4);
  const hubColor = withAlpha(color, isDark ? 0.75 : 0.55);
  const signalColor = withAlpha(color, isDark ? 0.95 : 0.8);

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip, style]}>
      {links.map((l, idx) => {
        const signalIndex = signalOn.indexOf(idx);
        return (
          <View
            key={l.key}
            style={[
              styles.link,
              {
                left: l.left,
                top: l.top,
                width: l.length,
                backgroundColor: lineColor,
                transform: [{ rotate: `${l.angle}deg` }],
              },
            ]}
          >
            {signalIndex >= 0 && (
              <Signal
                length={l.length}
                color={signalColor}
                duration={2600 + signalIndex * 700}
                delay={signalIndex * 900}
                paused={paused}
              />
            )}
          </View>
        );
      })}

      {nodes.map((n) => {
        const twinkleAt = TWINKLES.indexOf(n.i);
        const isHub = twinkleAt >= 0;
        const size = isHub ? 7 : 4.5;
        return (
          <View key={n.i} style={[styles.node, { left: n.x - size / 2, top: n.y - size / 2 }]}>
            {isHub ? (
              <Twinkle size={size} color={hubColor} phase={twinkleAt * 2.1} paused={paused} />
            ) : (
              <View
                style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: nodeColor }}
              />
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  link: {
    position: 'absolute',
    height: StyleSheet.hairlineWidth * 2,
    // Rotate about the start point, so the line runs from node A to node B
    // instead of pivoting around its own middle.
    transformOrigin: 'left center',
  },
  node: { position: 'absolute' },
  signal: {
    position: 'absolute',
    top: -2,
    left: -2.5,
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
});
