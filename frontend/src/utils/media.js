import { Image, PixelRatio } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Making remote images appear instantly.
 *
 * Home used to open on an empty carousel for several seconds, then fill in —
 * yet leaving for a portal and coming back showed the banners immediately. That
 * gap is the whole diagnosis: nothing was slow about rendering, the images
 * simply were not on the device yet, and the second visit was reading them out
 * of the in-memory cache the first visit had just filled.
 *
 * Three things fix it, in the order they help:
 *
 *  1. ASK FOR SMALLER IMAGES. A banner uploaded from a phone camera is a
 *     several-megabyte JPEG being downloaded to fill a strip a few hundred
 *     points tall. Every stored image has screen-sized copies sitting beside it
 *     on the CDN, so we ask for the one closest to the pixels this screen can
 *     actually show. Typically an order of magnitude less to download.
 *
 *  2. REMEMBER WHAT WAS THERE. The banner list is written to disk, so the next
 *     launch can paint the carousel from the last known list on the first frame
 *     instead of waiting for a round trip before it knows what to draw.
 *
 *  3. WARM THE CACHE EARLY. As soon as the URLs are known — from the cache, so
 *     before the network answers — they are prefetched. By the time the user has
 *     looked at the hero, the pictures are already local.
 *
 * None of this needs a new native dependency, so it works in the build that is
 * already installed.
 */

// Media lives on Cloudflare R2, which cannot resize anything on demand: it
// stores bytes and serves them back, and there is no URL syntax that produces a
// smaller copy.
//
// So the sizes are generated once, at upload, and stored beside the original:
//
//   iece_images/1712-photo.jpg          the original, capped at 1600px
//   iece_images/1712-photo_w480.jpg
//   iece_images/1712-photo_w1080.jpg
//
// EVERY image has EVERY width, deliberately, even when the source was already
// smaller than the target. A client cannot tell from a URL whether a particular
// variant was worth generating, so "sometimes it exists" is the same as
// "unusable" — and a missing variant renders as no image at all, not as a
// slightly larger one.
//
// The host is configurable so this keeps working if the CDN domain ever moves.
const CDN_BASE = (process.env.EXPO_PUBLIC_CDN_URL || 'https://cdn.iece.org.in').replace(/\/+$/, '');

// Must match VARIANT_WIDTHS in backend/utils/storage/keys.js. Anything wider
// than the largest gets the original, which is capped at 1600px anyway.
const R2_WIDTHS = [480, 1080];

const R2_IMAGE_EXT = /\.(jpe?g|png|webp)$/i;

const r2VariantFor = (url, logicalWidth) => {
  const px = Math.round((logicalWidth || 400) * PixelRatio.get());
  const width = R2_WIDTHS.find((w) => w >= px);
  // Wider than the largest stored variant: the original is the right answer,
  // and it is already capped, so this is not a full-size camera photo.
  if (!width) return url;
  return url.replace(R2_IMAGE_EXT, (ext) => `_w${width}${ext}`);
};

/**
 * A URL rewritten to deliver only as many pixels as the screen can use.
 *
 * Substitutes the stored `_w480` / `_w1080` sibling. Anything else — another
 * host, a video, a PDF, or a URL that already names a size — is returned
 * untouched, because a rewrite that misses renders as nothing at all, which is
 * worse than showing something slowly.
 *
 * Never upscales and never crops, so a banner keeps its framing.
 */
export function optimizedImageUrl(url, logicalWidth) {
  if (typeof url !== 'string') return url;
  if (!url.startsWith(`${CDN_BASE}/`)) return url;
  // Already a variant (`..._w480.jpg`); leave it alone.
  if (/_w\d+\.(jpe?g|png|webp)$/i.test(url)) return url;
  // Not an image we generated variants for — a video, a PDF, an animated GIF
  // served whole to keep its animation. Untouched.
  if (!R2_IMAGE_EXT.test(url)) return url;
  return r2VariantFor(url, logicalWidth);
}

/**
 * Start downloading these images now, without rendering them. Fire-and-forget:
 * a failure here costs nothing, the <Image> will simply fetch normally later.
 */
export function prefetchImages(urls = []) {
  urls.filter(Boolean).forEach((url) => {
    try {
      const p = Image.prefetch(url);
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) {
      // Ignore — prefetching is an optimisation, never a requirement.
    }
  });
}

/* ------------------------------------------------------------------ *
 * Last-known banner list                                              *
 * ------------------------------------------------------------------ */

// Scoped to the signed-in user ON PURPOSE. Banners can now be made invisible to
// specific people, so the last-known list is that person's list — a shared key
// would let the previous account's cache paint a banner this one is excluded
// from on the very first frame. The old unscoped 'home.banners.v1' entry is
// simply never read again.
const bannerCacheKey = (userId) => `home.banners.v2.${userId || 'anon'}`;

// Only the fields the carousel actually draws are kept, so a change to the
// media model can never make a stale cache entry render something odd.
const slim = (list = []) =>
  list
    .filter((m) => m && m.imageUrl)
    .map((m) => ({ _id: String(m._id || m.imageUrl), imageUrl: m.imageUrl, description: m.description || '' }));

export async function readCachedBanners(userId) {
  try {
    const raw = await AsyncStorage.getItem(bannerCacheKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

export async function writeCachedBanners(list, userId) {
  try {
    await AsyncStorage.setItem(bannerCacheKey(userId), JSON.stringify(slim(list)));
  } catch (e) {
    // A cache that cannot be written just means the next launch is as slow as
    // it used to be — never a reason to fail anything.
  }
}
