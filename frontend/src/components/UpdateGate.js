/**
 * The update gate.
 *
 * Not a reminder — a gate. If the installed build is behind what is live in
 * the store, this puts an opaque, undismissable screen in front of the entire
 * app. There is no Later, no back button out, and no exception for admins.
 * Nobody uses IECE on an old build.
 *
 * Mounted above the navigator, so it also covers the login screen: a build too
 * old to sign in is exactly the one that most needs updating.
 *
 * ── The one thing this deliberately does NOT do ──────────────────────────
 * It never blocks on a failed check. No network, backend unreachable, nothing
 * configured, a version string that won't parse — every one of those results
 * in no gate at all.
 *
 * That is not a softening of the rule, it is what makes the rule safe. This
 * screen sits in front of everything for every user simultaneously, so a
 * five-minute API outage that was allowed to "fail closed" would lock the
 * entire company out of an app that otherwise works offline — trainers mid-
 * visit included — and the people who could fix it would be locked out too.
 * A block is only ever raised on a positive, verified answer that a newer
 * version genuinely exists.
 *
 * ── Where the version comes from ─────────────────────────────────────────
 * `frontend/app.json` — the same field baked into the builds you submit. There
 * is nothing to configure and no admin screen: bump it, redeploy the backend,
 * and every older install is gated on its next launch.
 *
 * ── Getting back out ─────────────────────────────────────────────────────
 * If a wrong version ever ships, everyone is gated at once. Fix `app.json` and
 * redeploy — the server re-reads it within a minute. For an immediate stop,
 * set `UPDATE_GATE_DISABLED=true` in the backend environment and restart.
 */

import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MotiView } from 'moti';
import { ThemeContext } from '../context/ThemeContext';
import { checkForUpdate, openStore } from '../services/appVersion';

/** How long "Later" holds back a NON-blocking prompt (strict mode turned off). */
const SNOOZE_MS = 4 * 60 * 60 * 1000;
const SNOOZE_KEY = 'update:snoozedUntil';

