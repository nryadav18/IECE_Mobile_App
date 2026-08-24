import React from 'react';
import { View, Image, StyleSheet } from 'react-native';
import { optimizedImageUrl } from '../utils/media';

/**
 * The picture that stands for an activity — its first photo, or the IECE logo
 * when it has none.
 *
 * WHY THIS EXISTS
 *
 * An activity can legitimately have nothing to show. It may have been uploaded
 * without media, or the Admin may have emptied it to free cloud storage while
 * deliberately keeping the record of what happened. Six different screens each
 * had their own answer to that — a grey box, a border-coloured box, a faint
 * `image-outline` glyph — and every one of them read as "something is missing
 * here" rather than "this activity has no photos". A record that was tidied on
 * purpose looked like a record that was broken.
 *
 * So there is one answer now, in one place: the IECE mark on white. It is a
 * deliberate, finished-looking placeholder rather than an absence, and because
 * every screen calls the same component the app cannot drift back into having
 * six of them.
 *
 * THE RATIO
 *
 * The logo is `contain`-fitted inside a padded white tile, never `cover` and
 * never stretched to the tile's shape. Activity covers are square in the lists
 * (80×80) and landscape on the Home cards and the details carousel; a logo
 * stretched to fill either one is instantly recognisable as wrong, and it is
 * the organisation's own mark, so it is the worst possible thing to distort.
 * `contain` plus padding means it keeps its proportions and its breathing room
 * at every size the app asks for.
 *
 * The tile is white in BOTH themes on purpose. The logo artwork is a dark-blue
 * wordmark on white; on a dark surface it would sit in a bright rectangle
 * anyway, so pretending otherwise only produces a muddier edge.
 */

// The tightly-cropped square export. The other two logo files are wrong for
// this: IECE_Logo.png carries a large white margin of its own (so the mark
// renders small inside an already-padded tile) and IECE_Logo_White.png is
// white ink meant for dark backgrounds — invisible here.
const IECE_LOGO = require('../../assets/IECE_Logo_Web.png');

/** Cloudinary generates a poster frame for a video at the same id with .jpg. */
const posterFor = (url) =>
  (typeof url === 'string' && url.endsWith('.mp4')) ? url.replace('.mp4', '.jpg') : url;

/**
 * The first thing worth showing for an activity, or null when there is nothing.
 * Exported so a caller that needs the URL itself (a full-screen viewer, a
 * download button) does not re-derive the rule.
 */
export const activityThumbnail = (activity) => {
  const first = activity?.mediaUrls?.[0];
  return first ? posterFor(first) : null;
};

/** Does this activity have any photos or videos at all? */
export const hasMedia = (activity) => (activity?.mediaUrls?.length || 0) > 0;

/**
 * @param {object}  activity  the activity (only `mediaUrls` is read)
 * @param {number}  size      shorthand for a square cover
 * @param {number}  width     explicit width  (overrides `size`)
 * @param {number}  height    explicit height (overrides `size`)
 * @param {boolean} fill      take the parent's full width at `aspectRatio` instead
 *                            of a fixed size — for a card in a responsive column,
 *                            where a pixel width would break the column maths
 * @param {number}  aspectRatio  used with `fill`, default 16:9
 * @param {number}  sizeHint  logical width to request from Cloudinary in `fill`
 *                            mode (the real width is not known until layout)
 * @param {number}  radius    corner radius, default 12
 * @param {boolean} optimize  ask Cloudinary for a screen-sized image, default true
 */
export default function ActivityCover({
  activity,
  size = 80,
  width,
  height,
  fill = false,
  aspectRatio = 16 / 9,
  sizeHint,
  radius = 12,
  optimize = true,
  style,
  imageProps = {},
}) {
  const w = width ?? size;
  const h = height ?? size;
  const box = fill
    ? { width: '100%', aspectRatio, borderRadius: radius }
    : { width: w, height: h, borderRadius: radius };

  // Cloudinary is asked for a bucket size, not an exact width, so an estimate is
  // all `fill` needs — and the buckets round up, so a slightly low guess still
  // delivers enough pixels.
  const requestWidth = fill ? (sizeHint || 720) : w;

  const thumb = activityThumbnail(activity);

  if (thumb) {
    return (
      <Image
        source={{ uri: optimize ? optimizedImageUrl(thumb, requestWidth) : thumb }}
        style={[box, styles.cover, style]}
        fadeDuration={0}
        {...imageProps}
      />
    );
  }

  // Padding scales with the tile so the mark is proportionate whether it is a
  // 72pt list thumbnail or a full-width carousel panel. Clamped so a very small
  // tile does not squeeze the logo to nothing and a very large one does not
  // leave it floating in white. In `fill` mode the width is unknown until
  // layout, so it is expressed as a share of it instead.
  const pad = fill
    ? '7%'
    : Math.max(6, Math.min(Math.min(w, h) * 0.16, 48));

  return (
    <View
      style={[box, styles.tile, { padding: pad }, style]}
      accessible
      accessibilityRole="image"
      accessibilityLabel="IECE — this activity has no photos or videos"
    >
      <Image source={IECE_LOGO} style={styles.logo} resizeMode="contain" fadeDuration={0} />
    </View>
  );
}

const styles = StyleSheet.create({
  cover: { resizeMode: 'cover' },
  tile: {
    // Deliberately not a theme colour — see the note above.
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    // A hairline keeps the white tile from bleeding into a white surface in
    // light mode, where it would otherwise have no edge at all.
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E7EB',
  },
  logo: { width: '100%', height: '100%' },
});
