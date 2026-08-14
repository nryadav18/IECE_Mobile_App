import React, { useContext, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Platform, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemeContext } from '../context/ThemeContext';

/**
 * One point on a real map, and nothing else.
 *
 * Written for screens that show MANY points one at a time — pick a day, look at
 * where the check-in happened, tap check-out, look again. The naive version of
 * that re-creates the map on every tap: on Android a new `source={{html}}` is a
 * fresh WebView, a fresh Leaflet instance and a fresh round of tile downloads,
 * which is why such screens feel heavy. So:
 *
 *  - The map is built ONCE per mount. Afterwards a new point is a tiny message
 *    into the page (`__setPoint`) / an `animateCamera` on the native view. The
 *    tiles already on screen stay on screen.
 *  - The component is memoised on the point itself, so a parent re-rendering for
 *    an unrelated reason (a list scroll, a theme tick) does not touch the map at
 *    all. It moves when the selection moves, and only then.
 *  - The frame is laid out with percentage width and an aspect ratio, so it fits
 *    whatever column it is dropped into, on any screen size and either rotation.
 *
 * Platform split matches RegistrationEvidence: Apple Maps on iOS via
 * react-native-maps, Leaflet + free CARTO tiles in a WebView on Android (no API
 * key, so nothing to provision per build).
 */

let MapView, Marker, Circle, WebView;
if (Platform.OS === 'ios') {
  const Maps = require('react-native-maps');
  MapView = Maps.default;
  Marker = Maps.Marker;
  Circle = Maps.Circle;
} else if (Platform.OS === 'android') {
  WebView = require('react-native-webview').WebView;
}

// GPS uncertainty is drawn as a halo, clamped so a bad fix cannot swallow the
// whole map and a suspiciously perfect one is still visible.
const clampAccuracy = (a) => {
  const n = Number(a);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.max(n, 15), 1000);
};

const buildHTML = (lat, lng, color, label, accuracy) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    html, body, #map { height:100%; width:100%; background:#e8eaed; }
    .leaflet-control-attribution { font-size:8px; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    var map = L.map('map', { zoomControl: true, attributionControl: true }).setView([${lat}, ${lng}], 17);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd', maxZoom: 20
    }).addTo(map);

    var marker = null, halo = null;

    // The whole point of this page: move the pin without rebuilding anything.
    window.__setPoint = function (lat, lng, color, label, accuracy) {
      if (marker) { map.removeLayer(marker); marker = null; }
      if (halo) { map.removeLayer(halo); halo = null; }

      if (accuracy > 0) {
        halo = L.circle([lat, lng], {
          color: color, fillColor: color, fillOpacity: 0.12, weight: 1, radius: accuracy
        }).addTo(map);
      }

      var icon = L.divIcon({
        className: '',
        html: '<div style="width:18px;height:18px;border-radius:50%;background:' + color +
              ';border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.4);"></div>',
        iconSize: [18, 18], iconAnchor: [9, 9]
      });
      marker = L.marker([lat, lng], { icon: icon }).addTo(map).bindPopup(label).openPopup();

      // Keep whatever zoom the viewer chose; only correct one that is too far out
      // to make sense of a single pin.
      map.setView([lat, lng], map.getZoom() < 15 ? 17 : map.getZoom(), { animate: true });
    };

    window.__setPoint(${lat}, ${lng}, ${JSON.stringify(color)}, ${JSON.stringify(label)}, ${accuracy});

    window.addEventListener("message", function(event) {
      if (event.data && event.data.type === 'setPoint') {
        window.__setPoint(event.data.lat, event.data.lng, event.data.color, event.data.label, event.data.accuracy);
      }
    });
  </script>
