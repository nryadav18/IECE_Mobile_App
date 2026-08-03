/**
 * Colour maths for celebration scenes.
 *
 * Each occasion carries a `palette` of two-to-four brand-true hex colours
 * (tricolour, diya-amber on indigo, Onam yellow-and-white…). Those colours are
 * chosen for the *artwork*, not for text — so the wish has to be able to sit
 * legibly on saffron, on white and on deep indigo without anyone hand-tuning
 * thirty-odd occasions. That is what this file does.
 *
 * Reuses `withAlpha` and `clamp` from the home motion vocabulary rather than
 * re-implementing them, so the celebration header stays part of the same
 * system as the hero it replaces.
 */

import { clamp, withAlpha } from '../components/home/motion';

export { withAlpha };

/** `#RRGGBB` → `{ r, g, b }` (0-255). Returns null for anything else. */
export function toRgb(hex) {
  if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

const hex2 = (n) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');

/** Blend two hex colours. `t=0` → a, `t=1` → b. */
export function mix(a, b, t) {
  const ca = toRgb(a);
  const cb = toRgb(b);
  if (!ca || !cb) return a;
  const k = clamp(t, 0, 1);
  return `#${hex2(ca.r + (cb.r - ca.r) * k)}${hex2(ca.g + (cb.g - ca.g) * k)}${hex2(
    ca.b + (cb.b - ca.b) * k
  )}`;
}

export const lighten = (hex, t) => mix(hex, '#FFFFFF', t);
export const darken = (hex, t) => mix(hex, '#000000', t);

/**
 * Relative luminance, WCAG 2.x definition (sRGB → linear, then the 0.2126 /
 * 0.7152 / 0.0722 weighting). Used only to decide light-vs-dark ink, so the
 * gamma step matters: a naive (r+g+b)/3 calls saffron "dark" and puts white
 * text on it, which is exactly the unreadable case we're avoiding.
 */
export function luminance(hex) {
  const c = toRgb(hex);
  if (!c) return 0.5;
  const channel = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/** WCAG contrast ratio between two hex colours (1 → identical, 21 → max). */
export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

const INK_LIGHT = '#FFFFFF';
const INK_DARK = '#14161A';

/** Whichever of near-white / near-black reads better on `bg`. */
export function inkOn(bg) {
  return contrast(bg, INK_LIGHT) >= contrast(bg, INK_DARK) ? INK_LIGHT : INK_DARK;
}

/**
 * The single colour the wish text actually sits on.
 *
 * Scenes are multi-coloured by nature (three tricolour bands!), so "what is
 * behind the text" has no one answer. Every scene therefore paints a scrim
 * behind the text block, and *that* is the surface we solve contrast against —
 * which makes the answer exact rather than a guess.
 */
export function scrimFor(occasion, isDark) {
  const base = occasion.scrim || (occasion.ink === 'light' ? '#101318' : '#FFFFFF');
  return {
    color: base,
    // Deliberately modest. A heavy scrim reads as a grey box pasted over the
    // artwork; this is just enough to hold text.
    alpha: occasion.scrimAlpha ?? (isDark ? 0.34 : 0.28),
  };
}

/**
 * Everything a scene or the header bar needs to draw text and chrome for one
 * occasion, resolved once and passed down.
 *
 * `ink` on the occasion is an author's override ('light' | 'dark'); when it is
 * absent the palette decides for itself.
 */
export function themeForOccasion(occasion, isDark) {
  const palette = occasion.palette && occasion.palette.length ? occasion.palette : ['#E23744'];
  // The "field" is the colour that dominates the composition — the last band
  // for flags, the backdrop for everything else.
  const field = occasion.field || palette[palette.length - 1];
  const scrim = scrimFor(occasion, isDark);

  const ink =
    occasion.ink === 'light' ? INK_LIGHT :
    occasion.ink === 'dark' ? INK_DARK :
    inkOn(mix(field, scrim.color, scrim.alpha));

  const onInk = ink === INK_LIGHT;

  /**
   * The colour the floating header bar fills with once the page is scrolled
   * past the hero. Pulled toward the surface colour so the collapsed bar still
   * reads as app chrome rather than as a stray band of festival colour.
   */
  const barFill = mix(field, isDark ? '#1A1A1A' : '#FFFFFF', 0.18);

  return {
    palette,
    field,
    accent: occasion.accent || palette[0],
    scrim,
    /** Wish headline. */
    ink,
    /** Supporting line — same hue, stepped back so the headline leads. */
    inkSoft: withAlpha(ink, onInk ? 0.78 : 0.66),
    /** Hairlines, pips, chips. */
    inkFaint: withAlpha(ink, onInk ? 0.4 : 0.3),
    /** Fill behind chips/pills sitting on the artwork. */
    chip: withAlpha(onInk ? '#000000' : '#FFFFFF', onInk ? 0.26 : 0.5),
    /** What the OS status bar icons should be. */
    statusBarStyle: onInk ? 'light-content' : 'dark-content',
    /**
     * The colour the floating header bar fills with once the page is scrolled
     * past the hero. Pulled toward the surface colour so the collapsed bar
     * still reads as app chrome rather than as a stray band of festival colour.
     */
    barFill,
    /** Text colour for that collapsed bar — solved against it, not guessed. */
    barInk: inkOn(barFill),
  };
}

/**
 * Deterministic pseudo-random in [0, 1).
 *
 * Particles need scatter, but `Math.random()` would mean a scene looked
 * different every render — and, worse, that the admin previewing 15 August
 * twice saw two different compositions. This is a plain hash of the seed, so
 * "random" here means *fixed and arbitrary*, which is what scattering actually
 * wants.
 */
export function rand(seed) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

/** `rand` mapped into a range. */
export const randIn = (seed, min, max) => min + rand(seed) * (max - min);

/** Pick from an array deterministically. */
export const randPick = (seed, arr) => arr[Math.floor(rand(seed) * arr.length) % arr.length];
