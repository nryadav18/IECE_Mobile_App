import React, { useEffect, useState, useContext, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl, Linking, Animated } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { ThemeContext } from '../context/ThemeContext';
import { AuthContext } from '../context/AuthContext';
import api from '../services/api';
import { MotiView } from 'moti';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Avatar from '../components/Avatar';
import CustomAlert from '../components/CustomAlert';

export default function ChairmanPortal({ navigation }) {
  const [school, setSchool] = useState(null);
  const [faculty, setFaculty] = useState([]);
  const [activities, setActivities] = useState([]);
  const [visitReports, setVisitReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const { theme } = useContext(ThemeContext);
  const { user } = useContext(AuthContext);
  const insets = useSafeAreaInsets();
  const [alertConfig, setAlertConfig] = useState({ visible: false, title: '', message: '', type: 'info', buttons: [] });

  const showAlert = (title, message, type = 'info', buttons = []) => {
    setAlertConfig({ visible: true, title, message, type, buttons });
  };

  const [refreshing, setRefreshing] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);

  useFocusEffect(
    useCallback(() => {
      fetchUnreadNotifications();
    }, [])
  );

  const fetchUnreadNotifications = async () => {
    try {
      const res = await api.get('/notifications');
      setUnreadNotifications(res.data.count || 0);
    } catch (err) {}
  };

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
        
        const facultyRes = await api.get(`/schools/${user.schoolId}/faculty`);
        setFaculty(facultyRes.data.data);
      }
      
      const activitiesRes = await api.get(`/activities?schoolId=${user.schoolId}`);
      setActivities(activitiesRes.data.data.filter(a => a.status === 'Submitted'));

      const reportsRes = await api.get('/reports');
      setVisitReports(reportsRes.data.data.filter(r => r.status === 'pending'));
    } catch (error) {
      console.log('Error fetching chairman data', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStatus = async (id, action) => {
    try {
      if (action === 'approve') {
        await api.put(`/activities/${id}/approve-school`);
      } else {
        await api.put(`/activities/${id}/send-back`);
      }
      setActivities(activities.filter(a => a._id !== id));
      showAlert('Success', 'Activity updated', 'success');
    } catch (error) {
      console.log('Error updating status', error);
      showAlert('Error', 'Failed to update activity status', 'error');
    }
  };

  const handleUpdateReportStatus = async (id, status) => {
    try {
      await api.put(`/reports/${id}/status`, { status });
      setVisitReports(visitReports.filter(r => r._id !== id));
      showAlert('Success', `Report ${status}`, 'success');
    } catch (error) {
      showAlert('Error', 'Failed to update report status', 'error');
    }
  };



  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  const renderHeader = () => (
    <View style={{ paddingBottom: 16 }}>
      {school && (
        <MotiView 
          style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]} 
          from={{ opacity: 0, scale: 0.98 }} 
          animate={{ opacity: 1, scale: 1 }}
        >
          <View style={styles.cardHeader}>
            <Ionicons name="business-outline" size={20} color={theme.colors.primary} />
            <Text style={[styles.cardTitle, { color: theme.colors.textPrimary }]}>School Profile</Text>
          </View>
          <View style={styles.cardBody}>
            <Text style={[styles.profileText, { color: theme.colors.textSecondary }]}>
              Name: <Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>{school.name}</Text>
            </Text>
            <Text style={[styles.profileText, { color: theme.colors.textSecondary }]}>
              Association Year: <Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>{school.associationYear}</Text>
            </Text>
            <Text style={[styles.profileText, { color: theme.colors.textSecondary }]}>
              Class Coverage: <Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>{school.classCoverage}</Text>
            </Text>
            <Text style={[styles.profileText, { color: theme.colors.textSecondary }]}>
              Strength: <Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>{school.totalStrength || 0}</Text>
            </Text>
            <Text style={[styles.profileText, { color: theme.colors.textSecondary }]}>
              Total Trainers: <Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>{faculty.length}</Text>
            </Text>
            <Text style={[styles.profileText, { color: theme.colors.textSecondary }]}>
              State: <Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>{school.state || 'N/A'}</Text>
            </Text>
            {school.mouPdfUrl && (
              <TouchableOpacity 
                style={[styles.mouBtn, { backgroundColor: theme.colors.primary }]}
                onPress={() => Linking.openURL(school.mouPdfUrl)}
              >
                <Ionicons name="document-text-outline" size={18} color="#fff" />
                <Text style={styles.mouBtnText}>View MOU PDF</Text>
              </TouchableOpacity>
            )}
          </View>
        </MotiView>
      )}

      <Text style={[styles.subtitle, { color: theme.colors.textPrimary, marginTop: 16 }]}>Faculty Roster</Text>
      <FlatList
        data={faculty}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item._id}
        renderItem={({ item }) => (
          <View style={[styles.facultyChip, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            <Avatar name={item.name} size={20} style={{ marginRight: 6 }} />
            <Text style={[styles.facultyText, { color: theme.colors.textPrimary }]}>{item.name}</Text>
          </View>
        )}
        contentContainerStyle={{ paddingVertical: 4 }}
        ListEmptyComponent={
          <Text style={{ color: theme.colors.textSecondary, marginBottom: 16, fontSize: 14, fontWeight: '500' }}>
            No faculty found.
          </Text>
        }
      />

      <Text style={[styles.subtitle, { color: theme.colors.textPrimary, marginTop: 24 }]}>Pending Reports & Activities</Text>
    </View>
  );

  const renderRightActions = (progress, dragX, id) => {
    const scale = dragX.interpolate({
      inputRange: [-160, 0],
      outputRange: [1, 0.5],
      extrapolate: 'clamp',
    });

    return (
      <View style={[styles.actionContainer, { width: 160 }]}>
        <TouchableOpacity 
          style={[styles.actionBtn, { backgroundColor: theme.colors.success }]}
          onPress={() => handleUpdateStatus(id, 'approve')}
          activeOpacity={0.8}
        >
          <Animated.View style={{ transform: [{ scale }], alignItems: 'center' }}>
            <Ionicons name="checkmark-outline" size={24} color="#FFFFFF" />
            <Text style={styles.actionText}>Approve</Text>
          </Animated.View>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.actionBtn, { backgroundColor: theme.colors.error }]}
          onPress={() => handleUpdateStatus(id, 'reject')}
          activeOpacity={0.8}
        >
          <Animated.View style={{ transform: [{ scale }], alignItems: 'center' }}>
            <Ionicons name="close-outline" size={24} color="#FFFFFF" />
            <Text style={styles.actionText}>Reject</Text>
          </Animated.View>
        </TouchableOpacity>
      </View>
    );
  };

  const renderRightActionsReport = (progress, dragX, id) => {
    const scale = dragX.interpolate({
      inputRange: [-160, 0],
      outputRange: [1, 0.5],
      extrapolate: 'clamp',
    });

    return (
      <View style={[styles.actionContainer, { width: 160 }]}>
        <TouchableOpacity 
          style={[styles.actionBtn, { backgroundColor: theme.colors.success }]}
          onPress={() => handleUpdateReportStatus(id, 'approved')}
          activeOpacity={0.8}
        >
          <Animated.View style={{ transform: [{ scale }], alignItems: 'center' }}>
            <Ionicons name="checkmark-outline" size={24} color="#FFFFFF" />
            <Text style={styles.actionText}>Approve</Text>
          </Animated.View>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.actionBtn, { backgroundColor: theme.colors.error }]}
          onPress={() => handleUpdateReportStatus(id, 'rejected')}
          activeOpacity={0.8}
        >
          <Animated.View style={{ transform: [{ scale }], alignItems: 'center' }}>
            <Ionicons name="close-outline" size={24} color="#FFFFFF" />
            <Text style={styles.actionText}>Reject</Text>
          </Animated.View>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background, paddingTop: insets.top }]}>
      {/* Fixed Header */}
      <View style={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TouchableOpacity 
              style={[styles.backBtn, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface, marginRight: 12, marginBottom: 0 }]}
              onPress={() => navigation.goBack()}
              activeOpacity={0.8}
            >
              <Ionicons name="arrow-back-outline" size={20} color={theme.colors.textPrimary} />
            </TouchableOpacity>

            <Text style={[styles.title, { color: theme.colors.textPrimary, marginBottom: 0 }]}>Chairman Portal</Text>
          </View>
          <TouchableOpacity onPress={() => navigation.navigate('Notifications')} style={[styles.bellBtn, { position: 'relative' }]}>
            <Ionicons name="notifications-outline" size={24} color={theme.colors.textPrimary} />
            {unreadNotifications > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unreadNotifications > 99 ? '99+' : unreadNotifications}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={[...visitReports, ...activities]}
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
            from={{ opacity: 0, translateY: 15 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 300, delay: index * 50 }}
            style={{ marginBottom: 12 }}
          >
            <Swipeable 
              renderRightActions={(progress, dragX) => item.personMet ? renderRightActionsReport(progress, dragX, item._id) : renderRightActions(progress, dragX, item._id)}
              overshootRight={false}
            >
              <View style={[styles.reportItem, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                <View style={styles.reportHeader}>
                  <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: item.personMet ? theme.colors.primary + '20' : theme.colors.secondary + '20', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                    <Ionicons name={item.personMet ? "document-text-outline" : "bicycle-outline"} size={20} color={item.personMet ? theme.colors.primary : theme.colors.secondary} />
                  </View>
                  <View style={styles.reportMeta}>
                    <Text style={[styles.metText, { color: theme.colors.textPrimary }]}>
                      {item.personMet ? 'Visit Report' : 'Activity'}: {item.personMet ? item.personMet : item.name}
                    </Text>
                    <Text style={[styles.roleText, { color: theme.colors.textSecondary }]}>
                      {item.personMet ? 'Team Leader: ' + item.teamLeaderId?.name : 'Trainer: ' + (item.trainerId?.name || 'Unknown')}
                    </Text>
                  </View>
                </View>

                <View style={{ backgroundColor: theme.colors.background, padding: 12, borderRadius: 12, marginBottom: 12 }}>
                  <Text style={[styles.discussionText, { color: theme.colors.textPrimary, fontStyle: item.discussionContext ? 'italic' : 'normal' }]}>
                    {item.discussionContext ? `"${item.discussionContext}"` : `Status: ${item.status}`}
                  </Text>
                </View>
                
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  {item.dateOfInspection && (
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Ionicons name="calendar-outline" size={14} color={theme.colors.textSecondary} style={{ marginRight: 4 }} />
                      <Text style={[styles.roleText, { color: theme.colors.textSecondary, marginTop: 0 }]}>{new Date(item.dateOfInspection).toLocaleDateString()}</Text>
                    </View>
                  )}
                  {item.proofPhotoUrl && (
                    <TouchableOpacity onPress={() => Linking.openURL(item.proofPhotoUrl)} style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Ionicons name="image-outline" size={14} color={theme.colors.primary} style={{ marginRight: 4 }} />
                      <Text style={{ color: theme.colors.primary, fontSize: 13, fontWeight: '600' }}>Proof</Text>
                    </TouchableOpacity>
                  )}
                </View>
                
                <View style={[styles.swipeHint, { backgroundColor: theme.colors.primary + '15' }]}>
                  <MotiView
                    from={{ translateX: 12, opacity: 0.1 }}
                    animate={{ translateX: -12, opacity: 1 }}
                    transition={{ type: 'timing', duration: 1200, loop: true }}
                    style={{ flexDirection: 'row', alignItems: 'center' }}
                  >
                    <Ionicons name="chevron-back-outline" size={18} color={theme.colors.primary} style={{ marginRight: -6 }} />
                    <Ionicons name="chevron-back-outline" size={18} color={theme.colors.primary} style={{ marginRight: -6, opacity: 0.7 }} />
                    <Ionicons name="chevron-back-outline" size={18} color={theme.colors.primary} style={{ marginRight: 6, opacity: 0.4 }} />
                  </MotiView>
                  <Text style={[styles.swipeHintText, { color: theme.colors.primary }]}>SWIPE LEFT TO APPROVE / REJECT</Text>
                </View>
              </View>
            </Swipeable>
          </MotiView>
        )}
        ListEmptyComponent={
          <View style={[styles.emptyContainer, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            <Ionicons name="checkmark-circle-outline" size={32} color={theme.colors.textSecondary} style={{ marginBottom: 8 }} />
            <Text style={{ color: theme.colors.textSecondary, fontWeight: '500' }}>No pending reports.</Text>
          </View>
        }
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
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  bellBtn: { padding: 8, borderRadius: 12, backgroundColor: '#f0f0f0' },
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
  card: { 
    padding: 16, 
    borderRadius: 16, 
    borderWidth: 1,
    marginBottom: 20,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
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
  profileText: {
    fontSize: 14,
    marginBottom: 8,
  },
  subtitle: { 
    fontSize: 18, 
    fontWeight: '700', 
    marginBottom: 12,
    letterSpacing: -0.3,
  },
  facultyChip: { 
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12, 
    paddingVertical: 8, 
    borderRadius: 20, 
    marginRight: 8, 
    borderWidth: 1,
  },
  facultyText: {
    fontSize: 13,
    fontWeight: '600',
  },
  reportItem: { 
    padding: 16, 
    borderRadius: 16, 
    borderWidth: 1,
  },
  reportHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  reportMeta: {
    flex: 1,
  },
  metText: {
    fontSize: 14,
    fontWeight: '600',
  },
  roleText: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 1,
  },
  discussionText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    marginBottom: 12,
  },
  swipeHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 24,
    marginTop: 12,
  },
  swipeHintText: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginLeft: 8,
  },
  actionContainer: { 
    flexDirection: 'row', 
    alignItems: 'stretch',
    marginBottom: 12,
  },
  actionBtn: { 
    justifyContent: 'center', 
    alignItems: 'center', 
    flex: 1, 
    borderTopRightRadius: 16,
    borderBottomRightRadius: 16,
  },
  actionText: { 
    color: '#ffffff', 
    fontWeight: '700',
    fontSize: 12,
    marginTop: 4,
  },
  emptyContainer: {
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -4,
    backgroundColor: '#FF3B30',
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FFF',
    paddingHorizontal: 4,
  },
  badgeText: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: 'bold',
  },
  mouBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginTop: 12,
    alignSelf: 'flex-start',
  },
  mouBtnText: {
    color: '#fff',
    fontWeight: '600',
    marginLeft: 8,
  }
});
