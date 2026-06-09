import React, { useState, useEffect, useContext } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl, TouchableOpacity, Dimensions } from 'react-native';
import { ThemeContext } from '../context/ThemeContext';
import { AuthContext } from '../context/AuthContext';
import api from '../services/api';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Calendar } from 'react-native-calendars';

const { width } = Dimensions.get('window');

export default function UserProfileScreen({ route, navigation }) {
  const { userId } = route.params || { userId: 'me' };
  const { theme } = useContext(ThemeContext);
  const { user: currentUser } = useContext(AuthContext);
  const insets = useSafeAreaInsets();
  
  const [loading, setLoading] = useState(true);
  const [profileData, setProfileData] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('Overview');

  useEffect(() => {
    fetchProfile();
  }, [userId]);

  const fetchProfile = async () => {
    try {
      const res = await api.get(`/profile/${userId}`);
      setProfileData(res.data.data);
    } catch (error) {
      console.log('Failed to fetch profile', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    fetchProfile();
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (!profileData) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <Text style={{ color: theme.colors.textSecondary }}>Failed to load profile.</Text>
      </View>
    );
  }

  const { profile, attendance, visitReports, activities } = profileData;

  const getAttendanceSummary = () => {
    const present = attendance.filter(a => a.status === 'Present').length;
    const partiallyPresent = attendance.filter(a => a.status === 'Partially Present').length;
    const absent = attendance.filter(a => a.status === 'Absent').length;
    let totalMinutes = 0;
    attendance.forEach(a => {
        if(a.totalTimeSpent) totalMinutes += a.totalTimeSpent;
    });
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return { present, partiallyPresent, absent, totalTime: `${hours}h ${mins}m` };
  };

  const attSummary = getAttendanceSummary();

  const getMarkedDates = () => {
    const marked = {};
    attendance.forEach(att => {
      const dateStr = new Date(att.date).toISOString().split('T')[0];
      let color = '#9CA3AF'; // Default gray
      if (att.status === 'Present') color = '#10B981'; // Green
      else if (att.status === 'Partially Present') color = '#F59E0B'; // Yellow
      else if (att.status === 'Absent') color = '#EF4444'; // Red
      
      marked[dateStr] = {
        customStyles: {
          container: { backgroundColor: color, borderRadius: 8 },
          text: { color: 'white', fontWeight: 'bold' }
        }
      };
    });
    return marked;
  };

  const renderTabs = () => {
    const tabs = ['Overview', 'Attendance', 'Activities', 'Reports'];
    return (
      <View style={styles.tabsContainer}>
        {tabs.map(tab => {
          const isActive = activeTab === tab;
          return (
            <TouchableOpacity 
              key={tab} 
              style={[styles.tabBtn, { 
                backgroundColor: isActive ? theme.colors.primary : 'transparent',
                borderColor: isActive ? theme.colors.primary : theme.colors.border
              }]}
              onPress={() => setActiveTab(tab)}
            >
              <Text style={{ 
                color: isActive ? '#fff' : theme.colors.textSecondary,
                fontWeight: isActive ? 'bold' : 'normal',
                fontSize: 13
              }}>
                {tab}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  const renderOverview = () => (
    <View style={{ gap: 16 }}>
      {/* School / Leader details */}
      <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
          <Ionicons name="business-outline" size={20} color={theme.colors.primary} style={{ marginRight: 8 }} />
          <Text style={[styles.title, { color: theme.colors.textPrimary, marginBottom: 0 }]}>Assignment Details</Text>
        </View>
        
        {profile.schoolId ? (
          <View style={styles.detailRow}>
            <Text style={{ color: theme.colors.textSecondary, width: 80 }}>School:</Text>
            <Text style={{ color: theme.colors.textPrimary, flex: 1, fontWeight: '500' }}>{profile.schoolId.name}</Text>
          </View>
        ) : (
          <Text style={{ color: theme.colors.textSecondary }}>No school assigned.</Text>
        )}
        
        {profile.schoolId?.state && (
          <View style={styles.detailRow}>
            <Text style={{ color: theme.colors.textSecondary, width: 80 }}>Location:</Text>
            <Text style={{ color: theme.colors.textPrimary, flex: 1 }}>{profile.schoolId.state}</Text>
          </View>
        )}

        {profile.teamLeaderId && (
          <View style={[styles.detailRow, { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: theme.colors.border }]}>
            <Text style={{ color: theme.colors.textSecondary, width: 80 }}>Leader:</Text>
            <Text style={{ color: theme.colors.textPrimary, flex: 1, fontWeight: '500' }}>{profile.teamLeaderId.name}</Text>
          </View>
        )}
      </View>

      {/* Quick Stats Overview */}
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={[styles.statBox, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>Attendance</Text>
          <Text style={{ color: '#10B981', fontSize: 24, fontWeight: 'bold', marginVertical: 4 }}>{attSummary.present}</Text>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 11 }}>Days Present</Text>
        </View>
        <View style={[styles.statBox, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>Activities</Text>
          <Text style={{ color: theme.colors.primary, fontSize: 24, fontWeight: 'bold', marginVertical: 4 }}>{activities.length}</Text>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 11 }}>Total Uploaded</Text>
        </View>
      </View>
    </View>
  );

  const renderAttendance = () => (
    <View style={{ gap: 16 }}>
      {/* Calendar */}
      <View style={[styles.card, { padding: 0, overflow: 'hidden', backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
        <Calendar
          theme={{
            backgroundColor: theme.colors.surface,
            calendarBackground: theme.colors.surface,
            textSectionTitleColor: theme.colors.textSecondary,
            selectedDayBackgroundColor: theme.colors.primary,
            selectedDayTextColor: '#ffffff',
            todayTextColor: theme.colors.primary,
            dayTextColor: theme.colors.textPrimary,
            textDisabledColor: theme.colors.border,
            monthTextColor: theme.colors.textPrimary,
            arrowColor: theme.colors.primary,
          }}
          markingType={'custom'}
          markedDates={getMarkedDates()}
        />
        <View style={{ flexDirection: 'row', justifyContent: 'space-around', padding: 12, borderTopWidth: 1, borderTopColor: theme.colors.border, backgroundColor: theme.colors.background }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}><View style={[styles.legendDot, { backgroundColor: '#10B981' }]} /><Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>Present</Text></View>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}><View style={[styles.legendDot, { backgroundColor: '#F59E0B' }]} /><Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>Partial</Text></View>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}><View style={[styles.legendDot, { backgroundColor: '#EF4444' }]} /><Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>Absent</Text></View>
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
        <Text style={[styles.title, { color: theme.colors.textPrimary }]}>Recent History</Text>
        {attendance.slice(0, 5).map(att => (
          <View key={att._id} style={{ borderBottomWidth: 1, borderBottomColor: theme.colors.border, paddingVertical: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>
                {new Date(att.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
              </Text>
              <Text style={{ 
                color: att.status === 'Present' ? '#10B981' : att.status === 'Partially Present' ? '#F59E0B' : '#EF4444',
                fontWeight: '600', fontSize: 12 
              }}>
                {att.status}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', marginTop: 6, gap: 16 }}>
              {att.checkInTime && (
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
                  <Ionicons name="log-in-outline" size={12} /> {new Date(att.checkInTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                </Text>
              )}
              {att.checkOutTime && (
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
                  <Ionicons name="log-out-outline" size={12} /> {new Date(att.checkOutTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                </Text>
              )}
            </View>
          </View>
        ))}
        {attendance.length === 0 && <Text style={{ color: theme.colors.textSecondary }}>No attendance records found.</Text>}
      </View>
    </View>
  );

  const renderActivities = () => {
    const approved = activities.filter(a => a.status === 'approved').length;
    const pending = activities.filter(a => a.status === 'pending').length;
    const rejected = activities.filter(a => a.status === 'rejected').length;

    return (
      <View style={{ gap: 16 }}>
        <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
          <Text style={[styles.title, { color: theme.colors.textPrimary }]}>Activity Performance</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: '#10B981', fontSize: 22, fontWeight: 'bold' }}>{approved}</Text>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>Approved</Text>
            </View>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: '#F59E0B', fontSize: 22, fontWeight: 'bold' }}>{pending}</Text>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>Pending</Text>
            </View>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: '#EF4444', fontSize: 22, fontWeight: 'bold' }}>{rejected}</Text>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>Rejected</Text>
            </View>
          </View>
          
          {/* Simple progress bar representing approval rate */}
          {activities.length > 0 && (
            <View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>Approval Rate</Text>
                <Text style={{ color: theme.colors.primary, fontSize: 12, fontWeight: 'bold' }}>
                  {Math.round((approved / activities.length) * 100)}%
                </Text>
              </View>
              <View style={{ height: 8, backgroundColor: theme.colors.border, borderRadius: 4, overflow: 'hidden', flexDirection: 'row' }}>
                <View style={{ width: `${(approved / activities.length) * 100}%`, backgroundColor: '#10B981' }} />
                <View style={{ width: `${(pending / activities.length) * 100}%`, backgroundColor: '#F59E0B' }} />
                <View style={{ width: `${(rejected / activities.length) * 100}%`, backgroundColor: '#EF4444' }} />
              </View>
            </View>
          )}
        </View>

        <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
          <Text style={[styles.title, { color: theme.colors.textPrimary }]}>Recent Activities</Text>
          {activities.slice(0, 5).map(act => (
            <View key={act._id} style={{ borderBottomWidth: 1, borderBottomColor: theme.colors.border, paddingVertical: 10 }}>
              <Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>{act.title}</Text>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>{new Date(act.createdAt).toLocaleDateString()}</Text>
                <Text style={{ 
                  color: act.status === 'approved' ? '#10B981' : act.status === 'pending' ? '#F59E0B' : '#EF4444',
                  fontSize: 12, fontWeight: '600'
                }}>
                  {act.status.toUpperCase()}
                </Text>
              </View>
            </View>
          ))}
          {activities.length === 0 && <Text style={{ color: theme.colors.textSecondary }}>No activities uploaded yet.</Text>}
        </View>
      </View>
    );
  };

  const renderReports = () => (
    <View style={{ gap: 16 }}>
      {/* Visit Reports Timeline */}
      <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
        <Text style={[styles.title, { color: theme.colors.textPrimary }]}>Inspection Visit Reports</Text>
        {visitReports.length === 0 ? (
          <Text style={{ color: theme.colors.textSecondary }}>No reports submitted.</Text>
        ) : (
          visitReports.map((rep, idx) => (
            <View key={rep._id} style={{ flexDirection: 'row', marginTop: 12 }}>
              <View style={{ alignItems: 'center', marginRight: 12 }}>
                <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: theme.colors.primary, marginTop: 4 }} />
                {idx !== visitReports.length - 1 && (
                  <View style={{ width: 2, flex: 1, backgroundColor: theme.colors.border, marginVertical: 4 }} />
                )}
              </View>
              <View style={{ flex: 1, paddingBottom: 16 }}>
                <Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>{new Date(rep.dateOfInspection).toLocaleDateString()}</Text>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginBottom: 4 }}>Met with: {rep.personMet}</Text>
                <View style={{ backgroundColor: theme.colors.background, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border }}>
                  <Text style={{ color: theme.colors.textPrimary, fontSize: 13 }}>{rep.discussionContext}</Text>
                </View>
              </View>
            </View>
          ))
        )}
      </View>
      
      {/* Activity Rejection Feedback (if any) */}
      <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
        <Text style={[styles.title, { color: theme.colors.textPrimary }]}>Admin Feedbacks</Text>
        {activities.filter(a => a.adminRemarks).length === 0 ? (
          <Text style={{ color: theme.colors.textSecondary }}>No feedbacks available.</Text>
        ) : (
          activities.filter(a => a.adminRemarks).map(act => (
            <View key={act._id} style={{ borderBottomWidth: 1, borderBottomColor: theme.colors.border, paddingVertical: 10 }}>
              <Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>Activity: {act.title}</Text>
              <Text style={{ color: '#EF4444', fontSize: 13, marginTop: 4 }}>" {act.adminRemarks} "</Text>
            </View>
          ))
        )}
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background, paddingTop: insets.top }]}>
      {/* Custom Header with Profile Info */}
      <View style={[styles.header, { backgroundColor: theme.colors.primary }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 8 }}>
            <Ionicons name="arrow-back" size={24} color="#ffffff" />
          </TouchableOpacity>
        </View>
        <View style={{ alignItems: 'center', marginTop: 10, paddingBottom: 20 }}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{profile.name?.charAt(0).toUpperCase()}</Text>
          </View>
          <Text style={styles.nameText}>{profile.name}</Text>
          <Text style={styles.roleText}>{profile.role.replace('_', ' ').toUpperCase()}</Text>
          <Text style={styles.emailText}>{profile.email}</Text>
        </View>
      </View>

      {/* Tabs */}
      {renderTabs()}

      {/* Scrollable Content */}
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />}
      >
        {activeTab === 'Overview' && renderOverview()}
        {activeTab === 'Attendance' && renderAttendance()}
        {activeTab === 'Activities' && renderActivities()}
        {activeTab === 'Reports' && renderReports()}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { 
    paddingHorizontal: 16,
    paddingTop: 8,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  avatar: {
    width: 70, height: 70, borderRadius: 35,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 12,
    borderWidth: 2, borderColor: '#ffffff'
  },
  avatarText: { fontSize: 28, fontWeight: 'bold', color: '#ffffff' },
  nameText: { fontSize: 22, fontWeight: 'bold', color: '#ffffff', marginBottom: 4 },
  roleText: { fontSize: 12, color: 'rgba(255,255,255,0.8)', fontWeight: '600', letterSpacing: 1, marginBottom: 4 },
  emailText: { fontSize: 14, color: 'rgba(255,255,255,0.9)' },
  tabsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 8,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
  },
  scrollContent: { padding: 16, paddingBottom: 40 },
  card: { 
    padding: 16, 
    borderRadius: 16, 
    borderWidth: 1, 
  },
  title: { fontSize: 16, fontWeight: 'bold', marginBottom: 12 },
  detailRow: { flexDirection: 'row', marginBottom: 8 },
  statBox: {
    flex: 1,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  legendDot: { width: 8, height: 8, borderRadius: 4, marginRight: 4 }
});
