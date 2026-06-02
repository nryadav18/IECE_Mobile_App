import React, { useEffect, useState, useContext, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity, RefreshControl, ScrollView, Image } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { ThemeContext } from '../context/ThemeContext';
import { AuthContext } from '../context/AuthContext';
import api from '../services/api';
import { MotiView } from 'moti';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Avatar from '../components/Avatar';
import CustomAlert from '../components/CustomAlert';
import CreateEventForm from '../components/CreateEventForm';
import EditEventModal from '../components/EditEventModal';
import ScreenLoader from '../components/ScreenLoader';

export default function TrainerPortal({ navigation }) {
  const [school, setSchool] = useState(null);
  const [feed, setFeed] = useState([]); // This will now hold activities
  const [myEvents, setMyEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('Activities');
  const [eventToEdit, setEventToEdit] = useState(null);
  const { theme } = useContext(ThemeContext);
  const { user } = useContext(AuthContext);
  const insets = useSafeAreaInsets();

  const [alertConfig, setAlertConfig] = useState({ visible: false, title: '', message: '', type: 'info', buttons: [] });

  const showAlert = (title, message, type = 'info', buttons = []) => {
    setAlertConfig({ visible: true, title, message, type, buttons });
  };

  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData().finally(() => setRefreshing(false));
  }, []);

  const fetchData = async () => {
    try {
      if (user.schoolId) {
        const schoolRes = await api.get(`/schools/${user.schoolId}`);
        setSchool(schoolRes.data.data);
      }
      
      const [activitiesRes, eventsRes] = await Promise.all([
        api.get(`/activities?trainerId=${user._id || user.id}`),
        api.get(`/events?uploaderId=${user._id || user.id}`)
      ]);
      setFeed(activitiesRes.data.data);
      setMyEvents(eventsRes.data.data);
    } catch (error) {
      console.log('Error fetching trainer data', error);
    } finally {
      setLoading(false);
    }
  };

  const uploadTimetable = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf' });
      if (!result.canceled) {
        // Mock upload logic - in real app, upload to S3 and get URL
        const mockUrl = 'https://example.com/timetable.pdf';
        await api.put('/auth/updatedetails', { timetablePdfUrl: mockUrl });
        showAlert('Success', 'Timetable uploaded successfully!', 'success');
      }
    } catch (err) {
      showAlert('Error', 'Failed to upload timetable', 'error');
    }
  };

  const submitActivity = async (activityId) => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 0.5,
      });
      if (!result.canceled) {
        // Mock upload logic
        const mockUrl = 'https://example.com/proof.jpg';
        await api.put(`/activities/${activityId}/submit`, { proofPhotoUrl: mockUrl });
        showAlert('Success', 'Activity submitted for approval!', 'success');
        fetchData();
      }
    } catch (err) {
      showAlert('Error', 'Failed to submit activity', 'error');
    }
  };

  const deleteEvent = (id) => {
    showAlert('Confirm', 'Are you sure you want to permanently delete this event?', 'warning', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            await api.delete(`/events/${id}`);
            showAlert('Success', 'Event deleted permanently.', 'success');
            fetchData();
          } catch (err) {
            showAlert('Error', 'Failed to delete event.', 'error');
          }
      }}
    ]);
  };

  if (loading) {
    return <ScreenLoader message="Loading Trainer Portal..." />;
  }

  const renderHeader = () => (
    <View style={{ paddingBottom: 16 }}>
      <View style={{ display: activeTab === 'Activities' ? 'flex' : 'none' }}>
        {/* School details Card */}
        <MotiView 
        from={{ opacity: 0, translateY: 15 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'timing', duration: 400 }}
        style={[styles.schoolCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
      >
        <View style={styles.cardHeader}>
          <Ionicons name="school-outline" size={22} color={theme.colors.primary} />
          <Text style={[styles.cardTitle, { color: theme.colors.textPrimary }]}>Assigned School</Text>
        </View>

        {school ? (
          <View style={styles.cardBody}>
            <View style={styles.detailRow}>
              <Ionicons name="business-outline" size={16} color={theme.colors.textSecondary} style={styles.detailIcon} />
              <Text style={[styles.detailLabel, { color: theme.colors.textSecondary }]}>Name:</Text>
              <Text style={[styles.detailValue, { color: theme.colors.textPrimary }]}>{school.name}</Text>
            </View>
            <View style={styles.detailRow}>
              <Ionicons name="person-outline" size={16} color={theme.colors.textSecondary} style={styles.detailIcon} />
              <Text style={[styles.detailLabel, { color: theme.colors.textSecondary }]}>Chairman:</Text>
              <Text style={[styles.detailValue, { color: theme.colors.textPrimary }]}>{school.chairmanId?.name || 'N/A'}</Text>
            </View>
            <View style={styles.detailRow}>
              <Ionicons name="calendar-outline" size={16} color={theme.colors.textSecondary} style={styles.detailIcon} />
              <Text style={[styles.detailLabel, { color: theme.colors.textSecondary }]}>Start Date:</Text>
              <Text style={[styles.detailValue, { color: theme.colors.textPrimary }]}>
                {new Date(school.startDate).toLocaleDateString()}
              </Text>
            </View>
            <View style={styles.detailRow}>
              <Ionicons name="people-outline" size={16} color={theme.colors.textSecondary} style={styles.detailIcon} />
              <Text style={[styles.detailLabel, { color: theme.colors.textSecondary }]}>Strength:</Text>
              <Text style={[styles.detailValue, { color: theme.colors.textPrimary }]}>{school.totalStrength || 0}</Text>
            </View>
            <View style={styles.detailRow}>
              <Ionicons name="time-outline" size={16} color={theme.colors.textSecondary} style={styles.detailIcon} />
              <Text style={[styles.detailLabel, { color: theme.colors.textSecondary }]}>Assoc. Year:</Text>
              <Text style={[styles.detailValue, { color: theme.colors.textPrimary }]}>{school.associationYear || 'N/A'}</Text>
            </View>
            <View style={styles.detailRow}>
              <Ionicons name="book-outline" size={16} color={theme.colors.textSecondary} style={styles.detailIcon} />
              <Text style={[styles.detailLabel, { color: theme.colors.textSecondary }]}>Classes:</Text>
              <Text style={[styles.detailValue, { color: theme.colors.textPrimary }]}>{user.classesHandled ? user.classesHandled.join(', ') : 'N/A'}</Text>
            </View>
          </View>
        ) : (
          <View style={styles.noDataRow}>
            <Ionicons name="alert-circle-outline" size={20} color={theme.colors.textSecondary} style={{ marginRight: 8 }} />
            <Text style={{ color: theme.colors.textSecondary, fontWeight: '500' }}>No school assigned.</Text>
          </View>
        )}
      </MotiView>

      <TouchableOpacity 
        style={[styles.uploadBtn, { backgroundColor: theme.colors.primary }]}
        onPress={uploadTimetable}
      >
        <Ionicons name="document-attach-outline" size={20} color="#fff" />
        <Text style={styles.uploadBtnText}>Upload Timetable (PDF)</Text>
      </TouchableOpacity>

      <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}>Assigned Activities</Text>
      </View>

      <View style={{ display: activeTab === 'Events' ? 'flex' : 'none' }}>
        <CreateEventForm onEventCreated={fetchData} />
      </View>

      <View style={{ display: activeTab === 'ManageEvents' ? 'flex' : 'none', marginTop: 16 }}>
        {myEvents.length === 0 ? (
           <View style={{ alignItems: 'center', marginTop: 40 }}>
             <Ionicons name="calendar-outline" size={48} color={theme.colors.border} />
             <Text style={{ color: theme.colors.textSecondary, marginTop: 12 }}>No events published yet.</Text>
           </View>
        ) : (
           myEvents.map(evt => (
             <View key={evt._id} style={[styles.eventCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
               <View style={{ flexDirection: 'row', marginBottom: 16 }}>
                 {evt.mediaUrls && evt.mediaUrls.length > 0 ? (
                   <Image source={{ uri: evt.mediaUrls[0] }} style={{ width: 80, height: 80, borderRadius: 12, resizeMode: 'cover', marginRight: 16 }} />
                 ) : (
                   <View style={{ width: 80, height: 80, borderRadius: 12, backgroundColor: theme.colors.border, marginRight: 16, justifyContent: 'center', alignItems: 'center' }}>
                     <Ionicons name="image-outline" size={32} color={theme.colors.textSecondary} />
                   </View>
                 )}
                 <View style={{ flex: 1, justifyContent: 'center' }}>
                   <Text style={[styles.eventTitle, { color: theme.colors.textPrimary }]} numberOfLines={2}>{evt.name}</Text>
                   <Text style={[styles.eventDate, { color: theme.colors.textSecondary }]}>{new Date(evt.eventDate).toLocaleDateString()}</Text>
                   <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>{evt.organizers?.length || 0} Organizers</Text>
                 </View>
               </View>
               
               <View style={styles.eventActions}>
                 <TouchableOpacity style={[styles.actionBtn, { borderColor: theme.colors.primary, backgroundColor: theme.colors.primary + '10' }]} onPress={() => setEventToEdit(evt)}>
                   <Ionicons name="create-outline" size={18} color={theme.colors.primary} />
                   <Text style={{ color: theme.colors.primary, fontSize: 13, marginLeft: 6, fontWeight: '600' }}>Edit Event</Text>
                 </TouchableOpacity>
                 <TouchableOpacity style={[styles.actionBtn, { borderColor: '#FF4444', backgroundColor: '#FF444410' }]} onPress={() => deleteEvent(evt._id)}>
                   <Ionicons name="trash-outline" size={18} color="#FF4444" />
                   <Text style={{ color: '#FF4444', fontSize: 13, marginLeft: 6, fontWeight: '600' }}>Delete</Text>
                 </TouchableOpacity>
               </View>
             </View>
           ))
        )}
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background, paddingTop: insets.top }]}>
      {/* Fixed Header */}
      <View style={{ paddingHorizontal: 20, paddingTop: 4 }}>
        <TouchableOpacity 
          style={[styles.backBtn, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}
          onPress={() => navigation.goBack()}
          activeOpacity={0.8}
        >
          <Ionicons name="arrow-back-outline" size={20} color={theme.colors.textPrimary} />
        </TouchableOpacity>

        <Text style={[styles.title, { color: theme.colors.textPrimary }]}>Trainer Portal</Text>

        {/* Tabs - Pill Style */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsContainer} contentContainerStyle={{ paddingVertical: 4 }}>
          {[
            { key: 'Activities', label: 'Activities', icon: 'list-outline' },
            { key: 'Events', label: 'Publish Event', icon: 'add-circle-outline' },
            { key: 'ManageEvents', label: 'Manage Events', icon: 'calendar-outline' },
          ].map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                activeOpacity={0.8}
                style={[
                  styles.pillTab,
                  {
                    backgroundColor: isActive ? theme.colors.primary : theme.colors.surface,
                    borderColor: isActive ? theme.colors.primary : theme.colors.border,
                  }
                ]}
                onPress={() => setActiveTab(tab.key)}
              >
                <Ionicons
                  name={isActive ? tab.icon.replace('-outline', '') || tab.icon : tab.icon}
                  size={16}
                  color={isActive ? '#FFFFFF' : theme.colors.textSecondary}
                />
                <Text style={[
                  styles.pillTabText,
                  { color: isActive ? '#FFFFFF' : theme.colors.textSecondary },
                  isActive && { fontWeight: '700' }
                ]}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <FlatList
        data={feed}
        keyExtractor={(item) => item._id}
        ListHeaderComponent={renderHeader}
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 20 }}
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
        renderItem={({ item, index }) => (
          <MotiView
            from={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'timing', duration: 300, delay: index * 50 }}
            style={[styles.feedItem, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, display: activeTab === 'Activities' ? 'flex' : 'none' }]}
          >
            <View style={styles.feedHeader}>
              <View style={styles.feedMeta}>
                <Text style={[styles.feedUploader, { color: theme.colors.textPrimary }]}>{item.name}</Text>
                <Text style={[styles.feedDate, { color: theme.colors.textSecondary }]}>
                  Status: {item.status}
                </Text>
              </View>
            </View>
            {item.status === 'Pending' || item.status === 'Sent Back' ? (
              <TouchableOpacity 
                style={[styles.submitBtn, { borderColor: theme.colors.primary }]}
                onPress={() => submitActivity(item._id)}
              >
                <Text style={[styles.submitBtnText, { color: theme.colors.primary }]}>Upload Proof & Submit</Text>
              </TouchableOpacity>
            ) : null}
          </MotiView>
        )}
        ListEmptyComponent={
          activeTab === 'Activities' ? (
            <View style={[styles.emptyContainer, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
              <Ionicons name="chatbox-ellipses-outline" size={32} color={theme.colors.textSecondary} style={{ marginBottom: 8 }} />
              <Text style={{ color: theme.colors.textSecondary, fontWeight: '500' }}>No engagement data available.</Text>
            </View>
          ) : null
        }
      />
      <EditEventModal 
        visible={!!eventToEdit}
        event={eventToEdit}
        onClose={() => setEventToEdit(null)}
        onSuccess={() => {
          setEventToEdit(null);
          showAlert('Success', 'Event updated successfully.', 'success');
          fetchData();
        }}
        onError={(msg) => showAlert('Error', msg, 'error')}
      />

      <CustomAlert 
        visible={alertConfig.visible}
        title={alertConfig.title}
        message={alertConfig.message}
        type={alertConfig.type}
        buttons={alertConfig.buttons}
        onDismiss={() => setAlertConfig({ ...alertConfig, visible: false })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  tabsContainer: { flexDirection: 'row', marginBottom: 20 },
  pillTab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 10,
    marginRight: 10,
    borderRadius: 25,
    borderWidth: 1.5,
  },
  pillTabText: { fontSize: 13, fontWeight: '600', marginLeft: 6 },
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  proofImg: { width: '100%', height: 160, resizeMode: 'cover', borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  eventCard: { padding: 16, borderRadius: 16, borderWidth: 1, marginBottom: 16 },
  eventTitle: { fontSize: 16, fontWeight: 'bold', marginBottom: 6 },
  eventDate: { fontSize: 13, marginBottom: 4 },
  eventActions: { flexDirection: 'row', gap: 12 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  title: { 
    fontSize: 24, 
    fontWeight: '700', 
    marginBottom: 20,
    letterSpacing: -0.5,
  },
  schoolCard: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 28,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginLeft: 10,
    letterSpacing: -0.2,
  },
  cardBody: {
    paddingLeft: 2,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  detailIcon: {
    marginRight: 10,
  },
  detailLabel: {
    fontSize: 14,
    fontWeight: '600',
    width: 90,
  },
  detailValue: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
  },
  noDataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
    letterSpacing: -0.3,
  },
  feedItem: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 12,
  },
  feedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  feedAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  feedMeta: {
    flex: 1,
  },
  feedUploader: {
    fontSize: 14,
    fontWeight: '600',
  },
  feedDate: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 1,
  },
  feedDescription: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  emptyContainer: {
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    borderRadius: 12,
    marginBottom: 24,
  },
  uploadBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  submitBtn: {
    padding: 10,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 12,
  },
  submitBtnText: {
    fontSize: 14,
    fontWeight: '600',
  }
});
