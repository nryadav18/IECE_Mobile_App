import React, { useState, useEffect, useContext } from 'react';
import { View, Text, StyleSheet, ScrollView, Dimensions, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemeContext } from '../context/ThemeContext';
import { AuthContext } from '../context/AuthContext';
import { useAlert } from '../context/AlertContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Carousel from 'react-native-reanimated-carousel';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Image } from 'react-native';
import api from '../services/api';
import Avatar from '../components/Avatar';
import ApprovedBy from '../components/ApprovedBy';
import { Skeleton, SkeletonCircle, SkeletonDetail } from '../components/Skeleton';
import DownloadButton from '../components/DownloadButton';
import ActivityCover from '../components/ActivityCover';

const { width } = Dimensions.get('window');

export default function ActivityDetailsScreen({ route, navigation }) {
  const { activityId, preview } = route.params;
  const { theme } = useContext(ThemeContext);
  const { user } = useContext(AuthContext);
  const { showAlert } = useAlert();
  const insets = useSafeAreaInsets();
  
  const [activity, setActivity] = useState(null);
  const [loading, setLoading] = useState(true);
  const [purging, setPurging] = useState(false);

  // Only the Admin may strip an activity's media. Everyone else who wants their
  // photos gone deletes the whole activity; emptying an APPROVED activity while
  // leaving the approval standing is an archival call, not an authoring one.
  const isAdmin = user?.role === 'creator_admin';
  const mediaCount = activity?.mediaUrls?.length || 0;


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

  /**
   * Delete this activity's photos and videos — from Cloudinary, not just from
   * the record. The activity itself is untouched, which is the whole point:
   * the account stops paying to store the files while what happened, when,
   * where and who ran it all survive.
   */
  const purgeMedia = () => {
    showAlert(
      'Delete photos and videos?',
      `This permanently deletes ${mediaCount} file${mediaCount === 1 ? '' : 's'} from cloud storage. ` +
      'It cannot be undone, and the files cannot be recovered.\n\n' +
      `"${activity.name}" itself stays — its details, date, school, organisers and approval are all kept. ` +
      'Only the media is removed.',
      'warning',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete files',
          style: 'destructive',
          onPress: async () => {
            setPurging(true);
            try {
              const res = await api.delete(`/activities/${activityId}/media`);
              // The server returns the saved activity, so the carousel reflects
              // exactly what is left rather than what we hoped was left.
              if (res.data.data) setActivity(res.data.data);
              showAlert('Deleted', res.data.message || 'The files were removed from cloud storage.', 'success');
            } catch (error) {
              const data = error.response?.data;
              // A partial failure still returns the updated activity: whatever
              // DID get deleted is already gone, and the rest can be retried.
              if (data?.data) setActivity(data.data);
              showAlert(
                'Not fully deleted',
                data?.error || 'Could not remove the files from cloud storage. Please try again.',
                'error'
              );
            } finally {
              setPurging(false);
            }
          },
        },
      ]
    );
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

        {mediaCount > 0 ? (
          <View style={styles.carouselContainer}>
            <Carousel
              loop={false}
              width={width}
              height={width * 0.75}
              data={activity.mediaUrls}
              renderItem={renderMediaItem}
            />
          </View>
        ) : (
          // No photos and no videos — either it was uploaded without any, or
          // the Admin emptied it to free cloud storage. This used to collapse
          // the whole section, so the screen opened straight on the title and
          // read as half-loaded. The IECE mark is a deliberate stand-in: it
          // says "there is nothing to show here", not "something went wrong".
          <View style={styles.carouselContainer}>
            <ActivityCover activity={activity} width={width} height={width * 0.75} radius={0} />
          </View>
        )}

        {/* ---- Admin: delete the media, keep the activity ---------------- */}
        {isAdmin && mediaCount > 0 && (
          <TouchableOpacity
            onPress={purgeMedia}
            disabled={purging}
            activeOpacity={0.8}
            style={[styles.purgeBtn, { borderColor: '#EF444455', backgroundColor: '#EF44440F', opacity: purging ? 0.6 : 1 }]}
          >
            {purging
              ? <ActivityIndicator size="small" color="#DC2626" />
              : <Ionicons name="trash-outline" size={17} color="#DC2626" />}
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={{ color: '#DC2626', fontSize: 13.5, fontWeight: '700' }}>
                {purging ? 'Deleting from cloud storage…' : `Delete ${mediaCount} photo${mediaCount === 1 ? '' : 's'} / video${mediaCount === 1 ? '' : 's'}`}
              </Text>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 11, marginTop: 2 }}>
                Frees cloud storage. The activity and its details are kept.
              </Text>
            </View>
          </TouchableOpacity>
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

          {/* Who let this activity through. Activities are decided by team
              leaders, heads or either admin, so this is the only place that
              answers it. Admin/CEO only. */}
          <ApprovedBy record={activity} style={{ marginTop: 10 }} />

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
  purgeBtn: {
    flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, marginTop: 16,
    paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1,
  },
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
