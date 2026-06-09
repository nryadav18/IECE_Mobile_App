import React, { useRef, useEffect, useContext } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import { ThemeContext } from '../context/ThemeContext';

export default function IndiaMap({ activeStates, onStateSelect }) {
  const { theme } = useContext(ThemeContext);
  const webviewRef = useRef(null);

  // Convert active states to lowercase for case-insensitive matching
  const normalizedActiveStates = activeStates.map(s => s.toLowerCase());

  // We inject Leaflet.js and the map configuration into the webview
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes">
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <script src="https://unpkg.com/topojson-client@3"></script>
        <style>
            body { padding: 0; margin: 0; background-color: ${theme.colors.background}; }
            html, body, #map { height: 100%; width: 100%; }
            .leaflet-container { background: ${theme.colors.background}; outline: 0; }
            /* Hide the default Leaflet attribution for a cleaner app feel */
            .leaflet-control-attribution { display: none; }
        </style>
    </head>
    <body>
        <div id="map"></div>
        <script>
            // Initialize map, disable background tiles (we only want the SVG)
            const map = L.map('map', {
                zoomControl: false,
                attributionControl: false,
                maxBounds: [[5.0, 65.0], [38.0, 100.0]], // Roughly bound to India
                minZoom: 4,
                touchZoom: true, // Ensure two-finger zoom is explicitly enabled
                dragging: true,
            }).setView([22.5937, 78.9629], 4.5);

            const activeStates = ${JSON.stringify(normalizedActiveStates)};
            const primaryColor = '${theme.colors.primary}';
            const inactiveColor = '${theme.colors.surface}';
            const borderColor = '${theme.colors.border}';

            let geojsonLayer;

            // Fetch Updated India TopoJSON (Post-2019 boundaries including Ladakh, Telangana)
            fetch('https://code.highcharts.com/mapdata/countries/in/in-all.topo.json')
                .then(res => res.json())
                .then(topoData => {
                    const data = topojson.feature(topoData, topoData.objects.default);
                    geojsonLayer = L.geoJSON(data, {
                        style: function(feature) {
                            const stateName = (feature.properties.name || '').toLowerCase();
                            const isActive = activeStates.some(s => stateName.includes(s) || s.includes(stateName));
                            
                            return {
                                fillColor: isActive ? primaryColor : inactiveColor,
                                weight: 1,
                                opacity: 1,
                                color: borderColor,
                                fillOpacity: isActive ? 0.8 : 0.3
                            };
                        },
                        onEachFeature: function(feature, layer) {
                            const stateName = feature.properties.name || '';
                            const normalizedName = stateName.toLowerCase();
                            const isActive = activeStates.some(s => normalizedName.includes(s) || s.includes(normalizedName));

                            if (isActive) {
                                layer.on({
                                    mouseover: function(e) {
                                        const layer = e.target;
                                        layer.setStyle({ fillOpacity: 1, weight: 2 });
                                        layer.bringToFront();
                                    },
                                    mouseout: function(e) {
                                        geojsonLayer.resetStyle(e.target);
                                    },
                                    click: function(e) {
                                        // Send message back to React Native
                                        window.ReactNativeWebView.postMessage(stateName);
                                    }
                                });
                            }
                        }
                    }).addTo(map);
                    
                    // Fit map strictly to the bounds of India
                    map.fitBounds(geojsonLayer.getBounds(), { padding: [10, 10] });
                })
                .catch(err => console.error("Error loading GeoJSON: ", err));
        </script>
    </body>
    </html>
  `;

  const onMessage = (event) => {
    const selectedStateName = event.nativeEvent.data;
    // We try to match the map's state name back to our strict association states list
    const matchedState = activeStates.find(
      s => s.toLowerCase() === selectedStateName.toLowerCase() || 
           selectedStateName.toLowerCase().includes(s.toLowerCase()) || 
           s.toLowerCase().includes(selectedStateName.toLowerCase())
    );

    if (matchedState) {
      onStateSelect(matchedState);
    }
  };

  return (
    <View style={styles.container}>
      <WebView
        ref={webviewRef}
        originWhitelist={['*']}
        source={{ html: htmlContent }}
        onMessage={onMessage}
        startInLoadingState={true}
        renderLoading={() => (
          <View style={[styles.loadingContainer, { backgroundColor: theme.colors.background }]}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
          </View>
        )}
        style={{ flex: 1, backgroundColor: 'transparent' }}
        scrollEnabled={false}
        bounces={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 400,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginTop: 10,
    marginBottom: 20
  },
  loadingContainer: {
    position: 'absolute',
    top: 0, bottom: 0, left: 0, right: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10
  }
});
