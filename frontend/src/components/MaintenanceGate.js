/**
 * The maintenance gate.
 *
 * When the database says the app is being updated, this puts an opaque,
 * undismissable screen in front of everything — navigator, login screen and
 * all — and counts down to the moment it comes back. There is no Later, no
 * back button out, and no exception for admins on a phone.
 *
 * ── Where the switch is ──────────────────────────────────────────────────
 * One hand-edited document in MongoDB (`appmaintenances`, key "global"). There
 * is no admin screen and no write endpoint; see backend/models/AppMaintenance.js
 * for why. To end a window early, set `enabled` to false — every app picks it
 * up within a minute, and immediately on its next foreground.
 *
 * ── Store builds only ────────────────────────────────────────────────────
 * `isStoreBuild()` keeps this off the web build entirely. That is what makes the
 * lockout recoverable: the browser portal is where an admin goes to fix things,
 * and gating it would mean the only way out was the thing being blocked.
 *
 * ── It fails open ────────────────────────────────────────────────────────
 * No network, backend unreachable, nothing configured — none of them raise the
 * gate. A block is only ever raised on a positive answer: either the server
 * saying so now, or a window it already told us about that has not yet ended
 * (which is the case where the backend is down *because* of the update).
 *
 * ── Motion ───────────────────────────────────────────────────────────────
 * Everything animated here is a transform — rotate, scale, translate — never
 * opacity on a parent view, and the soft glows are stacked translucent circles
 * rather than a gradient library. Both are house rules that exist because
 * overdraw, not worklet count, is what makes these screens stutter.
 */

import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  AppState,
  BackHandler,
  Dimensions,
  Image,
  Modal,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MotiView } from 'moti';
import { ThemeContext } from '../context/ThemeContext';
import { checkMaintenance } from '../services/maintenance';

const IECE_LOGO = require('../../assets/IECE_Logo_Web.png');

/** How often to re-ask while the screen is up. */
const POLL_MS = 30 * 1000;

const { width: SCREEN_W } = Dimensions.get('window');
const LOGO = Math.min(Math.round(SCREEN_W * 0.34), 150);
const RING = LOGO + 62;

/* ------------------------------------------------------------------ *
 * Countdown                                                           *
 * ------------------------------------------------------------------ */

const two = (n) => String(n).padStart(2, '0');

/**
 * A ticking clock, isolated in its own component ON PURPOSE.
 *
 * It re-renders every second. If that state lived in the gate, the logo, the
 * ring and every drifting circle would be reconciled once a second too — for
 * the entire length of a maintenance window, on a screen whose whole job is to
 * sit there looking calm.
 *
 * Seeded from the SERVER's seconds-remaining and decremented locally, so the
 * device's own clock is never consulted. `onFinish` fires once, at zero.
 */
