import React, { useContext, useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, RefreshControl, KeyboardAvoidingView, Platform } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Formik } from 'formik';
import * as Yup from 'yup';
import { ThemeContext } from '../context/ThemeContext';
import { AuthContext } from '../context/AuthContext';
import api from '../services/api';
import { MotiView } from 'moti';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import CustomAlert from '../components/CustomAlert';
import ScreenLoader from '../components/ScreenLoader';
import CustomDropdown from '../components/CustomDropdown';
import DateTimePicker from '@react-native-community/datetimepicker';
import CreateActivityForm from '../components/CreateActivityForm';
import EditActivityModal from '../components/EditActivityModal';
import VisitReportForm from '../components/VisitReportForm';
import VisitReportDetail from '../components/VisitReportDetail';
import SidebarMenu from '../components/SidebarMenu';
import { Image } from 'react-native';
import { Calendar } from 'react-native-calendars';
import { useAlert } from '../context/AlertContext';
import { dayKey, isOffToday, buildHolidayMarks } from '../utils/holiday';
import ApplyHolidaySection from '../components/ApplyHolidaySection';

const TAB_ITEMS = [
  { key: 'Reports', label: 'Log Visit', icon: 'document-text-outline' },
  { key: 'MyReports', label: 'My Reports', icon: 'folder-open-outline' },
  { key: 'MyTeam', label: 'My Team', icon: 'people-outline' },
  { key: 'Attendance', label: 'Attendance', icon: 'calendar-outline' },
  { key: 'SchoolHoliday', label: 'Apply School Holiday', icon: 'sunny-outline' },
  { key: 'Events', label: 'Publish Activity', icon: 'add-circle-outline' },
  { key: 'ManageEvents', label: 'Manage Activities', icon: 'list-outline' },
];

const VisitSchema = Yup.object().shape({
  personMet: Yup.string().required('Met person name is required'),
  discussionContext: Yup.string().required('Discussion context is required'),
  trainerId: Yup.string().required('Trainer selection is required'),
  schoolId: Yup.string().required('School is required'),
});

