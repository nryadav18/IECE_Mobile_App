import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { CameraView, Camera } from 'expo-camera';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { MotiView, MotiText } from 'moti';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ensureLocationReady,
  acquireAccurateLocation,
  LocationCancelled,
  ATTENDANCE_FIX,
} from '../utils/location';

const RECORD_SECONDS = 3;

// A fix this recent is reused instead of locating again, so the common case
// (user opens the screen, reads the guide, taps) starts instantly. Anything
// that already resolved has passed the accuracy gate, so only age matters —
// and in half a minute nobody walks out of a geofence on foot.
const FRESH_FIX_MS = 30000;

/**
 * Reusable, guided face-capture experience used by both Face Registration and
 * Check In / Check Out.
 *
 * Props:
 *  - title:        big heading (e.g. "Face Check In")
 *  - subtitle:     short helper under the title
 *  - actionVerb:   verb used on the record button ("Register", "Check In", ...)
 *  - accentColor:  primary accent (defaults to a neutral blue)
 *  - onSubmit(video, location) => Promise   // location is { lat, lng, accuracy }
 *  - onSuccess(result)                       // called after onSubmit resolves
 *  - onError(message)                        // called when something fails
 *  - onCancel()                              // back button before recording
 *  - locationOptions: how precise the GPS fix must be. Defaults to the
 *    everyday ATTENDANCE_FIX; face registration passes the stricter
 *    REGISTRATION_FIX because that fix is stored as a permanent anchor.
 *  - locationRequired: whether a fix is a precondition at all. True everywhere
 *    a geofence is enforced — no fix, no attendance. FALSE for anonymous-
 *    location staff, whose position is never compared to anything: their
 *    location is recorded when the phone can supply one and simply omitted
 *    when it cannot, rather than standing between them and their attendance.
 *    `onSubmit` then receives `null` for location.
 */
