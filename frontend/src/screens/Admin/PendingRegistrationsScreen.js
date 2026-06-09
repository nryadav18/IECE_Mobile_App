import React, { useState, useEffect, useContext } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, Modal, ScrollView, Dimensions, Platform
} from 'react-native';
import { ThemeContext } from '../../context/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import api from '../../services/api';
import { useAlert } from '../../context/AlertContext';
import { VideoView, useVideoPlayer } from 'expo-video';

// Platform-specific map imports
// iOS  → Apple Maps via react-native-maps (PROVIDER_DEFAULT)
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

// ---------------------------------------------------------------------------
// Leaflet HTML for Android (CartoDB Voyager tiles — free, no API key)
// ---------------------------------------------------------------------------
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
    var map = L.map('map', {
      zoomControl: true,
      attributionControl: true
    }).setView([${lat}, ${lng}], 17);

    L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20
      }
    ).addTo(map);

    // 50m radius zone
    L.circle([${lat}, ${lng}], {
      color: '#10B981',
      fillColor: '#10B981',
      fillOpacity: 0.18,
      weight: 2.5,
      radius: 50
    }).addTo(map);

    // Pin marker
    var redIcon = L.divIcon({
      className: '',
      html: '<div style="width:18px;height:18px;border-radius:50%;background:#EF4444;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.4);"></div>',
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    });
    L.marker([${lat}, ${lng}], { icon: redIcon })
      .addTo(map)
      .bindPopup('Registration Location')
      .openPopup();
  </script>
