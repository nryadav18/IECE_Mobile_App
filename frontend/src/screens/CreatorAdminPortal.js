import React, { useState, useEffect, useContext, useCallback } from 'react';
import { 
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, ActivityIndicator, RefreshControl, KeyboardAvoidingView, Platform, Image
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Formik } from 'formik';
import * as Yup from 'yup';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { MotiView } from 'moti';
import { AuthContext } from '../context/AuthContext';
import { ThemeContext } from '../context/ThemeContext';
import api from '../services/api';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Avatar from '../components/Avatar';
import CustomAlert from '../components/CustomAlert';
import CustomDropdown from '../components/CustomDropdown';
import EditEventModal from '../components/EditEventModal';
import ScreenLoader from '../components/ScreenLoader';

const TlSchema = Yup.object().shape({
  name: Yup.string().required('Required'),
  email: Yup.string().email('Invalid email').required('Required'),
  password: Yup.string().min(6, 'Min 6 chars').required('Required'),
  schoolId: Yup.string().required('Required'),
});

const ChairmanSchema = Yup.object().shape({
  chairmanName: Yup.string().required('Required'),
  email: Yup.string().email('Invalid email').required('Required'),
  password: Yup.string().min(6, 'Min 6 chars').required('Required'),
  schoolName: Yup.string().required('Required'),
  associationDate: Yup.date().typeError('Must be a valid date (YYYY-MM-DD)').required('Required'),
  classCoverage: Yup.string().required('Required'),
  state: Yup.string().required('Required'),
  mouPdfUrl: Yup.string()
});

const INDIAN_STATES = [
  { _id: 'Andhra Pradesh', name: 'Andhra Pradesh' },
  { _id: 'Arunachal Pradesh', name: 'Arunachal Pradesh' },
  { _id: 'Assam', name: 'Assam' },
  { _id: 'Bihar', name: 'Bihar' },
  { _id: 'Chhattisgarh', name: 'Chhattisgarh' },
  { _id: 'Goa', name: 'Goa' },
  { _id: 'Gujarat', name: 'Gujarat' },
  { _id: 'Haryana', name: 'Haryana' },
  { _id: 'Himachal Pradesh', name: 'Himachal Pradesh' },
  { _id: 'Jharkhand', name: 'Jharkhand' },
  { _id: 'Karnataka', name: 'Karnataka' },
  { _id: 'Kerala', name: 'Kerala' },
  { _id: 'Madhya Pradesh', name: 'Madhya Pradesh' },
  { _id: 'Maharashtra', name: 'Maharashtra' },
  { _id: 'Manipur', name: 'Manipur' },
  { _id: 'Meghalaya', name: 'Meghalaya' },
  { _id: 'Mizoram', name: 'Mizoram' },
  { _id: 'Nagaland', name: 'Nagaland' },
  { _id: 'Odisha', name: 'Odisha' },
  { _id: 'Punjab', name: 'Punjab' },
  { _id: 'Rajasthan', name: 'Rajasthan' },
  { _id: 'Sikkim', name: 'Sikkim' },
  { _id: 'Tamil Nadu', name: 'Tamil Nadu' },
  { _id: 'Telangana', name: 'Telangana' },
  { _id: 'Tripura', name: 'Tripura' },
  { _id: 'Uttar Pradesh', name: 'Uttar Pradesh' },
  { _id: 'Uttarakhand', name: 'Uttarakhand' },
  { _id: 'West Bengal', name: 'West Bengal' },
  { _id: 'Andaman and Nicobar Islands', name: 'Andaman and Nicobar Islands' },
  { _id: 'Chandigarh', name: 'Chandigarh' },
  { _id: 'Dadra and Nagar Haveli and Daman and Diu', name: 'Dadra and Nagar Haveli and Daman and Diu' },
  { _id: 'Delhi', name: 'Delhi' },
  { _id: 'Jammu and Kashmir', name: 'Jammu and Kashmir' },
  { _id: 'Ladakh', name: 'Ladakh' },
  { _id: 'Lakshadweep', name: 'Lakshadweep' },
  { _id: 'Puducherry', name: 'Puducherry' },
];

const calculateAssociationYear = (dateStr) => {
  const start = new Date(dateStr);
  const now = new Date();
  const diff = (now - start) / (1000 * 60 * 60 * 24 * 365.25);
  if (diff < 0) return 'Future';
  if (diff < 1) return '1st Year';
  if (diff < 2) return '2nd Year';
  if (diff < 3) return '3rd Year';
  return `${Math.floor(diff) + 1}th Year`;
};

const TrainerSchema = Yup.object().shape({
  name: Yup.string().required('Required'),
  email: Yup.string().email('Invalid email').required('Required'),
  password: Yup.string().min(6, 'Min 6 chars').required('Required'),
  schoolId: Yup.string().required('Required'),
  teamLeaderId: Yup.string().required('Required'),
});

