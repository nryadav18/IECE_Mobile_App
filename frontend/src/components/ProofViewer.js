import React, { useCallback, useContext, useEffect, useState } from 'react';
import {
  View, Text, Modal, Image, TouchableOpacity, ActivityIndicator,
  Dimensions, StatusBar, ScrollView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemeContext } from '../context/ThemeContext';
import { optimizedImageUrl } from '../utils/media';

/**
 * Full-screen viewer for leave-request proof photos.
 *
 * Replaces `Linking.openURL`, which threw the approver out of the app into a
 * browser to look at a photograph. That was never a good experience and it had
 * a worse failure mode: if the URL did not resolve, the person landed on a
 * browser error page with no way back into what they were doing, and no way to
 * tell a missing file from a network blip.
 *
 * WHAT THIS GUARANTEES
 *
 * Every image is in exactly one of three visible states — loading, loaded, or
 * a stated failure with a Retry. There is no fourth state where a blank box
 * sits there and the reader has to guess. That is the whole point: "no broken
 * links" is only true if a broken one is *reported* rather than rendered as
 * nothing.
 *
 * Deliberately built on Image + ScrollView rather than a gesture library.
 * ScrollView's own pinch-zoom is native on both platforms, costs no new
 * dependency, and cannot conflict with the navigator's gestures — which
 * matters more here than a bespoke zoom would.
 */
export default function ProofViewer({ visible, urls = [], initialIndex = 0, onClose }) {
  const { theme } = useContext(ThemeContext);
  const insets = useSafeAreaInsets();
  const { width, height } = Dimensions.get('window');

  const [index, setIndex] = useState(initialIndex);
  // 'loading' | 'ready' | 'failed', per URL. Keyed by url so a retry of one
  // photo never resets the others.
  const [state, setState] = useState({});
  // Bumped to force <Image> to refetch after a failure.
  const [attempt, setAttempt] = useState({});

  useEffect(() => {
    if (visible) {
      setIndex(initialIndex);
      setState({});
      setAttempt({});
    }
  }, [visible, initialIndex]);

  const mark = useCallback((url, value) => {
    setState((prev) => (prev[url] === value ? prev : { ...prev, [url]: value }));
  }, []);

  const retry = useCallback((url) => {
    setState((prev) => ({ ...prev, [url]: 'loading' }));
    setAttempt((prev) => ({ ...prev, [url]: (prev[url] || 0) + 1 }));
  }, []);

  const onScrollEnd = (e) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    if (next !== index && next >= 0 && next < urls.length) setIndex(next);
  };

  if (!urls.length) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      // Both flags, or Android draws a black band around the modal and the
      // whole app appears to shrink behind it.
      statusBarTranslucent
      navigationBarTranslucent
    >
      <StatusBar barStyle="light-content" />
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.96)' }}>

        {/* Header: which photo, and the way out. Above the pager so it stays
            put while the images move underneath. */}
        <View
          style={{
            paddingTop: insets.top + 8,
            paddingHorizontal: 16,
            paddingBottom: 12,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            zIndex: 2,
          }}
        >
          <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>
            {urls.length > 1 ? `Proof ${index + 1} of ${urls.length}` : 'Proof'}
          </Text>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityLabel="Close"
            accessibilityRole="button"
          >
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
        </View>

        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onScrollEnd}
          contentOffset={{ x: initialIndex * width, y: 0 }}
          style={{ flex: 1 }}
        >
          {urls.map((url) => {
            const status = state[url] || 'loading';
            return (
              <ScrollView
                key={`${url}_${attempt[url] || 0}`}
                style={{ width }}
                contentContainerStyle={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
                maximumZoomScale={4}
                minimumZoomScale={1}
                showsVerticalScrollIndicator={false}
                showsHorizontalScrollIndicator={false}
                centerContent
              >
                {status === 'failed' ? (
                  // Said plainly. A photograph that will not load is worth a
                  // sentence and a button, not an empty rectangle the approver
                  // has to interpret.
                  <View style={{ alignItems: 'center', paddingHorizontal: 32 }}>
                    <Ionicons name="cloud-offline-outline" size={44} color="rgba(255,255,255,0.55)" />
                    <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600', marginTop: 14, textAlign: 'center' }}>
                      This photo could not be loaded
                    </Text>
                    <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, marginTop: 6, textAlign: 'center' }}>
                      Check your connection and try again. If it keeps failing, the
                      file may no longer be available.
                    </Text>
                    <TouchableOpacity
                      onPress={() => retry(url)}
                      style={{
                        marginTop: 18, flexDirection: 'row', alignItems: 'center',
                        borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)',
                        borderRadius: 10, paddingVertical: 10, paddingHorizontal: 18,
                      }}
                    >
                      <Ionicons name="refresh" size={17} color="#fff" style={{ marginRight: 8 }} />
                      <Text style={{ color: '#fff', fontWeight: '600', fontSize: 14 }}>Try again</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <>
                    <Image
                      // Full width of the screen, so the stored variant asked
                      // for is the large one rather than a thumbnail being
                      // stretched.
                      source={{ uri: optimizedImageUrl(url, width) }}
                      style={{ width, height: height * 0.75 }}
                      resizeMode="contain"
                      onLoadStart={() => mark(url, 'loading')}
                      onLoad={() => mark(url, 'ready')}
                      onError={() => mark(url, 'failed')}
                    />
                    {status === 'loading' && (
                      <View style={{ position: 'absolute', alignItems: 'center' }}>
                        <ActivityIndicator size="large" color="#fff" />
                      </View>
                    )}
                  </>
                )}
              </ScrollView>
            );
          })}
        </ScrollView>

        {/* Dots, only when there is more than one to move between. */}
        {urls.length > 1 && (
          <View
            style={{
              flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
              paddingBottom: insets.bottom + 18, paddingTop: 10, gap: 7,
            }}
          >
            {urls.map((u, i) => (
              <View
                key={`dot_${u}_${i}`}
                style={{
                  width: i === index ? 9 : 6,
                  height: i === index ? 9 : 6,
                  borderRadius: 5,
                  backgroundColor: i === index ? '#fff' : 'rgba(255,255,255,0.4)',
                }}
              />
            ))}
          </View>
        )}
      </View>
    </Modal>
  );
}
