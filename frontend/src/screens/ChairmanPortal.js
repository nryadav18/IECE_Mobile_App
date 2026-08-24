import React, { useEffect, useState, useContext, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl, Linking, Animated, Modal, TextInput, ScrollView, Image, Dimensions, KeyboardAvoidingView, Platform } from 'react-native';
import { ThemeContext } from '../context/ThemeContext';
import { AuthContext } from '../context/AuthContext';
import api from '../services/api';
import { MotiView } from 'moti';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Avatar from '../components/Avatar';
import CustomAlert from '../components/CustomAlert';
import SidebarMenu from '../components/SidebarMenu';
import NotificationBell from '../components/NotificationBell';
import VisitReportDetail from '../components/VisitReportDetail';
import { SectionSkeleton } from '../components/Skeleton';
import { useSectionTransition } from '../hooks/useSectionTransition';
import ResponsiveGrid from '../components/ResponsiveGrid';
import ActivityCover from '../components/ActivityCover';
import useResponsiveLayout from '../hooks/useResponsiveLayout';

const TAB_ITEMS = [
  { key: 'Overview', label: 'Overview', icon: 'home-outline' },
  { key: 'Pending', label: 'Pending Approvals', icon: 'time-outline' },
  { key: 'Completed', label: 'Completed Activities', icon: 'checkmark-done-outline' },
];

// Skeleton shape per section — matches the real layout that follows.
const SECTION_SKELETON = { Overview: 'stats', Pending: 'list', Completed: 'list' };