export default function UpdateGate() {
  const { theme } = useContext(ThemeContext);
  const [info, setInfo] = useState(null);
  const [checking, setChecking] = useState(false);

  // A ref, not state: read inside listeners that must not be torn down and
  // re-attached every time the value changes.
  const snoozedUntil = useRef(0);

  const run = useCallback(async ({ respectSnooze }) => {
    const result = await checkForUpdate();
    if (!result) {
      // Nothing to say — including every failure path. Fail open, always.
      setInfo(null);
      return;
    }

    // A required update ignores every quiet period. In strict mode (the
    // default) every update is required, so this branch simply never runs.
    if (!result.required && respectSnooze) {
      if (Date.now() < snoozedUntil.current) return;
      try {
        const stored = Number(await AsyncStorage.getItem(SNOOZE_KEY)) || 0;
        if (Date.now() < stored) return;
      } catch {
        // A storage read failing is not a reason to hide the prompt.
      }
    }

    setInfo(result);
  }, []);

  /* Cold start. */
  useEffect(() => {
    run({ respectSnooze: false });
  }, [run]);

  /* Returning from the background — re-check, so someone who has just
     updated is let straight back in, and someone who hasn't stays gated. */
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') run({ respectSnooze: true });
    });
    return () => sub.remove();
  }, [run]);

  /* Android hardware back is swallowed entirely while the gate is up.
     `onRequestClose` alone does not stop every path to a back action. */
  const blocking = !!info?.required;
  useEffect(() => {
    if (!blocking) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [blocking]);

  const onUpdate = () => openStore(info?.storeUrl);

  /**
   * "I've updated" — re-runs the check.
   *
   * A store update normally kills and relaunches the app, which clears the
   * gate on its own. This exists for the cases where it doesn't: the store
   * link failing to open, an update that installs without a restart, a device
   * that returns from Play in an odd state. Without it, a user in that
   * position has no way forward at all, and "no way forward" on a blocking
   * screen is a support call, not a design.
   */
  const onRecheck = async () => {
    setChecking(true);
    try {
      await run({ respectSnooze: false });
    } finally {
      setChecking(false);
    }
  };

  const onLater = async () => {
    const until = Date.now() + SNOOZE_MS;
    snoozedUntil.current = until;
    try {
      await AsyncStorage.setItem(SNOOZE_KEY, String(until));
    } catch {
      // In-memory snooze only is an acceptable degradation.
    }
    setInfo(null);
  };

  if (!info) return null;

  const c = theme.colors;
  const storeName = Platform.OS === 'ios' ? 'App Store' : 'Play Store';

  return (
    <Modal
      visible
      transparent={!blocking}
      animationType="fade"
      onRequestClose={() => {
        if (!blocking) onLater();
      }}
      // Without both of these an Android transparent modal draws a black
      // border and visibly shrinks the app behind it.
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View
        style={[
          styles.backdrop,
          blocking
            ? // Opaque: nothing behind the gate is readable, and nothing behind
              // it is reachable either.
              { backgroundColor: c.background }
            : { backgroundColor: 'rgba(0,0,0,0.55)' },
        ]}
      >
        <MotiView
          from={{ opacity: 0, scale: 0.92, translateY: 14 }}
          animate={{ opacity: 1, scale: 1, translateY: 0 }}
          transition={{ type: 'spring', damping: 17, stiffness: 190 }}
          style={[
            styles.card,
            {
              backgroundColor: c.surface,
              borderColor: blocking ? withA(c.primary, 0.35) : c.border,
            },
          ]}
        >
          <View style={[styles.icon, { backgroundColor: withA(c.primary, 0.12) }]}>
            <Ionicons
              name={blocking ? 'lock-closed-outline' : 'cloud-download-outline'}
              size={28}
              color={c.primary}
            />
          </View>

          <Text style={[styles.title, { color: c.textPrimary }]}>
            {blocking ? 'Update required' : 'Update available'}
          </Text>

          <Text style={[styles.body, { color: c.textSecondary }]}>
            {blocking
              ? `IECE ${info.latest} is out. This update is required — please install it from the ${storeName} to continue using the app.`
              : `A new version of IECE is ready on the ${storeName}.`}
          </Text>

          <View style={[styles.versions, { backgroundColor: c.background, borderColor: c.border }]}>
            <View style={styles.versionCol}>
              <Text style={[styles.versionLabel, { color: c.textSecondary }]}>You have</Text>
              <Text style={[styles.versionValue, { color: c.textSecondary }]}>
                {info.current || '—'}
              </Text>
            </View>
            <Ionicons name="arrow-forward" size={16} color={c.textSecondary} />
            <View style={styles.versionCol}>
              <Text style={[styles.versionLabel, { color: c.primary }]}>Latest</Text>
              <Text style={[styles.versionValue, { color: c.primary }]}>{info.latest}</Text>
            </View>
          </View>

          {!!info.releaseNotes && (
            <ScrollView
              style={styles.notes}
              contentContainerStyle={{ paddingVertical: 2 }}
              nestedScrollEnabled
            >
              <Text style={[styles.notesText, { color: c.textSecondary }]}>{info.releaseNotes}</Text>
            </ScrollView>
          )}

          <TouchableOpacity
            onPress={onUpdate}
            activeOpacity={0.85}
            style={[styles.primary, { backgroundColor: c.primary }]}
            accessibilityRole="button"
            accessibilityLabel={`Update now on the ${storeName}`}
          >
            <Ionicons name="rocket-outline" size={17} color="#FFFFFF" />
            <Text style={styles.primaryText}>Update now</Text>
          </TouchableOpacity>

          {blocking ? (
            <TouchableOpacity
              onPress={onRecheck}
              disabled={checking}
              style={styles.later}
              accessibilityRole="button"
            >
              {checking ? (
                <ActivityIndicator size="small" color={c.textSecondary} />
              ) : (
                <Text style={[styles.laterText, { color: c.textSecondary }]}>
                  I’ve already updated — check again
                </Text>
              )}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={onLater} style={styles.later} accessibilityRole="button">
              <Text style={[styles.laterText, { color: c.textSecondary }]}>Later</Text>
            </TouchableOpacity>
          )}
        </MotiView>
      </View>
    </Modal>
  );
}

/** Local alpha helper — this file must not depend on the celebration module. */
function withA(hex, alpha) {
  if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 26,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 22,
    paddingTop: 26,
    paddingBottom: 18,
    alignItems: 'center',
    ...Platform.select({
      ios: { shadowOpacity: 0.22, shadowRadius: 24, shadowOffset: { width: 0, height: 10 } },
      android: { elevation: 10 },
      default: {},
    }),
  },
  icon: {
    width: 62,
    height: 62,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  title: { fontSize: 20, fontWeight: '900', letterSpacing: -0.4, textAlign: 'center' },
  body: { fontSize: 13, fontWeight: '600', lineHeight: 19, textAlign: 'center', marginTop: 7 },
  versions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    alignSelf: 'stretch',
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 11,
    marginTop: 16,
  },
  versionCol: { alignItems: 'center', minWidth: 74 },
  versionLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  versionValue: { fontSize: 16, fontWeight: '900', letterSpacing: -0.3, marginTop: 2 },
  notes: { alignSelf: 'stretch', maxHeight: 116, marginTop: 14 },
  notesText: { fontSize: 12.5, fontWeight: '600', lineHeight: 18 },
  primary: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 50,
    borderRadius: 15,
    marginTop: 18,
  },
  primaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  later: { paddingVertical: 12, paddingHorizontal: 18, marginTop: 4, minHeight: 42 },
  laterText: { fontSize: 13, fontWeight: '700' },
});
