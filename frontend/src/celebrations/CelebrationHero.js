/**
 * The celebration header.
 *
 * What replaces `BrandHero` on a day the app is celebrating. It paints the
 * whole top region — status-bar strip included — and carries the wish.
 *
 * On a day with more than one occasion (21 June is both International Yoga Day
 * and IECE's own anniversary; 14 April is Ambedkar Jayanti and Puthandu) the
 * occasions take turns, highest priority first, handing off every few seconds.
 *
 * The hand-off is a **slide, not a cross-fade**, and that is a performance
 * decision rather than an aesthetic one: fading between two full-size scenes
 * means compositing the entire header into an offscreen buffer twice a
 * transition, which is the single most expensive thing this screen could do.
 * Sliding is pure transform, so it costs nothing beyond the two scenes being
 * briefly alive at once — and it reads better anyway, as one celebration
 * making way for the next.
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AnimatePresence, MotiView } from 'moti';
import { themeForOccasion, withAlpha } from './palette';
import { sceneFor } from './scenes';

/** How the subtitle resolves — it may be a plain string or a fn(date). */
export function subtitleFor(occasion, date) {
  const s = occasion.subtitle;
  if (typeof s === 'function') {
    try {
      return s(date);
    } catch {
      return '';
    }
  }
  return s || '';
}

/** The wish, personalised when we know who is reading it. */
export function wishFor(occasion, firstName) {
  const wish = occasion.wish || occasion.name;
  return firstName ? `${wish}, ${firstName}` : wish;
}

export default function CelebrationHero({
  occasions,
  index = 0,
  date = new Date(),
  isDark,
  width,
  height,
  /** Height of the floating bar above, so the wish never sits under it. */
  topPad = 0,
  firstName,
  logoSource,
  paused,
}) {
  const occasion = occasions[index % occasions.length];
  const look = useMemo(() => themeForOccasion(occasion, isDark), [occasion, isDark]);
  const Scene = sceneFor(occasion.scene);

  const subtitle = subtitleFor(occasion, date);
  const wish = wishFor(occasion, firstName);
  const many = occasions.length > 1;

  return (
    <View style={[styles.hero, { height }]}>
      <AnimatePresence>
        <MotiView
          // Keyed on the occasion, so a hand-off mounts the next scene and
          // slides the previous one out. Transform only — see the file note.
          key={occasion.key}
          from={{ translateX: width }}
          animate={{ translateX: 0 }}
          exit={{ translateX: -width }}
          // Reduced motion (or off-screen) turns the slide into a cut. The
          // occasions still take their turn — only the movement goes.
          transition={{ type: 'timing', duration: paused ? 0 : 520 }}
          style={StyleSheet.absoluteFill}
        >
          <Scene
            occasion={occasion}
            look={look}
            width={width}
            height={height}
            date={date}
            paused={paused}
            logoSource={logoSource}
          />

          {/* The wish, anchored to the bottom of the header. The height cap is
              what actually keeps it clear of the floating bar: on a short
              header — the admin preview, or a small phone in landscape — a
              long wish would otherwise grow upward into it. */}
          <View
            style={[styles.textWrap, { maxHeight: Math.max(110, height - topPad) }]}
            pointerEvents="none"
          >
            <View
              style={[
                styles.scrim,
                { backgroundColor: withAlpha(look.scrim.color, look.scrim.alpha) },
              ]}
            />

            <View style={[styles.chip, { backgroundColor: look.chip }]}>
              <Ionicons name={occasion.emblem || 'sparkles-outline'} size={13} color={look.ink} />
              <Text style={[styles.chipText, { color: look.ink }]} numberOfLines={1}>
                {occasion.name}
              </Text>
            </View>

            <Text
              style={[styles.wish, { color: look.ink }]}
              numberOfLines={2}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
            >
              {wish}
            </Text>

            {!!subtitle && (
              <Text style={[styles.subtitle, { color: look.inkSoft }]} numberOfLines={1}>
                {subtitle}
              </Text>
            )}

            {/* Who the day is about, in full. Deliberately the smallest thing
                here: "Mohandas Karamchand Gandhi" is long, and it earns its
                place by being complete, not by being loud. Two lines and
                `adjustsFontSizeToFit` mean it stays inside the header on a
                small phone and in the shrunken admin preview alike. */}
            {!!occasion.person && (
              <Text
                style={[styles.person, { color: look.inkFaint }]}
                numberOfLines={2}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
              >
                {occasion.person}
              </Text>
            )}

            {many && (
              <View style={styles.pips}>
                {occasions.map((o, i) => (
                  <View
                    key={o.key}
                    style={[
                      styles.pip,
                      {
                        backgroundColor: i === index % occasions.length ? look.ink : look.inkFaint,
                        width: i === index % occasions.length ? 16 : 6,
                      },
                    ]}
                  />
                ))}
              </View>
            )}
          </View>
        </MotiView>
      </AnimatePresence>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { width: '100%', overflow: 'hidden' },
  textWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 22,
    paddingBottom: 20,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  // A soft plate behind the text. Deliberately understated — enough to
  // guarantee contrast, not enough to look like a box pasted over the artwork.
  //
  // Offsets in points, not percentages: this box is auto-height, and a
  // percentage `top` has no definite height to resolve against.
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    top: -16,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 11,
    marginBottom: 8,
    maxWidth: '92%',
  },
  chipText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
  wish: {
    fontSize: 27,
    lineHeight: 32,
    fontWeight: '900',
    letterSpacing: -0.6,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 12.5,
    fontWeight: '600',
    letterSpacing: 0.2,
    textAlign: 'center',
    marginTop: 5,
  },
  person: {
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '700',
    letterSpacing: 0.5,
    textAlign: 'center',
    textTransform: 'uppercase',
    marginTop: 4,
    paddingHorizontal: 8,
  },
  pips: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 11 },
  pip: { height: 6, borderRadius: 3 },
});