function Countdown({ seconds, onFinish, theme }) {
  const [left, setLeft] = useState(seconds);
  const finished = useRef(false);

  // A fresh answer from the server re-seeds the clock — this is how an extended
  // window starts counting to its new end instead of sitting at zero.
  useEffect(() => {
    setLeft(seconds);
    finished.current = false;
  }, [seconds]);

  useEffect(() => {
    if (left <= 0) {
      // Guarded so the re-check fires ONCE per window. Without the ref, a
      // server that kept answering "0 seconds left" would have this component
      // re-checking in a tight loop — the server never returns 0 (a window
      // whose end has passed answers "not under maintenance" instead), but a
      // screen that can hammer the API is not something to leave resting on
      // an invariant held at the other end of the network.
      if (!finished.current) {
        finished.current = true;
        onFinish?.();
      }
      return undefined;
    }
    const id = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [left, onFinish]);

  const safe = Math.max(0, left);
  const parts = [
    { value: two(Math.floor(safe / 3600)), label: 'hrs' },
    { value: two(Math.floor((safe % 3600) / 60)), label: 'min' },
    { value: two(safe % 60), label: 'sec' },
  ];

  return (
    <View style={styles.clock}>
      {parts.map((p, i) => (
        <React.Fragment key={p.label}>
          {i > 0 && <Text style={[styles.colon, { color: theme.colors.primary }]}>:</Text>}
          <View style={styles.unit}>
            {/* Fixed-width boxes rather than tabular figures: `fontVariant` is
                iOS-only in React Native, so on Android the digits would shuffle
                the whole row sideways once a second. */}
            <View
              style={[
                styles.digitBox,
                { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
              ]}
            >
              <Text style={[styles.digits, { color: theme.colors.textPrimary }]}>{p.value}</Text>
            </View>
            <Text style={[styles.unitLabel, { color: theme.colors.textSecondary }]}>{p.label}</Text>
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * The animated mark                                                   *
 * ------------------------------------------------------------------ */

const RING_DOTS = 12;

/** The IECE mark, breathing, inside a slowly orbiting ring of dots. */
function Emblem({ theme }) {
  return (
    <View style={{ width: RING, height: RING, alignItems: 'center', justifyContent: 'center' }}>
      {/* Soft glow: two stacked translucent circles. No gradient library — see
          the house rule in the header. */}
      <View
        pointerEvents="none"
        style={[
          styles.glow,
          { width: RING * 1.5, height: RING * 1.5, borderRadius: RING * 0.75,
            backgroundColor: theme.colors.primary + '10' },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.glow,
          { width: RING * 1.1, height: RING * 1.1, borderRadius: RING * 0.55,
            backgroundColor: theme.colors.primary + '14' },
        ]}
      />

      {/* The orbit. One rotating parent carrying the dots — twelve separate
          animations would be twelve times the work for the same picture. */}
      <MotiView
        pointerEvents="none"
        from={{ rotate: '0deg' }}
        animate={{ rotate: '360deg' }}
        transition={{ type: 'timing', duration: 14000, loop: true, repeatReverse: false }}
        style={StyleSheet.absoluteFill}
      >
        {Array.from({ length: RING_DOTS }).map((_, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              {
                backgroundColor: theme.colors.primary,
                // Every other dot is smaller and fainter, which is what makes
                // the ring read as turning rather than just existing.
                opacity: i % 2 ? 0.28 : 0.7,
                transform: [
                  { translateX: -3 },
                  { translateY: -3 },
                  { rotate: `${(360 / RING_DOTS) * i}deg` },
                  { translateY: -RING / 2 },
                  { scale: i % 2 ? 0.7 : 1 },
                ],
              },
            ]}
          />
        ))}
      </MotiView>

      {/* The breath. Scale only — animating opacity on a view that has children
          forces the whole subtree onto its own layer. */}
      <MotiView
        from={{ scale: 1 }}
        animate={{ scale: 1.055 }}
        transition={{ type: 'timing', duration: 1900, loop: true, repeatReverse: true }}
        style={[
          styles.logoPlate,
          { width: LOGO, height: LOGO, borderRadius: LOGO / 2 },
        ]}
      >
        <Image source={IECE_LOGO} style={styles.logoImage} resizeMode="contain" />
      </MotiView>
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * The gate                                                            *
 * ------------------------------------------------------------------ */

export default function MaintenanceGate() {
  const { theme } = useContext(ThemeContext);
  const [info, setInfo] = useState(null);
  const [rechecking, setRechecking] = useState(false);

  const run = useCallback(async () => {
    const result = await checkMaintenance();
    setInfo(result);
    return result;
  }, []);

  // Launch.
  useEffect(() => {
    run();
  }, [run]);

  // Coming back from the background. The most common way a window is noticed —
  // and the most common way one is noticed to be OVER.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') run();
    });
    return () => sub.remove();
  }, [run]);

  // Poll while the screen is up, so a window switched off early clears without
  // anyone having to background the app. Nothing polls while it is down.
  useEffect(() => {
    if (!info?.active) return undefined;
    const id = setInterval(run, POLL_MS);
    return () => clearInterval(id);
  }, [info?.active, run]);

  // Swallow the Android back button for as long as the gate is up. Without
  // this, back dismisses the modal and drops the user into the app underneath.
  useEffect(() => {
    if (!info?.active) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [info?.active]);

  /**
   * The countdown hit zero. Ask again rather than leaving someone staring at
   * 00:00:00 — if the window really is over the gate dissolves on its own, and
   * if it was extended in the database the new time is picked up here.
   */
  const onCountdownFinished = useCallback(async () => {
    setRechecking(true);
    try {
      await run();
    } finally {
      setRechecking(false);
    }
  }, [run]);

  if (!info?.active) return null;

  const title = info.title || 'We’ll be right back';
  const message =
    info.message ||
    'IECE is being updated so everything works better for you. The app will open again as soon as we’re done.';

  return (
    <Modal
      visible
      animationType="fade"
      // Both flags are required on Android or the modal renders inside a black
      // inset that visibly shrinks the app — a house rule learned the hard way.
      statusBarTranslucent
      navigationBarTranslucent
      // Android hardware back is handled above; this is the iOS/AndroidTV path.
      onRequestClose={() => {}}
      presentationStyle="overFullScreen"
    >
      <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
        {/* Two large, very faint circles drifting behind everything. Slow enough
            to read as atmosphere rather than motion. */}
        <MotiView
          pointerEvents="none"
          from={{ translateY: -18, translateX: -10 }}
          animate={{ translateY: 18, translateX: 10 }}
          transition={{ type: 'timing', duration: 9000, loop: true, repeatReverse: true }}
          style={[
            styles.bubble,
            { top: -SCREEN_W * 0.28, left: -SCREEN_W * 0.22,
              width: SCREEN_W * 0.9, height: SCREEN_W * 0.9, borderRadius: SCREEN_W * 0.45,
              backgroundColor: theme.colors.primary + '0D' },
          ]}
        />
        <MotiView
          pointerEvents="none"
          from={{ translateY: 16, translateX: 12 }}
          animate={{ translateY: -16, translateX: -12 }}
          transition={{ type: 'timing', duration: 11000, loop: true, repeatReverse: true }}
          style={[
            styles.bubble,
            { bottom: -SCREEN_W * 0.34, right: -SCREEN_W * 0.26,
              width: SCREEN_W * 1.0, height: SCREEN_W * 1.0, borderRadius: SCREEN_W * 0.5,
              backgroundColor: theme.colors.primary + '0A' },
          ]}
        />

        <View style={styles.content}>
          <Emblem theme={theme} />

          <View style={[styles.badge, { backgroundColor: theme.colors.primary + '14', borderColor: theme.colors.primary + '3A' }]}>
            <Ionicons name="construct-outline" size={13} color={theme.colors.primary} />
            <Text style={[styles.badgeText, { color: theme.colors.primary }]}>UNDER MAINTENANCE</Text>
          </View>

          <Text style={[styles.title, { color: theme.colors.textPrimary }]}>{title}</Text>
          <Text style={[styles.message, { color: theme.colors.textSecondary }]}>{message}</Text>

          {/* An open-ended window has no countdown to show. Saying "we don't
              have a time yet" is the honest version — a fake number here would
              be the one thing on this screen nobody could verify. */}
          {info.secondsRemaining == null ? (
            <View style={[styles.noEta, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
              <Ionicons name="time-outline" size={15} color={theme.colors.textSecondary} />
              <Text style={[styles.noEtaText, { color: theme.colors.textSecondary }]}>
                We don’t have a finish time yet. This screen will clear itself the moment we’re back.
              </Text>
            </View>
          ) : rechecking ? (
            <View style={styles.checking}>
              <MotiView
                from={{ rotate: '0deg' }}
                animate={{ rotate: '360deg' }}
                transition={{ type: 'timing', duration: 900, loop: true, repeatReverse: false }}
              >
                <Ionicons name="sync-outline" size={18} color={theme.colors.primary} />
              </MotiView>
              <Text style={[styles.checkingText, { color: theme.colors.primary }]}>
                Checking if we’re back…
              </Text>
            </View>
          ) : (
            <>
              <Text style={[styles.eyebrow, { color: theme.colors.textSecondary }]}>
                BACK IN
              </Text>
              {/* No `key` here on purpose. Re-mounting on every poll would
                  throw away the local tick and restart the timer chain, which
                  shows as a one-second stutter every thirty seconds. The effect
                  inside re-seeds from a changed `seconds` instead, which is the
                  same correction without the churn. */}
              <Countdown
                seconds={info.secondsRemaining}
                onFinish={onCountdownFinished}
                theme={theme}
              />
              {!!info.endsAtLabel && (
                <Text style={[styles.endsAt, { color: theme.colors.textSecondary }]}>
                  Scheduled to return at {info.endsAtLabel}
                </Text>
              )}
            </>
          )}

          {/* Says plainly that this is not their phone's fault, and not
              something they can tap their way out of. */}
          <View style={[styles.footer, { borderTopColor: theme.colors.border }]}>
            <Text style={[styles.footerText, { color: theme.colors.textSecondary }]}>
              {info.fromCache
                ? 'Showing the last scheduled window — your device can’t reach IECE right now.'
                : 'No action is needed. The app opens by itself when maintenance finishes.'}
            </Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  bubble: { position: 'absolute' },
  content: { alignItems: 'center', paddingHorizontal: 30, maxWidth: 460, width: '100%' },

  glow: { position: 'absolute' },
  dot: { position: 'absolute', top: '50%', left: '50%', width: 6, height: 6, borderRadius: 3 },
  logoPlate: {
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } },
      android: { elevation: 6 },
      default: {},
    }),
  },
  logoImage: { width: '74%', height: '74%' },

  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginTop: 26,
  },
  badgeText: { fontSize: 10.5, fontWeight: '900', letterSpacing: 1 },

  title: { fontSize: 24, fontWeight: '800', marginTop: 16, textAlign: 'center' },
  message: { fontSize: 14, lineHeight: 21, marginTop: 10, textAlign: 'center' },

  eyebrow: { fontSize: 10.5, fontWeight: '900', letterSpacing: 1.6, marginTop: 26 },
  clock: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 12 },
  unit: { alignItems: 'center' },
  digitBox: {
    minWidth: 62,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
  },
  digits: {
    fontSize: 28,
    fontWeight: '800',
    // A monospaced face so the two digits inside the box do not shift either.
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },
  colon: { fontSize: 24, fontWeight: '800', marginHorizontal: 6, marginTop: 12 },
  unitLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, marginTop: 6, textTransform: 'uppercase' },

  endsAt: { fontSize: 12.5, fontWeight: '600', marginTop: 16, textAlign: 'center' },

  noEta: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginTop: 24,
  },
  noEtaText: { flex: 1, fontSize: 12.5, lineHeight: 18 },

  checking: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 30, height: 90 },
  checkingText: { fontSize: 14, fontWeight: '700' },

  footer: { borderTopWidth: 1, marginTop: 30, paddingTop: 16, width: '100%' },
  footerText: { fontSize: 12, lineHeight: 18, textAlign: 'center' },
});