export default function TeamLeaderPortal({ navigation, route }) {
  const { theme } = useContext(ThemeContext);
  const { user, logout } = useContext(AuthContext);
  const insets = useSafeAreaInsets();
  const { showAlert: showGlobalAlert } = useAlert();
  const sidebarRef = useRef(null);

  const [reports, setReports] = useState([]);
  const [trainers, setTrainers] = useState([]);
  const [myActivities, setMyActivities] = useState([]);
  const [attendanceRecords, setAttendanceRecords] = useState([]);
  const [faceStatus, setFaceStatus] = useState('none'); // aggregate: 'none' | 'pending' | 'approved'
  const [mySchools, setMySchools] = useState([]);        // [{ _id, name }] assigned schools
  const [faceRegs, setFaceRegs] = useState([]);          // per-school face registrations
  const [selectedSchoolId, setSelectedSchoolId] = useState(null); // school chosen for attendance
  const [holidays, setHolidays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(route?.params?.initialTab || 'Reports');

  // Honor an `initialTab` passed via navigation (e.g. from a tapped report
  // notification) even if the portal is already mounted.
  useEffect(() => {
    if (route?.params?.initialTab) {
      setActiveTab(route.params.initialTab);
    }
  }, [route?.params?.initialTab]);

  // Optimistically reflect a just-completed face registration so the user
  // immediately sees "Pending Approval" instead of the stale "Register Face".
  useEffect(() => {
    if (route?.params?.faceJustRegistered) {
      setFaceStatus('pending');
    }
  }, [route?.params?.faceJustRegistered]);
  const [activityToEdit, setActivityToEdit] = useState(null);
  const [reportToEdit, setReportToEdit] = useState(null); // opens VisitReportForm in edit mode
  const [reportFormVisible, setReportFormVisible] = useState(false); // new report
  const [reportToView, setReportToView] = useState(null); // read-only detail
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [dateOfInspection, setDateOfInspection] = useState(new Date());

  // Track focus states
  const [focusFields, setFocusFields] = useState({});
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      fetchFaceStatusAndAttendance();
      fetchHolidays();
    }, [])
  );

  // Fetch the two independently so a hiccup in one request can never strand the
  // other. (Previously a single Promise.all meant a failed attendance call would
  // skip setFaceStatus, leaving a stale "Register Face" button after registering.)
  // Load face-registration status with a /profile/me fallback so an approved
  // user is never stuck on "Register Face" if /auth/me intermittently fails.
  const loadFaceStatus = async () => {
    try {
      const meRes = await api.get('/auth/me');
      const d = meRes.data.data || {};
      setFaceStatus(d.facialRegistrationStatusV2 || d.facialRegistrationStatus || 'none');

      const schools = Array.isArray(d.schoolIds) && d.schoolIds.length
        ? d.schoolIds.filter(Boolean)
        : (d.schoolId && typeof d.schoolId === 'object' ? [d.schoolId] : []);
      setMySchools(schools);
      setFaceRegs(Array.isArray(d.faceRegistrations) ? d.faceRegistrations : []);
      setSelectedSchoolId((prev) => {
        const stillValid = prev && schools.some((s) => String(s._id) === String(prev));
        return stillValid ? prev : (schools[0]?._id || null);
      });
      return;
    } catch (err) {
      console.log('Error fetching face status from /auth/me', err?.response?.status);
    }
    try {
      const pRes = await api.get('/profile/me');
      const p = pRes.data.data?.profile || {};
      setFaceStatus(p.facialRegistrationStatusV2 || p.facialRegistrationStatus || 'none');
    } catch (err) {
      console.log('Error fetching face status from /profile/me', err?.response?.status);
    }
  };

  const fetchFaceStatusAndAttendance = async () => {
    await loadFaceStatus();
    try {
      const attendanceRes = await api.get('/attendance/my-attendance');
      setAttendanceRecords(attendanceRes.data.data || []);
    } catch (err) {
      console.log('Error fetching attendance', err);
    }
  };

  const fetchHolidays = async () => {
    try {
      const res = await api.get('/holidays');
      setHolidays(res.data.data || []);
    } catch (err) {
      console.log('Error fetching holidays', err);
    }
  };

  const [alertConfig, setAlertConfig] = useState({ visible: false, title: '', message: '', type: 'info', buttons: [] });

  const fetchData = async () => {
    try {
      // Use allSettled so one failing endpoint (e.g. a 404 on /auth/me) can't
      // blank out unrelated data like the team-members list. Each result is
      // applied independently.
      const [reportsRes, trainersRes, activitiesRes, attendanceRes] = await Promise.allSettled([
        api.get('/reports'),
        api.get(`/admin/users?role=trainer&teamLeaderId=${user._id || user.id}&limit=100`),
        api.get(`/activities?uploaderId=${user._id || user.id}`),
        api.get('/attendance/my-attendance'),
      ]);
      if (reportsRes.status === 'fulfilled') setReports(reportsRes.value.data.data);
      if (trainersRes.status === 'fulfilled') setTrainers(trainersRes.value.data.data);
      if (activitiesRes.status === 'fulfilled') setMyActivities(activitiesRes.value.data.data);
      if (attendanceRes.status === 'fulfilled') setAttendanceRecords(attendanceRes.value.data.data || []);
      // Log any individual failures without discarding the successful results.
      [reportsRes, trainersRes, activitiesRes, attendanceRes].forEach((r, i) => {
        if (r.status === 'rejected') console.log('TeamLeader fetchData call failed', i, r.reason?.message);
      });
      await loadFaceStatus();
      fetchHolidays();
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const showAlert = (title, message, type = 'info', buttons = []) => {
    setAlertConfig({ visible: true, title, message, type, buttons });
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
  }, []);

  const handleFocus = (field) => {
    setFocusFields((prev) => ({ ...prev, [field]: true }));
  };

  const handleBlur = (field) => {
    setFocusFields((prev) => ({ ...prev, [field]: false }));
  };

  if (loading) {
    return <ScreenLoader message="Loading Team Leader Portal..." />;
  }

  // During logout the user is cleared before the navigator swaps stacks; bail
  // out of this render so we don't read properties off a null user.
  if (!user) return null;

  // Lock check-in / check-out to once per calendar day. Once a team leader
  // checks in (or out) they cannot repeat that action until the next local
  // midnight, when a fresh day has no record and both buttons re-enable.
  const isToday = (d) => {
    const date = new Date(d);
    const now = new Date();
    return (
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate()
    );
  };
  const todayAttendance = attendanceRecords.find((r) => isToday(r.date));
  const alreadyCheckedIn = !!(todayAttendance && todayAttendance.checkInTime);
  const alreadyCheckedOut = !!(todayAttendance && todayAttendance.checkOutTime);

  // Today is a non-working day if it's a Sunday or an approved school holiday;
  // check-in / check-out are disabled on those days.
  const isHolidayToday = isOffToday(holidays);

  const getInputStyle = (field) => {
    const isFocused = focusFields[field];
    return [
      styles.input,
      {
        backgroundColor: theme.colors.background,
        borderColor: isFocused ? theme.colors.primary : theme.colors.border,
        color: theme.colors.textPrimary,
      },
    ];
  };

  const handleVisitSubmit = async (values, { resetForm }) => {
    try {
      await api.post('/reports', { 
        ...values, 
        dateOfInspection: dateOfInspection.toISOString() 
      });
      showAlert('Success', 'Visit report submitted for approval.', 'success');
      resetForm();
      fetchData();
    } catch (error) {
      showAlert('Error', error.response?.data?.error || 'Failed to submit', 'error');
    }
  };

  const deleteReport = (id) => {
    showAlert('Confirm', 'Are you sure you want to delete this visit report?', 'warning', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.delete(`/reports/${id}`);
            showAlert('Success', 'Visit report deleted.', 'success');
            fetchData();
          } catch (err) {
            showAlert('Error', err.response?.data?.error || 'Failed to delete report.', 'error');
          }
        },
      },
    ]);
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

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      {/* Fixed Header */}
      <View style={{ backgroundColor: theme.colors.background, paddingTop: insets.top }}>
        <View style={{ paddingHorizontal: 20, paddingTop: 4 }}>
          <View style={[styles.header, { borderBottomColor: theme.colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 16 }]}>
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
                  {TAB_ITEMS.find(t => t.key === activeTab)?.label || 'Team Leader'}
                </Text>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 1 }}>Team Leader Portal</Text>
              </View>
            </View>
          </View>
        </View>
      </View>

      <ScrollView
        style={[styles.container, { backgroundColor: theme.colors.background }]}
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
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

      <View style={{ display: activeTab === 'Reports' ? 'flex' : 'none' }}>
        {/* Log Visit — launches the full IECE EGM Visit report form */}
        <MotiView
          style={[styles.formCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
          from={{ opacity: 0, translateY: 15 }}
          animate={{ opacity: 1, translateY: 0 }}
        >
          <View style={styles.formHeader}>
            <Ionicons name="document-text-outline" size={20} color={theme.colors.primary} />
            <Text style={[styles.formTitle, { color: theme.colors.textPrimary }]}>Log Visit Report</Text>
          </View>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 13, lineHeight: 20, marginBottom: 16 }}>
            Visit a trainer's school and complete the full IECE EGM Visit / Sparked Visit report. Every field is
            mandatory. Once submitted it is sent to that school for review.
          </Text>
          {trainers.length === 0 ? (
            <Text style={{ color: theme.colors.textSecondary, fontStyle: 'italic' }}>No trainers assigned to you yet.</Text>
          ) : (
            <TouchableOpacity
              style={[styles.button, { backgroundColor: theme.colors.primary }]}
              onPress={() => setReportFormVisible(true)}
              activeOpacity={0.85}
            >
              <Ionicons name="add-circle-outline" size={18} color="#FFFFFF" style={{ marginRight: 6 }} />
              <Text style={styles.buttonText}>Start Visit Report</Text>
            </TouchableOpacity>
          )}
        </MotiView>
      </View>

      <View style={{ display: activeTab === 'MyReports' ? 'flex' : 'none' }}>
        {reports.length === 0 ? (
           <View style={{ alignItems: 'center', marginTop: 40 }}>
             <Ionicons name="document-text-outline" size={48} color={theme.colors.border} />
             <Text style={{ color: theme.colors.textSecondary, marginTop: 12 }}>No reports filed yet.</Text>
           </View>
        ) : (
           reports.map(report => {
             const isPending = report.status === 'pending';
             const isApproved = report.status === 'approved';
             
             return (
               <View key={report._id} style={[styles.reportCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                 <View style={[styles.cardAccent, { backgroundColor: isApproved ? '#4CAF50' : report.status === 'rejected' ? '#FF4444' : '#FFC107' }]} />
                 <View style={styles.cardContent}>
                   <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                     <View style={{ flex: 1, paddingRight: 12 }}>
                       <Text style={[styles.reportSchool, { color: theme.colors.textPrimary }]} numberOfLines={2}>
                         {report.schoolId?.name || 'School'}
                       </Text>
                       <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginTop: 6, fontWeight: '600' }}>
                         <Ionicons name="person-outline" size={12} /> Trainer: {report.trainerId?.name || 'Unknown Trainer'}
                       </Text>
                       <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginTop: 2, fontWeight: '600' }}>
                         <Ionicons name="shield-checkmark-outline" size={12} /> Approver: {report.schoolId?.chairmanId?.name || 'Unknown Chairman'}
                       </Text>
                     </View>
                     <View style={[styles.statusBadge, { backgroundColor: isApproved ? '#4CAF5015' : report.status === 'rejected' ? '#FF444415' : '#FFC10715' }]}>
                       <Text style={[styles.statusText, { color: isApproved ? '#4CAF50' : report.status === 'rejected' ? '#FF4444' : '#FFC107' }]}>
                         {isPending ? 'Pending Approval' : report.status.toUpperCase()}
                       </Text>
                     </View>
                   </View>
                   
                   <View style={styles.cardFooter}>
                     <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                       <Ionicons name="calendar-outline" size={14} color={theme.colors.textSecondary} style={{ marginRight: 6 }} />
                       <Text style={[styles.reportDate, { color: theme.colors.textSecondary }]}>
                         Inspection: {report.dateOfInspection ? new Date(report.dateOfInspection).toLocaleDateString() : 'N/A'}
                       </Text>
                     </View>
                   </View>

                   <View style={{ marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
                     <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                       <Ionicons name="people-circle-outline" size={18} color={theme.colors.primary} style={{ marginRight: 8 }} />
                       <Text style={{ color: theme.colors.textPrimary, fontSize: 14, fontWeight: '700' }}>
                         Met: {report.personMet}
                       </Text>
                     </View>
                     <View style={{ backgroundColor: theme.colors.background, padding: 14, borderRadius: 12, borderLeftWidth: 3, borderLeftColor: theme.colors.primary, marginBottom: 16 }}>
                       <Text style={{ color: theme.colors.textSecondary, fontSize: 14, fontStyle: 'italic', lineHeight: 20 }}>
                         "{report.discussionContext}"
                       </Text>
                     </View>

                     <View style={styles.eventActions}>
                       <TouchableOpacity
                         style={[styles.actionBtn, { borderColor: theme.colors.border, backgroundColor: theme.colors.background }]}
                         onPress={() => setReportToView(report)}
                       >
                         <Ionicons name="eye-outline" size={18} color={theme.colors.textPrimary} />
                         <Text style={{ color: theme.colors.textPrimary, fontSize: 13, marginLeft: 6, fontWeight: '600' }}>View</Text>
                       </TouchableOpacity>
                       <TouchableOpacity
                         style={[styles.actionBtn, { borderColor: theme.colors.primary, backgroundColor: theme.colors.primary + '10' }]}
                         onPress={() => setReportToEdit(report)}
                       >
                         <Ionicons name="create-outline" size={18} color={theme.colors.primary} />
                         <Text style={{ color: theme.colors.primary, fontSize: 13, marginLeft: 6, fontWeight: '600' }}>Edit</Text>
                       </TouchableOpacity>
                       <TouchableOpacity
                         style={[styles.actionBtn, { borderColor: '#FF4444', backgroundColor: '#FF444410' }]}
                         onPress={() => deleteReport(report._id)}
                       >
                         <Ionicons name="trash-outline" size={18} color="#FF4444" />
                         <Text style={{ color: '#FF4444', fontSize: 13, marginLeft: 6, fontWeight: '600' }}>Delete</Text>
                       </TouchableOpacity>
                     </View>
                   </View>
                 </View>
               </View>
             );
           })
        )}
      </View>

      <View style={{ display: activeTab === 'MyTeam' ? 'flex' : 'none' }}>
        {trainers.length === 0 ? (
           <View style={{ alignItems: 'center', marginTop: 40 }}>
             <Ionicons name="people-outline" size={48} color={theme.colors.border} />
             <Text style={{ color: theme.colors.textSecondary, marginTop: 12 }}>No trainers allocated.</Text>
           </View>
        ) : (
           trainers.map(trainer => (
             <View key={trainer._id} style={[styles.reportCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, padding: 16 }]}>
               <View style={{ flex: 1 }}>
                 <Text style={{ color: theme.colors.textPrimary, fontSize: 16, fontWeight: 'bold' }}>{trainer.name}</Text>
                 <Text style={{ color: theme.colors.textSecondary, marginTop: 4 }}>{trainer.email}</Text>
                 <Text style={{ color: theme.colors.textSecondary, marginTop: 4 }}>School: {trainer.schoolIds?.length ? trainer.schoolIds.map(s => s.name).join(', ') : (trainer.schoolId?.name || 'N/A')}</Text>
               </View>
               <TouchableOpacity 
                 style={{ backgroundColor: theme.colors.primary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, justifyContent: 'center' }}
                 onPress={() => navigation.navigate('UserProfile', { userId: trainer._id })}
               >
                 <Text style={{ color: '#fff', fontWeight: 'bold' }}>View Profile</Text>
               </TouchableOpacity>
             </View>
           ))
        )}
      </View>

      <View style={{ display: activeTab === 'Attendance' ? 'flex' : 'none', marginTop: 16 }}>
        {/* School selector — shown when the leader works under multiple schools */}
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

        {/* Per-school attendance actions (register / login / logout) */}
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

          const todayAtt = attendanceRecords.find((r) => isToday(r.date));
          const todaySchoolId = todayAtt ? String(todayAtt.schoolId?._id || todayAtt.schoolId) : null;
          const todaySchoolName = todayAtt ? (todayAtt.schoolId?.name || 'another school') : null;
          const checkedInHere = !!(todayAtt && todaySchoolId === String(selectedSchoolId) && todayAtt.checkInTime);
          const checkedOutHere = !!(todayAtt && todaySchoolId === String(selectedSchoolId) && todayAtt.checkOutTime);
          const checkedInElsewhere = !!(todayAtt && todaySchoolId !== String(selectedSchoolId));

          return (
            <View style={{ marginBottom: 12 }}>
              {regStatus === 'none' && (
                <TouchableOpacity
                  style={[styles.actionBtn, { borderColor: theme.colors.primary, backgroundColor: theme.colors.primary + '10' }]}
                  onPress={() => navigation.navigate('FaceRegistration', { schoolId: selectedSchoolId, schoolName, returnTo: 'TeamLeaderPortal' })}
                >
                  <Ionicons name="scan-outline" size={20} color={theme.colors.primary} />
                  <Text style={{ color: theme.colors.primary, fontSize: 13, marginLeft: 6, fontWeight: '600' }}>Register Face for {schoolName}</Text>
                </TouchableOpacity>
              )}

              {regStatus === 'pending' && (
                <View style={[styles.actionBtn, { borderColor: '#F59E0B', backgroundColor: '#FEF3C7' }]}>
                  <Ionicons name="hourglass-outline" size={20} color="#D97706" />
                  <Text style={{ color: '#D97706', fontSize: 13, marginLeft: 6, fontWeight: '700' }}>Pending Approval — {schoolName}</Text>
                </View>
              )}

              {regStatus === 'approved' && (
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity
                    style={[styles.actionBtn, { flex: 1, borderColor: '#4CAF50', backgroundColor: '#4CAF5010', opacity: (checkedInHere || isHolidayToday || checkedInElsewhere) ? 0.5 : 1 }]}
                    onPress={() => navigation.navigate('Attendance', { intent: 'login', schoolId: selectedSchoolId, schoolName })}
                    disabled={checkedInHere || isHolidayToday || checkedInElsewhere}
                  >
                    <Ionicons name={checkedInHere ? 'checkmark-done-outline' : 'log-in-outline'} size={20} color="#4CAF50" />
                    <Text style={{ color: '#4CAF50', fontSize: 13, marginLeft: 6, fontWeight: '600' }}>{checkedInHere ? 'Checked In' : 'Login'}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.actionBtn, { flex: 1, borderColor: '#F44336', backgroundColor: '#F4433610', opacity: (!checkedInHere || checkedOutHere || isHolidayToday) ? 0.5 : 1 }]}
                    onPress={() => navigation.navigate('Attendance', { intent: 'logout', schoolId: selectedSchoolId, schoolName })}
                    disabled={!checkedInHere || checkedOutHere || isHolidayToday}
                  >
                    <Ionicons name={checkedOutHere ? 'checkmark-done-outline' : 'log-out-outline'} size={20} color="#F44336" />
                    <Text style={{ color: '#F44336', fontSize: 13, marginLeft: 6, fontWeight: '600' }}>{checkedOutHere ? 'Checked Out' : 'Logout'}</Text>
                  </TouchableOpacity>
                </View>
              )}

              {checkedInElsewhere && (
                <View style={{ backgroundColor: '#E1F5FE', borderRadius: 10, padding: 12, marginTop: 12, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#87CEEB' }}>
                  <Ionicons name="information-circle-outline" size={16} color="#0277BD" style={{ marginRight: 8 }} />
                  <Text style={{ color: '#01579B', fontSize: 12, fontWeight: '600', flex: 1 }}>You already checked in at {todaySchoolName} today, so check-in here is disabled. You can only work at one school per day.</Text>
                </View>
              )}
            </View>
          );
        })()}

        {isHolidayToday && (
          <View style={{ backgroundColor: '#E1F5FE', borderRadius: 10, padding: 12, marginBottom: 16, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#87CEEB' }}>
            <Ionicons name="sunny-outline" size={16} color="#0277BD" style={{ marginRight: 8 }} />
            <Text style={{ color: '#01579B', fontSize: 12, fontWeight: '600', flex: 1 }}>Today is a holiday. Check-in and check-out are disabled.</Text>
          </View>
        )}

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
              ...buildHolidayMarks(holidays),
              ...((attendanceRecords.find(r => new Date(r.date).toISOString().split('T')[0] === dayKey()) || holidays.find(h => h.date === dayKey() && h.status !== 'rejected')) ? {} : {
                [dayKey()]: {
                  customStyles: {
                    container: { backgroundColor: '#E0E0E0', borderRadius: 8, borderWidth: 2, borderColor: theme.colors.primary },
                    text: { color: theme.colors.textPrimary, fontWeight: 'bold' }
                  }
                }
              })
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
          <View style={{ alignItems: 'center' }}><View style={{ width: 16, height: 16, backgroundColor: '#87CEEB', borderRadius: 4, marginBottom: 4 }} /><Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>Holiday</Text></View>
          <View style={{ alignItems: 'center' }}><View style={{ width: 16, height: 16, backgroundColor: '#E0E0E0', borderRadius: 4, marginBottom: 4 }} /><Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>Blank</Text></View>
        </View>
      </View>

      <View style={{ display: activeTab === 'SchoolHoliday' ? 'flex' : 'none', marginTop: 16 }}>
        <ApplyHolidaySection onChanged={fetchHolidays} />
      </View>

      <View style={{ display: activeTab === 'Events' ? 'flex' : 'none' }}>
        <CreateActivityForm onActivityCreated={fetchData} />
      </View>

      <View style={{ display: activeTab === 'ManageEvents' ? 'flex' : 'none', marginTop: 16 }}>
        {myActivities.length === 0 ? (
           <View style={{ alignItems: 'center', marginTop: 40 }}>
             <Ionicons name="calendar-outline" size={48} color={theme.colors.border} />
             <Text style={{ color: theme.colors.textSecondary, marginTop: 12 }}>No activities published yet.</Text>
           </View>
        ) : (
           myActivities.map(evt => (
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
                   <Text style={[styles.eventDate, { color: theme.colors.textSecondary }]}>{new Date(evt.activityDate).toLocaleDateString()}</Text>
                   <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>{evt.organizers?.length || 0} Organizers</Text>
                 </View>
               </View>
               
               <View style={styles.eventActions}>
                 <TouchableOpacity style={[styles.actionBtn, { borderColor: theme.colors.primary, backgroundColor: theme.colors.primary + '10' }]} onPress={() => setActivityToEdit(evt)}>
                   <Ionicons name="create-outline" size={18} color={theme.colors.primary} />
                   <Text style={{ color: theme.colors.primary, fontSize: 13, marginLeft: 6, fontWeight: '600' }}>Edit Activity</Text>
                 </TouchableOpacity>
                 <TouchableOpacity style={[styles.actionBtn, { borderColor: '#FF4444', backgroundColor: '#FF444410' }]} onPress={() => deleteActivity(evt._id)}>
                   <Ionicons name="trash-outline" size={18} color="#FF4444" />
                   <Text style={{ color: '#FF4444', fontSize: 13, marginLeft: 6, fontWeight: '600' }}>Delete</Text>
                 </TouchableOpacity>
               </View>
             </View>
           ))
        )}
      </View>

    </ScrollView>

    <SidebarMenu
      ref={sidebarRef}
      title="Team Leader"
      subtitle={user?.name || 'Team Leader'}
      tabs={TAB_ITEMS}
      activeTab={activeTab}
      onSelectTab={setActiveTab}
      actions={[
        { label: 'My Profile', icon: 'person-outline', onPress: () => navigation.navigate('UserProfile', { userId: 'me' }) },
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
    {activityToEdit && (
      <EditActivityModal 
        visible={!!activityToEdit}
        activity={activityToEdit}
        onClose={() => setActivityToEdit(null)}
        onSuccess={fetchData}
        onError={(msg) => showAlert('Error', msg, 'error')}
      />
    )}
    {/* New visit report */}
    <VisitReportForm
      visible={reportFormVisible}
      targets={trainers}
      author={user}
      onClose={() => setReportFormVisible(false)}
      onSubmitted={(message) => { showAlert('Success', message, 'success'); fetchData(); }}
      onError={(message) => showAlert('Error', message, 'error')}
    />

    {/* Edit existing report */}
    <VisitReportForm
      visible={!!reportToEdit}
      editReport={reportToEdit}
      targets={trainers}
      author={user}
      onClose={() => setReportToEdit(null)}
      onSubmitted={(message) => { setReportToEdit(null); showAlert('Success', message, 'success'); fetchData(); }}
      onError={(message) => showAlert('Error', message, 'error')}
    />

    {/* Read-only full report */}
    <VisitReportDetail
      visible={!!reportToView}
      report={reportToView}
      onClose={() => setReportToView(null)}
    />
  </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  backBtn: { padding: 8, borderRadius: 12, borderWidth: 1, alignSelf: 'flex-start' },
  headerIconBtn: { 
    width: 40, 
    height: 40, 
    borderRadius: 20, 
    alignItems: 'center', 
    justifyContent: 'center',
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
  title: { fontSize: 24, fontWeight: '700', letterSpacing: -0.5 },
  menuBtn: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  formCard: {
    padding: 16, 
    borderRadius: 16, 
    borderWidth: 1, 
    marginBottom: 20,
  },
  formHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  formTitle: { 
    fontSize: 16, 
    fontWeight: '700',
    marginLeft: 10,
    letterSpacing: -0.2,
  },
  inputContainer: {
    marginBottom: 14,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
    marginLeft: 2,
  },
  input: { 
    borderWidth: 1, 
    borderRadius: 12, 
    padding: 14, 
    fontSize: 14,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    marginLeft: 2,
  },
  error: { 
    fontSize: 11, 
    fontWeight: '600',
  },
  button: { 
    padding: 16, 
    borderRadius: 12, 
    alignItems: 'center', 
    justifyContent: 'center',
    marginTop: 10,
    flexDirection: 'row',
  },
  buttonText: { 
    color: '#FFFFFF',
    fontWeight: '700', 
    fontSize: 14,
  },
  reportCard: {
    flexDirection: 'row',
    borderRadius: 16,
    marginBottom: 16,
    overflow: 'hidden',
    borderWidth: 1,
  },
  cardAccent: {
    width: 6,
  },
  cardContent: {
    flex: 1,
    padding: 16,
  },
  reportSchool: {
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 22,
    letterSpacing: -0.3,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  reportDate: {
    fontSize: 13,
    fontWeight: '600',
  },
  eventCard: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 16,
  },
  eventTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  eventDate: {
    fontSize: 13,
    marginBottom: 4,
  },
  eventActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 4,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginHorizontal: 4,
  }
});
