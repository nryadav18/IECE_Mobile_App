import { Platform } from 'react-native';

/** True when running in a browser via react-native-web. */
export const isWeb = Platform.OS === 'web';

/** True on iOS or Android native builds. */
export const isNative = Platform.OS === 'ios' || Platform.OS === 'android';

export const isIOS = Platform.OS === 'ios';
export const isAndroid = Platform.OS === 'android';

/**
 * Shared breakpoints for responsive layout. Matches the thresholds already
 * used in DashboardScreen and monitoring views so web and mobile stay aligned.
 */
export const BREAKPOINTS = {
  compact: 480,
  tablet: 700,
  desktop: 1024,
  wide: 1280,
};

/**
 * Width of the centred content column in the browser.
 *
 * Everything on a screen — the header bar's title and actions, the cards, the
 * section headings, the dividers — is laid out inside this column, so the whole
 * page reads as one centred piece instead of content pinned to the left edge of
 * a wide monitor.
 */
export const CONTENT_MAX_WIDTH = 1180;

/**
 * Style for a pane that shows ONE record being reviewed or entered — a leave
 * request, a substitution, a form.
 *
 * Lists, grids and dashboards use the whole window. A single record does not
 * benefit from the same treatment: stretched across 1400px the eye has to cross
 * the monitor to pair each label with its value, so it is centred at a readable
 * width instead. Spreads to nothing on native, leaving phone layout untouched.
 */
export const REVIEW_PANE = isWeb
  ? { width: '100%', maxWidth: 1000, alignSelf: 'center' }
  : {};
