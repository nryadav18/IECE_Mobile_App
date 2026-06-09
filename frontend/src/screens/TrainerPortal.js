import React, { useEffect, useState, useContext, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity, RefreshControl, ScrollView, Image } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { ThemeContext } from '../context/ThemeContext';
import { AuthContext } from '../context/AuthContext';
import api from '../services/api';
import { MotiView } from 'moti';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import CustomAlert from '../components/CustomAlert';
import CreateActivityForm from '../components/CreateActivityForm';
import EditActivityModal from '../components/EditActivityModal';
import ScreenLoader from '../components/ScreenLoader';
import { Calendar } from 'react-native-calendars';
import { useAlert } from '../context/AlertContext';

export default function TrainerPortal({ navigation }) {
  const [school, setSchool] = useState(null);
  const [myActivities, setMyActivities] = useState([]);
  const [approvedCount, setApprovedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('Progress');
  const [activityToEdit, setActivityToEdit] = useState(null);
  const [attendanceRecords, setAttendanceRecords] = useState([]);
  const [faceStatus, setFaceStatus] = useState('none'); // 'none' | 'pending' | 'approved'
  
  const { theme } = useContext(ThemeContext);
  const { user } = useContext(AuthContext);
  const insets = useSafeAreaInsets();
  const { showAlert: showGlobalAlert } = useAlert();

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

  // Re-fetch attendance & face status whenever screen is focused (e.g. after marking attendance)
  useFocusEffect(
    useCallback(() => {
      fetchFaceStatusAndAttendance();
    }, [])
  );

  const fetchFaceStatusAndAttendance = async () => {
    try {
      const [meRes, attendanceRes] = await Promise.all([
        api.get('/auth/me'),
        api.get('/attendance/my-attendance')
      ]);
      setFaceStatus(meRes.data.data?.facialRegistrationStatusV2 || meRes.data.data?.facialRegistrationStatus || 'none');
      setAttendanceRecords(attendanceRes.data.data || []);
    } catch (error) {
      console.log('Error fetching face/attendance status', error);
    }
  };

  const fetchData = async () => {
    try {
      if (user.schoolId) {
        const schoolRes = await api.get(`/schools/${user.schoolId}`);
        setSchool(schoolRes.data.data);

        // Fetch approved activities for progress counter
        const approvedRes = await api.get(`/activities?schoolId=${user.schoolId}&status=approved`);
        setApprovedCount(approvedRes.data.count || approvedRes.data.data.length);
      }
      
      // Fetch all activities for the school to share among trainers
      if (user.schoolId) {
        const myActRes = await api.get(`/activities?schoolId=${user.schoolId}`);
        setMyActivities(myActRes.data.data);
      } else {
        const myActRes = await api.get(`/activities?uploaderId=${user._id || user.id}`);
        setMyActivities(myActRes.data.data);
      }

      const [attendanceRes, meRes] = await Promise.all([
        api.get('/attendance/my-attendance'),
        api.get('/auth/me')
      ]);
      setAttendanceRecords(attendanceRes.data.data || []);
      setFaceStatus(meRes.data.data?.facialRegistrationStatusV2 || meRes.data.data?.facialRegistrationStatus || 'none');
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
        const mockUrl = 'https://example.com/timetable.pdf';
        await api.put('/auth/updatedetails', { timetablePdfUrl: mockUrl });
        showAlert('Success', 'Timetable uploaded successfully!', 'success');
      }
    } catch (err) {
      showAlert('Error', 'Failed to upload timetable', 'error');
    }
  };

  const deleteActivity = (id) => {
    showAlert('Confirm', 'Are you sure you want to permanently delete this activity?', 'warning', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            await api.delete(`/activities/${id}`);
            showAlert('Success', 'Activity deleted permanently.', 'success');
            fetchData();
          } catch (err) {
            showAlert('Error', 'Failed to delete activity.', 'error');
          }
      }}
    ]);
  };

  if (loading) {
    return <ScreenLoader message="Loading Trainer Portal..." />;
  }

  const renderProgressTab = () => {
    const remainingCount = Math.max(0, 30 - approvedCount);
    const progressPercent = Math.min(100, (approvedCount / 30) * 100);

    return (
      <ScrollView 
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 20 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />
        }
      >
        {/* Progress Card */}
        <MotiView
          from={{ opacity: 0, translateY: 15 }}
          animate={{ opacity: 1, translateY: 0 }}
          style={[styles.progressCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
        >
          <View style={styles.cardHeader}>
            <Ionicons name="ribbon-outline" size={24} color={theme.colors.primary} />
            <Text style={[styles.cardTitle, { color: theme.colors.textPrimary }]}>School Activities Quota</Text>
          </View>
          <View style={styles.quotaRow}>
            <View style={styles.quotaBlock}>
              <Text style={[styles.quotaNumber, { color: theme.colors.primary }]}>{approvedCount}</Text>
              <Text style={[styles.quotaLabel, { color: theme.colors.textSecondary }]}>Approved</Text>
            </View>
            <View style={[styles.quotaDivider, { backgroundColor: theme.colors.border }]} />
            <View style={styles.quotaBlock}>
              <Text style={[styles.quotaNumber, { color: theme.colors.textPrimary }]}>{remainingCount}</Text>
              <Text style={[styles.quotaLabel, { color: theme.colors.textSecondary }]}>Remaining</Text>
            </View>
            <View style={[styles.quotaDivider, { backgroundColor: theme.colors.border }]} />
            <View style={styles.quotaBlock}>
              <Text style={[styles.quotaNumber, { color: theme.colors.textSecondary }]}>30</Text>
              <Text style={[styles.quotaLabel, { color: theme.colors.textSecondary }]}>Target</Text>
            </View>
          </View>

          {/* Progress Bar */}
          <View style={styles.progressBarWrapper}>
            <View style={[styles.progressBarBackground, { backgroundColor: theme.colors.border }]}>
              <View style={[styles.progressBarFill, { width: `${progressPercent}%`, backgroundColor: theme.colors.primary }]} />
            </View>
            <Text style={[styles.progressPercentText, { color: theme.colors.textSecondary }]}>
              {Math.floor(progressPercent)}% of target met
            </Text>
          </View>
        </MotiView>

        {/* School details Card */}
        <MotiView 
          from={{ opacity: 0, translateY: 15 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ delay: 100 }}
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
      </ScrollView>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background, paddingTop: insets.top }]}>
      {/* Fixed Header */}
      <View style={{ paddingHorizontal: 20, paddingTop: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TouchableOpacity 
              style={[styles.backBtn, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface, marginBottom: 0, marginRight: 16 }]}
              onPress={() => navigation.goBack()}
              activeOpacity={0.8}
            >
              <Ionicons name="arrow-back-outline" size={20} color={theme.colors.textPrimary} />
            </TouchableOpacity>

            <Text style={[styles.title, { color: theme.colors.textPrimary, marginBottom: 0 }]}>Trainer Portal</Text>
          </View>
          <TouchableOpacity 
            onPress={() => navigation.navigate('UserProfile', { userId: 'me' })} 
            style={{ 
              width: 36, 
              height: 36, 
              borderRadius: 18, 
              backgroundColor: '#FF3B30', 
              alignItems: 'center', 
              justifyContent: 'center',
              elevation: 2,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.2,
              shadowRadius: 1.41
            }}
            activeOpacity={0.8}
          >
            <Ionicons name="person" size={18} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        {/* Tabs - Pill Style */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsContainer} contentContainerStyle={{ paddingVertical: 4 }}>
          {[
            { key: 'Progress', label: 'Progress', icon: 'ribbon-outline' },
            { key: 'Attendance', label: 'Attendance', icon: 'calendar-outline' },
            { key: 'PublishActivity', label: 'Publish Activity', icon: 'add-circle-outline' },
            { key: 'ManageActivities', label: 'Manage Activities', icon: 'list-outline' },
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

      {activeTab === 'Progress' && renderProgressTab()}

      {activeTab === 'Attendance' && (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 20 }}>
          {/* Dynamic Buttons based on status */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
            {faceStatus !== 'approved' ? (
              /* Single Button Layout */
              <>
                {faceStatus === 'none' && (
                  <TouchableOpacity
                    style={[styles.uploadBtn, { flex: 1, backgroundColor: theme.colors.primary }]}
                    onPress={() => navigation.navigate('FaceRegistration')}
                  >
                    <Ionicons name="scan-outline" size={20} color="#fff" />
                    <Text style={[styles.uploadBtnText, { fontSize: 13 }]}>Register Face</Text>
                  </TouchableOpacity>
                )}
                {faceStatus === 'pending' && (
                  <View style={[styles.uploadBtn, { flex: 1, backgroundColor: '#F59E0B', opacity: 0.9 }]}>
                    <Ionicons name="hourglass-outline" size={20} color="#fff" />
                    <Text style={[styles.uploadBtnText, { fontSize: 13 }]}>Pending Approval</Text>
                  </View>
                )}
              </>
            ) : (
              /* Side-by-Side Login/Logout */
              <View style={{ flexDirection: 'row', gap: 10, flex: 1 }}>
                <TouchableOpacity
                  style={[styles.uploadBtn, { flex: 1, backgroundColor: '#4CAF50' }]}
                  onPress={() => navigation.navigate('Attendance', { intent: 'login' })}
                >
                  <Ionicons name="log-in-outline" size={20} color="#fff" />
                  <Text style={[styles.uploadBtnText, { fontSize: 13 }]}>Check In</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.uploadBtn, { flex: 1, backgroundColor: '#F44336' }]}
                  onPress={() => navigation.navigate('Attendance', { intent: 'logout' })}
                >
                  <Ionicons name="log-out-outline" size={20} color="#fff" />
                  <Text style={[styles.uploadBtnText, { fontSize: 13 }]}>Check Out</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Status info banner */}
          {faceStatus === 'pending' && (
            <View style={{ backgroundColor: '#FEF3C7', borderRadius: 10, padding: 12, marginBottom: 16, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#F59E0B' }}>
              <Ionicons name="hourglass-outline" size={16} color="#D97706" style={{ marginRight: 8 }} />
              <Text style={{ color: '#92400E', fontSize: 12, fontWeight: '600', flex: 1 }}>Your facial registration is pending admin approval. You will be able to mark attendance once approved.</Text>
            </View>
          )}

          <View style={{ backgroundColor: theme.colors.surface, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: theme.colors.border }}>
            <Calendar
              current={new Date().toISOString().split('T')[0]}
              markedDates={{
                ...attendanceRecords.reduce((acc, record) => {
                  const dateString = new Date(record.date).toISOString().split('T')[0];
                  let color = '#E0E0E0';
                  if (record.status === 'Present') color = '#4CAF50';
                  if (record.status === 'Absent') color = '#F44336';
                  if (record.status === 'Leave') color = '#FFC107';
                  acc[dateString] = {
                    customStyles: {
                      container: { backgroundColor: color, borderRadius: 8 },
                      text: { color: 'white', fontWeight: 'bold' }
                    }
                  };
                  return acc;
                }, {}),
                // Always mark today
                [new Date().toISOString().split('T')[0]]: {
                  ...(attendanceRecords.find(r => new Date(r.date).toISOString().split('T')[0] === new Date().toISOString().split('T')[0]) ? {} : {
                    customStyles: {
                      container: { backgroundColor: '#E0E0E0', borderRadius: 8, borderWidth: 2, borderColor: theme.colors.primary },
                      text: { color: theme.colors.textPrimary, fontWeight: 'bold' }
                    }
                  })
                }
              }}
              markingType={'custom'}
              theme={{
                calendarBackground: theme.colors.surface,
                textSectionTitleColor: theme.colors.textSecondary,
                dayTextColor: theme.colors.textPrimary,
                monthTextColor: theme.colors.primary,
                arrowColor: theme.colors.primary,
                todayTextColor: theme.colors.primary,
              }}
            />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginTop: 20 }}>
            <View style={{ alignItems: 'center' }}><View style={{ width: 16, height: 16, backgroundColor: '#4CAF50', borderRadius: 4, marginBottom: 4 }} /><Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>Present</Text></View>
            <View style={{ alignItems: 'center' }}><View style={{ width: 16, height: 16, backgroundColor: '#F44336', borderRadius: 4, marginBottom: 4 }} /><Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>Absent</Text></View>
            <View style={{ alignItems: 'center' }}><View style={{ width: 16, height: 16, backgroundColor: '#FFC107', borderRadius: 4, marginBottom: 4 }} /><Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>Leave</Text></View>
            <View style={{ alignItems: 'center' }}><View style={{ width: 16, height: 16, backgroundColor: '#E0E0E0', borderRadius: 4, marginBottom: 4 }} /><Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>Blank</Text></View>
          </View>
        </ScrollView>
      )}

      {activeTab === 'PublishActivity' && (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 20 }}>
          <CreateActivityForm onActivityCreated={() => {
            fetchData();
            setActiveTab('Progress');
          }} />
        </ScrollView>
      )}

      {activeTab === 'ManageActivities' && (
        <FlatList
          data={myActivities}
          keyExtractor={(item) => item._id}
          contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 20 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />
          }
          renderItem={({ item }) => (
            <View style={[styles.activityCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
              <View style={{ flexDirection: 'row', marginBottom: 16 }}>
                {item.mediaUrls && item.mediaUrls.length > 0 ? (
                  <Image source={{ uri: item.mediaUrls[0] }} style={{ width: 80, height: 80, borderRadius: 12, marginRight: 16 }} />
                ) : (
                  <View style={{ width: 80, height: 80, borderRadius: 12, backgroundColor: theme.colors.background, marginRight: 16, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: theme.colors.border }}>
                    <Ionicons name="image-outline" size={32} color={theme.colors.textSecondary} />
                  </View>
                )}
                <View style={{ flex: 1, justifyContent: 'center' }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                    <Text style={[styles.activityTitle, { color: theme.colors.textPrimary, flex: 1, marginRight: 8 }]} numberOfLines={2}>{item.name}</Text>
                    {/* Status Badge */}
                    <View style={[styles.statusBadge, { 
                      backgroundColor: item.status === 'approved' ? '#27AE6020' : item.status === 'rejected' ? '#E2374420' : '#FFC10720',
                      borderColor: item.status === 'approved' ? '#27AE60' : item.status === 'rejected' ? '#E23744' : '#FFC107',
                      borderWidth: 1
                    }]}>
                      <Text style={{ 
                        color: item.status === 'approved' ? '#27AE60' : item.status === 'rejected' ? '#E23744' : '#CC9900',
                        fontSize: 11,
                        fontWeight: '700',
                        textTransform: 'uppercase'
                      }}>{item.status}</Text>
                    </View>
                  </View>
                  <Text style={[styles.activityDateText, { color: theme.colors.textSecondary }]}>{new Date(item.activityDate).toLocaleDateString()}</Text>
                  <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 4 }}>
                    Uploaded by: {item.uploaderId?.name || 'Unknown'}
                  </Text>
                </View>
              </View>

              {item.status === 'rejected' && item.rejectionRemark && (
                <View style={{ backgroundColor: '#E2374410', borderColor: '#E2374430', borderWidth: 1, padding: 12, borderRadius: 8, marginTop: 4, marginBottom: 12 }}>
                  <Text style={{ color: '#E23744', fontSize: 12, fontWeight: '700' }}>Rejection Reason:</Text>
                  <Text style={{ color: theme.colors.textPrimary, fontSize: 12, marginTop: 2 }}>{item.rejectionRemark}</Text>
                </View>
              )}
              
              {/* Only allow editing/deleting if this trainer uploaded it */}
              {(item.uploaderId?._id || item.uploaderId) === (user._id || user.id) && (
                <View style={styles.activityActions}>
                  <TouchableOpacity 
                    style={[styles.actionBtn, { borderColor: theme.colors.primary, backgroundColor: theme.colors.primary + '10', opacity: item.status === 'rejected' ? 0.4 : 1 }]} 
                    onPress={() => setActivityToEdit(item)}
                    disabled={item.status === 'rejected'}
                  >
                    <Ionicons name="create-outline" size={18} color={theme.colors.primary} />
                    <Text style={{ color: theme.colors.primary, fontSize: 13, marginLeft: 6, fontWeight: '600' }}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.actionBtn, { borderColor: '#FF4444', backgroundColor: '#FF444410', opacity: item.status === 'rejected' ? 0.4 : 1 }]} 
                    onPress={() => deleteActivity(item._id)}
                    disabled={item.status === 'rejected'}
                  >
                    <Ionicons name="trash-outline" size={18} color="#FF4444" />
                    <Text style={{ color: '#FF4444', fontSize: 13, marginLeft: 6, fontWeight: '600' }}>Delete</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', marginTop: 40 }}>
              <Ionicons name="calendar-outline" size={48} color={theme.colors.border} />
              <Text style={{ color: theme.colors.textSecondary, marginTop: 12 }}>No activities published yet.</Text>
            </View>
          }
        />
      )}

      <EditActivityModal 
        visible={!!activityToEdit}
        activity={activityToEdit}
        onClose={() => setActivityToEdit(null)}
        onSuccess={() => {
          setActivityToEdit(null);
          showAlert('Success', 'Activity updated successfully.', 'success');
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
  container: { flex: 1 },
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
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: { 
    fontSize: 24, 
    fontWeight: '700', 
    marginBottom: 20,
    letterSpacing: -0.5,
  },
  progressCard: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 20,
  },
  quotaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    marginVertical: 16,
  },
  quotaBlock: {
    alignItems: 'center',
  },
  quotaNumber: {
    fontSize: 24,
    fontWeight: '800',
  },
  quotaLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  quotaDivider: {
    width: 1,
    height: 36,
  },
  progressBarWrapper: {
    marginTop: 8,
  },
  progressBarBackground: {
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 5,
  },
  progressPercentText: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 6,
    textAlign: 'right',
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
  activityCard: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 16,
  },
  activityTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  activityDateText: {
    fontSize: 13,
    marginBottom: 6,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  activityActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  bellBtn: {
    padding: 8,
    position: 'relative'
  },
  badge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: 'bold',
  }
});
