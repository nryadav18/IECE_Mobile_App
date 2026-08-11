import React, { useEffect, useState, useContext, useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity, RefreshControl, ScrollView, Image, KeyboardAvoidingView, Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { ThemeContext } from '../context/ThemeContext';
import { AuthContext } from '../context/AuthContext';
import api from '../services/api';
import { MotiView } from 'moti';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import CustomAlert from '../components/CustomAlert';
import ApprovedBy from '../components/ApprovedBy';
import CreateActivityForm from '../components/CreateActivityForm';
import EditActivityModal from '../components/EditActivityModal';
import SidebarMenu from '../components/SidebarMenu';
import NotificationBell from '../components/NotificationBell';
import CountBadge from '../components/CountBadge';
import { useBadges } from '../context/BadgeContext';
import { Calendar } from 'react-native-calendars';
import { useAlert } from '../context/AlertContext';
import { isOffToday, HOLIDAY_APPROVED_COLOR, HOLIDAY_PENDING_COLOR } from '../utils/holiday';
import { buildCalendarMarks } from '../utils/calendarColors';
import { deriveAttendanceActions, findTodayAttendance } from '../utils/attendanceActions';
import CalendarLegend from '../components/CalendarLegend';
import ApplyHolidaySection from '../components/ApplyHolidaySection';
import { SectionSkeleton } from '../components/Skeleton';
import { useSectionTransition } from '../hooks/useSectionTransition';

const TAB_ITEMS = [
  { key: 'Progress', label: 'Progress', icon: 'ribbon-outline' },
  { key: 'Attendance', label: 'Attendance', icon: 'calendar-outline' },
  { key: 'SchoolHoliday', label: 'Apply School Holiday', icon: 'sunny-outline' },
  { key: 'PublishActivity', label: 'Publish Activity', icon: 'add-circle-outline' },
  { key: 'ManageActivities', label: 'Manage Activities', icon: 'list-outline' },
];

// Skeleton shape per section — matches the real layout that follows.
const SECTION_SKELETON = {
  Progress: 'stats',
  Attendance: 'calendar',
  SchoolHoliday: 'form',
  PublishActivity: 'form',
  ManageActivities: 'list',
};

export default function TrainerPortal({ navigation, route }) {
  const [school, setSchool] = useState(null);
  const [myActivities, setMyActivities] = useState([]);
  const [uploadedCount, setUploadedCount] = useState(0);
  const [myApprovedCount, setMyApprovedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(route?.params?.initialTab || 'Progress');
  const { tabLoading, selectTab } = useSectionTransition(activeTab, setActiveTab);
  const [activityToEdit, setActivityToEdit] = useState(null);
  const [attendanceRecords, setAttendanceRecords] = useState([]);
  // Windows where THIS user was replaced by someone else -> painted On Leave.
  const [substitutionLeaves, setSubstitutionLeaves] = useState([]);
  // Windows where THIS user is covering for someone else -> painted On Substitution.
  const [substitutionDuties, setSubstitutionDuties] = useState([]);
  const [leaveDays, setLeaveDays] = useState([]);
  const [faceStatus, setFaceStatus] = useState('none'); // aggregate: 'none' | 'pending' | 'approved'
  const [mySchools, setMySchools] = useState([]);        // [{ _id, name }] assigned schools
  const [faceRegs, setFaceRegs] = useState([]);          // per-school face registrations
  const [selectedSchoolId, setSelectedSchoolId] = useState(null); // school chosen for attendance
  const [holidays, setHolidays] = useState([]);
  
  const { theme } = useContext(ThemeContext);
  const { user, logout } = useContext(AuthContext);
  const { unread, total } = useBadges();
  const insets = useSafeAreaInsets();
  const { showAlert: showGlobalAlert } = useAlert();
  const sidebarRef = useRef(null);

  // Honor an `initialTab` passed via navigation (e.g. from a tapped checkout
  // reminder) even if the portal is already mounted.
  //
  // It is consumed once and then cleared: navigation params outlive the
  // navigation that set them, so leaving it in place would make every later
  // visit to this portal re-open whichever tab an old deep link asked for
  // instead of the default one.
  useEffect(() => {
    if (route?.params?.initialTab) {
      setActiveTab(route.params.initialTab);
      navigation.setParams({ initialTab: undefined });
    }
  }, [route?.params?.initialTab]);

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
      fetchHolidays();
    }, [])
  );

  // Load the current face-registration status. Primary source is /auth/me; if
  // that request fails (it has intermittently 404'd), fall back to /profile/me
  // so an approved user is never left stuck on the "Register Face" button.
  const loadFaceStatus = async () => {
    try {
      const meRes = await api.get('/auth/me');
      const d = meRes.data.data || {};
      setFaceStatus(d.facialRegistrationStatusV2 || d.facialRegistrationStatus || 'none');

      // Assigned schools (populated with names). Fall back to the legacy single
      // school for un-migrated users.
      const schools = Array.isArray(d.schoolIds) && d.schoolIds.length
        ? d.schoolIds.filter(Boolean)
        : (d.schoolId && typeof d.schoolId === 'object' ? [d.schoolId] : []);
      setMySchools(schools);

      const regs = Array.isArray(d.faceRegistrations) ? d.faceRegistrations : [];
      setFaceRegs(regs);

      // Default the attendance school to the first assigned school the first
      // time, or keep the current choice if it's still valid.
      setSelectedSchoolId((prev) => {
        const stillValid = prev && schools.some((s) => String(s._id) === String(prev));
        return stillValid ? prev : (schools[0]?._id || null);
      });
      return;
    } catch (error) {
      console.log('Error fetching face status from /auth/me', error?.response?.status);
    }
    try {
      const pRes = await api.get('/profile/me');
      const p = pRes.data.data?.profile || {};
      setFaceStatus(p.facialRegistrationStatusV2 || p.facialRegistrationStatus || 'none');
    } catch (error) {
      console.log('Error fetching face status from /profile/me', error?.response?.status);
    }
  };

  const fetchFaceStatusAndAttendance = async () => {
    await loadFaceStatus();
    try {
      const attendanceRes = await api.get('/attendance/my-attendance');
      setAttendanceRecords(attendanceRes.data.data || []);
      setSubstitutionLeaves(attendanceRes.data.substitutionLeaves || []);
      setSubstitutionDuties(attendanceRes.data.substitutionDuties || []);
      setLeaveDays(attendanceRes.data.leaveDays || []);
    } catch (error) {
      console.log('Error fetching attendance', error);
    }
  };

  const fetchHolidays = async () => {
    try {
      const res = await api.get('/holidays');
      setHolidays(res.data.data || []);
    } catch (error) {
      console.log('Error fetching holidays', error);
    }
  };

  const fetchData = async () => {
    try {
      if (user.schoolId) {
        const schoolRes = await api.get(`/schools/${user.schoolId}`);
        setSchool(schoolRes.data.data);
      }

      // Fetch all activities for the school to share among trainers
      if (user.schoolId) {
        const myActRes = await api.get(`/activities?schoolId=${user.schoolId}`);
        setMyActivities(myActRes.data.data);
      } else {
        const myActRes = await api.get(`/activities?uploaderId=${user._id || user.id}`);
        setMyActivities(myActRes.data.data);
      }

      // Count of activities THIS trainer has uploaded (no target — just the count).
      const mineRes = await api.get(`/activities?uploaderId=${user._id || user.id}`);
      const mine = mineRes.data.data || [];
      setUploadedCount(mineRes.data.count ?? mine.length);
      setMyApprovedCount(mine.filter(a => a.status === 'approved').length);

      const attendanceRes = await api.get('/attendance/my-attendance');
      setAttendanceRecords(attendanceRes.data.data || []);
      setSubstitutionLeaves(attendanceRes.data.substitutionLeaves || []);
      setSubstitutionDuties(attendanceRes.data.substitutionDuties || []);
      setLeaveDays(attendanceRes.data.leaveDays || []);
      await loadFaceStatus();
      fetchHolidays();
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
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background, paddingTop: insets.top }}>
        <SectionSkeleton kind={SECTION_SKELETON[activeTab] || 'list'} />
      </View>
    );
  }

  // During logout the user is cleared before the navigator swaps stacks; bail
  // out of this render so we don't read properties off a null user.
  if (!user) return null;

  // Today's record, which drives the Check In / Check Out buttons below. It
  // comes from the same shared helper every other portal uses, so the once-per-
  // day locking behaves identically everywhere (and a null/undated record in
  // the list can never take the tab down).
  const todayAtt = findTodayAttendance(attendanceRecords);

  // Today is a non-working day only when the SELECTED school has an approved
  // holiday. The calendar shows every school's closures, but only the one being
  // marked at can close this day — the server checks per school, so asking
  // about all of them would grey out buttons the API would have accepted.
  // Sundays stay workable — check-in / check-out remain enabled on them.
  const isHolidayToday = isOffToday(holidays, selectedSchoolId);

  const renderProgressTab = () => {
    return (
      <ScrollView
        style={styles.flex1}
        contentContainerStyle={{ flexGrow: 1, padding: 20, paddingBottom: insets.bottom + 20 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
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
            <Text style={[styles.cardTitle, { color: theme.colors.textPrimary }]}>My Activities</Text>
          </View>
          <View style={styles.quotaRow}>
            <View style={styles.quotaBlock}>
              <Text style={[styles.quotaNumber, { color: theme.colors.primary }]}>{uploadedCount}</Text>
              <Text style={[styles.quotaLabel, { color: theme.colors.textSecondary }]}>Uploaded</Text>
            </View>
            <View style={[styles.quotaDivider, { backgroundColor: theme.colors.border }]} />
            <View style={styles.quotaBlock}>
              <Text style={[styles.quotaNumber, { color: '#10B981' }]}>{myApprovedCount}</Text>
              <Text style={[styles.quotaLabel, { color: theme.colors.textSecondary }]}>Approved</Text>
            </View>
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
            <Text style={[styles.cardTitle, { color: theme.colors.textPrimary }]}>
              {mySchools.length > 1 ? 'Assigned Schools' : 'Assigned School'}
            </Text>
          </View>

          {mySchools.length > 1 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
              {mySchools.map((s) => (
                <View key={s._id} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, borderWidth: 1, backgroundColor: theme.colors.primary + '15', borderColor: theme.colors.primary }}>
                  <Text style={{ color: theme.colors.primary, fontSize: 12, fontWeight: '600' }}>{s.name}</Text>
                </View>
              ))}
            </View>
          )}

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
          style={[styles.uploadBtn, { backgroundColor: theme.colors.primary, opacity: 0.5 }]}
          onPress={uploadTimetable}
          disabled={true}
        >
          <Ionicons name="document-attach-outline" size={20} color="#fff" />
          <Text style={styles.uploadBtnText}>Upload Timetable (PDF)</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  };

  return (
    <KeyboardAvoidingView style={[styles.container, { backgroundColor: theme.colors.background, paddingTop: insets.top }]} behavior="padding">
      {/* Fixed Header */}
      <View style={{ paddingHorizontal: 20, paddingTop: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
            <TouchableOpacity
              style={[styles.menuBtn, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}
              onPress={() => sidebarRef.current?.open()}
              activeOpacity={0.7}
              accessibilityLabel="Open menu"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="menu" size={24} color={theme.colors.textPrimary} />
              <CountBadge count={total} overlay />
            </TouchableOpacity>
            <View style={{ marginLeft: 14, flex: 1 }}>
              <Text style={[styles.title, { color: theme.colors.textPrimary, marginBottom: 0, fontSize: 20 }]} numberOfLines={1}>
                {TAB_ITEMS.find(t => t.key === activeTab)?.label || 'Trainer Portal'}
              </Text>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 1 }}>Trainer Portal</Text>
            </View>
          </View>
          <NotificationBell navigation={navigation} />
        </View>
      </View>

      {tabLoading && <SectionSkeleton kind={SECTION_SKELETON[activeTab] || 'list'} />}

      {!tabLoading && activeTab === 'Progress' && renderProgressTab()}

      {!tabLoading && activeTab === 'Attendance' && (
        <ScrollView style={styles.flex1} contentContainerStyle={{ flexGrow: 1, padding: 20, paddingBottom: insets.bottom + 20 }} keyboardShouldPersistTaps="handled">
          {/* School selector — shown when the person works under multiple schools */}
          {mySchools.length > 1 && (
            <View style={{ marginBottom: 14 }}>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 8 }}>Select School for Attendance</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {mySchools.map((s) => {
                  const sel = String(s._id) === String(selectedSchoolId);
                  return (
                    <TouchableOpacity
                      key={s._id}
                      onPress={() => setSelectedSchoolId(s._id)}
                      style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, marginRight: 8, backgroundColor: sel ? theme.colors.primary : theme.colors.surface, borderColor: sel ? theme.colors.primary : theme.colors.border }}
                    >
                      <Text style={{ color: sel ? '#fff' : theme.colors.textPrimary, fontWeight: '600', fontSize: 13 }}>{s.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {/* Per-school attendance actions (register / check-in / check-out) */}
          {(() => {
            if (!selectedSchoolId) {
              return (
                <View style={{ backgroundColor: theme.colors.surface, borderRadius: 10, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: theme.colors.border }}>
                  <Text style={{ color: theme.colors.textSecondary, fontSize: 13, fontWeight: '600' }}>No school assigned yet. Please contact your admin.</Text>
                </View>
              );
            }

            const selSchool = mySchools.find((s) => String(s._id) === String(selectedSchoolId));
            const schoolName = selSchool?.name || 'this school';
            const reg = faceRegs.find((r) => String(r.schoolId?._id || r.schoolId) === String(selectedSchoolId));
            const regStatus = reg?.status || 'none';

            // All Check In / Check Out rules live in one shared helper — see
            // utils/attendanceActions. Check-in is once per DAY; check-out may
            // happen at any school this person is approved for, so a day can
            // start at one school and finish at another.
            const act = deriveAttendanceActions({
              todayAttendance: todayAtt,
              selectedSchoolId,
              regStatus,
              isHolidayToday,
            });

            return (
              <View>
                {/* A rejection is a "try again", not a dead end. The reason is
                    shown here — a push notification is easy to miss — and the
                    button comes straight back, so the trainer can re-record on
                    the spot instead of waiting for anyone to reset anything. */}
                {regStatus === 'rejected' && (
                  <View style={{ backgroundColor: '#FEE2E2', borderColor: '#EF4444', borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 16 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Ionicons name="close-circle-outline" size={16} color="#B91C1C" style={{ marginRight: 6 }} />
                      <Text style={{ color: '#B91C1C', fontSize: 12.5, fontWeight: '800', flex: 1 }}>Registration rejected — {schoolName}</Text>
                    </View>
                    {!!reg?.rejectionReason && (
                      <Text style={{ color: '#7F1D1D', fontSize: 12, marginTop: 6, lineHeight: 17 }}>{reg.rejectionReason}</Text>
                    )}
                    <Text style={{ color: '#7F1D1D', fontSize: 12, marginTop: 6, lineHeight: 17 }}>
                      Please register again — your new recording goes back to the admin for approval.
                    </Text>
                  </View>
                )}

                {(regStatus === 'none' || regStatus === 'rejected') && (
                  <TouchableOpacity
                    style={[styles.uploadBtn, { backgroundColor: theme.colors.primary }]}
                    onPress={() => navigation.navigate('FaceRegistration', { schoolId: selectedSchoolId, schoolName })}
                  >
                    <Ionicons name="scan-outline" size={20} color="#fff" />
                    <Text style={[styles.uploadBtnText, { fontSize: 13 }]}>
                      {regStatus === 'rejected' ? `Register Face Again for ${schoolName}` : `Register Face for ${schoolName}`}
                    </Text>
                  </TouchableOpacity>
                )}

                {regStatus === 'pending' && (
                  <>
                    <View style={[styles.uploadBtn, { backgroundColor: '#F59E0B', opacity: 0.9 }]}>
                      <Ionicons name="hourglass-outline" size={20} color="#fff" />
                      <Text style={[styles.uploadBtnText, { fontSize: 13 }]}>Pending Approval — {schoolName}</Text>
                    </View>
                    <View style={{ backgroundColor: '#FEF3C7', borderRadius: 10, padding: 12, marginBottom: 16, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#F59E0B' }}>
                      <Ionicons name="hourglass-outline" size={16} color="#D97706" style={{ marginRight: 8 }} />
                      <Text style={{ color: '#92400E', fontSize: 12, fontWeight: '600', flex: 1 }}>Your facial registration for {schoolName} is pending admin approval. You will be able to mark attendance here once approved.</Text>
                    </View>
                  </>
                )}

                {regStatus === 'approved' && (
                  <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
                    <TouchableOpacity
                      style={[styles.uploadBtn, { flex: 1, marginBottom: 0, backgroundColor: '#4CAF50', opacity: act.canCheckIn ? 1 : 0.5 }]}
                      onPress={() => navigation.navigate('Attendance', { intent: 'login', schoolId: selectedSchoolId, schoolName })}
                      disabled={!act.canCheckIn}
                    >
                      <Ionicons name={act.checkedInHere ? 'checkmark-done-outline' : 'log-in-outline'} size={20} color="#fff" />
                      <Text style={[styles.uploadBtnText, { fontSize: 13 }]}>{act.checkInLabel}</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.uploadBtn, { flex: 1, marginBottom: 0, backgroundColor: '#F44336', opacity: act.canCheckOut ? 1 : 0.5 }]}
                      onPress={() => navigation.navigate('Attendance', { intent: 'logout', schoolId: selectedSchoolId, schoolName })}
                      disabled={!act.canCheckOut}
                    >
                      <Ionicons name={act.checkedOutToday ? 'checkmark-done-outline' : 'log-out-outline'} size={20} color="#fff" />
                      <Text style={[styles.uploadBtnText, { fontSize: 13 }]}>{act.checkOutLabel}</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {act.notice && (
                  <View style={{
                    backgroundColor: act.notice.tone === 'warn' ? '#FEF3C7' : '#E1F5FE',
                    borderColor: act.notice.tone === 'warn' ? '#F59E0B' : '#87CEEB',
                    borderRadius: 10, padding: 12, marginBottom: 16,
                    flexDirection: 'row', alignItems: 'center', borderWidth: 1,
                  }}>
                    <Ionicons
                      name={act.notice.tone === 'warn' ? 'alert-circle-outline' : 'information-circle-outline'}
                      size={16}
                      color={act.notice.tone === 'warn' ? '#D97706' : '#0277BD'}
                      style={{ marginRight: 8 }}
                    />
                    <Text style={{ color: act.notice.tone === 'warn' ? '#92400E' : '#01579B', fontSize: 12, fontWeight: '600', flex: 1 }}>
                      {act.notice.text}
                    </Text>
                  </View>
                )}
              </View>
            );
          })()}

          {/* Holiday banner — attendance disabled on approved school holidays.
              Takes its colour from the holiday constants, so this banner and
              the holiday cell on the calendar can never disagree. */}
          {isHolidayToday && (
            <View style={{ backgroundColor: HOLIDAY_PENDING_COLOR, borderRadius: 10, padding: 12, marginBottom: 16, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: HOLIDAY_APPROVED_COLOR }}>
              <Ionicons name="sunny-outline" size={16} color={HOLIDAY_APPROVED_COLOR} style={{ marginRight: 8 }} />
              <Text style={{ color: HOLIDAY_APPROVED_COLOR, fontSize: 12, fontWeight: '600', flex: 1 }}>Today is a holiday. Check-in and check-out are disabled.</Text>
            </View>
          )}

          <View style={{ backgroundColor: theme.colors.surface, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: theme.colors.border }}>
            <Calendar
              current={new Date().toISOString().split('T')[0]}
              markedDates={{
                // Canonical attendance colours (shared with every portal + profile).
                ...buildCalendarMarks({
                  attendance: attendanceRecords,
                  holidays,
                  leaveDays,
                  // Days someone else was approved to cover for this person —
                  // they are not expected in, so these read as On Leave.
                  substitutionLeaves,
                  // Days this person is covering for someone else — purple
                  // until they check in, then their own attendance colour.
                  substitutionDuties,
                  todayMark: {
                    customStyles: {
                      container: { backgroundColor: '#E0E0E0', borderRadius: 8, borderWidth: 2, borderColor: theme.colors.primary },
                      text: { color: theme.colors.textPrimary, fontWeight: 'bold' }
                    }
                  },
                }),
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
            <CalendarLegend />
          </View>
        </ScrollView>
      )}

      {!tabLoading && activeTab === 'SchoolHoliday' && (
        <ScrollView style={styles.flex1} contentContainerStyle={{ flexGrow: 1, padding: 20, paddingBottom: insets.bottom + 20 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
          <ApplyHolidaySection onChanged={fetchHolidays} />
        </ScrollView>
      )}

      {!tabLoading && activeTab === 'PublishActivity' && (
        <ScrollView style={styles.flex1} contentContainerStyle={{ flexGrow: 1, padding: 20, paddingBottom: insets.bottom + 20 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
          <CreateActivityForm onActivityCreated={() => {
            fetchData();
            setActiveTab('Progress');
          }} />
        </ScrollView>
      )}

      {!tabLoading && activeTab === 'ManageActivities' && (
        <FlatList
          data={myActivities}
          keyExtractor={(item) => item._id}
          style={styles.flex1}
          contentContainerStyle={{ flexGrow: 1, padding: 20, paddingBottom: insets.bottom + 20 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
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
                  {/* Admin/CEO only — a trainer never learns which leader or head
                      decided their activity. */}
                  <ApprovedBy record={item} compact style={{ marginTop: 6 }} />
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

      <SidebarMenu
        ref={sidebarRef}
        title="Trainer Portal"
        subtitle={user?.name || 'Trainer'}
        tabs={TAB_ITEMS}
        activeTab={activeTab}
        onSelectTab={selectTab}
        actions={[
          { label: 'My Profile', icon: 'person-outline', onPress: () => navigation.navigate('UserProfile', { userId: 'me' }) },
          { label: 'Meeting Corner', icon: 'videocam-outline', onPress: () => navigation.navigate('MeetingCorner') },
          { label: 'Apply Leave', icon: 'calendar-outline', onPress: () => navigation.navigate('Leave') },
          { label: 'Notifications', icon: 'notifications-outline', badge: unread || 0, onPress: () => navigation.navigate('Notifications') },
          { label: 'Back to Dashboard', icon: 'home-outline', onPress: () => navigation.goBack() },
          { label: 'Logout', icon: 'log-out-outline', danger: true, onPress: () => logout() },
        ]}
      />

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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex1: { flex: 1 },
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
