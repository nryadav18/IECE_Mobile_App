import React, { useState, useContext, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  useWindowDimensions,
  Image,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  Platform,
  StatusBar,
} from 'react-native';
import Carousel from 'react-native-reanimated-carousel';
import { ThemeContext } from '../context/ThemeContext';
import { AuthContext } from '../context/AuthContext';
import { useAlert } from '../context/AlertContext';
import api from '../services/api';
import { MotiView } from 'moti';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { HEAD_ROLES } from '../utils/roles';
import { CONTENT_MAX_WIDTH, isWeb } from '../utils/platform';
import { Skeleton, SkeletonCard, SkeletonList } from '../components/Skeleton';
import BrandHero from '../components/home/BrandHero';
import PressableScale from '../components/home/PressableScale';
import AnimatedCounter from '../components/home/AnimatedCounter';
import PortalButton from '../components/home/PortalButton';
import { clamp, greetingFor, withAlpha } from '../components/home/motion';
import { yearsSinceFounding } from '../utils/org';
import { optimizedImageUrl, prefetchImages, readCachedBanners, writeCachedBanners } from '../utils/media';
import useOccasions from '../celebrations/useOccasions';
import CelebrationHero from '../celebrations/CelebrationHero';
import CelebrationBarTitle from '../celebrations/CelebrationHeaderBar';
import { prettyDate } from '../celebrations/dates';

/**
 * Home.
 *
 * The screen is built as one continuous piece of motion rather than a list of
 * boxes: an always-live brand hero at the top (see `BrandHero`), which the page
 * then scrolls *over* with real parallax, a stat strip that counts itself up
 * when data lands, a parallax media carousel, and cards that spring under the
 * finger.
 *
 * All of the layout comes from `useWindowDimensions`, so rotation, tablets,
 * split screen and foldables re-lay-out live instead of being frozen to the
 * dimensions captured at import time.
 */
