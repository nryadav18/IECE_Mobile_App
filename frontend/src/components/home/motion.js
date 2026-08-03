/**
 * Shared motion vocabulary for the home experience.
 *
 * Everything the hero does is built from these few primitives so the whole
 * screen feels like one system rather than a pile of unrelated effects:
 * the same spring, the same tint maths, the same brand palette.
 *
 * No gradient / SVG dependency is used anywhere — soft edges are built from a
 * few stacked translucent shapes (see GlowButton), which keeps the app's
 * dependency list exactly as it was and renders identically on iOS, Android
 * and web.
 *
 * Two rules the home screen holds to, learned the hard way:
 *   · never animate `opacity` on a view that has children — it forces an
 *     offscreen buffer every frame. Animate leaves, or animate transforms.
 *   · keep translucent fills small. Overdraw, not worklet count, is what
 *     costs frames on mid-range Android.
 */

/**
 * Clamp a number.
 *
 * The `'worklet'` directive matters: this is called from inside
 * `useAnimatedStyle` bodies, and a plain imported function invoked on the UI
 * thread throws "tried to synchronously call a non-worklet function". Marking
 * it makes the Reanimated/Worklets Babel plugin compile a UI-thread copy — it
 * stays an ordinary function for the JS-thread callers (layout maths) too.
 */
export const clamp = (v, min, max) => {
  'worklet';
  return Math.min(Math.max(v, min), max);
};

/**
 * `#RRGGBB` + alpha → `rgba(...)`.
 *
 * Theme colours are plain 6-digit hex, but a couple (dark `border`) already
 * carry an alpha suffix, so anything that isn't a clean 6-digit hex is passed
 * straight through instead of producing an invalid colour string.
 */
export function withAlpha(hex, alpha) {
  if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
}

/** Springs tuned to feel physical but never bouncy enough to look sloppy. */
export const SPRING = {
  /** Buttons / cards reacting to a finger. Snappy, no overshoot wobble. */
  press: { damping: 18, stiffness: 320, mass: 0.5 },
  /** Releasing something back to rest. Slightly softer landing. */
  settle: { damping: 15, stiffness: 220, mass: 0.7 },
  /** Big, expressive entrances. */
  entrance: { damping: 14, stiffness: 130, mass: 0.9 },
};

/** Greeting that matches the user's actual time of day. */
export function greetingFor(date = new Date()) {
  const h = date.getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 21) return 'Good evening';
  return 'Good night';
}