</body>
</html>
`;

// ---------------------------------------------------------------------------
// Platform Map Component
// ---------------------------------------------------------------------------
function PlatformMap({ location }) {
  if (!location) return null;
  const { lat, lng } = location;

  if (Platform.OS === 'ios') {
    // Apple Maps on iOS
    return (
      <View style={styles.mapBorderRadius}>
        <MapView
          style={styles.map}
          // No provider specified = PROVIDER_DEFAULT = Apple Maps on iOS
          initialRegion={{
            latitude: lat,
            longitude: lng,
            latitudeDelta: 0.004,
            longitudeDelta: 0.004,
          }}
          scrollEnabled={false}
          zoomEnabled={true}
          pitchEnabled={false}
          rotateEnabled={false}
        >
          <Marker
            coordinate={{ latitude: lat, longitude: lng }}
            title="Registration Location"
          />
          <Circle
            center={{ latitude: lat, longitude: lng }}
            radius={50}
            fillColor="rgba(16,185,129,0.15)"
            strokeColor="rgba(16,185,129,0.6)"
            strokeWidth={2}
          />
        </MapView>
      </View>
    );
  }

  // Android → WebView + Leaflet
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

// ---------------------------------------------------------------------------
// Video Player (Cloudinary .mp4 via expo-video)
// ---------------------------------------------------------------------------
function RegistrationVideoPlayer({ uri, style }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
  });
  return (
    <VideoView
      player={player}
      style={style}
      allowsFullscreen
      allowsPictureInPicture
      contentFit="cover"
    />
  );
}

// ---------------------------------------------------------------------------
// Main Screen
// ---------------------------------------------------------------------------
export default function PendingRegistrationsScreen({ navigation }) {
  const [registrations, setRegistrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState(null);

  const { theme } = useContext(ThemeContext);
  const insets = useSafeAreaInsets();
  const { showAlert } = useAlert();

  useEffect(() => {
    fetchPendingRegistrations();
  }, []);

  const fetchPendingRegistrations = async () => {
    try {
      const response = await api.get('/admin/pending-face-registrations');
      if (response.data.success) {
        setRegistrations(response.data.data);
      }
    } catch (error) {
      console.error('fetchPendingRegistrations error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (id) => {
    try {
      const response = await api.put(`/admin/approve-face-registration/${id}`);
      if (response.data.success) {
        showAlert('Approved!', 'Facial registration has been approved successfully.', 'success');
        setRegistrations(prev => prev.filter(u => u._id !== id));
        setSelectedUser(null);
      }
    } catch (error) {
      console.error(error);
      showAlert('Error', 'Approval failed. Please try again.', 'error');
    }
  };

  const handleReject = async (id) => {
    try {
      const response = await api.delete(`/admin/face-registration/${id}`);
      if (response.data.success) {
        showAlert('Rejected', 'Registration has been rejected and cleared.', 'success');
        setRegistrations(prev => prev.filter(u => u._id !== id));
        setSelectedUser(null);
      }
    } catch (error) {
      console.error(error);
      showAlert('Error', 'Rejection failed. Please try again.', 'error');
    }
  };

  // Safe coordinate extraction
  const getLocation = (user) => {
    const loc = user?.registrationLocation;
    if (!loc) return null;
    const lat = parseFloat(loc.lat);
    const lng = parseFloat(loc.lng);
    if (isNaN(lat) || isNaN(lng)) return null;
    return { lat, lng };
  };

  // ---------------------------------------------------------------------------
  // List card
  // ---------------------------------------------------------------------------
  const renderItem = ({ item, index }) => {
    const location = getLocation(item);
    const isTeamLeader = item.role === 'team_leader';
    const roleLabel = isTeamLeader ? 'Team Leader' : 'Trainer';
    const roleColor = isTeamLeader ? '#8B5CF6' : '#3B82F6';

    return (
      <MotiView
        from={{ opacity: 0, translateY: 20 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'timing', duration: 400, delay: index * 80 }}
      >
        <TouchableOpacity
          style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
          onPress={() => setSelectedUser(item)}
          activeOpacity={0.8}
        >
          <View style={[styles.cardStrip, { backgroundColor: roleColor }]} />
          <View style={[styles.avatarBox, { backgroundColor: roleColor + '20' }]}>
            <Ionicons name="person" size={28} color={roleColor} />
          </View>
          <View style={styles.cardInfo}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
              <Text style={[styles.nameText, { color: theme.colors.textPrimary }]} numberOfLines={1}>
                {item.name}
              </Text>
              <View style={[styles.roleBadge, { backgroundColor: roleColor + '18', borderColor: roleColor }]}>
                <Text style={[styles.roleBadgeText, { color: roleColor }]}>{roleLabel}</Text>
              </View>
            </View>
            <Text style={[styles.schoolText, { color: theme.colors.textSecondary }]} numberOfLines={1}>
              {item.schoolId?.name || 'No School Assigned'}
            </Text>
            <Text style={[styles.emailText, { color: theme.colors.textSecondary }]} numberOfLines={1}>
              {item.email}
            </Text>
            {location ? (
              <View style={styles.locationRow}>
                <Ionicons name="location-outline" size={12} color="#10B981" />
                <Text style={[styles.locationText, { color: '#10B981' }]}>
                  {location.lat.toFixed(4)}, {location.lng.toFixed(4)}
                </Text>
              </View>
            ) : (
              <View style={styles.locationRow}>
                <Ionicons name="location-outline" size={12} color={theme.colors.textSecondary} />
                <Text style={[styles.locationText, { color: theme.colors.textSecondary }]}>No location</Text>
              </View>
            )}
          </View>
          <Ionicons name="chevron-forward" size={20} color={theme.colors.textSecondary} />
        </TouchableOpacity>
      </MotiView>
    );
  };

  // ---------------------------------------------------------------------------
  // Detail modal
  // ---------------------------------------------------------------------------
  const renderModal = () => {
    if (!selectedUser) return null;
    const location = getLocation(selectedUser);
    const videoUrl = selectedUser.registrationPhotoUrl;
    const isTeamLeader = selectedUser.role === 'team_leader';
    const roleLabel = isTeamLeader ? 'Team Leader' : 'Trainer';
    const roleColor = isTeamLeader ? '#8B5CF6' : '#3B82F6';

    return (
      <Modal
        animationType="slide"
        transparent
        visible
        onRequestClose={() => setSelectedUser(null)}
      >
        <View style={[styles.modalOverlay, { backgroundColor: 'rgba(0,0,0,0.65)' }]}>
          <View style={[styles.modalContainer, { backgroundColor: theme.colors.background, paddingBottom: insets.bottom + 20 }]}>

            {/* Header */}
            <View style={[styles.modalHeader, { borderBottomColor: theme.colors.border }]}>
              <Text style={[styles.modalTitle, { color: theme.colors.textPrimary }]}>Registration Details</Text>
              <TouchableOpacity onPress={() => setSelectedUser(null)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Ionicons name="close-circle" size={30} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} bounces={false}>

              {/* Video */}
              <View style={styles.videoWrapper}>
                {videoUrl ? (
                  <RegistrationVideoPlayer uri={videoUrl} style={styles.videoPlayer} />
                ) : (
                  <View style={[styles.videoPlaceholder, { backgroundColor: theme.colors.surface }]}>
                    <Ionicons name="videocam-off-outline" size={48} color={theme.colors.textSecondary} />
                    <Text style={{ color: theme.colors.textSecondary, marginTop: 8, fontWeight: '500' }}>
                      No video recorded
                    </Text>
                  </View>
                )}
                <View style={[styles.videoBadge, { backgroundColor: roleColor }]}>
                  <Text style={styles.videoBadgeText}>{roleLabel}</Text>
                </View>
              </View>

              {/* Personal details */}
              <View style={[styles.detailsBox, { borderColor: theme.colors.border }]}>
                <DetailRow icon="person-outline"          label="Name"   value={selectedUser.name}               theme={theme} />
                <DetailRow icon="mail-outline"            label="Email"  value={selectedUser.email}              theme={theme} />
                <DetailRow icon="business-outline"        label="School" value={selectedUser.schoolId?.name || 'N/A'} theme={theme} />
                <DetailRow icon="shield-checkmark-outline" label="Role"  value={roleLabel} valueColor={roleColor} theme={theme} />
              </View>

              {/* Map section */}
              <View style={styles.sectionHeader}>
                <Ionicons
                  name={Platform.OS === 'ios' ? 'map-outline' : 'globe-outline'}
                  size={18}
                  color={theme.colors.primary}
                />
                <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}>
                  Registration Location
                  <Text style={{ fontSize: 11, fontWeight: '400', color: theme.colors.textSecondary }}>
                    {Platform.OS === 'ios' ? '  (Apple Maps)' : '  (OpenStreetMap)'}
                  </Text>
                </Text>
              </View>

              {location ? (
                <>
                  {/* Map container — no overflow:hidden here (kills MapView on Android) */}
                  <View style={styles.mapContainer}>
                    <PlatformMap location={location} />
                  </View>
                  <View style={styles.coordsRow}>
                    <Ionicons name="location" size={14} color="#10B981" />
                    <Text style={[styles.coordsText, { color: theme.colors.textSecondary }]}>
                      {location.lat.toFixed(6)}, {location.lng.toFixed(6)}
                    </Text>
                  </View>
                </>
              ) : (
                <View style={[styles.noMapBox, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                  <Ionicons name="location-outline" size={36} color={theme.colors.textSecondary} />
                  <Text style={[styles.noMapText, { color: theme.colors.textSecondary }]}>
                    No location data was captured during registration.
                  </Text>
                </View>
              )}

              <View style={{ height: 16 }} />
            </ScrollView>

            {/* Action buttons */}
            <View style={[styles.actionButtons, { borderTopColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
              <TouchableOpacity
                style={[styles.btn, styles.btnReject]}
                onPress={() => handleReject(selectedUser._id)}
                activeOpacity={0.85}
              >
                <Ionicons name="close-circle-outline" size={20} color="#fff" style={{ marginRight: 8 }} />
                <Text style={styles.btnText}>Reject</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.btnApprove]}
                onPress={() => handleApprove(selectedUser._id)}
                activeOpacity={0.85}
              >
                <Ionicons name="checkmark-circle-outline" size={20} color="#fff" style={{ marginRight: 8 }} />
                <Text style={styles.btnText}>Approve</Text>
              </TouchableOpacity>
            </View>

          </View>
        </View>
      </Modal>
    );
  };

  // ---------------------------------------------------------------------------
  // Root render
  // ---------------------------------------------------------------------------
  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 10, borderBottomColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>Pending Registrations</Text>
        <View style={{ width: 32 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={{ color: theme.colors.textSecondary, marginTop: 12, fontWeight: '500' }}>Loading…</Text>
        </View>
      ) : registrations.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="checkmark-circle-outline" size={64} color="#10B981" style={{ marginBottom: 12 }} />
          <Text style={[styles.noData, { color: theme.colors.textPrimary }]}>All caught up!</Text>
          <Text style={{ color: theme.colors.textSecondary, marginTop: 6, textAlign: 'center', paddingHorizontal: 40 }}>
            No pending facial registrations at this time.
          </Text>
        </View>
      ) : (
        <FlatList
          data={registrations}
          keyExtractor={(item) => item._id}
          renderItem={renderItem}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 20 }]}
          showsVerticalScrollIndicator={false}
        />
      )}

      {renderModal()}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Detail Row
// ---------------------------------------------------------------------------
function DetailRow({ icon, label, value, valueColor, theme }) {
  return (
    <View style={drStyles.row}>
      <Ionicons name={icon} size={16} color={theme.colors.textSecondary} style={{ marginRight: 10 }} />
      <Text style={[drStyles.label, { color: theme.colors.textSecondary }]}>{label}</Text>
      <Text style={[drStyles.value, { color: valueColor || theme.colors.textPrimary }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}
const drStyles = StyleSheet.create({
  row:   { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  label: { fontSize: 13, fontWeight: '600', width: 70 },
  value: { flex: 1, fontSize: 14, fontWeight: '700' },
});

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  container: { flex: 1 },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 20, fontWeight: '700', letterSpacing: -0.3 },
  backBtn:     { padding: 4 },
  noData:      { fontSize: 18, fontWeight: '700' },
  list:        { paddingHorizontal: 16, paddingTop: 20 },

  // Card
  card: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 16, borderWidth: 1, marginBottom: 14, overflow: 'hidden',
  },
  cardStrip:  { width: 4, alignSelf: 'stretch' },
  avatarBox:  { width: 56, height: 56, borderRadius: 28, margin: 14, alignItems: 'center', justifyContent: 'center' },
  cardInfo:   { flex: 1, paddingVertical: 14, paddingRight: 10 },
  nameText:   { fontSize: 15, fontWeight: '700', flex: 1, marginRight: 6 },
  schoolText: { fontSize: 12, fontWeight: '500', marginBottom: 2 },
  emailText:  { fontSize: 11, marginBottom: 4 },
  locationRow:{ flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  locationText:{ fontSize: 11, fontWeight: '600', marginLeft: 3 },
  roleBadge:  { borderWidth: 1, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, marginLeft: 6 },
  roleBadgeText: { fontSize: 9, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },

  // Modal
  modalOverlay:   { flex: 1, justifyContent: 'flex-end' },
  modalContainer: { height: '93%', borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1,
  },
  modalTitle: { fontSize: 18, fontWeight: '700' },

  // Video
  videoWrapper:     { width: SCREEN_WIDTH, height: 300, backgroundColor: '#000' },
  videoPlayer:      { width: '100%', height: '100%' },
  videoPlaceholder: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  videoBadge: {
    position: 'absolute', top: 12, left: 12,
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20,
  },
  videoBadgeText: { color: '#fff', fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },

  // Details
  detailsBox: {
    marginHorizontal: 16, marginTop: 16, marginBottom: 8,
    borderRadius: 14, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 4,
  },

  // Section header
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 16, marginTop: 20, marginBottom: 10,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', marginLeft: 8 },

  // Map — NO overflow:hidden on mapContainer (kills MapView on Android)
  mapContainer:   { marginHorizontal: 16 },
  mapBorderRadius:{ borderRadius: 16, overflow: 'hidden' }, // overflow:hidden only on inner wrapper
  map:            { width: MAP_WIDTH, height: MAP_HEIGHT },

  coordsRow:   { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 8 },
  coordsText:  { fontSize: 12, marginLeft: 6 },
  noMapBox:    { marginHorizontal: 16, borderRadius: 14, borderWidth: 1, padding: 24, alignItems: 'center' },
  noMapText:   { fontSize: 13, marginTop: 10, textAlign: 'center', fontStyle: 'italic' },

  // Actions
  actionButtons: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16, borderTopWidth: 1, gap: 12,
  },
  btn:       { flex: 1, flexDirection: 'row', paddingVertical: 16, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  btnApprove:{ backgroundColor: '#10B981' },
  btnReject: { backgroundColor: '#EF4444' },
  btnText:   { color: '#fff', fontWeight: '700', fontSize: 15 },
});