export default function FaceCapture({
  title = 'Face Scan',
  subtitle = 'Center your face and follow the steps',
  actionVerb = 'Scan',
  accentColor = '#3B82F6',
  onSubmit,
  onSuccess,
  onError,
  onCancel,
  locationOptions = ATTENDANCE_FIX,
  locationRequired = true,
}) {
  const insets = useSafeAreaInsets();
  const cameraRef = useRef(null);

  const [hasPermission, setHasPermission] = useState(null);
  const [phase, setPhase] = useState('guide'); // 'guide' | 'locating' | 'recording' | 'processing'
  const [countdown, setCountdown] = useState(RECORD_SECONDS);
  // Best GPS uncertainty seen so far, in metres — surfaced so the user can see
  // the lock tighten instead of staring at a spinner.
  const [accuracy, setAccuracy] = useState(null);
  const countdownRef = useRef(null);
  // Last precise fix we obtained, with the time we obtained it.
  const warmFixRef = useRef(null);
  // The warm-up acquisition while it is still running, so tapping Record joins
  // it instead of opening a second receiver session alongside it.
  const pendingFixRef = useRef(null);
  // Lets us tear the GPS watch down when the screen closes mid-acquisition,
  // instead of leaving the receiver running in the background.
  const abortRef = useRef(null);
  const mountedRef = useRef(true);

  const trackAccuracy = ({ accuracy: acc }) => {
    if (mountedRef.current) setAccuracy(acc);
  };

  const startAcquisition = () => {
    const controller = new AbortController();
    abortRef.current = controller;

    const promise = ensureLocationReady()
      .then(() => acquireAccurateLocation({
        ...locationOptions,
        onProgress: trackAccuracy,
        signal: controller.signal,
      }))
      .then((fix) => {
        warmFixRef.current = { fix, at: Date.now() };
        if (mountedRef.current) setAccuracy(fix.accuracy);
        return fix;
      })
      .finally(() => {
        if (pendingFixRef.current === promise) pendingFixRef.current = null;
        if (abortRef.current === controller) abortRef.current = null;
      });

    pendingFixRef.current = promise;
    return promise;
  };

  useEffect(() => {
    mountedRef.current = true;

    (async () => {
      const { status: cameraStatus } = await Camera.requestCameraPermissionsAsync();
      const { status: micStatus } = await Camera.requestMicrophonePermissionsAsync();
      const { status: locationStatus } = await Location.requestForegroundPermissionsAsync();
      if (!mountedRef.current) return;

      // Location is only a hard requirement where it decides something. For
      // anonymous-location staff the camera and microphone are enough.
      const mediaOk = cameraStatus === 'granted' && micStatus === 'granted';
      setHasPermission(locationRequired ? mediaOk && locationStatus === 'granted' : mediaOk);
      if (locationStatus !== 'granted') return;

      // Warm the GPS receiver up while the user reads the on-screen guide, so
      // by the time they tap Record there is usually a tight fix waiting.
      // Any failure here is silent — the user hasn't asked for anything yet,
      // and Record retries and surfaces the real error then.
      startAcquisition().catch(() => {});
    })();

    return () => {
      mountedRef.current = false;
      if (countdownRef.current) clearInterval(countdownRef.current);
      // Stop the GPS watch if the user walked away mid-lock.
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  // Resolve a fix good enough to anchor / verify attendance, reusing the
  // warm-up result while it is still recent.
  const resolveLocation = async () => {
    const warm = warmFixRef.current;
    if (warm && Date.now() - warm.at < FRESH_FIX_MS) {
      return warm.fix;
    }

    setPhase('locating');

    // Join the warm-up if it is still in flight; only fall back to a fresh
    // acquisition if it has finished (or failed) already.
    if (pendingFixRef.current) {
      try {
        return await pendingFixRef.current;
      } catch (e) {
        if (e instanceof LocationCancelled) throw e;
        // Otherwise fall through and try once more — GPS may have come good
        // since the warm-up gave up.
      }
    }

    if (!mountedRef.current) throw new LocationCancelled();
    return startAcquisition();
  };

  const startCountdown = () => {
    setCountdown(RECORD_SECONDS);
    countdownRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(countdownRef.current);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  };

  const handleRecord = async () => {
    if (!cameraRef.current || phase !== 'guide') return;

    // Pin down where we are BEFORE recording. Attendance is only as trustworthy
    // as this fix, so a vague or stale one stops the flow here rather than
    // being saved and breaking every future check-in.
    let location = null;
    try {
      location = await resolveLocation();
    } catch (err) {
      // A cancellation means the screen closed — there is nobody to tell.
      if (!mountedRef.current || err instanceof LocationCancelled) return;
      // Where location decides nothing, failing to get one is not a failure:
      // carry on and record the attendance without it.
      if (locationRequired) {
        setPhase('guide');
        onError && onError(err?.message || 'Could not get your location. Please try again.');
        return;
      }
      location = null;
    }
    if (!mountedRef.current) return;

    try {
      setPhase('recording');
      startCountdown();
      // Record a short video so the backend can detect a live blink.
      const video = await cameraRef.current.recordAsync({ maxDuration: RECORD_SECONDS });
      if (countdownRef.current) clearInterval(countdownRef.current);

      // Guard: never submit unless we actually captured a usable video file.
      // (Recording can resolve empty if the camera was interrupted or the user
      //  left the screen.) Stay on the camera and ask them to try again.
      if (!video || !video.uri) {
        setPhase('guide');
        onError && onError('No video was captured. Please keep your face in the frame and try again.');
        return;
      }

      // Switch to the dedicated waiting screen (camera goes away).
      setPhase('processing');
      try {
        const result = await onSubmit(video, location);
        // Only treat as done when the backend confirms a valid, accepted face.
        if (!result || result.success === false) {
          throw new Error(result?.message || 'Face not accepted. Please try again.');
        }
        onSuccess && onSuccess(result);
      } catch (err) {
        const msg = err?.response?.data?.message || err?.message || 'Face could not be verified. Please try again.';
        // Return to the camera so the user can re-record; nothing is saved.
        setPhase('guide');
        onError && onError(msg);
      }
    } catch (err) {
      if (countdownRef.current) clearInterval(countdownRef.current);
      setPhase('guide');
      onError && onError('Failed to record. Please try again.');
    }
  };

  /* ---------- Permission / loading states ---------- */
  if (hasPermission === null) {
    return (
      <View style={styles.fullCenter}>
        <ActivityIndicator size="large" color={accentColor} />
        <Text style={styles.loadingText}>Preparing camera…</Text>
      </View>
    );
  }

  if (hasPermission === false) {
    return (
      <View style={[styles.fullCenter, { padding: 32 }]}>
        <View style={[styles.permIcon, { backgroundColor: accentColor + '22' }]}>
          <Ionicons name="lock-closed-outline" size={40} color={accentColor} />
        </View>
        <Text style={styles.permTitle}>Permissions needed</Text>
        <Text style={styles.permText}>
          We need access to your camera, microphone and location to verify your attendance.
          Please enable them in Settings.
        </Text>
        <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: accentColor }]} onPress={() => onCancel && onCancel()}>
          <Text style={styles.primaryBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  /* ---------- Processing / waiting screen (no camera) ---------- */
  if (phase === 'processing') {
    return <WaitingScreen accentColor={accentColor} insets={insets} actionVerb={actionVerb} />;
  }

  /* ---------- Camera + guided overlay ---------- */
  const recording = phase === 'recording';
  const locating = phase === 'locating';
  const busy = recording || locating;

  return (
    <View style={styles.container}>
      {/* Overlay is a CHILD of CameraView: native camera surfaces must own their
          own view layer or the preview can render black behind sibling views. */}
      <CameraView style={styles.camera} facing="front" mode="video" ref={cameraRef}>
      <View style={[styles.overlay, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }]} pointerEvents="box-none">
        {/* Header */}
        <View style={styles.header} pointerEvents="box-none">
          {!busy ? (
            <TouchableOpacity style={styles.backBtn} onPress={() => onCancel && onCancel()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="chevron-back" size={26} color="#fff" />
            </TouchableOpacity>
          ) : (
            <View style={styles.backBtn} />
          )}
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
          </View>
          <View style={styles.backBtn} />
        </View>

        {/* GPS lock indicator — the whole flow hinges on this fix, so its
            quality is shown rather than hidden behind a spinner. */}
        <GpsPill
          accuracy={accuracy}
          locating={locating}
          accentColor={accentColor}
          targetAccuracy={locationOptions.targetAccuracyM}
        />

        {/* Center face guide */}
        <View style={styles.centerArea} pointerEvents="none">
          <MotiView
            from={{ scale: 1, opacity: 0.7 }}
            animate={{ scale: recording ? 1.04 : 1, opacity: 1 }}
            transition={{ type: 'timing', duration: 900, loop: true, repeatReverse: true }}
            style={[styles.faceFrame, { borderColor: recording ? accentColor : 'rgba(255,255,255,0.85)' }]}
          >
            {/* Corner accents */}
            <View style={[styles.corner, styles.cornerTL, { borderColor: accentColor }]} />
            <View style={[styles.corner, styles.cornerTR, { borderColor: accentColor }]} />
            <View style={[styles.corner, styles.cornerBL, { borderColor: accentColor }]} />
            <View style={[styles.corner, styles.cornerBR, { borderColor: accentColor }]} />

            {recording && (
              <View style={styles.countdownWrap}>
                <Text style={[styles.countdownNum, { color: accentColor }]}>{countdown > 0 ? countdown : ''}</Text>
              </View>
            )}
          </MotiView>
        </View>

        {/* Bottom guidance + control */}
        <View style={styles.bottomArea} pointerEvents="box-none">
          {recording ? (
            <BlinkCue accentColor={accentColor} />
          ) : locating ? (
            <LocatingCue accentColor={accentColor} accuracy={accuracy} />
          ) : (
            <GuideSteps accentColor={accentColor} />
          )}

          <TouchableOpacity
            style={[styles.recordBtn, { borderColor: accentColor + '88' }, busy && { opacity: 0.6 }]}
            onPress={handleRecord}
            disabled={busy}
            activeOpacity={0.85}
          >
            <View style={[styles.recordInner, { backgroundColor: accentColor }]}>
              {locating ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name={recording ? 'ellipse' : 'scan'} size={recording ? 26 : 34} color="#fff" />
              )}
            </View>
          </TouchableOpacity>
          <Text style={styles.btnLabel}>
            {recording
              ? `Recording… keep blinking (${countdown}s)`
              : locating
                ? 'Pinpointing your location…'
                : `Tap to ${actionVerb}`}
          </Text>
        </View>
      </View>
      </CameraView>
    </View>
  );
}

/* ===================== Sub-components ===================== */

// Small status pill showing how tight the GPS lock currently is. Green once the
// fix is precise enough to anchor attendance, amber while it is still coarse.
function GpsPill({ accuracy, locating, accentColor, targetAccuracy }) {
  const locked = accuracy != null && accuracy <= targetAccuracy;
  const color = locked ? '#34D399' : accuracy != null ? '#FBBF24' : '#94A3B8';

  const label = locating
    ? 'Locking on to GPS…'
    : accuracy == null
      ? 'Finding your location…'
      : locked
        ? `Location locked · ±${accuracy} m`
        : `Improving accuracy · ±${accuracy} m`;

  return (
    <View style={styles.gpsPillWrap} pointerEvents="none">
      <View style={styles.gpsPill}>
        {accuracy == null || locating ? (
          <ActivityIndicator size="small" color={accentColor} style={{ marginRight: 8 }} />
        ) : (
          <Ionicons
            name={locked ? 'location' : 'location-outline'}
            size={14}
            color={color}
            style={{ marginRight: 6 }}
          />
        )}
        <Text style={[styles.gpsPillText, { color }]}>{label}</Text>
      </View>
    </View>
  );
}

// Shown in place of the guide steps while we wait for a precise fix.
function LocatingCue({ accentColor, accuracy }) {
  return (
    <View style={styles.blinkCard}>
      <MotiView
        from={{ scale: 0.9 }}
        animate={{ scale: 1.1 }}
        transition={{ type: 'timing', duration: 800, loop: true, repeatReverse: true }}
        style={[styles.blinkIconWrap, { backgroundColor: accentColor + '33' }]}
      >
        <Ionicons name="navigate" size={30} color="#fff" />
      </MotiView>
      <Text style={styles.blinkTitle}>Getting your exact location</Text>
      <Text style={styles.blinkSub}>
        {accuracy != null
          ? `Accurate to ±${accuracy} m — hold still a moment`
          : 'Stay still, ideally near a window or outdoors'}
      </Text>
    </View>
  );
}

// Animated, looping eye that opens & closes to cue the user to blink.
function BlinkCue({ accentColor }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    const id = setInterval(() => setOpen((o) => !o), 650);
    return () => clearInterval(id);
  }, []);
  return (
    <View style={styles.blinkCard}>
      <MotiView
        from={{ scale: 0.9 }}
        animate={{ scale: 1.1 }}
        transition={{ type: 'timing', duration: 650, loop: true, repeatReverse: true }}
        style={[styles.blinkIconWrap, { backgroundColor: accentColor + '33' }]}
      >
        <Ionicons name={open ? 'eye-outline' : 'eye-off-outline'} size={34} color="#fff" />
      </MotiView>
      <Text style={styles.blinkTitle}>Blink your eyes now</Text>
      <Text style={styles.blinkSub}>Blink slowly 2–3 times and hold still</Text>
    </View>
  );
}

