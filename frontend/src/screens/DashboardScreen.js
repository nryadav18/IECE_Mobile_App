import React, { useEffect, useState, useContext, useCallback } from 'react';
import { View, Text, StyleSheet, Dimensions, ActivityIndicator, Image, TouchableOpacity, ScrollView, RefreshControl } from 'react-native';
import Carousel from 'react-native-reanimated-carousel';
import { ThemeContext } from '../context/ThemeContext';
import { AuthContext } from '../context/AuthContext';
import { useAlert } from '../context/AlertContext';
import api from '../services/api';
import { MotiView } from 'moti';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';

const width = Dimensions.get('window').width;

export default function DashboardScreen({ navigation }) {
  const [media, setMedia] = useState([]);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const { theme, isDarkMode, toggleTheme } = useContext(ThemeContext);
  const { user, logout } = useContext(AuthContext);
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      fetchMedia();
    }, [])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchMedia().finally(() => setRefreshing(false));
  }, []);

  const { showAlert } = useAlert();

  const fetchMedia = async () => {
    try {
      const [mediaRes, activitiesRes] = await Promise.all([
        api.get('/media'),
        api.get('/activities?status=approved')
      ]);
      setMedia(mediaRes.data.data);
      setActivities(activitiesRes.data.data);
    } catch (error) {
      console.log('Error fetching dashboard data:', error);
      showAlert('Error', 'Failed to retrieve latest activities and media details. Please refresh to try again.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const getPortalRoute = () => {
    if (user.role === 'creator_admin') return 'CreatorAdminPortal';
    if (user.role === 'trainer') return 'TrainerPortal';
    if (user.role === 'chairman') return 'ChairmanPortal';
    if (user.role === 'team_leader') return 'TeamLeaderPortal';
    return null;
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* Premium Header */}
      <View 
        style={[
          styles.header, 
          { 
            backgroundColor: theme.colors.surface, 
            borderBottomWidth: 1, 
            borderBottomColor: theme.colors.border,
            paddingTop: insets.top + 10,
            paddingBottom: 16
          }
        ]}
      >
        <View style={styles.headerLeft}>
          <Text style={[styles.headerText, { color: theme.colors.textPrimary }]}>Global Dashboard</Text>
          <Text style={[styles.welcomeText, { color: theme.colors.textSecondary }]}>Welcome, {user?.name}</Text>
        </View>
        
        <View style={styles.headerActions}>
          <TouchableOpacity 
            onPress={toggleTheme} 
            style={[styles.headerBtn, { backgroundColor: theme.colors.background, borderColor: theme.colors.border }]}
            activeOpacity={0.8}
          >
            <Ionicons 
              name={isDarkMode ? 'sunny-outline' : 'moon-outline'} 
              size={18} 
              color={theme.colors.textPrimary} 
            />
          </TouchableOpacity>
          <TouchableOpacity 
            onPress={logout} 
            style={[styles.headerBtn, { backgroundColor: theme.colors.background, borderColor: theme.colors.border }]}
            activeOpacity={0.8}
          >
            <Ionicons name="log-out-outline" size={18} color={theme.colors.primary} />
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : (
        <ScrollView 
          contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom + 20 }} 
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl 
              refreshing={refreshing} 
              onRefresh={onRefresh} 
              tintColor={theme.colors.primary} 
              colors={[theme.colors.primary]} 
              progressBackgroundColor={theme.colors.surface}
            />
          }
        >
          <MotiView
            from={{ opacity: 0, translateY: 15 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 400 }}
            style={styles.carouselContainer}
          >
            {media.length > 0 ? (
              <Carousel
                loop={media.length > 1}
                width={width}
                height={width * 0.56} // 16:9 ratio
                autoPlay={media.length > 1}
                autoPlayInterval={3000}
                data={media}
                enabled={media.length > 1}
                scrollAnimationDuration={1200}
                renderItem={({ item }) => (
                  <View style={[styles.carouselItem, { backgroundColor: theme.colors.surface }]}>
                    <Image source={{ uri: item.imageUrl }} style={styles.image} />
                    <View style={styles.overlay}>
                      <Text style={styles.description} numberOfLines={2}>{item.description}</Text>
                    </View>
                  </View>
                )}
              />
            ) : (
              <View style={[styles.noData, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                <Ionicons name="images-outline" size={40} color={theme.colors.textSecondary} style={{ marginBottom: 8 }} />
                <Text style={{ color: theme.colors.textSecondary, fontWeight: '500' }}>No approved media available</Text>
              </View>
            )}
          </MotiView>

          <View style={styles.eventsSection}>
            <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}>Recent Activities</Text>
            {activities.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 10 }}>
                {activities.map((activity, index) => {
                  const thumbnail = activity.mediaUrls && activity.mediaUrls.length > 0 ? activity.mediaUrls[0] : null;
                  // Handle auto-generated video thumbnails by replacing .mp4 with .jpg (Cloudinary feature)
                  const thumbUrl = thumbnail && thumbnail.endsWith('.mp4') ? thumbnail.replace('.mp4', '.jpg') : thumbnail;
                  
                  return (
                    <MotiView 
                      key={activity._id}
                      from={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ type: 'timing', duration: 400, delay: index * 100 }}
                    >
                      <TouchableOpacity 
                        style={[styles.eventCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
                        onPress={() => navigation.navigate('ActivityDetails', { activityId: activity._id })}
                        activeOpacity={0.8}
                      >
                        {thumbUrl ? (
                          <Image source={{ uri: thumbUrl }} style={styles.eventThumbnail} />
                        ) : (
                          <View style={[styles.eventThumbnail, { backgroundColor: theme.colors.background, justifyContent: 'center', alignItems: 'center' }]}>
                            <Ionicons name="image-outline" size={32} color={theme.colors.textSecondary} />
                          </View>
                        )}
                        <View style={styles.eventInfo}>
                          <Text style={[styles.eventName, { color: theme.colors.textPrimary }]} numberOfLines={1}>{activity.name}</Text>
                          <Text style={[styles.eventSchool, { color: theme.colors.textSecondary }]} numberOfLines={1}>{activity.schoolId?.name}</Text>
                          <View style={styles.eventMetaRow}>
                            <Ionicons name="calendar-outline" size={12} color={theme.colors.textSecondary} />
                            <Text style={[styles.eventDate, { color: theme.colors.textSecondary }]}>{new Date(activity.activityDate).toLocaleDateString()}</Text>
                          </View>
                        </View>
                      </TouchableOpacity>
                    </MotiView>
                  );
                })}
              </ScrollView>
            ) : (
              <Text style={[styles.noEventsText, { color: theme.colors.textSecondary }]}>No recent activities to show.</Text>
            )}
          </View>

          <View style={styles.actionsContainer}>
            <MotiView
              from={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'timing', duration: 400, delay: 200 }}
            >
              <TouchableOpacity 
                style={[styles.portalBtn, { backgroundColor: theme.colors.primary }]}
                onPress={() => navigation.navigate(getPortalRoute())}
                activeOpacity={0.8}
              >
                <View style={styles.portalBtnContent}>
                  <Ionicons name="apps-outline" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
                  <Text style={styles.portalBtnText}>Go to My Portal</Text>
                  <Ionicons name="chevron-forward-outline" size={18} color="#FFFFFF" style={{ marginLeft: 8 }} />
                </View>
              </TouchableOpacity>
            </MotiView>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1 
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    paddingHorizontal: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerLeft: {
    flex: 1,
  },
  headerText: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  welcomeText: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  carouselContainer: {
    marginTop: 10,
  },
  carouselItem: {
    flex: 1,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  overlay: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  description: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 14,
  },
  actionsContainer: {
    paddingHorizontal: 20,
    paddingVertical: 32,
  },
  portalBtn: {
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  portalBtnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  portalBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  noData: {
    height: width * 0.56,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    marginTop: 20,
  },
  eventsSection: {
    marginTop: 32,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  eventCard: {
    width: 240,
    marginRight: 16,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  eventThumbnail: {
    width: '100%',
    height: 135,
    resizeMode: 'cover',
  },
  eventInfo: {
    padding: 12,
  },
  eventName: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  eventSchool: {
    fontSize: 13,
    marginBottom: 8,
  },
  eventMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  eventDate: {
    fontSize: 12,
    marginLeft: 4,
  },
  noEventsText: {
    paddingHorizontal: 20,
    fontStyle: 'italic',
  }
});