export default function CreatorAdminPortal({ navigation }) {
  const { user, logout } = useContext(AuthContext);
  const { theme } = useContext(ThemeContext);
  const insets = useSafeAreaInsets();
  
  const [activeTab, setActiveTab] = useState('Monitoring');
  const [schools, setSchools] = useState([]);
  const [teamLeaders, setTeamLeaders] = useState([]);
  const [allEvents, setAllEvents] = useState([]);
  const [reports, setReports] = useState([]);
  const [loadingData, setLoadingData] = useState(true);
  const [eventToEdit, setEventToEdit] = useState(null);
  const [alertConfig, setAlertConfig] = useState({ visible: false, title: '', message: '', type: 'info' });
  const [secureTextEntry, setSecureTextEntry] = useState(true);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [bannerDesc, setBannerDesc] = useState('');
  const [isUploadingBanner, setIsUploadingBanner] = useState(false);
  const [isUploadingMou, setIsUploadingMou] = useState(false);
  
  // Banner flow state
  const [bannerImageAsset, setBannerImageAsset] = useState(null);

  // Monitoring state
  const [selectedState, setSelectedState] = useState(null);
  const [selectedSchool, setSelectedSchool] = useState(null);
  const [schoolActivities, setSchoolActivities] = useState([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  
  const [banners, setBanners] = useState([]);
  const [bannerPage, setBannerPage] = useState(1);
  const bannersPerPage = 5;

  const showAlert = (title, message, type = 'info', buttons = []) => {
    setAlertConfig({ visible: true, title, message, type, buttons });
  };

  useEffect(() => {
    fetchDropdownData();
  }, []);

  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = React.useCallback(() => {
    setRefreshing(true);
    fetchDropdownData().finally(() => setRefreshing(false));
  }, []);

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

  const fetchDropdownData = async () => {
    try {
      const [schoolsRes, tlsRes, eventsRes, bannerRes, reportsRes] = await Promise.all([
        api.get('/admin/schools'),
        api.get('/admin/team-leaders'),
        api.get('/events'),
        api.get('/media'),
        api.get('/reports')
      ]);
      setSchools(schoolsRes.data.data);
      setTeamLeaders(tlsRes.data.data);
      setAllEvents(eventsRes.data.data);
      setBanners(bannerRes.data.data);
      setReports(reportsRes.data.data);
    } catch (err) {
      console.log('Error fetching initial admin data', err);
    } finally {
      setLoadingData(false);
    }
  };

  const submitForm = async (url, values, resetForm) => {
    try {
      await api.post(url, values);
      showAlert('Success', 'Creation successful', 'success');
      resetForm();
      fetchDropdownData();
    } catch (err) {
      showAlert('Error', err.response?.data?.error || 'Creation failed', 'error');
    }
  };

  const uploadToCloudinary = async (fileUri, mimeType, name) => {
    try {
      const formData = new FormData();
      formData.append('file', {
        uri: fileUri,
        type: mimeType,
        name: name
      });
      const response = await api.post('/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      return response.data.url;
    } catch (error) {
      console.log('Upload error', error);
      showAlert('Error', 'File upload failed', 'error');
      return null;
    }
  };

  const pickAndCropBanner = async () => {
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.8,
    });
  
    if (!result.canceled) {
      setBannerImageAsset(result.assets[0]);
    }
  };

  const submitBanner = async () => {
    if (!bannerImageAsset) {
      showAlert('Error', 'Please select and crop an image first', 'error');
      return;
    }

    setIsUploadingBanner(true);
    const url = await uploadToCloudinary(bannerImageAsset.uri, bannerImageAsset.mimeType || 'image/jpeg', bannerImageAsset.fileName || 'banner.jpg');
    if (url) {
      try {
        await api.post('/media', { imageUrl: url, description: bannerDesc });
        showAlert('Success', 'Banner published successfully!', 'success');
        setBannerDesc('');
        setBannerImageAsset(null);
        fetchDropdownData();
      } catch (err) {
        showAlert('Error', 'Failed to save media record', 'error');
      }
    }
    setIsUploadingBanner(false);
  };

  const deleteBanner = (id) => {
    showAlert('Confirm Deletion', 'Are you sure you want to delete this banner?', 'warning', [
      { text: 'Cancel', type: 'secondary' },
      { text: 'Delete', type: 'primary', onPress: async () => {
          try {
            await api.delete(`/media/${id}`);
            showAlert('Success', 'Banner deleted successfully!', 'success');
            fetchDropdownData();
          } catch (err) {
            showAlert('Error', 'Failed to delete banner', 'error');
          }
      }}
    ]);
  };

  const deleteEvent = (id) => {
    showAlert('Confirm', 'Are you sure you want to permanently delete this event?', 'warning', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            await api.delete(`/events/${id}`);
            showAlert('Success', 'Event deleted permanently.', 'success');
            fetchDropdownData();
          } catch (err) {
            showAlert('Error', 'Failed to delete event.', 'error');
          }
      }}
    ]);
  };

  const handlePickMOU = async (handleChange) => {
    let result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'] });
    if (!result.canceled) {
      setIsUploadingMou(true);
      const asset = result.assets[0];
      const url = await uploadToCloudinary(asset.uri, asset.mimeType || 'application/pdf', asset.name);
      if (url) {
        handleChange('mouPdfUrl')(url);
        showAlert('Success', 'MOU uploaded and attached!', 'success');
      } else {
        showAlert('Error', 'Failed to upload MOU to server.', 'error');
      }
      setIsUploadingMou(false);
    }
  };

  const states = [...new Set(schools.map(s => s.state).filter(Boolean))];
  const schoolsInState = schools.filter(s => s.state === selectedState);

  const viewSchoolDetails = async (school) => {
    setSelectedSchool(school);
    setActivitiesLoading(true);
    try {
      const res = await api.get(`/activities?schoolId=${school._id}`);
      setSchoolActivities(res.data.data);
    } catch (error) {
      console.log('Error fetching activities');
    } finally {
      setActivitiesLoading(false);
    }
  };

  const handleConfirmActivity = async (id) => {
    try {
      await api.put(`/activities/${id}/confirm-admin`);
      setSchoolActivities(schoolActivities.map(a => a._id === id ? { ...a, status: 'Completed Successfully' } : a));
      showAlert('Success', 'Activity Confirmed', 'success');
    } catch (error) {
      showAlert('Error', 'Failed to confirm activity', 'error');
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <View style={[styles.container, { backgroundColor: theme.colors.background, paddingTop: insets.top }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: theme.colors.border }]}>
        <View style={styles.headerTitleContainer}>
          <Ionicons name="shield-checkmark" size={24} color={theme.colors.primary} />
          <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>IECE Management Dashboard</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity onPress={() => navigation.navigate('Notifications')} style={[styles.logoutBtn, { backgroundColor: theme.colors.surface, marginRight: 10, position: 'relative' }]}>
            <Ionicons name="notifications-outline" size={20} color={theme.colors.textPrimary} />
            {unreadNotifications > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unreadNotifications > 99 ? '99+' : unreadNotifications}</Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity onPress={logout} style={[styles.logoutBtn, { backgroundColor: theme.colors.surface }]}>
            <Ionicons name="log-out-outline" size={20} color={theme.colors.error || '#FF4444'} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Scrollable Tabs - Pill Style */}
      <View style={{ borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false}
          style={styles.tabsContainer}
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 4 }}
        >
          {[
            { key: 'Monitoring', label: 'Monitoring', icon: 'pulse-outline' },
            { key: 'Trainer', label: 'Trainer', icon: 'person-outline' },
            { key: 'Chairman', label: 'Chairman', icon: 'business-outline' },
            { key: 'TeamLeader', label: 'Team Leader', icon: 'people-outline' },
            { key: 'Reports', label: 'Reports', icon: 'document-text-outline' },
            { key: 'Banners', label: 'Banners', icon: 'images-outline' },
            { key: 'ManageEvents', label: 'Events', icon: 'calendar-outline' },
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

      {loadingData ? (
        <ScreenLoader message="Loading Admin Dashboard..." />
      ) : (
        <ScrollView 
          contentContainerStyle={styles.scrollContent} 
          keyboardShouldPersistTaps="handled"
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
          
          {/* Monitoring Tab */}
          <View style={{ display: activeTab === 'Monitoring' ? 'flex' : 'none' }}>
            {!selectedState && !selectedSchool && (
              <View>
                <Text style={[styles.formTitle, { color: theme.colors.textPrimary }]}>Select State</Text>
                {states.length > 0 ? states.map(st => (
                  <TouchableOpacity key={st} style={[styles.stateBtn, { backgroundColor: theme.colors.surface }]} onPress={() => setSelectedState(st)}>
                    <Text style={{ color: theme.colors.textPrimary, fontSize: 16, fontWeight: 'bold' }}>{st}</Text>
                    <Ionicons name="chevron-forward" size={20} color={theme.colors.textSecondary} />
                  </TouchableOpacity>
                )) : <Text style={{ color: theme.colors.textSecondary }}>No states available.</Text>}
              </View>
            )}

            {selectedState && !selectedSchool && (
              <View>
                <TouchableOpacity onPress={() => setSelectedState(null)} style={{ flexDirection: 'row', marginBottom: 16 }}>
                  <Ionicons name="arrow-back" size={20} color={theme.colors.primary} />
                  <Text style={{ color: theme.colors.primary, marginLeft: 8 }}>Back to States</Text>
                </TouchableOpacity>
                <Text style={[styles.formTitle, { color: theme.colors.textPrimary }]}>Schools in {selectedState}</Text>
                {schoolsInState.map(school => (
                  <TouchableOpacity key={school._id} style={[styles.schoolItem, { backgroundColor: theme.colors.surface }]} onPress={() => viewSchoolDetails(school)}>
                    <Text style={{ color: theme.colors.textPrimary, fontSize: 16, fontWeight: 'bold' }}>{school.name}</Text>
                    <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>{school.totalStrength || 0} Students</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {selectedSchool && (
              <View>
                <TouchableOpacity onPress={() => setSelectedSchool(null)} style={{ flexDirection: 'row', marginBottom: 16 }}>
                  <Ionicons name="arrow-back" size={20} color={theme.colors.primary} />
                  <Text style={{ color: theme.colors.primary, marginLeft: 8 }}>Back to Schools</Text>
                </TouchableOpacity>
                <View style={[styles.formCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                  <Text style={[styles.formTitle, { color: theme.colors.textPrimary }]}>{selectedSchool.name}</Text>
                  <Text style={{ color: theme.colors.textSecondary }}>Association Year: {selectedSchool.associationYear}</Text>
                  <Text style={{ color: theme.colors.textSecondary }}>Class Coverage: {selectedSchool.classCoverage}</Text>
                  <Text style={{ color: theme.colors.textSecondary, marginBottom: 16 }}>Total Strength: {selectedSchool.totalStrength || 0}</Text>
                  
                  <Text style={[styles.sectionHeader, { color: theme.colors.primary }]}>Activities</Text>
                  {activitiesLoading ? <ActivityIndicator color={theme.colors.primary} /> : (
                    schoolActivities.length > 0 ? schoolActivities.map(act => (
                      <View key={act._id} style={styles.activityItem}>
                        <Text style={{ color: theme.colors.textPrimary, fontWeight: 'bold' }}>{act.name}</Text>
                        <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>Trainer: {act.trainerId?.name}</Text>
                        <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginBottom: 8 }}>Status: {act.status}</Text>
                        {act.status === 'Approved by School' && (
                          <TouchableOpacity style={[styles.submitBtn, { backgroundColor: theme.colors.success, marginTop: 4, padding: 8 }]} onPress={() => handleConfirmActivity(act._id)}>
                            <Text style={[styles.submitBtnText, { color: '#FFF' }]}>Confirm as Admin</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    )) : <Text style={{ color: theme.colors.textSecondary }}>No activities assigned yet.</Text>
                  )}
                </View>
              </View>
            )}
          </View>

          {/* Reports Tab */}
          <View style={{ display: activeTab === 'Reports' ? 'flex' : 'none' }}>
            <Text style={[styles.formTitle, { color: theme.colors.textPrimary }]}>Visit Reports</Text>
            {reports.length === 0 ? (
               <Text style={{ color: theme.colors.textSecondary, textAlign: 'center', marginTop: 12 }}>No reports found.</Text>
            ) : (
               reports.map(report => {
                 const isPending = report.status === 'pending';
                 const isApproved = report.status === 'approved';
                 return (
                   <View key={report._id} style={[styles.formCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, marginBottom: 12 }]}>
                     <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                       <Text style={{ color: theme.colors.textPrimary, fontSize: 16, fontWeight: '700', flex: 1, marginRight: 8 }}>
                         {report.schoolId?.name || 'Unknown School'}
                       </Text>
                       <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, backgroundColor: isApproved ? '#4CAF5020' : report.status === 'rejected' ? '#FF444420' : '#FFC10720' }}>
                         <Text style={{ fontSize: 10, fontWeight: 'bold', color: isApproved ? '#4CAF50' : report.status === 'rejected' ? '#FF4444' : '#FFC107' }}>
                           {isPending ? 'PENDING APPROVAL' : report.status.toUpperCase()}
                         </Text>
                       </View>
                     </View>
                     
                     <Text style={{ color: theme.colors.textSecondary, marginBottom: 4 }}>
                       Date: {report.dateOfInspection ? new Date(report.dateOfInspection).toLocaleDateString() : 'N/A'}
                     </Text>
                     <Text style={{ color: theme.colors.textSecondary, marginBottom: 4 }}>
                       Trainer: {report.trainerId?.name || 'N/A'}
                     </Text>
                     <Text style={{ color: theme.colors.textSecondary, marginBottom: 4 }}>
                       Team Leader: {report.teamLeaderId?.name || 'N/A'}
                     </Text>
                     
                     {!isPending && (
                       <View style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
                         <Text style={{ color: theme.colors.textSecondary, marginBottom: 8 }}>
                           Met: {report.personMet}
                         </Text>
                         <View style={{ padding: 12, backgroundColor: theme.colors.background, borderRadius: 8 }}>
                           <Text style={{ color: theme.colors.textPrimary }}>{report.discussionContext}</Text>
                         </View>
                       </View>
                     )}
                   </View>
                 );
               })
            )}
          </View>

          {/* Trainer Form */}
          <View style={{ display: activeTab === 'Trainer' ? 'flex' : 'none' }}>
            <MotiView from={{ opacity: 0, x: -20 }} animate={{ opacity: activeTab === 'Trainer' ? 1 : 0, x: activeTab === 'Trainer' ? 0 : -20 }}>
              <View style={[styles.formCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                <Text style={[styles.formTitle, { color: theme.colors.textPrimary }]}>Create Trainer</Text>
                <Formik
                  initialValues={{ name: '', email: '', password: '', schoolId: '', teamLeaderId: '' }}
                  validationSchema={TrainerSchema}
                  onSubmit={(v, { resetForm }) => submitForm('/admin/trainer', v, resetForm)}
                >
                  {({ handleChange, handleSubmit, values, errors, submitCount }) => (
                    <View>
                      <TextInput style={[styles.input, { borderColor: theme.colors.border, backgroundColor: theme.colors.background, color: theme.colors.textPrimary }]} placeholder="Name" placeholderTextColor={theme.colors.placeholder} onChangeText={handleChange('name')} value={values.name} />
                      {submitCount > 0 && errors.name && <Text style={[styles.errorText, { color: theme.colors.error || 'red' }]}>{errors.name}</Text>}
                      
                      <TextInput style={[styles.input, { borderColor: theme.colors.border, backgroundColor: theme.colors.background, color: theme.colors.textPrimary }]} placeholder="Email" placeholderTextColor={theme.colors.placeholder} onChangeText={handleChange('email')} value={values.email} autoCapitalize="none" keyboardType="email-address" />
                      {submitCount > 0 && errors.email && <Text style={[styles.errorText, { color: theme.colors.error || 'red' }]}>{errors.email}</Text>}
                      
                      <View style={[styles.passwordInputWrapper, { borderColor: theme.colors.border, backgroundColor: theme.colors.background }]}>
                        <TextInput style={[styles.passwordInput, { color: theme.colors.textPrimary }]} placeholder="Password" placeholderTextColor={theme.colors.placeholder} onChangeText={handleChange('password')} value={values.password} secureTextEntry={secureTextEntry} />
                        <TouchableOpacity onPress={() => setSecureTextEntry(!secureTextEntry)} style={styles.eyeIconContainer}>
                          <Ionicons name={secureTextEntry ? 'eye-off-outline' : 'eye-outline'} size={20} color={theme.colors.textSecondary} />
                        </TouchableOpacity>
                      </View>
                      {submitCount > 0 && errors.password && <Text style={[styles.errorText, { color: theme.colors.error || 'red' }]}>{errors.password}</Text>}
                      
                      <CustomDropdown
                        label="Assign School"
                        data={schools}
                        selectedValue={values.schoolId}
                        onSelect={(item) => handleChange('schoolId')(item._id)}
                        placeholder="Select a school"
                      />
                      {submitCount > 0 && errors.schoolId && <Text style={[styles.errorText, { color: theme.colors.error || 'red' }]}>{errors.schoolId}</Text>}

                      <CustomDropdown
                        label="Assign Team Leader"
                        data={teamLeaders}
                        selectedValue={values.teamLeaderId}
                        onSelect={(item) => handleChange('teamLeaderId')(item._id)}
                        placeholder="Select a team leader"
                      />
                      {submitCount > 0 && errors.teamLeaderId && <Text style={[styles.errorText, { color: theme.colors.error || 'red' }]}>{errors.teamLeaderId}</Text>}

                      <TouchableOpacity style={[styles.submitBtn, { backgroundColor: theme.colors.primary }]} onPress={handleSubmit}>
                        <Text style={[styles.submitBtnText, { color: '#FFF' }]}>Create Trainer</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </Formik>
              </View>
            </MotiView>
          </View>

          {/* Chairman Form */}
          <View style={{ display: activeTab === 'Chairman' ? 'flex' : 'none' }}>
            <MotiView from={{ opacity: 0, x: -20 }} animate={{ opacity: activeTab === 'Chairman' ? 1 : 0, x: activeTab === 'Chairman' ? 0 : -20 }}>
              <View style={[styles.formCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                <Text style={[styles.formTitle, { color: theme.colors.textPrimary }]}>Create Chairman & School</Text>
                <Formik
                  initialValues={{ chairmanName: '', email: '', password: '', schoolName: '', associationDate: '', classCoverage: '', state: '', mouPdfUrl: '' }}
                  validationSchema={ChairmanSchema}
                  onSubmit={(v, { resetForm }) => {
                    const associationYear = calculateAssociationYear(v.associationDate);
                    submitForm('/admin/chairman-school', { ...v, associationYear }, resetForm);
                  }}
                >
                  {({ handleChange, handleSubmit, values, errors, submitCount, setFieldValue }) => (
                    <View>
                      <Text style={[styles.sectionHeader, { color: theme.colors.primary }]}>Chairman Details</Text>
                      <TextInput style={[styles.input, { borderColor: theme.colors.border, backgroundColor: theme.colors.background, color: theme.colors.textPrimary }]} placeholder="Chairman Name" placeholderTextColor={theme.colors.placeholder} onChangeText={handleChange('chairmanName')} value={values.chairmanName} />
                      {submitCount > 0 && errors.chairmanName && <Text style={[styles.errorText, { color: theme.colors.error || 'red' }]}>{errors.chairmanName}</Text>}
                      
                      <TextInput style={[styles.input, { borderColor: theme.colors.border, backgroundColor: theme.colors.background, color: theme.colors.textPrimary }]} placeholder="Email" placeholderTextColor={theme.colors.placeholder} onChangeText={handleChange('email')} value={values.email} autoCapitalize="none" />
                      {submitCount > 0 && errors.email && <Text style={[styles.errorText, { color: theme.colors.error || 'red' }]}>{errors.email}</Text>}
                      
                      <View style={[styles.passwordInputWrapper, { borderColor: theme.colors.border, backgroundColor: theme.colors.background }]}>
                        <TextInput style={[styles.passwordInput, { color: theme.colors.textPrimary }]} placeholder="Password" placeholderTextColor={theme.colors.placeholder} onChangeText={handleChange('password')} value={values.password} secureTextEntry={secureTextEntry} />
                        <TouchableOpacity onPress={() => setSecureTextEntry(!secureTextEntry)} style={styles.eyeIconContainer}>
                          <Ionicons name={secureTextEntry ? 'eye-off-outline' : 'eye-outline'} size={20} color={theme.colors.textSecondary} />
                        </TouchableOpacity>
                      </View>
                      {submitCount > 0 && errors.password && <Text style={[styles.errorText, { color: theme.colors.error || 'red' }]}>{errors.password}</Text>}
                      
                      <Text style={[styles.sectionHeader, { color: theme.colors.primary, marginTop: 10 }]}>School Details</Text>
                      <TextInput style={[styles.input, { borderColor: theme.colors.border, backgroundColor: theme.colors.background, color: theme.colors.textPrimary }]} placeholder="School Name" placeholderTextColor={theme.colors.placeholder} onChangeText={handleChange('schoolName')} value={values.schoolName} />
                      {submitCount > 0 && errors.schoolName && <Text style={[styles.errorText, { color: theme.colors.error || 'red' }]}>{errors.schoolName}</Text>}
                      
                      <CustomDropdown
                        label="Select State"
                        data={INDIAN_STATES}
                        selectedValue={values.state}
                        onSelect={(item) => setFieldValue('state', item.name)}
                        placeholder="Select an Indian State"
                      />
                      {submitCount > 0 && errors.state && <Text style={[styles.errorText, { color: theme.colors.error || 'red' }]}>{errors.state}</Text>}
                      
                      <TouchableOpacity 
                        style={[styles.input, { borderColor: theme.colors.border, backgroundColor: theme.colors.background, justifyContent: 'center' }]}
                        onPress={() => setShowDatePicker(true)}
                      >
                        <Text style={{ color: values.associationDate ? theme.colors.textPrimary : theme.colors.placeholder }}>
                          {values.associationDate ? values.associationDate : "Select Association Date"}
                        </Text>
                      </TouchableOpacity>
                      
                      {showDatePicker && (
                        <DateTimePicker
                          value={values.associationDate ? new Date(values.associationDate) : new Date()}
                          mode="date"
                          display="default"
                          onChange={(event, selectedDate) => {
                            setShowDatePicker(Platform.OS === 'ios');
                            if (selectedDate) {
                              const dateStr = selectedDate.toISOString().split('T')[0];
                              handleChange('associationDate')(dateStr);
                            }
                          }}
                        />
                      )}
                      {submitCount > 0 && errors.associationDate && <Text style={[styles.errorText, { color: theme.colors.error || 'red' }]}>{errors.associationDate}</Text>}
                      
                      <TextInput style={[styles.input, { borderColor: theme.colors.border, backgroundColor: theme.colors.background, color: theme.colors.textPrimary }]} placeholder="Class Coverage (e.g. 8th to 10th)" placeholderTextColor={theme.colors.placeholder} onChangeText={handleChange('classCoverage')} value={values.classCoverage} />
                      {submitCount > 0 && errors.classCoverage && <Text style={[styles.errorText, { color: theme.colors.error || 'red' }]}>{errors.classCoverage}</Text>}

                      <TouchableOpacity style={[styles.input, { borderColor: theme.colors.border, backgroundColor: theme.colors.background, justifyContent: 'center', flexDirection: 'row', alignItems: 'center' }]} onPress={() => handlePickMOU(handleChange)} disabled={isUploadingMou}>
                        {isUploadingMou ? (
                          <>
                            <ActivityIndicator size="small" color={theme.colors.primary} style={{ marginRight: 8 }} />
                            <Text style={{ color: theme.colors.primary }}>Uploading MOU...</Text>
                          </>
                        ) : (
                          <Text style={{ color: values.mouPdfUrl ? theme.colors.primary : theme.colors.placeholder }}>
                            {values.mouPdfUrl ? "MOU Uploaded ✓" : "Upload MOU (PDF/Docx) - Optional"}
                          </Text>
                        )}
                      </TouchableOpacity>

                      <TouchableOpacity style={[styles.submitBtn, { backgroundColor: theme.colors.primary }]} onPress={handleSubmit}>
                        <Text style={[styles.submitBtnText, { color: '#FFF' }]}>Create Chairman & School</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </Formik>
              </View>
            </MotiView>
          </View>

          {/* Team Leader Form */}
          <View style={{ display: activeTab === 'TeamLeader' ? 'flex' : 'none' }}>
            <MotiView from={{ opacity: 0, x: -20 }} animate={{ opacity: activeTab === 'TeamLeader' ? 1 : 0, x: activeTab === 'TeamLeader' ? 0 : -20 }}>
              <View style={[styles.formCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                <Text style={[styles.formTitle, { color: theme.colors.textPrimary }]}>Create Team Leader</Text>
                <Formik
                  initialValues={{ name: '', email: '', password: '', schoolId: '' }}
                  validationSchema={TlSchema}
                  onSubmit={(v, { resetForm }) => submitForm('/admin/team-leader', v, resetForm)}
                >
                  {({ handleChange, handleSubmit, values, errors, submitCount }) => (
                    <View>
                      <TextInput style={[styles.input, { borderColor: theme.colors.border, backgroundColor: theme.colors.background, color: theme.colors.textPrimary }]} placeholder="Name" placeholderTextColor={theme.colors.placeholder} onChangeText={handleChange('name')} value={values.name} />
                      {submitCount > 0 && errors.name && <Text style={[styles.errorText, { color: theme.colors.error || 'red' }]}>{errors.name}</Text>}
                      
                      <TextInput style={[styles.input, { borderColor: theme.colors.border, backgroundColor: theme.colors.background, color: theme.colors.textPrimary }]} placeholder="Email" placeholderTextColor={theme.colors.placeholder} onChangeText={handleChange('email')} value={values.email} autoCapitalize="none" />
                      {submitCount > 0 && errors.email && <Text style={[styles.errorText, { color: theme.colors.error || 'red' }]}>{errors.email}</Text>}
                      
                      <View style={[styles.passwordInputWrapper, { borderColor: theme.colors.border, backgroundColor: theme.colors.background }]}>
                        <TextInput style={[styles.passwordInput, { color: theme.colors.textPrimary }]} placeholder="Password" placeholderTextColor={theme.colors.placeholder} onChangeText={handleChange('password')} value={values.password} secureTextEntry={secureTextEntry} />
                        <TouchableOpacity onPress={() => setSecureTextEntry(!secureTextEntry)} style={styles.eyeIconContainer}>
                          <Ionicons name={secureTextEntry ? 'eye-off-outline' : 'eye-outline'} size={20} color={theme.colors.textSecondary} />
                        </TouchableOpacity>
                      </View>
                      {submitCount > 0 && errors.password && <Text style={[styles.errorText, { color: theme.colors.error || 'red' }]}>{errors.password}</Text>}

                      <CustomDropdown
                        label="Assign School"
                        data={schools}
                        selectedValue={values.schoolId}
                        onSelect={(item) => handleChange('schoolId')(item._id)}
                        placeholder="Select a school"
                      />
                      {submitCount > 0 && errors.schoolId && <Text style={[styles.errorText, { color: theme.colors.error || 'red' }]}>{errors.schoolId}</Text>}

                      <TouchableOpacity style={[styles.submitBtn, { backgroundColor: theme.colors.primary }]} onPress={handleSubmit}>
                        <Text style={[styles.submitBtnText, { color: '#FFF' }]}>Create Team Leader</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </Formik>
              </View>
            </MotiView>
          </View>

          {/* Banners TAB */}
          <View style={{ display: activeTab === 'Banners' ? 'flex' : 'none' }}>
            <MotiView style={[styles.formCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
              <Text style={[styles.formTitle, { color: theme.colors.textPrimary }]}>Manage Banners</Text>
              
              <View style={{ marginBottom: 16 }}>
                <Text style={[styles.label, { color: theme.colors.textSecondary }]}>Step 1: Pick Banner Image (16:9)</Text>
                {bannerImageAsset ? (
                  <View style={{ marginBottom: 16 }}>
                    <Image source={{ uri: bannerImageAsset.uri }} style={{ width: '100%', height: 180, borderRadius: 12, resizeMode: 'cover', borderWidth: 1, borderColor: theme.colors.border }} />
                    <TouchableOpacity style={{ position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 15 }} onPress={() => setBannerImageAsset(null)}>
                      <Ionicons name="close-circle" size={24} color="#FF4444" />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity style={[styles.uploadBtn, { borderColor: theme.colors.primary, borderWidth: 1 }]} onPress={pickAndCropBanner}>
                    <Ionicons name="image-outline" size={20} color={theme.colors.primary} />
                    <Text style={[styles.uploadBtnText, { color: theme.colors.primary, marginLeft: 8 }]}>Upload Banner Image</Text>
                  </TouchableOpacity>
                )}
              </View>

              {bannerImageAsset && (
                <View>
                  <Text style={[styles.label, { color: theme.colors.textSecondary }]}>Step 2: Add Description (Optional)</Text>
                  <TextInput
                    style={[styles.input, { borderColor: theme.colors.border, color: theme.colors.textPrimary, height: 80, textAlignVertical: 'top' }]}
                    placeholder="Enter banner description"
                    placeholderTextColor={theme.colors.placeholder}
                    value={bannerDesc}
                    onChangeText={setBannerDesc}
                    multiline
                  />
                  
                  <TouchableOpacity 
                    style={[styles.submitBtn, { backgroundColor: theme.colors.primary, opacity: isUploadingBanner ? 0.7 : 1 }]} 
                    onPress={submitBanner}
                    disabled={isUploadingBanner}
                  >
                    {isUploadingBanner ? <ActivityIndicator color="#FFF" /> : <Text style={styles.submitBtnText}>Submit Banner</Text>}
                  </TouchableOpacity>
                </View>
              )}

              <View style={{ marginTop: 24, borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: 16 }}>
                <Text style={[styles.formTitle, { color: theme.colors.textPrimary, fontSize: 16 }]}>Existing Banners</Text>
                {banners.length === 0 ? (
                  <Text style={{ color: theme.colors.textSecondary, marginTop: 12 }}>No banners found.</Text>
                ) : (
                  banners.slice((bannerPage - 1) * bannersPerPage, bannerPage * bannersPerPage).map((b) => (
                    <View key={b._id} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8, overflow: 'hidden' }}>
                      <Image source={{ uri: b.imageUrl }} style={{ width: 80, height: 45, resizeMode: 'cover' }} />
                      <View style={{ flex: 1, paddingHorizontal: 12 }}>
                        <Text style={{ color: theme.colors.textPrimary, fontSize: 12 }} numberOfLines={2}>{b.description || 'No description'}</Text>
                      </View>
                      <TouchableOpacity style={{ padding: 12 }} onPress={() => deleteBanner(b._id)}>
                        <Ionicons name="trash-outline" size={20} color="#FF4444" />
                      </TouchableOpacity>
                    </View>
                  ))
                )}

                {banners.length > bannersPerPage && (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
                    <TouchableOpacity 
                      style={[styles.pageBtn, { borderColor: theme.colors.border, opacity: bannerPage === 1 ? 0.5 : 1 }]} 
                      disabled={bannerPage === 1}
                      onPress={() => setBannerPage(p => p - 1)}
                    >
                      <Ionicons name="chevron-back" size={20} color={theme.colors.textPrimary} />
                    </TouchableOpacity>
                    <Text style={{ color: theme.colors.textSecondary }}>Page {bannerPage} of {Math.ceil(banners.length / bannersPerPage)}</Text>
                    <TouchableOpacity 
                      style={[styles.pageBtn, { borderColor: theme.colors.border, opacity: bannerPage === Math.ceil(banners.length / bannersPerPage) ? 0.5 : 1 }]} 
                      disabled={bannerPage === Math.ceil(banners.length / bannersPerPage)}
                      onPress={() => setBannerPage(p => p + 1)}
                    >
                      <Ionicons name="chevron-forward" size={20} color={theme.colors.textPrimary} />
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            </MotiView>
          </View>

          {/* MANAGE EVENTS TAB */}
          <View style={{ display: activeTab === 'ManageEvents' ? 'flex' : 'none', marginTop: 16 }}>
            {allEvents.length === 0 ? (
               <View style={{ alignItems: 'center', marginTop: 40 }}>
                 <Ionicons name="calendar-outline" size={48} color={theme.colors.border} />
                 <Text style={{ color: theme.colors.textSecondary, marginTop: 12 }}>No events published yet.</Text>
               </View>
            ) : (
               allEvents.map(evt => (
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
                       <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }} numberOfLines={1}>School: {evt.schoolId?.name || 'N/A'}</Text>
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

        </ScrollView>
      )}

      <EditEventModal 
        visible={!!eventToEdit}
        event={eventToEdit}
        onClose={() => setEventToEdit(null)}
        onSuccess={() => {
          setEventToEdit(null);
          showAlert('Success', 'Event updated successfully.', 'success');
          fetchDropdownData();
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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1
  },
  headerTitleContainer: { flexDirection: 'row', alignItems: 'center' },
  headerTitle: { fontSize: 20, fontWeight: 'bold', marginLeft: 8 },
  logoutBtn: { padding: 8, borderRadius: 8 },
  tabsContainer: { paddingTop: 10, paddingBottom: 10 },
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
  scrollContent: { padding: 20, paddingBottom: 60 },
  formCard: { padding: 20, borderRadius: 16, borderWidth: 1 },
  formTitle: { fontSize: 18, fontWeight: '700', marginBottom: 20 },
  sectionHeader: { fontSize: 14, fontWeight: '600', marginBottom: 12, textTransform: 'uppercase' },
  label: { fontSize: 12, marginBottom: 8, marginTop: 12, fontWeight: '600' },
  input: { padding: 14, borderRadius: 8, borderWidth: 1, marginBottom: 12 },
  submitBtn: { padding: 16, borderRadius: 8, alignItems: 'center', marginTop: 24 },
  submitBtnText: { fontWeight: '800', textTransform: 'uppercase', color: '#FFF' },
  errorText: { fontSize: 12, marginBottom: 8, marginTop: -8, marginLeft: 4 },
  stateBtn: { flexDirection: 'row', justifyContent: 'space-between', padding: 16, borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: '#ccc' },
  schoolItem: { padding: 16, borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: '#ccc' },
  activityItem: { padding: 12, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.05)', marginBottom: 8 },
  passwordInputWrapper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 8, paddingRight: 14, marginBottom: 12 },
  passwordInput: { flex: 1, padding: 14 },
  eyeIconContainer: { padding: 4 },
  uploadBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 14, borderRadius: 12, marginTop: 12 },
  uploadBtnText: { fontWeight: '600' },
  pageBtn: { padding: 8, borderWidth: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  eventCard: { padding: 16, borderRadius: 16, borderWidth: 1, marginBottom: 16 },
  eventTitle: { fontSize: 16, fontWeight: 'bold', marginBottom: 6 },
  eventDate: { fontSize: 13, marginBottom: 4 },
  eventActions: { flexDirection: 'row', gap: 12 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
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
  }
});
