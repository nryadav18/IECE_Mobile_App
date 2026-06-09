import React, { useContext, useState, useCallback, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, RefreshControl } from 'react-native';
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
import EditReportModal from '../components/EditReportModal';
import { Image } from 'react-native';
import { Calendar } from 'react-native-calendars';
import { useAlert } from '../context/AlertContext';

const VisitSchema = Yup.object().shape({
  personMet: Yup.string().required('Met person name is required'),
  discussionContext: Yup.string().required('Discussion context is required'),
  trainerId: Yup.string().required('Trainer selection is required'),
  schoolId: Yup.string().required('School is required'),
});

export default function TeamLeaderPortal({ navigation }) {
  const { theme } = useContext(ThemeContext);
  const { user } = useContext(AuthContext);
  const insets = useSafeAreaInsets();
  const { showAlert: showGlobalAlert } = useAlert();

  const [reports, setReports] = useState([]);
  const [trainers, setTrainers] = useState([]);
  const [myActivities, setMyActivities] = useState([]);
  const [attendanceRecords, setAttendanceRecords] = useState([]);
  const [faceStatus, setFaceStatus] = useState('none'); // 'none' | 'pending' | 'approved'
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('Reports');
  const [activityToEdit, setActivityToEdit] = useState(null);
  const [reportToEdit, setReportToEdit] = useState(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [dateOfInspection, setDateOfInspection] = useState(new Date());

  // Track focus states
  const [focusFields, setFocusFields] = useState({});
  const [refreshing, setRefreshing] = useState(false);

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
    } catch (err) {
      console.log('Error fetching face/attendance status', err);
    }
  };

  const [alertConfig, setAlertConfig] = useState({ visible: false, title: '', message: '', type: 'info', buttons: [] });

  const fetchData = async () => {
    try {
      const [reportsRes, trainersRes, activitiesRes, attendanceRes, meRes] = await Promise.all([
        api.get('/reports'),
        api.get(`/admin/users?role=trainer&teamLeaderId=${user._id || user.id}&limit=100`),
        api.get(`/activities?uploaderId=${user._id || user.id}`),
        api.get('/attendance/my-attendance'),
        api.get('/auth/me')
      ]);
      setReports(reportsRes.data.data);
      setTrainers(trainersRes.data.data);
      setMyActivities(activitiesRes.data.data);
      setAttendanceRecords(attendanceRes.data.data || []);
      setFaceStatus(meRes.data.data?.facialRegistrationStatusV2 || meRes.data.data?.facialRegistrationStatus || 'none');
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
    <View style={{ flex: 1 }}>
      {/* Fixed Header */}
      <View style={{ backgroundColor: theme.colors.background, paddingTop: insets.top }}>
        <View style={{ paddingHorizontal: 20, paddingTop: 4 }}>
          <View style={[styles.header, { borderBottomColor: theme.colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 16 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <TouchableOpacity 
                style={[styles.backBtn, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface, marginRight: 12 }]}
                onPress={() => navigation.goBack()}
                activeOpacity={0.8}
              >
                <Ionicons name="arrow-back-outline" size={20} color={theme.colors.textPrimary} />
              </TouchableOpacity>
              <Text style={[styles.title, { color: theme.colors.textPrimary, marginBottom: 0 }]}>Team Leader</Text>
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
              { key: 'Reports', label: 'Log Visit', icon: 'document-text-outline' },
              { key: 'MyReports', label: 'My Reports', icon: 'folder-open-outline' },
              { key: 'MyTeam', label: 'My Team', icon: 'people-outline' },
              { key: 'Attendance', label: 'Attendance', icon: 'calendar-outline' },
              { key: 'Events', label: 'Publish Activity', icon: 'add-circle-outline' },
              { key: 'ManageEvents', label: 'Manage Activities', icon: 'list-outline' },
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
      </View>

      <ScrollView 
        style={[styles.container, { backgroundColor: theme.colors.background }]}
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }}
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

      <View style={{ display: activeTab === 'Reports' ? 'flex' : 'none' }}>
        {/* Log Visit Form */}
        <MotiView 
        style={[styles.formCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]} 
        from={{ opacity: 0, translateY: 15 }} 
        animate={{ opacity: 1, translateY: 0 }}
      >
        <View style={styles.formHeader}>
          <Ionicons name="document-text-outline" size={20} color={theme.colors.primary} />
          <Text style={[styles.formTitle, { color: theme.colors.textPrimary }]}>Log Visit Report</Text>
        </View>

        <Formik
          initialValues={{ personMet: '', discussionContext: '', trainerId: '', schoolId: '' }}
          validationSchema={VisitSchema}
          onSubmit={handleVisitSubmit}
        >
          {({ handleChange, handleBlur: formikBlur, handleSubmit, setFieldValue, values, errors, touched }) => (
            <View>
              <View style={styles.inputContainer}>
                <Text style={[styles.inputLabel, { color: theme.colors.textSecondary }]}>Find our Trainer</Text>
                <CustomDropdown
                  data={trainers}
                  selectedValue={values.trainerId}
                  onSelect={(item) => {
                    setFieldValue('trainerId', item._id);
                    if (item.schoolId) {
                      setFieldValue('schoolId', item.schoolId._id || item.schoolId);
                    } else {
                      setFieldValue('schoolId', '');
                    }
                  }}
                  placeholder="Search & Select Trainer"
                  theme={theme}
                />
                {errors.trainerId && touched.trainerId && (
                  <Text style={[styles.error, { color: theme.colors.primary }]}>{errors.trainerId}</Text>
                )}
              </View>

              <View style={styles.inputContainer}>
                <Text style={[styles.inputLabel, { color: theme.colors.textSecondary }]}>Find the School</Text>
                <CustomDropdown
                  data={values.trainerId ? [trainers.find(t => t._id === values.trainerId)?.schoolId].filter(Boolean) : []}
                  selectedValue={values.schoolId}
                  onSelect={() => {}} // Readonly basically, auto-selected
                  placeholder="Auto-selected based on Trainer"
                  theme={theme}
                />
                {errors.schoolId && touched.schoolId && (
                  <Text style={[styles.error, { color: theme.colors.primary }]}>{errors.schoolId}</Text>
                )}
              </View>

              <View style={styles.inputContainer}>
                <Text style={[styles.inputLabel, { color: theme.colors.textSecondary }]}>Date of Inspection</Text>
                <TouchableOpacity 
                  style={[styles.input, { borderColor: theme.colors.border, justifyContent: 'center' }]}
                  onPress={() => setShowDatePicker(true)}
                >
                  <Text style={{ color: theme.colors.textPrimary }}>{dateOfInspection.toLocaleDateString()}</Text>
                </TouchableOpacity>
                {showDatePicker && (
                  <DateTimePicker
                    value={dateOfInspection}
                    mode="date"
                    display="default"
                    onChange={(event, selectedDate) => {
                      setShowDatePicker(false);
                      if (selectedDate) setDateOfInspection(selectedDate);
                    }}
                  />
                )}
              </View>

              <View style={styles.inputContainer}>
                <Text style={[styles.inputLabel, { color: theme.colors.textSecondary }]}>Person Met</Text>
                <TextInput
                  style={getInputStyle('personMet')}
                  onChangeText={handleChange('personMet')}
                  onBlur={() => {
                    formikBlur('personMet');
                    handleBlur('personMet');
                  }}
                  onFocus={() => handleFocus('personMet')}
                  value={values.personMet}
                  placeholder="Enter name"
                  placeholderTextColor={theme.colors.placeholder}
                />
                {errors.personMet && touched.personMet ? (
                  <View style={styles.errorRow}>
                    <Ionicons name="alert-circle-outline" size={14} color={theme.colors.primary} style={{ marginRight: 4 }} />
                    <Text style={[styles.error, { color: theme.colors.primary }]}>{errors.personMet}</Text>
                  </View>
                ) : null}
              </View>
              
              <View style={styles.inputContainer}>
                <Text style={[styles.inputLabel, { color: theme.colors.textSecondary }]}>Discussion Context</Text>
                <TextInput
                  style={[getInputStyle('discussionContext'), { height: 100, textAlignVertical: 'top' }]}
                  onChangeText={handleChange('discussionContext')}
                  onBlur={() => {
                    formikBlur('discussionContext');
                    handleBlur('discussionContext');
                  }}
                  onFocus={() => handleFocus('discussionContext')}
                  value={values.discussionContext}
                  placeholder="What was discussed?"
                  placeholderTextColor={theme.colors.placeholder}
                  multiline
                  numberOfLines={4}
                />
                {errors.discussionContext && touched.discussionContext ? (
                  <View style={styles.errorRow}>
                    <Ionicons name="alert-circle-outline" size={14} color={theme.colors.primary} style={{ marginRight: 4 }} />
                    <Text style={[styles.error, { color: theme.colors.primary }]}>{errors.discussionContext}</Text>
                  </View>
                ) : null}
              </View>
              
              <TouchableOpacity 
                style={[styles.button, { backgroundColor: theme.colors.primary }]} 
                onPress={handleSubmit}
                activeOpacity={0.8}
              >
                <Text style={styles.buttonText}>Submit Report</Text>
                <Ionicons name="send-outline" size={16} color="#FFFFFF" style={{ marginLeft: 6 }} />
              </TouchableOpacity>
            </View>
          )}
        </Formik>
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
                 <Text style={{ color: theme.colors.textSecondary, marginTop: 4 }}>School: {trainer.schoolId?.name || 'N/A'}</Text>
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
        {/* Dynamic Buttons based on status */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
          {faceStatus !== 'approved' ? (
            /* Single Button Layout */
            <>
              {faceStatus === 'none' && (
                <TouchableOpacity
                  style={[styles.actionBtn, { flex: 1, borderColor: theme.colors.primary, backgroundColor: theme.colors.primary + '10' }]}
                  onPress={() => navigation.navigate('FaceRegistration')}
                >
                  <Ionicons name="scan-outline" size={20} color={theme.colors.primary} />
                  <Text style={{ color: theme.colors.primary, fontSize: 13, marginLeft: 6, fontWeight: '600' }}>Register Face</Text>
                </TouchableOpacity>
              )}
              {faceStatus === 'pending' && (
                <View style={[styles.actionBtn, { flex: 1, borderColor: '#F59E0B', backgroundColor: '#FEF3C7' }]}>
                  <Ionicons name="hourglass-outline" size={20} color="#D97706" />
                  <Text style={{ color: '#D97706', fontSize: 13, marginLeft: 6, fontWeight: '700' }}>Pending Approval</Text>
                </View>
              )}
            </>
          ) : (
            /* Side-by-Side Login/Logout */
            <View style={{ flexDirection: 'row', gap: 10, flex: 1 }}>
              <TouchableOpacity
                style={[styles.actionBtn, { flex: 1, borderColor: '#4CAF50', backgroundColor: '#4CAF5010' }]}
                onPress={() => navigation.navigate('Attendance', { intent: 'login' })}
              >
                <Ionicons name="log-in-outline" size={20} color="#4CAF50" />
                <Text style={{ color: '#4CAF50', fontSize: 13, marginLeft: 6, fontWeight: '600' }}>Login</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionBtn, { flex: 1, borderColor: '#F44336', backgroundColor: '#F4433610' }]}
                onPress={() => navigation.navigate('Attendance', { intent: 'logout' })}
              >
                <Ionicons name="log-out-outline" size={20} color="#F44336" />
                <Text style={{ color: '#F44336', fontSize: 13, marginLeft: 6, fontWeight: '600' }}>Logout</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

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
    {reportToEdit && (
      <EditReportModal
        visible={!!reportToEdit}
        report={reportToEdit}
        trainers={trainers}
        onClose={() => setReportToEdit(null)}
        onReportUpdated={(message) => {
          setReportToEdit(null);
          showAlert('Success', message, 'success');
          fetchData();
        }}
        onError={(message) => showAlert('Error', message, 'error')}
      />
    )}
  </View>
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
