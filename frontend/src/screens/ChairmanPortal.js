import React, { useEffect, useState, useContext, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl, Linking, Animated, Modal, TextInput, ScrollView, Image, Dimensions } from 'react-native';
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
  const [approvedCount, setApprovedCount] = useState(0);
  const [visitReports, setVisitReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const { theme } = useContext(ThemeContext);
  const { user } = useContext(AuthContext);
  const insets = useSafeAreaInsets();
  const [alertConfig, setAlertConfig] = useState({ visible: false, title: '', message: '', type: 'info', buttons: [] });
  
  // Rejection & Edit states
  const [rejectingItem, setRejectingItem] = useState(null); // { id, type: 'activity' | 'report' }
  const [rejectionRemark, setRejectionRemark] = useState('');
  const [editingReport, setEditingReport] = useState(null); // report object
  const [editPersonMet, setEditPersonMet] = useState('');
  const [editDiscussionContext, setEditDiscussionContext] = useState('');
  const [completedActivities, setCompletedActivities] = useState([]);
  const [schools, setSchools] = useState([]);
  const [mediaModalConfig, setMediaModalConfig] = useState({ visible: false, mediaUrls: [] });
  const mediaScrollRef = useRef(null);
  const [currentMediaIndex, setCurrentMediaIndex] = useState(0);

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
      const schoolsRes = await api.get(`/schools?chairmanId=${user._id || user.id}`);
      const fetchedSchools = schoolsRes.data.data || [];
      setSchools(fetchedSchools);

      if (fetchedSchools.length > 0) {
        setSchool(fetchedSchools[0]);
        const allFaculty = [];
        for (const s of fetchedSchools) {
          try {
            const facultyRes = await api.get(`/schools/${s._id}/faculty`);
            allFaculty.push(...facultyRes.data.data);
          } catch (e) {
            console.log('Error fetching faculty for school', s._id);
          }
        }
        // Deduplicate faculty just in case
        const uniqueFaculty = Array.from(new Map(allFaculty.map(item => [item._id, item])).values());
        setFaculty(uniqueFaculty);
      }

      const activitiesRes = await api.get(`/activities`);
      const allActs = activitiesRes.data.data || [];
      // Chairman no longer approves activities, only sees approved ones in the summary
      setActivities([]); 
      setCompletedActivities(allActs.filter(a => a.status === 'approved'));
      setApprovedCount(allActs.filter(a => a.status === 'approved').length);

      const reportsRes = await api.get('/reports');
      setVisitReports(reportsRes.data.data.filter(r => r.status === 'pending'));
    } catch (error) {
      console.log('Error fetching chairman data', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateReportStatus = async (id, status) => {
    try {
      await api.put(`/reports/${id}/status`, { status });
      setVisitReports(visitReports.filter(r => r._id !== id));
      showAlert('Success', `Report approved successfully.`, 'success');
    } catch (error) {
      showAlert('Error', 'Failed to update report status', 'error');
    }
  };

  const handleRejectClick = (id, type) => {
    setRejectingItem({ id, type });
    setRejectionRemark('');
  };

  const handleApproveReportClick = (item) => {
    showAlert(
      'Confirm Approval',
      'Would you like to approve this report directly, or edit its details first?',
      'info',
      [
        {
          text: 'Approve Directly',
          type: 'primary',
          onPress: () => handleUpdateReportStatus(item._id, 'approved'),
        },
        {
          text: 'Edit Report',
          type: 'secondary',
          onPress: () => {
            setEditingReport(item);
            setEditPersonMet(item.personMet);
            setEditDiscussionContext(item.discussionContext);
          },
        },
        {
          text: 'Cancel',
          style: 'cancel',
        },
      ]
    );
  };

  const submitRejection = async () => {
    if (!rejectionRemark.trim()) {
      showAlert('Error', 'Please enter a rejection remark.', 'error');
      return;
    }

    const { id, type } = rejectingItem;
    try {
      if (type === 'activity') {
        await api.put(`/activities/${id}/status`, { status: 'rejected', rejectionRemark });
        setActivities(activities.filter(a => a._id !== id));
        showAlert('Success', 'Activity rejected successfully.', 'success');
      } else {
        await api.put(`/reports/${id}/status`, { status: 'rejected', rejectionRemark });
        setVisitReports(visitReports.filter(r => r._id !== id));
        showAlert('Success', 'Visit report rejected successfully.', 'success');
      }
      setRejectingItem(null);
      setRejectionRemark('');
    } catch (error) {
      console.log('Error rejecting item', error);
      showAlert('Error', 'Failed to reject submission.', 'error');
    }
  };

  const submitEditAndApprove = async () => {
    if (!editPersonMet.trim()) {
      showAlert('Error', 'Please enter who you met.', 'error');
      return;
    }
    if (!editDiscussionContext.trim()) {
      showAlert('Error', 'Please enter discussion context.', 'error');
      return;
    }

    try {
      await api.put(`/reports/${editingReport._id}`, {
        personMet: editPersonMet,
        discussionContext: editDiscussionContext,
        status: 'approved'
      });
      setVisitReports(visitReports.filter(r => r._id !== editingReport._id));
      showAlert('Success', 'Report edited and approved successfully.', 'success');
      setEditingReport(null);
      setEditPersonMet('');
      setEditDiscussionContext('');
    } catch (error) {
      console.log('Error editing and approving report', error);
      showAlert('Error', 'Failed to edit and approve report.', 'error');
    }
  };

  const headerComponent = React.useMemo(() => {
    const remainingCount = Math.max(0, 30 - approvedCount);
    const progressPercent = Math.min(100, (approvedCount / 30) * 100);

    return (
      <View style={{ paddingBottom: 16 }}>
        {school && (
          <MotiView 
            style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]} 
            from={{ opacity: 0, scale: 0.98 }} 
            animate={{ opacity: 1, scale: 1 }}
          >
            <View style={styles.cardHeader}>
              <Ionicons name="business-outline" size={20} color={theme.colors.primary} />
              <Text style={[styles.cardTitle, { color: theme.colors.textPrimary }]}>School Profile & Progress</Text>
            </View>
            <View style={styles.cardBody}>
              <Text style={[styles.profileText, { color: theme.colors.textSecondary }]}>
                Schools: <Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>{schools.map(s => s.name).join(', ')}</Text>
              </Text>
              <Text style={[styles.profileText, { color: theme.colors.textSecondary }]}>
                Association Year: <Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>{schools.length > 0 ? schools[0].associationYear : 'N/A'}</Text>
              </Text>
              
              {/* Quota Progress */}
              <View style={[styles.quotaContainer, { borderColor: theme.colors.border }]}>
                <View style={styles.quotaHeader}>
                  <Text style={{ color: theme.colors.textPrimary, fontWeight: '700', fontSize: 13 }}>Activities Completed</Text>
                  <Text style={{ color: theme.colors.primary, fontWeight: '800', fontSize: 13 }}>{approvedCount} / 30</Text>
                </View>
                <View style={[styles.progressBarBackground, { backgroundColor: theme.colors.background }]}>
                  <View style={[styles.progressBarFill, { width: `${progressPercent}%`, backgroundColor: theme.colors.primary }]} />
                </View>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 11, marginTop: 4 }}>
                  {remainingCount} more activities needed to meet yearly target.
                </Text>
              </View>

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

        {/* Section of Completed Activities */}
        {completedActivities.length > 0 && (
          <View style={{ marginTop: 24 }}>
            <Text style={[styles.subtitle, { color: theme.colors.textPrimary }]}>Completed Activities Details</Text>
            {completedActivities.map((act) => (
              <View key={act._id} style={[styles.completedActivityCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: theme.colors.textPrimary, fontWeight: '700', fontSize: 14, flex: 1, marginRight: 8 }} numberOfLines={1}>{act.name}</Text>
                  <Text style={{ color: theme.colors.textSecondary, fontSize: 11 }}>{new Date(act.activityDate).toLocaleDateString()}</Text>
                </View>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 4 }}>
                  Trainer: <Text style={{ color: theme.colors.primary, fontWeight: '600' }}>{act.uploaderId?.name || 'N/A'}</Text>
                </Text>
              </View>
            ))}
          </View>
        )}

        <Text style={[styles.subtitle, { color: theme.colors.textPrimary, marginTop: 24 }]}>Pending Reports & Activities</Text>
      </View>
    );
  }, [school, approvedCount, faculty, completedActivities, theme]);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }



  const renderRightActionsReport = (progress, dragX, item) => {
    const scale = dragX.interpolate({
      inputRange: [-160, 0],
      outputRange: [1, 0.5],
      extrapolate: 'clamp',
    });

    return (
      <View style={[styles.actionContainer, { width: 160 }]}>
        <TouchableOpacity 
          style={[styles.actionBtn, { backgroundColor: theme.colors.success }]}
          onPress={() => handleApproveReportClick(item)}
          activeOpacity={0.8}
        >
          <Animated.View style={{ transform: [{ scale }], alignItems: 'center' }}>
            <Ionicons name="checkmark-outline" size={24} color="#FFFFFF" />
            <Text style={styles.actionText}>Approve</Text>
          </Animated.View>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.actionBtn, { backgroundColor: theme.colors.error }]}
          onPress={() => handleRejectClick(item._id, 'report')}
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
        </View>
      </View>

      <FlatList
        data={[...visitReports, ...activities]}
        keyExtractor={(item) => item._id}
        ListHeaderComponent={headerComponent}
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
              renderRightActions={(progress, dragX) => item.personMet ? renderRightActionsReport(progress, dragX, item) : null}
              overshootRight={false}
            >
              <View style={[styles.reportItem, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                <View style={styles.reportHeader}>
                  <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: item.personMet ? theme.colors.primary + '20' : theme.colors.secondary + '20', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                    <Ionicons name={item.personMet ? "document-text-outline" : "calendar-outline"} size={20} color={item.personMet ? theme.colors.primary : theme.colors.secondary} />
                  </View>
                  <View style={styles.reportMeta}>
                    <Text style={[styles.metText, { color: theme.colors.textPrimary }]}>
                      {item.personMet ? 'Visit Report' : 'Activity'}: {item.personMet ? item.personMet : item.name}
                    </Text>
                    <Text style={[styles.roleText, { color: theme.colors.textSecondary }]}>
                      {item.personMet ? 'Team Leader: ' + item.teamLeaderId?.name : 'Trainer: ' + (item.uploaderId?.name || 'Unknown')}
                    </Text>
                  </View>
                </View>

                <View style={{ backgroundColor: theme.colors.background, padding: 12, borderRadius: 12, marginBottom: 12 }}>
                  <Text style={[styles.discussionText, { color: theme.colors.textPrimary, fontStyle: item.discussionContext || item.description ? 'italic' : 'normal' }]}>
                    {item.personMet ? `"${item.discussionContext}"` : `"${item.description || 'No description provided'}"`}
                  </Text>
                </View>
                
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  {(item.dateOfInspection || item.activityDate) && (
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Ionicons name="calendar-outline" size={14} color={theme.colors.textSecondary} style={{ marginRight: 4 }} />
                      <Text style={[styles.roleText, { color: theme.colors.textSecondary, marginTop: 0 }]}>
                        {new Date(item.dateOfInspection || item.activityDate).toLocaleDateString()}
                      </Text>
                    </View>
                  )}
                  {item.mediaUrls && item.mediaUrls.length > 0 && (
                    <TouchableOpacity onPress={() => setMediaModalConfig({ visible: true, mediaUrls: item.mediaUrls })} style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Ionicons name="image-outline" size={14} color={theme.colors.primary} style={{ marginRight: 4 }} />
                      <Text style={{ color: theme.colors.primary, fontSize: 13, fontWeight: '600' }}>View Media</Text>
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
            <Text style={{ color: theme.colors.textSecondary, fontWeight: '500' }}>No pending reports or activities.</Text>
          </View>
        }
      />
      {/* Rejection Remark Modal */}
      <Modal
        visible={!!rejectingItem}
        transparent
        animationType="fade"
        onRequestClose={() => setRejectingItem(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContainer, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            <Text style={[styles.modalTitle, { color: theme.colors.textPrimary }]}>Add Rejection Remark</Text>
            <Text style={[styles.modalSubtitle, { color: theme.colors.textSecondary }]}>
              Please explain why you are rejecting this {rejectingItem?.type === 'report' ? 'visit report' : 'activity'}.
            </Text>
            
            <TextInput
              style={[styles.modalInput, { borderColor: theme.colors.border, color: theme.colors.textPrimary, backgroundColor: theme.colors.background }]}
              placeholder="Enter rejection remark..."
              placeholderTextColor={theme.colors.placeholder}
              value={rejectionRemark}
              onChangeText={setRejectionRemark}
              multiline
              numberOfLines={4}
            />
            
            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={[styles.modalBtn, styles.modalSecondaryBtn, { borderColor: theme.colors.border }]} 
                onPress={() => {
                  setRejectingItem(null);
                  setRejectionRemark('');
                }}
              >
                <Text style={[styles.modalBtnText, { color: theme.colors.textPrimary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.modalBtn, styles.modalPrimaryBtn, { backgroundColor: theme.colors.error }]} 
                onPress={submitRejection}
              >
                <Text style={[styles.modalBtnText, { color: '#FFF' }]}>Reject</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Edit Report Modal */}
      <Modal
        visible={!!editingReport}
        transparent
        animationType="fade"
        onRequestClose={() => setEditingReport(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContainer, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, width: '90%', maxWidth: 450 }]}>
            <Text style={[styles.modalTitle, { color: theme.colors.textPrimary }]}>Edit & Approve Report</Text>
            <Text style={[styles.modalSubtitle, { color: theme.colors.textSecondary, marginBottom: 16 }]}>
              Modify report details before approving.
            </Text>
            
            <Text style={[styles.inputLabel, { color: theme.colors.textSecondary }]}>Person Met</Text>
            <TextInput
              style={[styles.modalInput, { borderColor: theme.colors.border, color: theme.colors.textPrimary, backgroundColor: theme.colors.background, height: 45, marginBottom: 12 }]}
              placeholder="Person Met"
              placeholderTextColor={theme.colors.placeholder}
              value={editPersonMet}
              onChangeText={setEditPersonMet}
            />
            
            <Text style={[styles.inputLabel, { color: theme.colors.textSecondary }]}>Discussion Context</Text>
            <TextInput
              style={[styles.modalInput, { borderColor: theme.colors.border, color: theme.colors.textPrimary, backgroundColor: theme.colors.background, height: 100 }]}
              placeholder="Discussion Context"
              placeholderTextColor={theme.colors.placeholder}
              value={editDiscussionContext}
              onChangeText={setEditDiscussionContext}
              multiline
              numberOfLines={4}
            />
            
            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={[styles.modalBtn, styles.modalSecondaryBtn, { borderColor: theme.colors.border }]} 
                onPress={() => {
                  setEditingReport(null);
                  setEditPersonMet('');
                  setEditDiscussionContext('');
                }}
              >
                <Text style={[styles.modalBtnText, { color: theme.colors.textPrimary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.modalBtn, styles.modalPrimaryBtn, { backgroundColor: theme.colors.primary }]} 
                onPress={submitEditAndApprove}
              >
                <Text style={[styles.modalBtnText, { color: '#FFF' }]}>Save & Approve</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Image Slider Modal */}
      <Modal
        visible={mediaModalConfig.visible}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setMediaModalConfig({ visible: false, mediaUrls: [] });
          setCurrentMediaIndex(0);
        }}
      >
        <View style={styles.sliderOverlay}>
          <View style={styles.sliderHeader}>
            <Text style={{ color: '#FFF', fontSize: 16, fontWeight: '600' }}>
              Media ({currentMediaIndex + 1}/{mediaModalConfig.mediaUrls.length || 1})
            </Text>
            <TouchableOpacity onPress={() => {
              setMediaModalConfig({ visible: false, mediaUrls: [] });
              setCurrentMediaIndex(0);
            }}>
              <Ionicons name="close" size={28} color="#FFF" />
            </TouchableOpacity>
          </View>
          
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <ScrollView
              ref={mediaScrollRef}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) => {
                const index = Math.round(e.nativeEvent.contentOffset.x / Dimensions.get('window').width);
                setCurrentMediaIndex(index);
              }}
            >
              {mediaModalConfig.mediaUrls.map((url, i) => (
                <View key={i} style={{ width: Dimensions.get('window').width, justifyContent: 'center', alignItems: 'center' }}>
                  <Image source={{ uri: url }} style={{ width: '100%', height: '80%', resizeMode: 'contain' }} />
                </View>
              ))}
            </ScrollView>

            {/* Left/Right Controls */}
            {mediaModalConfig.mediaUrls.length > 1 && (
              <>
                <TouchableOpacity 
                  style={[styles.sliderArrowBtn, { left: 20 }]}
                  onPress={() => {
                    const newIndex = Math.max(0, currentMediaIndex - 1);
                    setCurrentMediaIndex(newIndex);
                    mediaScrollRef.current?.scrollTo({ x: newIndex * Dimensions.get('window').width, animated: true });
                  }}
                >
                  <Ionicons name="chevron-back" size={32} color="#FFF" />
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.sliderArrowBtn, { right: 20 }]}
                  onPress={() => {
                    const newIndex = Math.min(mediaModalConfig.mediaUrls.length - 1, currentMediaIndex + 1);
                    setCurrentMediaIndex(newIndex);
                    mediaScrollRef.current?.scrollTo({ x: newIndex * Dimensions.get('window').width, animated: true });
                  }}
                >
                  <Ionicons name="chevron-forward" size={32} color="#FFF" />
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

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
  quotaContainer: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
    marginBottom: 8,
  },
  quotaHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  progressBarBackground: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
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
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    width: '85%',
    maxWidth: 400,
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  modalSubtitle: {
    fontSize: 14,
    marginBottom: 16,
    textAlign: 'center',
  },
  modalInput: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    marginBottom: 16,
    textAlignVertical: 'top',
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalPrimaryBtn: {
    // Background set dynamically
  },
  modalSecondaryBtn: {
    borderWidth: 1,
  },
  modalBtnText: {
    fontWeight: '700',
    fontSize: 14,
  },
  completedActivityCard: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 20,
  },
  sliderOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
  },
  sliderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 50,
    paddingBottom: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.3)'
  },
  sliderArrowBtn: {
    position: 'absolute',
    top: '50%',
    transform: [{ translateY: -25 }],
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
});