export default function DashboardScreen({ navigation, route }) {
  /* ------------------------------------------------------------------ *
   * Celebration preview mode                                            *
   *                                                                     *
   * The admin's "what will this look like?" is answered by opening THIS  *
   * screen on a different date, not by building a mock of it. Same       *
   * component, same hero, same header, same everything — the only        *
   * difference is which day it thinks it is.                            *
   *                                                                     *
   * That is the same trick Approvals already uses to preview an activity *
   * (`ActivityDetails` with `preview: true`), and it is the only way a   *
   * preview can be trusted: there is no second implementation to drift.  *
   *                                                                     *
   * It is a separate entry on the stack, so the real Home sits           *
   * underneath completely untouched — same scroll position, same data —  *
   * and is simply revealed again when this one is dismissed.            *
   * ------------------------------------------------------------------ */
  const preview = route?.params?.preview
    ? {
        dateKey: route.params.previewDateKey || null,
        occasionKey: route.params.previewOccasionKey || null,
      }
    : null;
  const [media, setMedia] = useState([]);
  const [activities, setActivities] = useState([]);
  // Organisation-wide headline figures. Counted server-side (see
  // `GET /api/stats/overview`) rather than derived from the activity feed —
  // the feed only contains schools that happen to have an approved activity,
  // so deriving from it under-reports and never changes when a school is added.
  const [org, setOrg] = useState({ staff: 0, schools: 0 });
  const [years, setYears] = useState(() => yearsSinceFounding());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [slide, setSlide] = useState(0);

  const { theme, isDarkMode, toggleTheme } = useContext(ThemeContext);
  const { user, logout } = useContext(AuthContext);
  const { showAlert } = useAlert();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const reduced = useReducedMotion();
  // This screen is never unmounted — the stack keeps it alive underneath every
  // portal the user opens. Without this gate its animations, its carousel
  // autoplay and its motto timer all keep running for the whole session, which
  // is why the app felt heavy everywhere, not just here.
  const isFocused = useIsFocused();
  const still = reduced || !isFocused;

  /* ------------------------------------------------------------------ *
   * Responsive geometry                                                 *
   * ------------------------------------------------------------------ */
  const isWide = width >= 700; // tablets / landscape phones
  const headerH = insets.top + 58;
  const heroH = clamp(Math.min(width * 0.92, height * 0.46), 268, 400);
  const heroTotal = headerH + heroH;
  const carouselH = isWide ? Math.min(width * 0.36, 380) : width * 0.56;
  const cardW = clamp(width * 0.62, 220, 300);
  // In a browser this widens into the inset that centres the content column, so
  // the stat strip, the section headings and the header bar all line up down the
  // middle of a monitor instead of clinging to its left edge. Native keeps the
  // tablet/phone values it always had.
  const gutter = isWeb
    ? Math.max(isWide ? 28 : 20, Math.round((width - CONTENT_MAX_WIDTH) / 2))
    : isWide ? 28 : 20;

  const logoSource = isDarkMode
    ? require('../../assets/IECE_Logo_White.png')
    : require('../../assets/IECE_Logo.png');

  /* ------------------------------------------------------------------ *
   * Data                                                                *
   * ------------------------------------------------------------------ */

  // The banners the app saw last time it ran, painted before the network has
  // said anything. Without this the carousel is a grey box for as long as the
  // round trip takes, on every single cold start — which is exactly why the
  // banners "appeared instantly" on the way back from a portal but not on the
  // way in. See utils/media.
  const networkLanded = useRef(false);
  useEffect(() => {
    let alive = true;
    readCachedBanners(user?._id || user?.id).then((cached) => {
      // If the live list has already arrived, it wins — never paint over fresh
      // data with a stale cache just because the disk read finished second.
      if (!alive || networkLanded.current || !cached.length) return;
      setMedia(cached);
      setLoading(false);
      prefetchImages(cached.map((m) => optimizedImageUrl(m.imageUrl, width)));
    });
    return () => { alive = false; };
    // Deliberately once, on mount: this is a first-paint optimisation, and
    // re-running it on rotation would risk replacing live data with the cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchMedia();
    }, [])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchMedia().finally(() => setRefreshing(false));
  }, []);

  const fetchMedia = async () => {
    // Recomputed on every focus/refresh so an app left open across 21 June
    // still rolls the anniversary over.
    setYears(yearsSinceFounding());
    try {
      // Use allSettled so one failing endpoint can't block the others from
      // updating — otherwise a single hiccup makes pull-to-refresh appear to do
      // nothing (neither media nor activities would update).
      const [mediaRes, activitiesRes, statsRes] = await Promise.allSettled([
        api.get('/media'),
        api.get('/activities?status=approved'),
        api.get('/stats/overview'),
      ]);
      if (mediaRes.status === 'fulfilled') {
        const list = mediaRes.value.data.data || [];
        networkLanded.current = true;
        setMedia(list);
        // Save for the next cold start, and pull the pictures down now so the
        // carousel has them before it needs to draw them.
        writeCachedBanners(list, user?._id || user?.id);
        prefetchImages(list.map((m) => optimizedImageUrl(m.imageUrl, width)));
      }
      if (activitiesRes.status === 'fulfilled') setActivities(activitiesRes.value.data.data || []);
      if (statsRes.status === 'fulfilled') {
        const d = statsRes.value.data?.data || {};
        setOrg({ staff: d.staff || 0, schools: d.schools || 0 });
      }

      // Only surface an error if nothing could be refreshed.
      if (mediaRes.status === 'rejected' && activitiesRes.status === 'rejected') {
        console.log('Error fetching dashboard data:', mediaRes.reason?.message, activitiesRes.reason?.message);
        showAlert('Error', 'Failed to retrieve latest activities and media details. Please refresh to try again.', 'error');
      }
    } catch (error) {
      console.log('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getPortalRoute = () => {
    if (user?.role === 'creator_admin' || user?.role === 'ceo') return 'CreatorAdminPortal';
    if (user?.role === 'trainer') return 'TrainerPortal';
    if (user?.role === 'chairman') return 'ChairmanPortal';
    // Trainee Team Leader shares the Team Leader portal (full parity).
    if (user?.role === 'team_leader' || user?.role === 'trainee_team_leader') return 'TeamLeaderPortal';
    if (HEAD_ROLES.includes(user?.role)) return 'HeadPortal';
    return null;
  };

  const portalRoute = getPortalRoute();

  const stats = useMemo(
    () => [
      { key: 'staff', icon: 'people-outline', value: org.staff, label: 'Staff' },
      { key: 'schools', icon: 'school-outline', value: org.schools, label: 'Schools' },
      { key: 'years', icon: 'ribbon-outline', value: years, label: 'Years of Excellence' },
    ],
    [org, years]
  );

  const greeting = useMemo(() => greetingFor(), []);
  const firstName = (user?.name || '').trim().split(/\s+/)[0] || 'there';

  /* ------------------------------------------------------------------ *
   * Celebrations                                                        *
   *                                                                     *
   * On any day the app celebrates — a national day, a festival, a school *
   * day, IECE's own anniversary — the whole top region is handed over to *
   * `CelebrationHero` and the greeting steps aside. Every other day this *
   * resolves to nothing and Home is exactly what it has always been.     *
   * ------------------------------------------------------------------ */
  //
  // Gated on focus rather than on `still`: a reduced-motion user should still
  // see all of a day's occasions take their turn — 21 June carries three —
  // they just shouldn't see them slide. The hand-off becomes a cut instead
  // (see `CelebrationHero`), and every scene renders as a still composition.
  const {
    occasions,
    occasion,
    index: occasionIndex,
    look,
    date: occasionDate,
    isCelebration,
    allOccasions,
  } = useOccasions({
    isDark: isDarkMode,
    paused: !isFocused,
    previewDateKey: preview?.dateKey,
    previewOccasionKey: preview?.occasionKey,
  });

  /* ------------------------------------------------------------------ *
   * Scroll-linked motion                                                *
   * ------------------------------------------------------------------ */
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });

  // The hero drifts up at 60% of the page's speed (classic parallax) and
  // stretches when the user over-scrolls at the top — which is what makes
  // pull-to-refresh feel like a material surface.
  //
  // Transforms ONLY, deliberately. Animating `opacity` here would fade a view
  // containing the entire hero tree, forcing the renderer to allocate and blend
  // an offscreen buffer of that whole area on every scroll frame. The fade was
  // cosmetic anyway: the clipping window scrolls off-screen on its own and the
  // header goes opaque over it.
  const heroStyle = useAnimatedStyle(() => {
    const y = scrollY.value;
    return {
      transform: [
        { translateY: y * 0.4 },
        { scale: interpolate(y, [-heroTotal * 0.5, 0], [1.35, 1], Extrapolation.CLAMP) },
      ],
    };
  });

  // The header starts invisible on top of the hero and materialises into a
  // solid bar as the content reaches it.
  const headerFillStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      scrollY.value,
      [heroTotal * 0.3, heroTotal * 0.62],
      [0, 1],
      Extrapolation.CLAMP
    ),
  }));

  const greetTitleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, heroTotal * 0.4], [1, 0], Extrapolation.CLAMP),
  }));

  const compactTitleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      scrollY.value,
      [heroTotal * 0.42, heroTotal * 0.68],
      [0, 1],
      Extrapolation.CLAMP
    ),
    transform: [
      {
        translateY: interpolate(
          scrollY.value,
          [heroTotal * 0.42, heroTotal * 0.68],
          [10, 0],
          Extrapolation.CLAMP
        ),
      },
    ],
  }));

  /* ------------------------------------------------------------------ *
   * Render                                                              *
   * ------------------------------------------------------------------ */
  const iconBtn = (name, onPress, tint, label) => (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      scaleTo={0.88}
      style={[
        styles.headerBtn,
        {
          backgroundColor: withAlpha(theme.colors.surface, isDarkMode ? 0.72 : 0.82),
          borderColor: theme.colors.border,
        },
      ]}
    >
      <Ionicons name={name} size={18} color={tint} />
    </PressableScale>
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* The status bar is part of the composition, not a strip above it.
          Android's AppTheme already paints it transparent, so the celebration
          scene runs to the very top of the screen — this only decides whether
          the clock and battery icons are drawn light or dark against it.

          Rendered only while this screen is focused: Home stays mounted
          underneath every portal, and RN's StatusBar is a stack, so leaving it
          mounted would push a festival bar style onto the rest of the app. */}
      {isFocused && (
        <StatusBar
          translucent
          backgroundColor="transparent"
          barStyle={
            isCelebration
              ? look.statusBarStyle
              : isDarkMode
                ? 'light-content'
                : 'dark-content'
          }
        />
      )}

      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: insets.bottom + 28 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
            progressBackgroundColor={theme.colors.surface}
            progressViewOffset={headerH * 0.5}
          />
        }
      >
        {/* ---------- The signature animation ----------
            The outer box holds its place in the layout; the hero *inside* it
            drifts, stretches and fades against that fixed window. Moving the
            box itself would let it ride down over the stat row as the page
            scrolls — this way the parallax is real but nothing ever collides.

            On a celebration day the scene fills this box edge to edge — from
            y=0, so it paints behind the translucent status bar too — and the
            wish is inset by `headerH` so it clears the floating bar. On every
            other day the hero keeps its original top padding and nothing about
            this changes. */}
        <View style={{ height: heroTotal, overflow: 'hidden' }}>
          <Animated.View style={[styles.heroWrap, heroStyle]}>
            {isCelebration ? (
              <CelebrationHero
                occasions={occasions}
                index={occasionIndex}
                date={occasionDate}
                isDark={isDarkMode}
                width={width}
                height={heroTotal}
                topPad={headerH}
                firstName={firstName}
                logoSource={logoSource}
                paused={still}
              />
            ) : (
              <View style={{ paddingTop: headerH }}>
                <BrandHero
                  theme={theme}
                  isDark={isDarkMode}
                  width={width}
                  height={heroH}
                  logoSource={logoSource}
                  paused={!isFocused}
                />
              </View>
            )}
          </Animated.View>
        </View>

        

        {/* ---------- Media carousel ---------- */}
        <View style={styles.block}>
          {loading ? (
            <SkeletonCard padding={0} style={{ marginHorizontal: gutter, overflow: 'hidden' }}>
              <Skeleton plain width={'100%'} height={carouselH} radius={0} />
            </SkeletonCard>
          ) : media.length > 0 ? (
            <MotiView
              // Transform only, and no delay. Fading this view in meant blending
              // an offscreen buffer the size of the whole carousel, and the
              // delay+duration held the banners back by another half second
              // after they were ready to show — both of which read as "the
              // images are still loading" when they no longer are.
              from={{ translateY: 18 }}
              animate={{ translateY: 0 }}
              transition={{ type: 'timing', duration: 320 }}
            >
              <Carousel
                loop={media.length > 1}
                width={width}
                height={carouselH}
                autoPlay={media.length > 1 && !still}
                autoPlayInterval={3800}
                data={media}
                enabled={media.length > 1}
                scrollAnimationDuration={1000}
                onSnapToItem={setSlide}
                // The neighbouring slides sit slightly back and scale up as they
                // arrive — depth, instead of a flat filmstrip.
                mode="parallax"
                modeConfig={{
                  parallaxScrollingScale: 0.9,
                  parallaxScrollingOffset: isWide ? 140 : 56,
                  parallaxAdjacentItemScale: 0.78,
                }}
                renderItem={({ item }) => (
                  <View
                    style={[
                      styles.slide,
                      { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
                    ]}
                  >
                    {/* Screen-sized, modern-format delivery (see utils/media) —
                        the original upload is often several megabytes. */}
                    <Image
                      source={{ uri: optimizedImageUrl(item.imageUrl, width) }}
                      style={styles.slideImage}
                      // Android cross-fades every image in over 300ms, which
                      // reads as "still loading" even when it came from cache.
                      fadeDuration={0}
                    />
                    {!!item.description && (
                      <View style={styles.slideOverlay}>
                        <Text style={styles.slideText} numberOfLines={2}>
                          {item.description}
                        </Text>
                      </View>
                    )}
                  </View>
                )}
              />

              {media.length > 1 && (
                <View style={styles.dots}>
                  {media.map((m, i) => (
                    <MotiView
                      key={m._id || i}
                      // scaleX, not width: animating a layout prop makes Yoga
                      // re-measure the row on every frame of the transition.
                      animate={{
                        scaleX: i === slide ? 2.6 : 1,
                        opacity: i === slide ? 1 : 0.35,
                      }}
                      transition={{ type: 'spring', damping: 18, stiffness: 220 }}
                      style={[styles.dot, { backgroundColor: theme.colors.primary }]}
                    />
                  ))}
                </View>
              )}
            </MotiView>
          ) : (
            <View
              style={[
                styles.empty,
                {
                  height: carouselH,
                  marginHorizontal: gutter,
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.border,
                },
              ]}
            >
              <Ionicons name="images-outline" size={38} color={theme.colors.textSecondary} />
              <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                No approved media available
              </Text>
            </View>
          )}
        </View>

        {/* ---------- Live numbers ---------- */}
        <View style={[styles.statRow, { paddingHorizontal: gutter }]}>
          {stats.map((s, i) => (
            <MotiView
              key={s.key}
              from={{ opacity: 0, translateY: 22, scale: 0.94 }}
              animate={{ opacity: 1, translateY: 0, scale: 1 }}
              transition={{ type: 'spring', damping: 15, stiffness: 140, delay: 160 + i * 90 }}
              style={[
                styles.statCard,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.border,
                  shadowColor: isDarkMode ? '#000' : theme.colors.primary,
                },
              ]}
            >
              <View
                style={[
                  styles.statIcon,
                  { backgroundColor: withAlpha(theme.colors.primary, isDarkMode ? 0.18 : 0.1) },
                ]}
              >
                <Ionicons name={s.icon} size={16} color={theme.colors.primary} />
              </View>
              <AnimatedCounter
                value={s.value}
                style={[styles.statValue, { color: theme.colors.textPrimary }]}
              />
              <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>
                {s.label}
              </Text>
            </MotiView>
          ))}
        </View>

        {/* ---------- Recent activities ---------- */}
        <View style={styles.block}>
          <View style={[styles.sectionHead, { paddingHorizontal: gutter }]}>
            <MotiView
              from={{ scaleY: 0 }}
              animate={{ scaleY: 1 }}
              transition={{ type: 'spring', damping: 14, stiffness: 180, delay: 200 }}
              style={[styles.sectionBar, { backgroundColor: theme.colors.primary }]}
            />
            <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}>
              Recent Activities
            </Text>
            {activities.length > 0 && (
              <View
                style={[
                  styles.countPill,
                  { backgroundColor: withAlpha(theme.colors.primary, isDarkMode ? 0.2 : 0.1) },
                ]}
              >
                <Text style={[styles.countPillText, { color: theme.colors.primary }]}>
                  {activities.length}
                </Text>
              </View>
            )}
          </View>

          {loading ? (
            <View style={{ paddingHorizontal: gutter }}>
              <SkeletonList count={2} avatar={false} lines={2} />
            </View>
          ) : activities.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              decelerationRate="fast"
              snapToInterval={cardW + 14}
              snapToAlignment="start"
              contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: 6 }}
            >
              {activities.map((activity, index) => {
                // Tagged as an organiser on someone else's upload. The server
                // now returns these alongside a person's own activities (see
                // getActivities), so the card has to say which is which —
                // otherwise a trainer sees work appear under their name with no
                // explanation of where it came from.
                const myId = String(user?._id || user?.id || '');
                const isTagged =
                  !!myId &&
                  String(activity.uploaderId?._id || activity.uploaderId) !== myId &&
                  (activity.organizers || []).some((o) => String(o?._id || o) === myId);

                const thumbnail =
                  activity.mediaUrls && activity.mediaUrls.length > 0 ? activity.mediaUrls[0] : null;
                // Handle auto-generated video thumbnails by replacing .mp4 with .jpg (Cloudinary feature)
                const thumbUrl =
                  thumbnail && thumbnail.endsWith('.mp4') ? thumbnail.replace('.mp4', '.jpg') : thumbnail;

                return (
                  <MotiView
                    key={activity._id}
                    from={{ opacity: 0, translateY: 26, scale: 0.94 }}
                    animate={{ opacity: 1, translateY: 0, scale: 1 }}
                    transition={{
                      type: 'spring',
                      damping: 16,
                      stiffness: 150,
                      delay: 220 + Math.min(index, 6) * 80,
                    }}
                    // The shadow lives on the wrapper, not the card: the card
                    // needs `overflow: hidden` to round its image, and a view
                    // that clips its children clips its own shadow too.
                    style={[styles.cardShadow, { shadowColor: isDarkMode ? '#000' : '#1C1C1C' }]}
                  >
                    <PressableScale
                      // Inert in preview: this screen is a look, not a place to
                      // work from, and wandering off into an activity would
                      // leave the admin somewhere they didn't mean to go.
                      onPress={() =>
                        preview
                          ? null
                          : navigation.navigate('ActivityDetails', { activityId: activity._id })
                      }
                      accessibilityRole="button"
                      accessibilityLabel={activity.name}
                      style={[
                        styles.card,
                        {
                          width: cardW,
                          backgroundColor: theme.colors.surface,
                          borderColor: theme.colors.border,
                        },
                      ]}
                    >
                      {thumbUrl ? (
                        <Image
                          source={{ uri: optimizedImageUrl(thumbUrl, cardW) }}
                          style={[styles.cardImage, { height: cardW * 0.56 }]}
                          fadeDuration={0}
                        />
                      ) : (
                        <View
                          style={[
                            styles.cardImage,
                            {
                              height: cardW * 0.56,
                              backgroundColor: theme.colors.background,
                              alignItems: 'center',
                              justifyContent: 'center',
                            },
                          ]}
                        >
                          <Ionicons name="image-outline" size={30} color={theme.colors.textSecondary} />
                        </View>
                      )}

                      {activity.isStarred && (
                        <View style={styles.starBadge}>
                          <Ionicons name="star" size={13} color="#F5B301" />
                          <Text style={styles.starText}>Star</Text>
                        </View>
                      )}

                      {/* Sits opposite the star so the two never collide. */}
                      {isTagged && (
                        <View style={styles.taggedBadge}>
                          <Ionicons name="pricetag" size={12} color="#FFFFFF" />
                          <Text style={styles.starText}>Tagged</Text>
                        </View>
                      )}

                      <View style={styles.cardBody}>
                        <Text
                          style={[styles.cardTitle, { color: theme.colors.textPrimary }]}
                          numberOfLines={1}
                        >
                          {activity.name}
                        </Text>
                        <Text
                          style={[styles.cardSub, { color: theme.colors.textSecondary }]}
                          numberOfLines={1}
                        >
                          {activity.schoolId?.name}
                        </Text>
                        <View style={styles.cardMeta}>
                          <Ionicons name="calendar-outline" size={12} color={theme.colors.textSecondary} />
                          <Text style={[styles.cardDate, { color: theme.colors.textSecondary }]}>
                            {new Date(activity.activityDate).toLocaleDateString()}
                          </Text>
                        </View>
                      </View>
                    </PressableScale>
                  </MotiView>
                );
              })}
            </ScrollView>
          ) : (
            <View
              style={[
                styles.empty,
                {
                  height: 120,
                  marginHorizontal: gutter,
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.border,
                },
              ]}
            >
              <Ionicons name="calendar-outline" size={30} color={theme.colors.textSecondary} />
              <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                No recent activities to show
              </Text>
            </View>
          )}
        </View>

        {/* ---------- Portal ---------- */}
        {portalRoute && (
          <MotiView
            from={{ opacity: 0, translateY: 24 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', damping: 16, stiffness: 140, delay: 320 }}
            style={{ paddingHorizontal: gutter, paddingTop: 30 }}
          >
            <PortalButton
              label="Go to My Portal"
              theme={theme}
              onPress={() => (preview ? null : navigation.navigate(portalRoute))}
            />
          </MotiView>
        )}
      </Animated.ScrollView>

      {/* ---------- Floating header ---------- */}
      <View style={[styles.header, { height: headerH, paddingTop: insets.top + 8, paddingHorizontal: gutter }]}
        pointerEvents="box-none"
      >
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              // On a celebration day the bar settles into a colour derived from
              // the scene rather than the plain surface, so scrolling past the
              // hero doesn't snap the palette back to grey.
              backgroundColor: isCelebration ? look.barFill : theme.colors.surface,
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderBottomColor: isCelebration
                ? withAlpha(look.barInk, 0.14)
                : theme.colors.border,
            },
            headerFillStyle,
          ]}
        />

        <View style={styles.headerTitles} pointerEvents="none">
          <Animated.View style={[StyleSheet.absoluteFill, styles.titleLayer, greetTitleStyle]}>
            {isCelebration ? (
              <CelebrationBarTitle occasion={occasion} look={look} count={occasions.length} />
            ) : (
              <>
                <Text
                  style={[styles.greeting, { color: theme.colors.textSecondary }]}
                  numberOfLines={1}
                >
                  {greeting},
                </Text>
                <Text style={[styles.name, { color: theme.colors.textPrimary }]} numberOfLines={1}>
                  {firstName}
                </Text>
              </>
            )}
          </Animated.View>

          <Animated.View style={[StyleSheet.absoluteFill, styles.titleLayer, compactTitleStyle]}>
            {isCelebration ? (
              <CelebrationBarTitle occasion={occasion} look={look} count={occasions.length} compact />
            ) : (
              <>
                <Text style={[styles.name, { color: theme.colors.textPrimary }]} numberOfLines={1}>
                  Global Dashboard
                </Text>
                <Text
                  style={[styles.greeting, { color: theme.colors.textSecondary }]}
                  numberOfLines={1}
                >
                  Welcome, {user?.name}
                </Text>
              </>
            )}
          </Animated.View>
        </View>

        <View style={styles.headerActions}>
          {/* The theme toggle stays live in preview — checking the header in
              both themes is exactly what an admin wants to do here. */}
          {iconBtn(
            isDarkMode ? 'sunny-outline' : 'moon-outline',
            toggleTheme,
            theme.colors.textPrimary,
            isDarkMode ? 'Switch to light theme' : 'Switch to dark theme'
          )}
          {preview
            ? iconBtn('close', () => navigation.goBack(), theme.colors.primary, 'Close preview')
            : iconBtn('log-out-outline', logout, theme.colors.primary, 'Log out')}
        </View>
      </View>

      {/* ---------- Preview chrome ----------
          A floating bar, deliberately the ONLY thing that differs from the
          real screen. `box-none` so it never intercepts a scroll: everything
          behind it stays as touchable and as scrollable as it really is. */}
      {preview && (
        <View
          style={[styles.previewDock, { bottom: insets.bottom + 16, paddingHorizontal: gutter }]}
          pointerEvents="box-none"
        >
          <View
            style={[
              styles.previewPill,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
            ]}
          >
            <View style={[styles.previewDot, { backgroundColor: theme.colors.primary }]} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.previewTitle, { color: theme.colors.textPrimary }]} numberOfLines={1}>
                {isCelebration ? occasion.name : 'No celebration'}
              </Text>
              <Text style={[styles.previewSub, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                Preview · {prettyDate(occasionDate)}
                {allOccasions.length > 1 ? ` · ${allOccasions.length} on this day` : ''}
              </Text>
            </View>
            <PressableScale
              onPress={() => navigation.goBack()}
              accessibilityRole="button"
              accessibilityLabel="Close preview"
              scaleTo={0.9}
              style={[styles.previewClose, { backgroundColor: theme.colors.primary }]}
            >
              <Text style={styles.previewCloseText}>Done</Text>
            </PressableScale>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  /* header */
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitles: {
    flex: 1,
    height: 40,
    justifyContent: 'center',
  },
  titleLayer: {
    justifyContent: 'center',
  },
  greeting: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  name: {
    fontSize: 19,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* hero */
  heroWrap: {
    // `transformOrigin` keeps the over-scroll stretch anchored to the top edge,
    // so pulling down grows the hero downward instead of from its middle.
    transformOrigin: 'center top',
  },

  /* stats */
  statRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 6,
    borderRadius: 18,
    borderWidth: 1,
    ...Platform.select({
      ios: { shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
      android: { elevation: 2 },
      default: {},
    }),
  },
  statIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 7,
  },
  statValue: { fontSize: 20, fontWeight: '900', letterSpacing: -0.5 },
  // "Years of Excellence" wraps to two lines on a narrow phone; the row's
  // default stretch keeps all three cards the same height when it does.
  statLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 1,
    textAlign: 'center',
    lineHeight: 14,
  },

  /* blocks */
  block: { marginTop: 28 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginBottom: 14,
  },
  sectionBar: { width: 3.5, height: 18, borderRadius: 2 },
  sectionTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  countPill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 10 },
  countPillText: { fontSize: 11.5, fontWeight: '800' },

  /* carousel */
  slide: {
    flex: 1,
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1,
  },
  slideImage: { width: '100%', height: '100%', resizeMode: 'cover' },
  slideOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  slideText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  dots: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    marginTop: 12,
  },
  dot: { width: 8, height: 7, borderRadius: 4 },

  /* activity cards */
  cardShadow: {
    marginRight: 14,
    borderRadius: 20,
    ...Platform.select({
      ios: { shadowOpacity: 0.1, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
      android: { elevation: 3 },
      default: {},
    }),
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
  },
  cardImage: { width: '100%', resizeMode: 'cover' },
  starBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 14,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  starText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  taggedBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(13,148,136,0.92)',
    borderRadius: 14,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  cardBody: { padding: 13 },
  cardTitle: { fontSize: 15, fontWeight: '800', marginBottom: 3 },
  cardSub: { fontSize: 12.5, marginBottom: 8 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardDate: { fontSize: 11.5, fontWeight: '600' },

  /* preview chrome */
  previewDock: { position: 'absolute', left: 0, right: 0 },
  previewPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 18,
    borderWidth: 1,
    paddingLeft: 14,
    paddingRight: 8,
    paddingVertical: 9,
    ...Platform.select({
      ios: { shadowOpacity: 0.16, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
      android: { elevation: 6 },
      default: {},
    }),
  },
  previewDot: { width: 8, height: 8, borderRadius: 4 },
  previewTitle: { fontSize: 13.5, fontWeight: '800', letterSpacing: -0.2 },
  previewSub: { fontSize: 11, fontWeight: '600', marginTop: 1 },
  previewClose: { paddingHorizontal: 15, paddingVertical: 8, borderRadius: 12 },
  previewCloseText: { color: '#FFFFFF', fontSize: 12.5, fontWeight: '800' },

  /* empty */
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  emptyText: { fontSize: 13, fontWeight: '600' },
});
