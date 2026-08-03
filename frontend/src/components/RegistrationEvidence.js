import React from 'react';
import { View, Text, ActivityIndicator, Platform, Dimensions, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { VideoView, useVideoPlayer } from 'expo-video';

// Platform-specific map imports
// iOS     → Apple Maps via react-native-maps (PROVIDER_DEFAULT)
// Android → WebView + Leaflet + CartoDB free tiles (no API key)
let MapView, Marker, Circle, WebView;
if (Platform.OS === 'ios') {
  const Maps = require('react-native-maps');
  MapView = Maps.default;
  Marker = Maps.Marker;
  Circle = Maps.Circle;
} else {
  WebView = require('react-native-webview').WebView;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const MAP_WIDTH = SCREEN_WIDTH - 32;
const MAP_HEIGHT = 230;

// The radius drawn on the map is the PUBLIC 50 m figure. The server enforces a
// wider one to absorb GPS drift; that number is deliberately not shown anywhere.
const DISPLAY_RADIUS_M = 50;

const buildLeafletHTML = (lat, lng) => `
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
    L.circle([${lat}, ${lng}], {
      color: '#10B981', fillColor: '#10B981', fillOpacity: 0.18, weight: 2.5, radius: ${DISPLAY_RADIUS_M}
    }).addTo(map);
    var redIcon = L.divIcon({
      className: '',
      html: '<div style="width:18px;height:18px;border-radius:50%;background:#EF4444;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.4);"></div>',
      iconSize: [18, 18], iconAnchor: [9, 9]
    });
    L.marker([${lat}, ${lng}], { icon: redIcon }).addTo(map).bindPopup('Registration Location').openPopup();
  </script>
</body>
</html>
`;

/** Where a face registration was captured, on a real map. */
export function RegistrationMap({ location }) {
  if (!location) return null;
  const { lat, lng } = location;

  if (Platform.OS === 'ios') {
    return (
      <View style={styles.mapBorderRadius}>
        <MapView
          style={styles.map}
          initialRegion={{ latitude: lat, longitude: lng, latitudeDelta: 0.004, longitudeDelta: 0.004 }}
          scrollEnabled={false}
          zoomEnabled
          pitchEnabled={false}
          rotateEnabled={false}
        >
          <Marker coordinate={{ latitude: lat, longitude: lng }} title="Registration Location" />
          <Circle
            center={{ latitude: lat, longitude: lng }}
            radius={DISPLAY_RADIUS_M}
            fillColor="rgba(16,185,129,0.15)"
            strokeColor="rgba(16,185,129,0.6)"
            strokeWidth={2}
          />
        </MapView>
      </View>
    );
  }

  return (
    <View style={styles.mapBorderRadius}>
      <WebView
        style={styles.map}
        source={{ html: buildLeafletHTML(lat, lng) }}
        scrollEnabled={false}
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={['*']}
        mixedContentMode="always"
        androidLayerType="hardware"
        startInLoadingState
        renderLoading={() => (
          <View style={[styles.map, { alignItems: 'center', justifyContent: 'center', position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#e8eaed' }]}>
            <ActivityIndicator size="small" color="#10B981" />
            <Text style={{ fontSize: 11, color: '#666', marginTop: 6 }}>Loading map…</Text>
          </View>
        )}
      />
    </View>
  );
}

/** The captured face video (Cloudinary .mp4) via expo-video. */
export function RegistrationVideo({ uri, style }) {
  const player = useVideoPlayer(uri, (p) => { p.loop = false; });
  return <VideoView player={player} style={style} allowsFullscreen allowsPictureInPicture contentFit="cover" />;
}

/** Safe coordinate extraction from a per-school registration. */
export function registrationLocation(reg) {
  const loc = reg?.registrationLocation;
  if (!loc) return null;
  const lat = parseFloat(loc.lat);
  const lng = parseFloat(loc.lng);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return { lat, lng };
}

export const MAP_SIZE = { width: MAP_WIDTH, height: MAP_HEIGHT };

const styles = StyleSheet.create({
  // NO overflow:hidden on the outer container — it kills MapView on Android.
  mapBorderRadius: { borderRadius: 16, overflow: 'hidden' },
  map: { width: MAP_WIDTH, height: MAP_HEIGHT },
});

export default { RegistrationMap, RegistrationVideo, registrationLocation };