export default function ChairmanPortal({ navigation, route }) {
  const [activeTab, setActiveTab] = useState(route?.params?.initialTab || 'Overview');
  const { tabLoading, selectTab } = useSectionTransition(activeTab, setActiveTab);
  const [school, setSchool] = useState(null);
  const [faculty, setFaculty] = useState([]);
  const [activities, setActivities] = useState([]);
  const [approvedCount, setApprovedCount] = useState(0);
  const [visitReports, setVisitReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const { theme } = useContext(ThemeContext);
  const { user, logout } = useContext(AuthContext);
  const insets = useSafeAreaInsets();
  // Wide-screen metrics. On a phone `contentInset` is 20 and `columns` is 1,
  // which is exactly the layout this screen had before, so nothing shifts on mobile.
  const { contentInset, columns } = useResponsiveLayout();
  const facultyPerRow = Math.min(columns * 2, 5);
  const sidebarRef = useRef(null);
  const [alertConfig, setAlertConfig] = useState({ visible: false, title: '', message: '', type: 'info', buttons: [] });
  
  // Rejection & Edit states
  const [rejectingItem, setRejectingItem] = useState(null); // { id, type: 'activity' | 'report' }
  const [rejectionRemark, setRejectionRemark] = useState('');
  const [editingReport, setEditingReport] = useState(null); // report object
  const [reportToView, setReportToView] = useState(null); // full read-only report
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

  // Honor an `initialTab` passed via navigation (e.g. from a tapped school
  // holiday notification) even when the portal is already mounted.
  useEffect(() => {
    if (route?.params?.initialTab) {
      setActiveTab(route.params.initialTab);
    }
  }, [route?.params?.initialTab]);

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

  // Approve / reject a visit report from the full-report screen. Feedback is
  // mandatory; rejection also carries a reason.
  const approveReportWithFeedback = async (feedback) => {
    const id = reportToView?._id;
    if (!id) return;
    try {
      await api.put(`/reports/${id}/status`, { status: 'approved', feedback });
      setVisitReports(prev => prev.filter(r => r._id !== id));
      setReportToView(null);
      showAlert('Success', 'Report approved successfully.', 'success');
    } catch (error) {
      showAlert('Error', error.response?.data?.error || 'Failed to approve report.', 'error');
    }
  };

  const rejectReportWithFeedback = async (feedback, reason) => {
    const id = reportToView?._id;
    if (!id) return;
    try {
      await api.put(`/reports/${id}/status`, { status: 'rejected', feedback, rejectionRemark: reason });
      setVisitReports(prev => prev.filter(r => r._id !== id));
      setReportToView(null);
      showAlert('Success', 'Report rejected.', 'success');
    } catch (error) {
      showAlert('Error', error.response?.data?.error || 'Failed to reject report.', 'error');
    }
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

  const refreshControl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={theme.colors.primary}
      colors={[theme.colors.primary]}
      progressBackgroundColor={theme.colors.surface}
    />
  );

  // ---- Overview tab: school profile/progress + faculty roster ----
  const renderOverview = () => {
    return (
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: contentInset, paddingVertical: 20, paddingBottom: insets.bottom + 20 }}
        showsVerticalScrollIndicator={false}
        refreshControl={refreshControl}
      >
        {school && (
          <MotiView
            style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
            from={{ opacity: 0, translateY: 8 }}
            animate={{ opacity: 1, translateY: 0 }}
          >
            {/* Hero header */}
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={[styles.schoolIcon, { backgroundColor: theme.colors.primary + '15' }]}>
                <Ionicons name="business" size={22} color={theme.colors.primary} />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[styles.schoolName, { color: theme.colors.textPrimary }]} numberOfLines={2}>{school.name}</Text>
                {!!school.state && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
                    <Ionicons name="location-outline" size={13} color={theme.colors.textSecondary} />
                    <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginLeft: 3 }}>{school.state}</Text>
                  </View>
                )}
              </View>
            </View>

            {/* When the chairman owns more than one school */}
            {schools.length > 1 && (
              <View style={{ marginTop: 14 }}>
                <Text style={[styles.miniLabel, { color: theme.colors.textSecondary }]}>YOUR SCHOOLS</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 }}>
                  {schools.map((s) => (
                    <View key={s._id} style={[styles.schoolChip, { backgroundColor: theme.colors.background, borderColor: theme.colors.border }]}>
                      <Text style={{ color: theme.colors.textPrimary, fontSize: 12, fontWeight: '600' }}>{s.name}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Responsive info grid */}
            <View style={styles.infoGrid}>
              {[
                { icon: 'calendar-outline', label: 'Association', value: school.associationYear || 'N/A' },
                { icon: 'library-outline', label: 'Class Coverage', value: school.classCoverage || 'N/A' },
                { icon: 'person-outline', label: 'Faculty', value: String(faculty.length) },
              ].map((info) => (
                <View key={info.label} style={[styles.infoTile, { backgroundColor: theme.colors.background, borderColor: theme.colors.border }]}>
                  <Ionicons name={info.icon} size={16} color={theme.colors.primary} />
                  <Text style={[styles.infoValue, { color: theme.colors.textPrimary }]} numberOfLines={1}>{info.value}</Text>
                  <Text style={[styles.infoLabel, { color: theme.colors.textSecondary }]}>{info.label}</Text>
                </View>
              ))}
            </View>

            {/* Activities completed — count only (no fixed target) */}
            <View style={[styles.progressPanel, { backgroundColor: theme.colors.primary + '0D', borderColor: theme.colors.primary + '22', flexDirection: 'row', alignItems: 'center' }]}>
              <View style={[styles.schoolIcon, { backgroundColor: theme.colors.primary + '18' }]}>
                <Ionicons name="ribbon" size={22} color={theme.colors.primary} />
              </View>
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12, fontWeight: '600' }}>Activities Completed</Text>
                <Text style={{ color: theme.colors.textPrimary, fontSize: 24, fontWeight: '800', marginTop: 2 }}>
                  {approvedCount}
                  <Text style={{ fontSize: 13, fontWeight: '600', color: theme.colors.textSecondary }}>  approved</Text>
                </Text>
              </View>
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
          </MotiView>
        )}

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, marginBottom: 12 }}>
          <Text style={[styles.subtitle, { color: theme.colors.textPrimary, marginBottom: 0 }]}>Faculty Roster</Text>
          {faculty.length > 0 && (
            <View style={{ backgroundColor: theme.colors.primary + '15', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12 }}>
              <Text style={{ color: theme.colors.primary, fontSize: 12, fontWeight: '700' }}>{faculty.length}</Text>
            </View>
          )}
        </View>
        {faculty.length === 0 ? (
          <Text style={{ color: theme.colors.textSecondary, marginBottom: 16, fontSize: 14, fontWeight: '500' }}>
            No faculty found.
          </Text>
        ) : (
          <View style={styles.facultyGrid}>
            {faculty.map((item) => (
              // Two-up on a phone (100/2 - 1.5 = the 48.5% it already used); on a
              // wide screen the roster keeps the same card size and simply fits
              // more per row, capped at 5 so a name still has room to read.
              <View key={item._id} style={[styles.facultyCard, { width: `${100 / facultyPerRow - 1.5}%`, backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                <Avatar name={item.name} size={34} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={[styles.facultyName, { color: theme.colors.textPrimary }]} numberOfLines={1}>{item.name}</Text>
                  <Text style={{ color: theme.colors.textSecondary, fontSize: 11, marginTop: 1 }} numberOfLines={1}>
                    {item.email || 'Trainer'}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    );
  };

  // ---- Completed Activities tab ----
  const renderCompleted = () => (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ flexGrow: 1, paddingHorizontal: contentInset, paddingVertical: 20, paddingBottom: insets.bottom + 20 }}
      showsVerticalScrollIndicator={false}
      refreshControl={refreshControl}
    >
      <Text style={[styles.subtitle, { color: theme.colors.textPrimary }]}>Completed Activities</Text>
      {completedActivities.length > 0 ? (
        <ResponsiveGrid gap={16}>
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
        </ResponsiveGrid>
      ) : (
        <Text style={{ color: theme.colors.textSecondary, fontSize: 14, marginTop: 8 }}>No completed activities yet.</Text>
      )}
    </ScrollView>
  );

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background, paddingTop: insets.top }}>
        <SectionSkeleton kind={SECTION_SKELETON[activeTab] || 'list'} />
      </View>
    );
  }

  // During logout the user is cleared before the navigator swaps stacks; bail
  // out of this render so we don't read properties off a null user.
  if (!user) return null;



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
      <View style={{ paddingHorizontal: contentInset, paddingTop: 4, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
            <TouchableOpacity
              style={[styles.menuBtn, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}
              onPress={() => sidebarRef.current?.open()}
              activeOpacity={0.7}
              accessibilityLabel="Open menu"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="menu" size={24} color={theme.colors.textPrimary} />
            </TouchableOpacity>
            <View style={{ marginLeft: 14, flex: 1 }}>
              <Text style={[styles.title, { color: theme.colors.textPrimary, marginBottom: 0, fontSize: 20 }]} numberOfLines={1}>
                {TAB_ITEMS.find(t => t.key === activeTab)?.label || 'Chairman Portal'}
              </Text>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 1 }}>Chairman Portal · {user?.name || 'Chairman'}</Text>
            </View>
          </View>
          <NotificationBell navigation={navigation} />
        </View>
      </View>

      {tabLoading && <SectionSkeleton kind={SECTION_SKELETON[activeTab] || 'list'} />}

      {!tabLoading && activeTab === 'Overview' && renderOverview()}

      {!tabLoading && activeTab === 'Completed' && renderCompleted()}

      {!tabLoading && activeTab === 'Pending' && (
      <FlatList
        style={{ flex: 1 }}
        data={[...visitReports, ...activities]}
        keyExtractor={(item) => item._id}
        // FlatList cannot change `numColumns` in place, so the column count is
        // baked into the key and a resize past a breakpoint remounts the list.
        // On a phone `columns` is always 1, so this never fires there.
        key={`pending-${columns}`}
        numColumns={columns}
        columnWrapperStyle={columns > 1 ? { gap: 12 } : undefined}
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: contentInset, paddingVertical: 20, paddingBottom: insets.bottom + 20 }}
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
            // In multi-column mode the items have to share the row; `minWidth: 0`
            // stops a long report title from pushing its column wider than its share.
            style={[{ marginBottom: 12 }, columns > 1 && { flex: 1, minWidth: 0 }]}
          >
            <Swipeable
              renderRightActions={() => null}
              overshootRight={false}
            >
              <View style={[styles.reportItem, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                <View style={styles.reportHeader}>
                  {/* This feed carries both visit reports and activities. A
                      report has no cover to show, so it keeps its glyph; an
                      activity shows its first photo — or the IECE mark when it
                      has none, the same stand-in every other screen uses. */}
                  {item.personMet ? (
                    <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.primary + '20', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                      <Ionicons name="document-text-outline" size={20} color={theme.colors.primary} />
                    </View>
                  ) : (
                    <ActivityCover activity={item} size={40} radius={10} style={{ marginRight: 12 }} />
                  )}
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
                
                {item.personMet ? (
                  <TouchableOpacity
                    style={{ marginTop: 14, backgroundColor: theme.colors.primary, padding: 14, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}
                    onPress={() => setReportToView(item)}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="reader-outline" size={18} color="#fff" style={{ marginRight: 8 }} />
                    <Text style={{ color: '#fff', fontWeight: '700' }}>View Full Report</Text>
                  </TouchableOpacity>
                ) : (
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
                )}
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
      )}
      {/* Rejection Remark Modal */}
      <Modal
        visible={!!rejectingItem}
        transparent
        animationType="fade"
        onRequestClose={() => setRejectingItem(null)}
      >
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
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
        </KeyboardAvoidingView>
      </Modal>

      {/* Edit Report Modal */}
      <Modal
        visible={!!editingReport}
        transparent
        animationType="fade"
        onRequestClose={() => setEditingReport(null)}
      >
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
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
        </KeyboardAvoidingView>
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

      <SidebarMenu
        ref={sidebarRef}
        title="Chairman Portal"
        subtitle={user?.name || 'Chairman'}
        tabs={TAB_ITEMS}
        activeTab={activeTab}
        onSelectTab={selectTab}
        actions={[
          { label: 'Notifications', icon: 'notifications-outline', onPress: () => navigation.navigate('Notifications') },
          { label: 'Back to Dashboard', icon: 'home-outline', onPress: () => navigation.goBack() },
          { label: 'Logout', icon: 'log-out-outline', danger: true, onPress: () => logout() },
        ]}
      />

      <CustomAlert
        visible={alertConfig.visible}
        title={alertConfig.title}
        message={alertConfig.message}
        type={alertConfig.type}
        buttons={alertConfig.buttons}
        onDismiss={() => setAlertConfig({ ...alertConfig, visible: false })}
      />

      <VisitReportDetail
        visible={!!reportToView}
        report={reportToView}
        reviewMode
        onApprove={approveReportWithFeedback}
        onReject={rejectReportWithFeedback}
        onClose={() => setReportToView(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  bellBtn: { padding: 8, borderRadius: 12, backgroundColor: '#f0f0f0' },
  menuBtn: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
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
  schoolIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  schoolName: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  miniLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  schoolChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    marginRight: 8,
    marginBottom: 8,
  },
  infoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  infoTile: {
    width: '48.5%',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  infoValue: {
    fontSize: 16,
    fontWeight: '800',
    marginTop: 8,
  },
  infoLabel: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
  },
  progressPanel: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginTop: 6,
    marginBottom: 4,
  },
  subtitle: { 
    fontSize: 18, 
    fontWeight: '700', 
    marginBottom: 12,
    letterSpacing: -0.3,
  },
  facultyGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  facultyCard: {
    width: '48.5%',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
  },
  facultyName: {
    fontSize: 13,
    fontWeight: '700',
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
