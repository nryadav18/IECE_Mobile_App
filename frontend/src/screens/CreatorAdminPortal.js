import React, { useState, useEffect, useContext, useCallback, useRef } from 'react';
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
import EditActivityModal from '../components/EditActivityModal';
import EditReportModal from '../components/EditReportModal';
import VisitReportDetail from '../components/VisitReportDetail';
import VisitReportForm from '../components/VisitReportForm';
import IndiaMap from '../components/IndiaMap';
import SidebarMenu from '../components/SidebarMenu';
import NotificationBell from '../components/NotificationBell';
import SchoolHolidayApprovals from '../components/SchoolHolidayApprovals';
import TeamMultiSelectModal from '../components/TeamMultiSelectModal';
import MultiSelectField from '../components/MultiSelectField';
import { SectionSkeleton } from '../components/Skeleton';
import { useSectionTransition } from '../hooks/useSectionTransition';
import { HEAD_ROLES, roleLabel } from '../utils/roles';

// Head roles as dropdown options ({ _id, name }) for CustomDropdown.
const HEAD_ROLE_OPTIONS = HEAD_ROLES.map(r => ({ _id: r, name: roleLabel(r) }));
// Leader roles for the Team Leader / Trainee Team Leader toggle.
const LEADER_ROLE_OPTIONS = [
  { _id: 'team_leader', name: 'Team Leader' },
  { _id: 'trainee_team_leader', name: 'Trainee Team Leader' },
];

const TlSchema = Yup.object().shape({
  name: Yup.string().required('Required'),
  email: Yup.string().email('Invalid email').required('Required'),
  password: Yup.string().min(6, 'Min 6 chars').required('Required'),
  schoolIds: Yup.array().of(Yup.string()).min(1, 'Assign at least one school'),
  teamId: Yup.string().required('Required'),
});

const HeadSchema = Yup.object().shape({
  name: Yup.string().required('Required'),
  email: Yup.string().email('Invalid email').required('Required'),
  password: Yup.string().min(6, 'Min 6 chars').required('Required'),
  role: Yup.string().oneOf(HEAD_ROLES, 'Select a head role').required('Required'),
  schoolIds: Yup.array().of(Yup.string()).min(1, 'Assign at least one school'),
  teamIds: Yup.array().of(Yup.string()).min(1, 'Assign at least one team'),
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
  schoolIds: Yup.array().of(Yup.string()).min(1, 'Assign at least one school'),
  teamLeaderId: Yup.string().required('Required'),
  teamId: Yup.string().required('Required'),
});

const TAB_ITEMS = [
  { key: 'Monitoring', label: 'Monitoring', icon: 'pulse-outline' },
  { key: 'Profiles', label: 'Profiles', icon: 'people-outline' },
  { key: 'Trainer', label: 'Create Trainer', icon: 'person-add-outline' },
  { key: 'Chairman', label: 'Create Chairman', icon: 'business-outline' },
  { key: 'TeamLeader', label: 'Create Team Leader', icon: 'person-add-outline' },
  { key: 'Head', label: 'Create Head', icon: 'ribbon-outline' },
  { key: 'Teams', label: 'Teams', icon: 'people-circle-outline' },
  { key: 'Reports', label: 'Reports', icon: 'document-text-outline' },
  { key: 'LogVisit', label: 'Log Visit', icon: 'clipboard-outline' },
  { key: 'Holidays', label: 'School Holidays', icon: 'sunny-outline' },
  { key: 'Banners', label: 'Banners', icon: 'images-outline' },
  { key: 'ManageEvents', label: 'Activities', icon: 'calendar-outline' },
];

// Which skeleton shape each section shows while it loads — mirrors the real
// content so the loader "predicts" the layout that's about to appear.
const SECTION_SKELETON = {
  Monitoring: 'monitoring',
  Profiles: 'list',
  Trainer: 'form',
  Chairman: 'form',
  TeamLeader: 'form',
  Head: 'form',
  Teams: 'form',
  Reports: 'list',
  LogVisit: 'form',
  Holidays: 'list',
  Banners: 'form',
  ManageEvents: 'list',
};

// The CEO is a read-only super-viewer: no create/manage, no holidays. They keep
// Monitoring, Profiles, Reports and can log their own visit reports.
const CEO_TABS = ['Monitoring', 'Profiles', 'Reports', 'LogVisit'];

