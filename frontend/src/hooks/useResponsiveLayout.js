import { useWindowDimensions } from 'react-native';
import { BREAKPOINTS, CONTENT_MAX_WIDTH, isWeb } from '../utils/platform';

/**
 * Live layout metrics for any screen. Uses `useWindowDimensions` so browser
 * resizes and tablet rotation re-flow immediately — unlike `Dimensions.get`
 * captured once at module load.
 *
 * `gutter` and `columns` are the two values screens actually reach for, and both
 * are deliberately inert on native: `gutter` returns the caller's own
 * `baseGutter` and `columns` is always 1. The mobile app therefore renders the
 * padding and the single-column lists it was designed with, and only a browser
 * ever sees the wider gutters or the extra columns.
 *
 * @param baseGutter The screen's existing horizontal padding. Pass the value the
 *   screen already used (16, 20, …) so the phone layout is preserved exactly.
 */
export default function useResponsiveLayout({ baseGutter = 20 } = {}) {
  const { width, height } = useWindowDimensions();

  const isCompact = width < BREAKPOINTS.compact;
  const isTablet = width >= BREAKPOINTS.tablet && width < BREAKPOINTS.desktop;
  const isDesktop = width >= BREAKPOINTS.desktop;
  const isWide = width >= BREAKPOINTS.tablet;

  // Cards stay in a comfortable band instead of stretching into 1400px-wide
  // slabs: past ~1000px we add columns rather than width.
  const columns = !isWeb || !isWide
    ? 1
    : width >= 1700 ? 4
    : width >= BREAKPOINTS.wide ? 3
    : isDesktop ? 2
    : 1;

  // Wide browser windows get a bigger margin so content is not glued to the
  // window edge, while still filling the screen rather than hiding in a column.
  const gutter = !isWeb
    ? baseGutter
    : isDesktop ? (width >= BREAKPOINTS.wide ? 40 : 32)
    : isWide ? 28
    : baseGutter;

  // Horizontal inset that CENTRES the content column.
  //
  // Applied as padding rather than a `maxWidth` + `alignSelf` wrapper on purpose:
  // used on a screen's header bar and on its scroll content alike, it lines the
  // two up exactly, while the bar's own background and bottom border still run
  // the full width of the window the way an app bar should. Falls back to the
  // plain gutter once the window is narrower than the column, and equals
  // `baseGutter` on native, so the phone is untouched.
  const contentInset = !isWeb
    ? baseGutter
    : Math.max(gutter, Math.round((width - CONTENT_MAX_WIDTH) / 2));

  return {
    width,
    height,
    isCompact,
    isTablet,
    isDesktop,
    isWide,
    gutter,
    contentInset,
    columns,
    /** True only in a browser wide enough to be worth reflowing for. */
    isWebWide: isWeb && isWide,
  };
}