</body>
</html>
`;

function LocationMapImpl({
  lat,
  lng,
  label = 'Location',
  color = '#10B981',
  accuracy = null,
  aspectRatio = 1.5,
  emptyText = 'No location recorded.',
}) {
  const { theme } = useContext(ThemeContext);
  const webRef = useRef(null);
  const mapRef = useRef(null);
  const [ready, setReady] = useState(false);

  const hasPoint = Number.isFinite(lat) && Number.isFinite(lng);
  const halo = clampAccuracy(accuracy);

  // The HTML is frozen at the FIRST point this instance ever showed. Every later
  // point arrives through __setPoint, so the WebView is never re-sourced (which
  // would remount it and re-download tiles).
  const firstPoint = useRef(null);
  if (hasPoint && !firstPoint.current) {
    firstPoint.current = { lat, lng, color, label, halo };
  }

  // Selecting a day with nothing to show (checked in, never checked out) takes
  // the map off screen entirely. The next point therefore starts a NEW map, so
  // both pieces of per-map state have to go with it: the frozen first point, or
  // the fresh page would open on the old location, and `ready`, or the injection
  // below would fire at a page that has not loaded yet and leave a stale pin.
  useEffect(() => {
    if (hasPoint) return;
    firstPoint.current = null;
    setReady(false);
  }, [hasPoint]);

  // Move the existing map to the new point. Runs on selection changes only —
  // the memo below keeps unrelated re-renders from reaching this component.
  useEffect(() => {
    if (!hasPoint) return;

    if (Platform.OS === 'ios') {
      mapRef.current?.animateCamera({ center: { latitude: lat, longitude: lng } }, { duration: 350 });
      return;
    }

    if (Platform.OS === 'web') {
      if (!ready) return;
      webRef.current?.contentWindow?.postMessage({
        type: 'setPoint', lat, lng, color, label, accuracy: halo
      }, '*');
      return;
    }

    if (!ready) return; // applied by onLoadEnd instead
    const js = `window.__setPoint && window.__setPoint(${lat}, ${lng}, ${JSON.stringify(color)}, ${JSON.stringify(label)}, ${halo}); true;`;
    webRef.current?.injectJavaScript(js);
  }, [lat, lng, color, label, halo, hasPoint, ready]);

  if (!hasPoint) {
    return (
      <View style={[styles.frame, styles.empty, { aspectRatio, backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
        <Ionicons name="location-outline" size={22} color={theme.colors.textSecondary} />
        <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 6, textAlign: 'center', paddingHorizontal: 16 }}>
          {emptyText}
        </Text>
      </View>
    );
  }

  if (Platform.OS === 'ios') {
    return (
      <View style={[styles.frame, { aspectRatio }]}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          initialRegion={{
            latitude: firstPoint.current.lat,
            longitude: firstPoint.current.lng,
            latitudeDelta: 0.004,
            longitudeDelta: 0.004,
          }}
          pitchEnabled={false}
          rotateEnabled={false}
        >
          <Marker coordinate={{ latitude: lat, longitude: lng }} title={label} pinColor={color} />
          {halo > 0 && (
            <Circle
              center={{ latitude: lat, longitude: lng }}
              radius={halo}
              fillColor={`${color}22`}
              strokeColor={`${color}88`}
              strokeWidth={1}
            />
          )}
        </MapView>
      </View>
    );
  }

  if (Platform.OS === 'web') {
    return (
      <View style={[styles.frame, { aspectRatio }]}>
        <iframe
          ref={webRef}
          style={{ width: '100%', height: '100%', border: 'none' }}
          srcDoc={htmlFor(firstPoint.current)}
          onLoad={() => setReady(true)}
        />
      </View>
    );
  }

  return (
    <View style={[styles.frame, { aspectRatio }]}>
      <WebView
        ref={webRef}
        style={StyleSheet.absoluteFill}
        source={{ html: htmlFor(firstPoint.current) }}
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={['*']}
        mixedContentMode="always"
        androidLayerType="hardware"
        scrollEnabled={false}
        startInLoadingState
        onLoadEnd={() => setReady(true)}
        renderLoading={() => (
          <View style={[StyleSheet.absoluteFill, styles.empty, { backgroundColor: '#e8eaed' }]}>
            <ActivityIndicator size="small" color={color} />
            <Text style={{ fontSize: 11, color: '#666', marginTop: 6 }}>Loading map…</Text>
          </View>
        )}
      />
    </View>
  );
}

// The initial HTML must be referentially stable for the WebView's whole life:
// a new string is a new source, and a new source is a remount.
const htmlCache = new WeakMap();
function htmlFor(point) {
  if (!point) return '';
  if (!htmlCache.has(point)) {
    htmlCache.set(point, buildHTML(point.lat, point.lng, point.color, point.label, point.halo));
  }
  return htmlCache.get(point);
}

/**
 * Re-render ONLY when the point (or how it should be drawn) actually changes.
 * This is what makes "the map only changes when the option changes" true rather
 * than merely intended.
 */
const LocationMap = React.memo(LocationMapImpl, (a, b) =>
  a.lat === b.lat &&
  a.lng === b.lng &&
  a.label === b.label &&
  a.color === b.color &&
  a.accuracy === b.accuracy &&
  a.aspectRatio === b.aspectRatio &&
  a.emptyText === b.emptyText
);

export default LocationMap;

const styles = StyleSheet.create({
  // Percentage width + aspectRatio: fits any column, any screen, either
  // rotation. NO overflow:hidden on a parent of MapView — it kills it on Android.
  frame: { width: '100%', borderRadius: 16, overflow: 'hidden' },
  empty: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
});