// Pre-recording checklist that gently fades/slides in.
function GuideSteps({ accentColor }) {
  const steps = [
    { icon: 'person-outline', text: 'Center your face in the frame' },
    { icon: 'sunny-outline', text: 'Make sure your face is well lit' },
    { icon: 'eye-outline', text: 'After you tap, blink 2–3 times' },
  ];
  return (
    <View style={styles.guideCard}>
      {steps.map((s, i) => (
        <MotiView
          key={s.text}
          from={{ opacity: 0, translateY: 10 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 350, delay: i * 130 }}
          style={styles.guideRow}
        >
          <View style={[styles.guideIcon, { backgroundColor: accentColor + '33' }]}>
            <Ionicons name={s.icon} size={16} color="#fff" />
          </View>
          <Text style={styles.guideText}>{s.text}</Text>
        </MotiView>
      ))}
    </View>
  );
}

// Full-screen waiting state shown while the video uploads / is verified.
function WaitingScreen({ accentColor, insets, actionVerb }) {
  const warnings = [
    { icon: 'close-circle-outline', text: "Don't close or minimize the app" },
    { icon: 'phone-portrait-outline', text: "Don't switch to another app" },
    { icon: 'lock-closed-outline', text: "Don't lock your screen" },
    { icon: 'body-outline', text: 'Stay still until it finishes' },
  ];
  return (
    <View style={[styles.waitRoot, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}>
      {/* Pulsing rings around a scan icon */}
      <View style={styles.pulseWrap}>
        {[0, 1, 2].map((i) => (
          <MotiView
            key={i}
            from={{ scale: 0.6, opacity: 0.6 }}
            animate={{ scale: 1.8, opacity: 0 }}
            transition={{ type: 'timing', duration: 2000, loop: true, delay: i * 600 }}
            style={[styles.pulseRing, { borderColor: accentColor }]}
          />
        ))}
        <View style={[styles.pulseCore, { backgroundColor: accentColor }]}>
          <Ionicons name="scan-outline" size={44} color="#fff" />
        </View>
      </View>

      <MotiText
        from={{ opacity: 0.4 }}
        animate={{ opacity: 1 }}
        transition={{ type: 'timing', duration: 800, loop: true, repeatReverse: true }}
        style={styles.waitTitle}
      >
        Verifying your face…
      </MotiText>
      <Text style={styles.waitSub}>
        This usually takes a few seconds. Please keep the app open while we {actionVerb.toLowerCase()} you.
      </Text>

      {/* Indeterminate progress bar */}
      <View style={styles.progressTrack}>
        <MotiView
          from={{ translateX: -120 }}
          animate={{ translateX: 260 }}
          transition={{ type: 'timing', duration: 1100, loop: true }}
          style={[styles.progressChunk, { backgroundColor: accentColor }]}
        />
      </View>

      {/* Do-not list */}
      <View style={styles.warnCard}>
        <Text style={styles.warnHeading}>Please do not</Text>
        {warnings.map((w) => (
          <View key={w.text} style={styles.warnRow}>
            <Ionicons name={w.icon} size={18} color="#FCA5A5" style={{ marginRight: 10 }} />
            <Text style={styles.warnText}>{w.text}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.waitFooter}>Hang tight — almost there.</Text>
    </View>
  );
}

/* ===================== Styles ===================== */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  fullCenter: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0B1220' },
  loadingText: { color: '#cbd5e1', marginTop: 14, fontSize: 15 },

  // Permission screen
  permIcon: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  permTitle: { color: '#fff', fontSize: 22, fontWeight: '800', marginBottom: 10 },
  permText: { color: '#94a3b8', fontSize: 14, textAlign: 'center', lineHeight: 21, marginBottom: 24 },
  primaryBtn: { paddingHorizontal: 28, paddingVertical: 14, borderRadius: 14 },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },

  // Overlay
  overlay: { flex: 1, justifyContent: 'space-between', paddingHorizontal: 20 },
  header: { flexDirection: 'row', alignItems: 'center' },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)' },
  title: { color: '#fff', fontSize: 20, fontWeight: '800', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6 },
  subtitle: { color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 2, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6 },

  // GPS status pill
  gpsPillWrap: { alignItems: 'center', marginTop: 12 },
  gpsPill: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
  },
  gpsPillText: { fontSize: 12.5, fontWeight: '700' },

  // Center face guide
  centerArea: { alignItems: 'center', justifyContent: 'center', flex: 1 },
  faceFrame: {
    width: 240, height: 300, borderRadius: 150,
    borderWidth: 3,
    alignItems: 'center', justifyContent: 'center',
  },
  corner: { position: 'absolute', width: 28, height: 28, borderColor: '#fff' },
  cornerTL: { top: 18, left: 30, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 12 },
  cornerTR: { top: 18, right: 30, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 12 },
  cornerBL: { bottom: 18, left: 30, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 12 },
  cornerBR: { bottom: 18, right: 30, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 12 },
  countdownWrap: { alignItems: 'center', justifyContent: 'center' },
  countdownNum: { fontSize: 96, fontWeight: '900', textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 10 },

  // Bottom area
  bottomArea: { alignItems: 'center' },
  recordBtn: {
    width: 84, height: 84, borderRadius: 42,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 4, backgroundColor: 'rgba(0,0,0,0.25)', marginTop: 6,
  },
  recordInner: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  btnLabel: { color: '#fff', marginTop: 12, fontWeight: '700', fontSize: 14, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6 },

  // Guide card
  guideCard: { backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 16, padding: 14, width: '100%', marginBottom: 16 },
  guideRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  guideIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  guideText: { color: '#fff', fontSize: 14, fontWeight: '600', flex: 1 },

  // Blink cue
  blinkCard: { backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 18, paddingVertical: 16, paddingHorizontal: 24, alignItems: 'center', marginBottom: 16, alignSelf: 'stretch' },
  blinkIconWrap: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  blinkTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  blinkSub: { color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 4 },

  // Waiting screen
  waitRoot: { flex: 1, backgroundColor: '#0B1220', alignItems: 'center', paddingHorizontal: 28 },
  pulseWrap: { width: 180, height: 180, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  pulseRing: { position: 'absolute', width: 120, height: 120, borderRadius: 60, borderWidth: 2 },
  pulseCore: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center' },
  waitTitle: { color: '#fff', fontSize: 22, fontWeight: '800', marginTop: 28, textAlign: 'center' },
  waitSub: { color: '#94a3b8', fontSize: 14, textAlign: 'center', lineHeight: 21, marginTop: 10 },
  progressTrack: { width: 220, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden', marginTop: 22 },
  progressChunk: { width: 90, height: 6, borderRadius: 3 },
  warnCard: { backgroundColor: 'rgba(239,68,68,0.10)', borderColor: 'rgba(239,68,68,0.35)', borderWidth: 1, borderRadius: 16, padding: 16, width: '100%', marginTop: 28 },
  warnHeading: { color: '#FCA5A5', fontSize: 13, fontWeight: '800', letterSpacing: 0.5, marginBottom: 10, textTransform: 'uppercase' },
  warnRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5 },
  warnText: { color: '#fecaca', fontSize: 14, fontWeight: '600', flex: 1 },
  waitFooter: { color: '#64748b', fontSize: 13, marginTop: 'auto' },
});
