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
import { Skeleton, SkeletonCircle, SkeletonDetail } from '../components/Skeleton';
import DownloadButton from '../components/DownloadButton';

const { width } = Dimensions.get('window');

export default function ActivityDetailsScreen({ route, navigation }) {
  const { activityId, preview } = route.params;
  const { theme } = useContext(ThemeContext);
  const insets = useSafeAreaInsets();
  
  const [activity, setActivity] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchActivityDetails();
  }, [activityId]);

  const fetchActivityDetails = async () => {
    try {
      const res = await api.get(`/activities/${activityId}`);
      setActivity(res.data.data);
    } catch (error) {
      console.log('Error fetching activity details', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !activity) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background, paddingTop: insets.top }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 }}>
          <SkeletonCircle plain size={36} style={{ marginRight: 12 }} />
          <Skeleton plain width={'55%'} height={18} radius={8} />
        </View>
        <SkeletonDetail style={{ paddingHorizontal: 16 }} />
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

    // Admin / CEO can save whatever is on screen. The button renders itself
    // away for every other role, so no role check is needed here.
    return (
      <View style={styles.mediaItem}>
        {isVideo ? <VideoItem url={item} /> : <Image source={{ uri: item }} style={styles.mediaItem} />}
        <DownloadButton
          url={item}
          variant="icon"
          filename={`${(activity?.name || 'activity').replace(/[^\w.\- ]+/g, '_')}`}
          style={{ position: 'absolute', top: 12, right: 12 }}
        />
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      
      <View style={[styles.header, { backgroundColor: theme.colors.surface, paddingTop: insets.top + 10, borderBottomColor: theme.colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]} numberOfLines={1}>{activity.name}</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}>

        {/* Opened from the approvals queue. Everything below is rendered by the
            SAME code the published view uses, so what is judged here is exactly
            what everyone will see once it is approved. */}
        {preview && (
          <View style={{ flexDirection: 'row', alignItems: 'center', margin: 16, marginBottom: 0, padding: 12, borderRadius: 12, borderWidth: 1, backgroundColor: '#F59E0B12', borderColor: '#F59E0B55' }}>
            <Ionicons name="eye-outline" size={16} color="#D97706" style={{ marginRight: 8 }} />
            <Text style={{ color: theme.colors.textSecondary, fontSize: 12, lineHeight: 17, flex: 1 }}>
              Preview — this is exactly how the activity will look once you approve it.
              {activity.status === 'pending' ? ' It is not published yet.' : ''}
            </Text>
          </View>
        )}

        {activity.mediaUrls && activity.mediaUrls.length > 0 && (
          <View style={styles.carouselContainer}>
            <Carousel
              loop={false}
              width={width}
              height={width * 0.75}
              data={activity.mediaUrls}
              renderItem={renderMediaItem}
            />
          </View>
        )}

        <View style={styles.content}>
          {activity.isStarred && (
            <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', backgroundColor: '#F5B30120', borderColor: '#F5B301', borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16, marginBottom: 10 }}>
              <Ionicons name="star" size={15} color="#F5B301" />
              <Text style={{ color: '#B07D00', fontSize: 12, fontWeight: '700', marginLeft: 5 }}>Star Activity</Text>
            </View>
          )}
          <Text style={[styles.title, { color: theme.colors.textPrimary }]}>{activity.name}</Text>

          <View style={styles.metaRow}>
            <Ionicons name="calendar-outline" size={16} color={theme.colors.textSecondary} />
            <Text style={[styles.metaText, { color: theme.colors.textSecondary }]}>
              {new Date(activity.activityDate).toLocaleDateString()} at {new Date(activity.activityDate).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
            </Text>
          </View>
          
          <View style={styles.metaRow}>
            <Ionicons name="business-outline" size={16} color={theme.colors.textSecondary} />
            <Text style={[styles.metaText, { color: theme.colors.textSecondary }]}>{activity.schoolId?.name}</Text>
          </View>

          <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
          
          <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}>About the Activity</Text>
          <Text style={[styles.description, { color: theme.colors.textSecondary }]}>{activity.description}</Text>

          <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />

          <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}>Organizers</Text>
          
          <View style={styles.organizersList}>
            {activity.organizers && activity.organizers.length > 0 ? (
              activity.organizers.map(org => (
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
