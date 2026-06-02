import React, { useState, useEffect, useContext } from 'react';
import { View, Text, StyleSheet, ScrollView, Dimensions, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemeContext } from '../context/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Carousel from 'react-native-reanimated-carousel';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Image } from 'react-native';
import api from '../services/api';
import Avatar from '../components/Avatar';

const { width } = Dimensions.get('window');

export default function EventDetailsScreen({ route, navigation }) {
  const { eventId } = route.params;
  const { theme } = useContext(ThemeContext);
  const insets = useSafeAreaInsets();
  
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchEventDetails();
  }, [eventId]);

  const fetchEventDetails = async () => {
    try {
      const res = await api.get(`/events/${eventId}`);
      setEvent(res.data.data);
    } catch (error) {
      console.log('Error fetching event details', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !event) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background, justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={{ color: theme.colors.textPrimary }}>Loading event...</Text>
      </View>
    );
  }

  const VideoItem = ({ url }) => {
    const player = useVideoPlayer(url, (player) => {
      player.loop = false;
    });

    return (
      <VideoView
        player={player}
        style={styles.mediaItem}
        allowsFullscreen
        allowsPictureInPicture
      />
    );
  };

  const renderMediaItem = ({ item }) => {
    const isVideo = item.endsWith('.mp4') || item.includes('/video/');
    
    if (isVideo) {
      return <VideoItem url={item} />;
    }
    
    return (
      <Image 
        source={{ uri: item }} 
        style={styles.mediaItem} 
      />
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      
      <View style={[styles.header, { backgroundColor: theme.colors.surface, paddingTop: insets.top + 10, borderBottomColor: theme.colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]} numberOfLines={1}>{event.name}</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}>
        
        {event.mediaUrls && event.mediaUrls.length > 0 && (
          <View style={styles.carouselContainer}>
            <Carousel
              loop={false}
              width={width}
              height={width * 0.75}
              data={event.mediaUrls}
              renderItem={renderMediaItem}
            />
          </View>
        )}

        <View style={styles.content}>
          <Text style={[styles.title, { color: theme.colors.textPrimary }]}>{event.name}</Text>
          
          <View style={styles.metaRow}>
            <Ionicons name="calendar-outline" size={16} color={theme.colors.textSecondary} />
            <Text style={[styles.metaText, { color: theme.colors.textSecondary }]}>
              {new Date(event.eventDate).toLocaleDateString()} at {new Date(event.eventDate).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
            </Text>
          </View>
          
          <View style={styles.metaRow}>
            <Ionicons name="business-outline" size={16} color={theme.colors.textSecondary} />
            <Text style={[styles.metaText, { color: theme.colors.textSecondary }]}>{event.schoolId?.name}</Text>
          </View>

          <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
          
          <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}>About the Event</Text>
          <Text style={[styles.description, { color: theme.colors.textSecondary }]}>{event.description}</Text>

          <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />

          <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}>Organizers</Text>
          
          <View style={styles.organizersList}>
            {event.organizers && event.organizers.length > 0 ? (
              event.organizers.map(org => (
                <View key={org._id} style={[styles.organizerCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                  <Avatar name={org.name} size={40} />
                  <View style={styles.orgInfo}>
                    <Text style={[styles.orgName, { color: theme.colors.textPrimary }]}>{org.name}</Text>
                    <Text style={[styles.orgRole, { color: theme.colors.textSecondary }]}>{org.role?.replace('_', ' ').toUpperCase()}</Text>
                  </View>
                </View>
              ))
            ) : (
              <Text style={{ color: theme.colors.textSecondary }}>No organizers listed.</Text>
            )}
          </View>

        </View>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 16, borderBottomWidth: 1 },
  backBtn: { paddingRight: 16 },
  headerTitle: { fontSize: 18, fontWeight: 'bold', flex: 1 },
  carouselContainer: { width: width, height: width * 0.75, backgroundColor: '#000' },
  mediaItem: { width: '100%', height: '100%', resizeMode: 'cover' },
  content: { padding: 20 },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 12 },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  metaText: { fontSize: 14, marginLeft: 8 },
  divider: { height: 1, marginVertical: 20 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 12 },
  description: { fontSize: 15, lineHeight: 22 },
  organizersList: { marginTop: 8 },
  organizerCard: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 10 },
  orgInfo: { marginLeft: 12 },
  orgName: { fontSize: 16, fontWeight: '600' },
  orgRole: { fontSize: 12, marginTop: 2 }
});