export default function CreatorAdminPortal({ navigation, route }) {
  const { user, logout } = useContext(AuthContext);
  const { theme } = useContext(ThemeContext);
  const insets = useSafeAreaInsets();

  const isCEO = user?.role === 'ceo';
  const visibleTabs = isCEO ? TAB_ITEMS.filter(t => CEO_TABS.includes(t.key)) : TAB_ITEMS;

  const [activeTab, setActiveTab] = useState(route?.params?.initialTab || 'Monitoring');
  const { tabLoading, selectTab } = useSectionTransition(activeTab, setActiveTab);

  // Honor an `initialTab` passed via navigation (e.g. from a tapped report
  // notification) even if the portal is already mounted.
  useEffect(() => {
    if (route?.params?.initialTab) {
      setActiveTab(route.params.initialTab);
    }
  }, [route?.params?.initialTab]);

  // Sidebar (hamburger) drawer
  const sidebarRef = useRef(null);
  const [profilesSearchQuery, setProfilesSearchQuery] = useState('');
  const [schools, setSchools] = useState([]);
  const [teamLeaders, setTeamLeaders] = useState([]);
  const [trainers, setTrainers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [heads, setHeads] = useState([]);
  const [newTeamName, setNewTeamName] = useState('');
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [teamModalVisible, setTeamModalVisible] = useState(false);
  const [reportToView, setReportToView] = useState(null);
  const [reportFormVisible, setReportFormVisible] = useState(false);
  // Everyone a visit report can be logged on (all field staff).
  const reportTargets = [...teamLeaders, ...trainers, ...heads];
  const myId = user?._id || user?.id;
  const [allActivities, setAllActivities] = useState([]);
  const [reports, setReports] = useState([]);
  const myReports = reports.filter(r => (r.teamLeaderId?._id || r.teamLeaderId) === myId);
  const [loadingData, setLoadingData] = useState(true);
  const [activityToEdit, setActivityToEdit] = useState(null);
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

  // Re-fetch whenever the admin returns to / focuses the portal so newly
  // submitted Team Leader reports (and other data) show up without needing a
  // manual pull-to-refresh. useFocusEffect also runs on the initial mount.
  useFocusEffect(
    useCallback(() => {
      fetchDropdownData();
    }, [])
  );

  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = React.useCallback(() => {
    setRefreshing(true);
    fetchDropdownData().finally(() => setRefreshing(false));
  }, []);

  const fetchDropdownData = async () => {
    try {
      // Use allSettled so a single failing endpoint can't blank unrelated data
      // (e.g. the Visit Reports list staying empty just because /media failed).
      const [schoolsRes, tlsRes, trainersRes, activitiesRes, bannerRes, reportsRes, teamsRes, headsRes] = await Promise.allSettled([
        api.get('/admin/schools'),
        api.get('/admin/team-leaders'),
        api.get('/admin/users?role=trainer&limit=100'),
        api.get('/activities'),
        api.get('/media'),
        api.get('/reports'),
        api.get('/admin/teams'),
        api.get('/admin/users?role=zonal_head,cluster_head,regional_head&limit=100')
      ]);
      if (schoolsRes.status === 'fulfilled') setSchools(schoolsRes.value.data.data);
      if (tlsRes.status === 'fulfilled') setTeamLeaders(tlsRes.value.data.data);
      if (trainersRes.status === 'fulfilled') setTrainers(trainersRes.value.data.data);
      if (activitiesRes.status === 'fulfilled') setAllActivities(activitiesRes.value.data.data);
      if (bannerRes.status === 'fulfilled') setBanners(bannerRes.value.data.data);
      if (reportsRes.status === 'fulfilled') setReports(reportsRes.value.data.data);
      if (teamsRes.status === 'fulfilled') setTeams(teamsRes.value.data.data);
      if (headsRes.status === 'fulfilled') setHeads(headsRes.value.data.data);
      [schoolsRes, tlsRes, trainersRes, activitiesRes, bannerRes, reportsRes, teamsRes, headsRes].forEach((r, i) => {
        if (r.status === 'rejected') console.log('Admin fetchDropdownData call failed', i, r.reason?.message);
      });
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

  const handleCreateTeam = async () => {
    const name = newTeamName.trim();
    if (!name) {
      showAlert('Error', 'Team name is required', 'error');
      return;
    }
    setCreatingTeam(true);
    try {
      await api.post('/admin/team', { name });
      setNewTeamName('');
      showAlert('Success', 'Team created', 'success');
      fetchDropdownData();
    } catch (err) {
      showAlert('Error', err.response?.data?.error || 'Failed to create team', 'error');
    } finally {
      setCreatingTeam(false);
    }
  };

  const handleDeleteTeam = (team) => {
    showAlert(
      'Delete Team',
      `Delete "${team.name}"? Its members will be unassigned and it will be removed from every head.`,
      'warning',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/admin/team/${team._id}`);
              showAlert('Deleted', 'Team removed', 'success');
              fetchDropdownData();
            } catch (err) {
              showAlert('Error', err.response?.data?.error || 'Failed to delete team', 'error');
            }
          },
        },
      ]
    );
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
    if (!bannerDesc.trim()) {
      showAlert('Error', 'Banner description is required', 'error');
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

  const handleUpdateActivityStatus = async (id, status) => {
    try {
      await api.put(`/activities/${id}/status`, { status });
      showAlert('Success', `Activity ${status} successfully.`, 'success');
      fetchDropdownData();
    } catch (err) {
      showAlert('Error', err.response?.data?.error || 'Failed to update activity status.', 'error');
    }
  };

  const deleteActivity = (id) => {
    showAlert('Confirm', 'Are you sure you want to permanently delete this activity?', 'warning', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            await api.delete(`/activities/${id}`);
            showAlert('Success', 'Activity deleted permanently.', 'success');
            fetchDropdownData();
          } catch (err) {
            showAlert('Error', 'Failed to delete activity.', 'error');
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

  const states = [...new Set(schools.map(s => s.state).filter(Boolean))].sort((a, b) => a.localeCompare(b));
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

  // Chairman approval is now final, so no admin confirmation is needed.

  // During logout the user is cleared before the navigator swaps stacks; bail
  // out of this render so we don't read properties off a null user.
  if (!user) return null;

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
      <View style={[styles.container, { backgroundColor: theme.colors.background, paddingTop: insets.top }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: theme.colors.border }]}>
        <View style={styles.headerTitleContainer}>
          <TouchableOpacity
            onPress={() => sidebarRef.current?.open()}
            activeOpacity={0.7}
            style={[styles.menuBtn, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
            accessibilityLabel="Open menu"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="menu" size={24} color={theme.colors.textPrimary} />
          </TouchableOpacity>
          <View style={{ marginLeft: 12 }}>
            <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>
              {TAB_ITEMS.find(t => t.key === activeTab)?.label || 'IECE Management'}
            </Text>
            <Text style={[styles.headerSubtitle, { color: theme.colors.textSecondary }]}>IECE Management</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <NotificationBell navigation={navigation} />
          <Ionicons name="shield-checkmark" size={24} color={theme.colors.primary} />
        </View>
      </View>

      {loadingData || tabLoading ? (
        <SectionSkeleton kind={SECTION_SKELETON[activeTab] || 'list'} />
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
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
          
          {/* Monitoring Tab */}
          <View style={[{ display: activeTab === 'Monitoring' ? 'flex' : 'none' }, activeTab === 'Monitoring' && { flex: 1 }]}>
            {!selectedState && !selectedSchool && (
              <View style={{ flex: 1 }}>
                <Text style={[styles.formTitle, { color: theme.colors.textPrimary }]}>Select State</Text>
                <Text style={{ color: theme.colors.textSecondary, marginBottom: 12 }}>
                  Tap a state to view its schools.
                </Text>
                <IndiaMap 
                  activeStates={states} 
                  onStateSelect={(state) => setSelectedState(state)} 
                />
              </View>
            )}

            {selectedState && !selectedSchool && (
              <View>
                <TouchableOpacity onPress={() => setSelectedState(null)} style={{ flexDirection: 'row', marginBottom: 16 }}>
                  <Ionicons name="arrow-back" size={20} color={theme.colors.primary} />
                  <Text style={{ color: theme.colors.primary, marginLeft: 8 }}>Back to States</Text>
                </TouchableOpacity>
                <Text style={[styles.formTitle, { color: theme.colors.textPrimary }]}>Schools in {selectedState}</Text>
                <View style={{ gap: 12 }}>
                  {schoolsInState.map(school => (
                    <TouchableOpacity 
                      key={school._id} 
                      style={[styles.schoolCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: 1, padding: 16, borderRadius: 16, flexDirection: 'row', alignItems: 'center' }]} 
                      onPress={() => viewSchoolDetails(school)}
                      activeOpacity={0.8}
                    >
                      <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: theme.colors.primary + '15', justifyContent: 'center', alignItems: 'center', marginRight: 16 }}>
                        <Ionicons name="business" size={24} color={theme.colors.primary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.colors.textPrimary, fontSize: 16, fontWeight: 'bold', marginBottom: 4 }}>{school.name}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Ionicons name="people-outline" size={14} color={theme.colors.textSecondary} style={{ marginRight: 4 }} />
                            <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>{school.totalStrength || 0} Students</Text>
                          </View>
                          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Ionicons name="star-outline" size={14} color={theme.colors.textSecondary} style={{ marginRight: 4 }} />
                            <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>Since {school.associationYear || 'N/A'}</Text>
                          </View>
                        </View>
                      </View>
                      <Ionicons name="chevron-forward" size={20} color={theme.colors.border} />
                    </TouchableOpacity>
                  ))}
                </View>
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
                  
                  {/* Activities summary for this school — counts only, no fixed target */}
                  {(() => {
                    const approvedCount = schoolActivities.filter(a => a.status === 'approved').length;
                    const totalCount = schoolActivities.length;
                    return (
                      <View style={[styles.progressCard, { backgroundColor: theme.colors.background, borderColor: theme.colors.border, borderWidth: 1, padding: 16, borderRadius: 12, marginBottom: 20 }]}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                          <Ionicons name="ribbon-outline" size={20} color={theme.colors.primary} style={{ marginRight: 8 }} />
                          <Text style={{ fontSize: 15, fontWeight: '700', color: theme.colors.textPrimary }}>School Activities</Text>
                        </View>
                        <View style={styles.quotaRow}>
                          <View style={styles.quotaBlock}>
                            <Text style={[styles.quotaNumber, { color: theme.colors.primary }]}>{approvedCount}</Text>
                            <Text style={[styles.quotaLabel, { color: theme.colors.textSecondary }]}>Approved</Text>
                          </View>
                          <View style={[styles.quotaDivider, { backgroundColor: theme.colors.border }]} />
                          <View style={styles.quotaBlock}>
                            <Text style={[styles.quotaNumber, { color: theme.colors.textPrimary }]}>{totalCount}</Text>
                            <Text style={[styles.quotaLabel, { color: theme.colors.textSecondary }]}>Total</Text>
                          </View>
                        </View>
                      </View>
                    );
                  })()}

                  <Text style={[styles.sectionHeader, { color: theme.colors.primary }]}>Activities</Text>
                  {activitiesLoading ? <ActivityIndicator color={theme.colors.primary} /> : (
                    schoolActivities.length > 0 ? schoolActivities.map(act => (
                      <View key={act._id} style={styles.activityItem}>
                        <Text style={{ color: theme.colors.textPrimary, fontWeight: 'bold' }}>{act.name}</Text>
                        <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>Trainer: {act.uploaderId?.name || 'N/A'}</Text>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                          <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>Date: {act.activityDate ? new Date(act.activityDate).toLocaleDateString() : 'N/A'}</Text>
                          <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, backgroundColor: act.status === 'approved' ? '#4CAF5020' : act.status === 'rejected' ? '#FF444420' : '#FFC10720' }}>
                            <Text style={{ fontSize: 10, fontWeight: 'bold', color: act.status === 'approved' ? '#4CAF50' : act.status === 'rejected' ? '#FF4444' : '#FFC107' }}>
                              {act.status.toUpperCase()}
                            </Text>
                          </View>
                        </View>
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
                       Reported by: {report.teamLeaderId?.name || 'N/A'}
                     </Text>

                     <TouchableOpacity
                       style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}
                       onPress={() => setReportToView(report)}
                     >
                       <Ionicons name="reader-outline" size={16} color={theme.colors.primary} style={{ marginRight: 4 }} />
                       <Text style={{ color: theme.colors.primary, fontWeight: '600' }}>View Full Report</Text>
                     </TouchableOpacity>

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

          {/* Log Visit Tab — admin & CEO can log a physical visit report on any staff */}
          <View style={{ display: activeTab === 'LogVisit' ? 'flex' : 'none' }}>
            <View style={[styles.formCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, marginBottom: 16 }]}>
              <Text style={[styles.formTitle, { color: theme.colors.textPrimary }]}>Log Visit Report</Text>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 13, lineHeight: 20, marginBottom: 14 }}>
                Visit a school and complete the full IECE EGM Visit report on any team leader, trainee team leader,
                trainer or head. Every field is mandatory.
              </Text>
              {reportTargets.length === 0 ? (
                <Text style={{ color: theme.colors.textSecondary, fontStyle: 'italic' }}>No staff available yet.</Text>
              ) : (
                <TouchableOpacity
                  style={[styles.submitBtn, { backgroundColor: theme.colors.primary, marginTop: 0 }]}
                  onPress={() => setReportFormVisible(true)}
                >
                  <Text style={[styles.submitBtnText, { color: '#FFF' }]}>Start Visit Report</Text>
                </TouchableOpacity>
              )}
            </View>

            <Text style={[styles.formTitle, { color: theme.colors.textPrimary, marginBottom: 12 }]}>My Reports</Text>
            {myReports.length === 0 ? (
              <Text style={{ color: theme.colors.textSecondary, marginBottom: 20 }}>You haven't logged any visit reports yet.</Text>
            ) : (
              myReports.map(report => (
                <TouchableOpacity
                  key={report._id}
                  style={[styles.formCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, padding: 16, marginBottom: 12, flexDirection: 'row', alignItems: 'center' }]}
                  onPress={() => setReportToView(report)}
                  activeOpacity={0.85}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.colors.textPrimary, fontWeight: '700' }}>{report.trainerId?.name || 'Member'}</Text>
                    <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 }}>{report.schoolId?.name || ''}</Text>
                    <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 }}>
                      {report.dateOfInspection ? new Date(report.dateOfInspection).toLocaleDateString() : ''}
                    </Text>
                  </View>
                  <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: (report.status === 'approved' ? '#4CAF50' : report.status === 'rejected' ? '#F44336' : '#F59E0B') + '20', marginRight: 8 }}>
                    <Text style={{ fontSize: 11, fontWeight: '700', textTransform: 'capitalize', color: report.status === 'approved' ? '#4CAF50' : report.status === 'rejected' ? '#F44336' : '#F59E0B' }}>{report.status}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={theme.colors.textSecondary} />
                </TouchableOpacity>
              ))
            )}
          </View>

          {/* Profiles Tab */}
          <View style={{ display: activeTab === 'Profiles' ? 'flex' : 'none' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, paddingHorizontal: 12, height: 48, marginBottom: 16 }}>
              <Ionicons name="search" size={18} color={theme.colors.textSecondary} style={{ marginRight: 8 }} />
              <TextInput
                style={{ flex: 1, color: theme.colors.textPrimary, fontSize: 14 }}
                placeholder="Search profiles by name or email..."
                placeholderTextColor={theme.colors.placeholder}
                value={profilesSearchQuery}
                onChangeText={setProfilesSearchQuery}
                autoCapitalize="none"
              />
              {profilesSearchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setProfilesSearchQuery('')}>
                  <Ionicons name="close-circle" size={18} color={theme.colors.textSecondary} />
                </TouchableOpacity>
              )}
            </View>

            <Text style={[styles.formTitle, { color: theme.colors.textPrimary, marginBottom: 12 }]}>Heads</Text>
            {heads.filter(h => h.name?.toLowerCase().includes(profilesSearchQuery.toLowerCase()) || h.email?.toLowerCase().includes(profilesSearchQuery.toLowerCase())).length === 0 ? <Text style={{ color: theme.colors.textSecondary, marginBottom: 20 }}>No Heads found.</Text> : (
               heads.filter(h => h.name?.toLowerCase().includes(profilesSearchQuery.toLowerCase()) || h.email?.toLowerCase().includes(profilesSearchQuery.toLowerCase())).map(h => (
                 <View key={h._id} style={[styles.formCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, padding: 16, marginBottom: 12 }]}>
                   <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                     <View style={{ flex: 1 }}>
                       <Text style={{ color: theme.colors.textPrimary, fontSize: 16, fontWeight: 'bold' }}>{h.name}</Text>
                       <Text style={{ color: theme.colors.textSecondary, marginTop: 4 }}>{h.email}</Text>
                       <Text style={{ color: theme.colors.primary, marginTop: 4, fontSize: 12, fontWeight: '600' }}>{roleLabel(h.role)} · {(h.teamIds?.length || 0)} team(s)</Text>
                     </View>
                     <TouchableOpacity
                       style={{ backgroundColor: theme.colors.primary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 }}
                       onPress={() => navigation.navigate('UserProfile', { userId: h._id })}
                     >
                       <Text style={{ color: '#fff', fontWeight: 'bold' }}>View Profile</Text>
                     </TouchableOpacity>
                   </View>
                 </View>
               ))
            )}

            <Text style={[styles.formTitle, { color: theme.colors.textPrimary, marginBottom: 12, marginTop: 12 }]}>Team Leaders</Text>
            {teamLeaders.filter(tl => tl.name?.toLowerCase().includes(profilesSearchQuery.toLowerCase()) || tl.email?.toLowerCase().includes(profilesSearchQuery.toLowerCase())).length === 0 ? <Text style={{ color: theme.colors.textSecondary, marginBottom: 20 }}>No Team Leaders found.</Text> : (
               teamLeaders.filter(tl => tl.name?.toLowerCase().includes(profilesSearchQuery.toLowerCase()) || tl.email?.toLowerCase().includes(profilesSearchQuery.toLowerCase())).map(tl => (
                 <View key={tl._id} style={[styles.formCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, padding: 16, marginBottom: 12 }]}>
                   <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                     <View style={{ flex: 1 }}>
                       <Text style={{ color: theme.colors.textPrimary, fontSize: 16, fontWeight: 'bold' }}>{tl.name}</Text>
                       <Text style={{ color: theme.colors.textSecondary, marginTop: 4 }}>{tl.email}</Text>
                       <Text style={{ color: theme.colors.textSecondary, marginTop: 4, fontSize: 12 }}>{roleLabel(tl.role)}{tl.teamId?.name ? ` · ${tl.teamId.name}` : ''}</Text>
                     </View>
                     <TouchableOpacity
                       style={{ backgroundColor: theme.colors.primary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 }}
                       onPress={() => navigation.navigate('UserProfile', { userId: tl._id })}
                     >
                       <Text style={{ color: '#fff', fontWeight: 'bold' }}>View Profile</Text>
                     </TouchableOpacity>
                   </View>
                 </View>
               ))
            )}

            <Text style={[styles.formTitle, { color: theme.colors.textPrimary, marginBottom: 12, marginTop: 12 }]}>Trainers</Text>
            {trainers.filter(t => t.name?.toLowerCase().includes(profilesSearchQuery.toLowerCase()) || t.email?.toLowerCase().includes(profilesSearchQuery.toLowerCase())).length === 0 ? <Text style={{ color: theme.colors.textSecondary, marginBottom: 20 }}>No Trainers found.</Text> : (
               trainers.filter(t => t.name?.toLowerCase().includes(profilesSearchQuery.toLowerCase()) || t.email?.toLowerCase().includes(profilesSearchQuery.toLowerCase())).map(trainer => (
                 <View key={trainer._id} style={[styles.formCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, padding: 16, marginBottom: 12 }]}>
                   <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                     <View style={{ flex: 1 }}>
                       <Text style={{ color: theme.colors.textPrimary, fontSize: 16, fontWeight: 'bold' }}>{trainer.name}</Text>
                       <Text style={{ color: theme.colors.textSecondary, marginTop: 4 }}>{trainer.email}</Text>
                       <Text style={{ color: theme.colors.textSecondary, marginTop: 4 }}>School: {trainer.schoolIds?.length ? trainer.schoolIds.map(s => s.name).join(', ') : (trainer.schoolId?.name || 'N/A')}</Text>
                     </View>
                     <TouchableOpacity 
                       style={{ backgroundColor: theme.colors.primary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 }}
                       onPress={() => navigation.navigate('UserProfile', { userId: trainer._id })}
                     >
                       <Text style={{ color: '#fff', fontWeight: 'bold' }}>View Profile</Text>
                     </TouchableOpacity>
                   </View>
                 </View>
               ))
            )}
          </View>

          {/* Trainer Form */}
          <View style={{ display: activeTab === 'Trainer' ? 'flex' : 'none' }}>
            <MotiView from={{ opacity: 0, x: -20 }} animate={{ opacity: activeTab === 'Trainer' ? 1 : 0, x: activeTab === 'Trainer' ? 0 : -20 }}>
              <View style={[styles.formCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                <Text style={[styles.formTitle, { color: theme.colors.textPrimary }]}>Create Trainer</Text>
                <Formik
                  initialValues={{ name: '', email: '', password: '', schoolIds: [], teamLeaderId: '', teamId: '' }}
                  validationSchema={TrainerSchema}
                  onSubmit={(v, { resetForm }) => submitForm('/admin/trainer', v, resetForm)}
                >
                  {({ handleChange, handleSubmit, values, errors, submitCount, setFieldValue }) => (
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

                      <MultiSelectField
                        label="Assign School(s)"
                        data={schools}
                        selectedIds={values.schoolIds}
                        onChange={(ids) => setFieldValue('schoolIds', ids)}
                        placeholder="Select one or more schools"
                      />
                      {submitCount > 0 && errors.schoolIds && <Text style={[styles.errorText, { color: theme.colors.error || 'red' }]}>{errors.schoolIds}</Text>}

                      <CustomDropdown
                        label="Assign Team Leader"
                        data={teamLeaders}
                        selectedValue={values.teamLeaderId}
                        onSelect={(item) => handleChange('teamLeaderId')(item._id)}
                        placeholder="Select a team leader"
                      />
                      {submitCount > 0 && errors.teamLeaderId && <Text style={[styles.errorText, { color: theme.colors.error || 'red' }]}>{errors.teamLeaderId}</Text>}

                      <CustomDropdown
                        label="Assign Team"
                        data={teams}
                        selectedValue={values.teamId}
                        onSelect={(item) => handleChange('teamId')(item._id)}
                        placeholder="Select a team"
                      />
                      {submitCount > 0 && errors.teamId && <Text style={[styles.errorText, { color: theme.colors.error || 'red' }]}>{errors.teamId}</Text>}

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

          {/* Team Leader / Trainee Team Leader Form */}
          <View style={{ display: activeTab === 'TeamLeader' ? 'flex' : 'none' }}>
            <MotiView from={{ opacity: 0, x: -20 }} animate={{ opacity: activeTab === 'TeamLeader' ? 1 : 0, x: activeTab === 'TeamLeader' ? 0 : -20 }}>
              <View style={[styles.formCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                <Text style={[styles.formTitle, { color: theme.colors.textPrimary }]}>Create Team Leader</Text>
                <Formik
                  initialValues={{ name: '', email: '', password: '', schoolIds: [], teamId: '', role: 'team_leader' }}
                  validationSchema={TlSchema}
                  onSubmit={(v, { resetForm }) => submitForm('/admin/team-leader', v, resetForm)}
                >
                  {({ handleChange, handleSubmit, values, errors, submitCount, setFieldValue }) => (
                    <View>
                      {/* Role toggle: Team Leader has full parity with Trainee Team Leader. */}
                      <Text style={[styles.label, { color: theme.colors.textSecondary }]}>Role</Text>
                      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
                        {LEADER_ROLE_OPTIONS.map(opt => {
                          const selected = values.role === opt._id;
                          return (
                            <TouchableOpacity
                              key={opt._id}
                              onPress={() => setFieldValue('role', opt._id)}
                              style={{
                                flex: 1,
                                paddingVertical: 12,
                                borderRadius: 10,
                                borderWidth: 1,
                                alignItems: 'center',
                                backgroundColor: selected ? theme.colors.primary : theme.colors.background,
                                borderColor: selected ? theme.colors.primary : theme.colors.border,
                              }}
                            >
                              <Text style={{ color: selected ? '#FFF' : theme.colors.textPrimary, fontWeight: '600', fontSize: 13 }}>{opt.name}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>

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

                      <MultiSelectField
                        label="Assign School(s)"
                        data={schools}
                        selectedIds={values.schoolIds}
                        onChange={(ids) => setFieldValue('schoolIds', ids)}
                        placeholder="Select one or more schools"
                      />
                      {submitCount > 0 && errors.schoolIds && <Text style={[styles.errorText, { color: theme.colors.error || 'red' }]}>{errors.schoolIds}</Text>}

                      <CustomDropdown
                        label="Assign Team"
                        data={teams}
                        selectedValue={values.teamId}
                        onSelect={(item) => handleChange('teamId')(item._id)}
                        placeholder="Select a team"
                      />
                      {submitCount > 0 && errors.teamId && <Text style={[styles.errorText, { color: theme.colors.error || 'red' }]}>{errors.teamId}</Text>}

                      <TouchableOpacity style={[styles.submitBtn, { backgroundColor: theme.colors.primary }]} onPress={handleSubmit}>
                        <Text style={[styles.submitBtnText, { color: '#FFF' }]}>
                          Create {values.role === 'trainee_team_leader' ? 'Trainee Team Leader' : 'Team Leader'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </Formik>
              </View>
            </MotiView>
          </View>

          {/* Head Form (Zonal / Cluster / Regional) */}
          <View style={{ display: activeTab === 'Head' ? 'flex' : 'none' }}>
            <MotiView from={{ opacity: 0, x: -20 }} animate={{ opacity: activeTab === 'Head' ? 1 : 0, x: activeTab === 'Head' ? 0 : -20 }}>
              <View style={[styles.formCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                <Text style={[styles.formTitle, { color: theme.colors.textPrimary }]}>Create Head</Text>
                <Formik
                  initialValues={{ name: '', email: '', password: '', role: '', schoolIds: [], teamIds: [] }}
                  validationSchema={HeadSchema}
                  onSubmit={(v, { resetForm }) => submitForm('/admin/head', v, resetForm)}
                >
                  {({ handleChange, handleSubmit, values, errors, submitCount, setFieldValue }) => (
                    <View>
                      <CustomDropdown
                        label="Head Role"
                        data={HEAD_ROLE_OPTIONS}
                        selectedValue={values.role}
                        onSelect={(item) => setFieldValue('role', item._id)}
                        placeholder="Select head role"
                      />
                      {submitCount > 0 && errors.role && <Text style={[styles.errorText, { color: theme.colors.error || 'red' }]}>{errors.role}</Text>}

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

                      <MultiSelectField
                        label="Assign School(s)"
                        data={schools}
                        selectedIds={values.schoolIds}
                        onChange={(ids) => setFieldValue('schoolIds', ids)}
                        placeholder="Select one or more schools"
                      />
                      {submitCount > 0 && errors.schoolIds && <Text style={[styles.errorText, { color: theme.colors.error || 'red' }]}>{errors.schoolIds}</Text>}

                      {/* Assign Team (multi-select) */}
                      <Text style={[styles.label, { color: theme.colors.textSecondary }]}>Assign Team(s)</Text>
                      <TouchableOpacity
                        style={[styles.input, { borderColor: theme.colors.border, backgroundColor: theme.colors.background, justifyContent: 'center' }]}
                        onPress={() => setTeamModalVisible(true)}
                      >
                        <Text style={{ color: values.teamIds.length ? theme.colors.textPrimary : theme.colors.placeholder }}>
                          {values.teamIds.length
                            ? teams.filter(t => values.teamIds.includes(t._id)).map(t => t.name).join(', ')
                            : 'Select one or more teams'}
                        </Text>
                      </TouchableOpacity>
                      {submitCount > 0 && errors.teamIds && <Text style={[styles.errorText, { color: theme.colors.error || 'red' }]}>{errors.teamIds}</Text>}

                      <TeamMultiSelectModal
                        visible={teamModalVisible}
                        teams={teams}
                        selectedIds={values.teamIds}
                        onClose={() => setTeamModalVisible(false)}
                        onSelect={(ids) => setFieldValue('teamIds', ids)}
                      />

                      <TouchableOpacity style={[styles.submitBtn, { backgroundColor: theme.colors.primary }]} onPress={handleSubmit}>
                        <Text style={[styles.submitBtnText, { color: '#FFF' }]}>
                          Create {values.role ? roleLabel(values.role) : 'Head'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </Formik>
              </View>
            </MotiView>
          </View>

          {/* Teams TAB — create + manage teams */}
          <View style={{ display: activeTab === 'Teams' ? 'flex' : 'none' }}>
            <View style={[styles.formCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
              <Text style={[styles.formTitle, { color: theme.colors.textPrimary }]}>Create Team</Text>
              <TextInput
                style={[styles.input, { borderColor: theme.colors.border, backgroundColor: theme.colors.background, color: theme.colors.textPrimary }]}
                placeholder="Team Name"
                placeholderTextColor={theme.colors.placeholder}
                value={newTeamName}
                onChangeText={setNewTeamName}
              />
              <TouchableOpacity
                style={[styles.submitBtn, { backgroundColor: theme.colors.primary, opacity: creatingTeam ? 0.7 : 1 }]}
                onPress={handleCreateTeam}
                disabled={creatingTeam}
              >
                {creatingTeam
                  ? <ActivityIndicator color="#FFF" />
                  : <Text style={[styles.submitBtnText, { color: '#FFF' }]}>Create Team</Text>}
              </TouchableOpacity>
            </View>

            <Text style={[styles.formTitle, { color: theme.colors.textPrimary, marginTop: 8, marginBottom: 12 }]}>All Teams</Text>
            {teams.length === 0 ? (
              <Text style={{ color: theme.colors.textSecondary, marginBottom: 20 }}>No teams yet. Create one above.</Text>
            ) : (
              teams.map(team => (
                <View key={team._id} style={[styles.formCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, padding: 16, marginBottom: 12 }]}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.colors.textPrimary, fontSize: 16, fontWeight: 'bold' }}>{team.name}</Text>
                      <Text style={{ color: theme.colors.textSecondary, marginTop: 4 }}>
                        {typeof team.memberCount === 'number' ? `${team.memberCount} member${team.memberCount === 1 ? '' : 's'}` : ''}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={{ backgroundColor: (theme.colors.error || '#e53935') + '20', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 }}
                      onPress={() => handleDeleteTeam(team)}
                    >
                      <Ionicons name="trash-outline" size={18} color={theme.colors.error || '#e53935'} />
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </View>

          {/* School Holidays TAB */}
          <View style={{ display: activeTab === 'Holidays' ? 'flex' : 'none' }}>
            <SchoolHolidayApprovals refreshKey={activeTab === 'Holidays' ? 1 : 0} />
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
                  <Text style={[styles.label, { color: theme.colors.textSecondary }]}>Step 2: Add Description (Required)</Text>
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

          {/* MANAGE ACTIVITIES TAB */}
          <View style={{ display: activeTab === 'ManageEvents' ? 'flex' : 'none', marginTop: 16 }}>
            {allActivities.length === 0 ? (
               <View style={{ alignItems: 'center', marginTop: 40 }}>
                 <Ionicons name="calendar-outline" size={48} color={theme.colors.border} />
                 <Text style={{ color: theme.colors.textSecondary, marginTop: 12 }}>No activities published yet.</Text>
               </View>
            ) : (
               allActivities.map(evt => (
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
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                          <Text style={[styles.eventTitle, { color: theme.colors.textPrimary, flex: 1, marginBottom: 0 }]} numberOfLines={2}>{evt.name}</Text>
                          <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, backgroundColor: evt.status === 'approved' ? theme.colors.success + '20' : evt.status === 'rejected' ? theme.colors.error + '20' : theme.colors.primary + '20' }}>
                            <Text style={{ fontSize: 10, fontWeight: '700', textTransform: 'uppercase', color: evt.status === 'approved' ? theme.colors.success : evt.status === 'rejected' ? theme.colors.error : theme.colors.primary }}>{evt.status || 'pending'}</Text>
                          </View>
                        </View>
                        <Text style={[styles.eventDate, { color: theme.colors.textSecondary }]}>{new Date(evt.activityDate || evt.eventDate).toLocaleDateString()}</Text>
                        <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }} numberOfLines={1}>School: {evt.schoolId?.name || 'N/A'}</Text>
                      </View>
                    </View>
                    
                    <View style={[styles.eventActions, { flexWrap: 'wrap' }]}>
                      {(!evt.status || evt.status === 'pending') && (
                        <>
                          <TouchableOpacity style={[styles.actionBtn, { borderColor: theme.colors.success, backgroundColor: theme.colors.success + '10', flex: 1 }]} onPress={() => handleUpdateActivityStatus(evt._id, 'approved')}>
                            <Ionicons name="checkmark-outline" size={18} color={theme.colors.success} />
                            <Text style={{ color: theme.colors.success, fontSize: 13, marginLeft: 6, fontWeight: '600' }}>Approve</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={[styles.actionBtn, { borderColor: theme.colors.error, backgroundColor: theme.colors.error + '10', flex: 1 }]} onPress={() => handleUpdateActivityStatus(evt._id, 'rejected')}>
                            <Ionicons name="close-outline" size={18} color={theme.colors.error} />
                            <Text style={{ color: theme.colors.error, fontSize: 13, marginLeft: 6, fontWeight: '600' }}>Reject</Text>
                          </TouchableOpacity>
                        </>
                      )}
                      <TouchableOpacity style={[styles.actionBtn, { borderColor: theme.colors.primary, backgroundColor: theme.colors.primary + '10', flex: 1 }]} onPress={() => setActivityToEdit(evt)}>
                        <Ionicons name="create-outline" size={18} color={theme.colors.primary} />
                        <Text style={{ color: theme.colors.primary, fontSize: 13, marginLeft: 6, fontWeight: '600' }}>Edit</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.actionBtn, { borderColor: '#FF4444', backgroundColor: '#FF444410', flex: 1 }]} onPress={() => deleteActivity(evt._id)}>
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

      {/* Sidebar Drawer */}
      <SidebarMenu
        ref={sidebarRef}
        title={isCEO ? 'IECE CEO' : 'IECE Admin'}
        subtitle={isCEO ? 'Executive Portal' : 'Management Portal'}
        tabs={visibleTabs}
        activeTab={activeTab}
        onSelectTab={selectTab}
        actions={[
          { label: 'Substitution Requests', icon: 'swap-horizontal-outline', onPress: () => navigation.navigate('Substitution') },
          { label: 'Notifications', icon: 'notifications-outline', onPress: () => navigation.navigate('Notifications') },
          // Face approvals + staff management + create-admin are admin-only. CEO is read-only.
          ...(isCEO ? [] : [
            { label: 'Face Approvals', icon: 'scan-outline', onPress: () => navigation.navigate('PendingRegistrations') },
            { label: 'IECE Staff', icon: 'people-outline', onPress: () => navigation.navigate('ManageScreen') },
            { label: 'Create Admin', icon: 'shield-checkmark-outline', onPress: () => navigation.navigate('CreateAdmin') },
          ]),
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

      <VisitReportDetail
        visible={!!reportToView}
        report={reportToView}
        onClose={() => setReportToView(null)}
      />

      <VisitReportForm
        visible={reportFormVisible}
        targets={reportTargets}
        author={user}
        onClose={() => setReportFormVisible(false)}
        onSubmitted={(message) => { showAlert('Success', message, 'success'); fetchDropdownData(); }}
        onError={(message) => showAlert('Error', message, 'error')}
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
    paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16, borderBottomWidth: 1
  },
  headerTitleContainer: { flexDirection: 'row', alignItems: 'center' },
  headerTitle: { fontSize: 20, fontWeight: 'bold' },
  headerSubtitle: { fontSize: 12, marginTop: 1 },
  menuBtn: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  logoutBtn: { padding: 8, borderRadius: 8 },
  scroll: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 60, flexGrow: 1 },
  formCard: { padding: 20, borderRadius: 16, borderWidth: 1 },
  formTitle: { fontSize: 18, fontWeight: '700', marginBottom: 20 },
  sectionHeader: { fontSize: 14, fontWeight: '600', marginBottom: 12, textTransform: 'uppercase' },
  label: { fontSize: 12, marginBottom: 8, marginTop: 12, fontWeight: '600' },
  input: { padding: 14, borderRadius: 8, borderWidth: 1, marginBottom: 12 },
  submitBtn: { padding: 16, borderRadius: 8, alignItems: 'center', marginTop: 24 },
  submitBtnText: { fontWeight: '800', textTransform: 'uppercase', color: '#FFF' },
  errorText: { fontSize: 12, marginBottom: 8, marginTop: -8, marginLeft: 4 },
  stateBtn: { flexDirection: 'row', justifyContent: 'space-between', padding: 16, borderRadius: 12, marginBottom: 12, borderWidth: 1 },
  schoolItem: { padding: 16, borderRadius: 12, marginBottom: 12, borderWidth: 1 },
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
  actionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 5, paddingHorizontal: 10, borderRadius: 10, backgroundColor: 'white' },
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
});
