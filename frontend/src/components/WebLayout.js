import React, { useEffect } from 'react';
import { isWeb } from '../utils/platform';

/**
 * Browser-only chrome for the portal.
 *
 * The app itself is left alone: this injects the handful of things a React
 * Native tree cannot express but a browser needs — a real pointer cursor on
 * touchables, a scrollbar that does not look like 1998, a visible focus ring for
 * keyboard users, and no rubber-band overscroll on the page behind the app.
 *
 * Layout is deliberately NOT constrained here. Content runs the full width of
 * the window and the screens reflow into columns themselves (see
 * `ResponsiveGrid` / `useResponsiveLayout`), so nothing is boxed into a narrow
 * phone-shaped strip on a monitor.
 *
 * On native this renders its children and nothing else, so the mobile app is
 * completely unaffected.
 */

const WEB_STYLES = `
  /* index.html already sets html/body/#root to full height and hides body
     overflow; each screen's own ScrollView is the scroller, exactly as on the
     phone. Keep the page itself from bouncing or double-scrolling. */
  html, body {
    overscroll-behavior: none;
  }

  body {
    margin: 0;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    text-rendering: optimizeLegibility;
  }

  /* React Native Web renders touchables as plain divs, which leaves the default
     text caret over every button in the app. */
  [role="button"], [role="link"], [role="tab"], [role="switch"], button, a, summary {
    cursor: pointer;
  }

  input, textarea, select, [contenteditable="true"] {
    cursor: auto;
  }

  input:disabled, textarea:disabled, select:disabled,
  button:disabled, [aria-disabled="true"] {
    cursor: not-allowed;
  }

  /* Mouse users get no outline; keyboard users get a clear one. */
  *:focus {
    outline: none;
  }

  *:focus-visible {
    outline: 2px solid #E11D3A;
    outline-offset: 2px;
    border-radius: 4px;
  }

  /* Slim, theme-neutral scrollbars for every scroll area in the app. */
  * {
    scrollbar-width: thin;
    scrollbar-color: rgba(120, 132, 150, 0.45) transparent;
  }

  ::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }

  ::-webkit-scrollbar-track {
    background: transparent;
  }

  ::-webkit-scrollbar-thumb {
    background: rgba(120, 132, 150, 0.42);
    border-radius: 999px;
    border: 2px solid transparent;
    background-clip: padding-box;
  }

  ::-webkit-scrollbar-thumb:hover {
    background: rgba(100, 112, 132, 0.62);
    background-clip: padding-box;
  }

  ::-webkit-scrollbar-corner {
    background: transparent;
  }

  /* Text stays selectable, but dragging a card or a button should not paint a
     selection highlight across the UI. */
  [role="button"], [role="tab"] {
    -webkit-user-select: none;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
  }

  /* Images are content here, never draggable ghosts. */
  img {
    -webkit-user-drag: none;
    user-drag: none;
  }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
  }
`;

const STYLE_ID = 'iece-web-styles';

export default function WebLayout({ children }) {
  useEffect(() => {
    if (!isWeb || typeof document === 'undefined') return;
    if (document.getElementById(STYLE_ID)) return;

    const tag = document.createElement('style');
    tag.id = STYLE_ID;
    tag.textContent = WEB_STYLES;
    document.head.appendChild(tag);
    // Intentionally not removed on unmount: this is app-level chrome for the
    // life of the document, and tearing it down mid-session would flash the
    // browser defaults back over the UI.
  }, []);

  return <>{children}</>;
}
