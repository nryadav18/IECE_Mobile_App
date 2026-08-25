import React, { useState, useEffect, useContext, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, ActivityIndicator, RefreshControl, KeyboardAvoidingView, Platform, Image, Modal
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
import ApprovedBy from '../components/ApprovedBy';
import ActivityCover from '../components/ActivityCover';
import Paginator from '../components/Paginator';
import { getActivitiesPage } from '../services/activities';
import CustomAlert from '../components/CustomAlert';
import CustomDropdown from '../components/CustomDropdown';
import EditReportModal from '../components/EditReportModal';
import VisitReportDetail from '../components/VisitReportDetail';
import VisitReportForm from '../components/VisitReportForm';
import MonitoringDashboard from '../components/monitoring/MonitoringDashboard';
import SidebarMenu from '../components/SidebarMenu';
import NotificationBell from '../components/NotificationBell';
import CountBadge from '../components/CountBadge';
import { useBadges } from '../context/BadgeContext';
import SchoolHolidayApprovals from '../components/SchoolHolidayApprovals';
import CelebrationsSection from './Admin/CelebrationsSection';
import TeamMultiSelectModal from '../components/TeamMultiSelectModal';
import DirectoryMultiSelectModal from '../components/DirectoryMultiSelectModal';
import MultiSelectField from '../components/MultiSelectField';
import { SectionSkeleton } from '../components/Skeleton';
import LazyTab from '../components/LazyTab';
import MonthlyReportSection from '../components/MonthlyReportSection';
import { useSectionTransition } from '../hooks/useSectionTransition';
import { HEAD_ROLES, roleLabel } from '../utils/roles';
import ResponsiveGrid from '../components/ResponsiveGrid';
import useResponsiveLayout from '../hooks/useResponsiveLayout';

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
  // An anonymous-location head belongs to no school on purpose, so the school
  // requirement lifts entirely when that is switched on.
  anonymousLocation: Yup.boolean(),
  schoolIds: Yup.array().of(Yup.string()).when('anonymousLocation', {
    is: true,
    then: (s) => s.max(0),
    otherwise: (s) => s.min(1, 'Assign at least one school'),
  }),
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
  { key: 'MonthlyReport', label: 'Monthly Report', icon: 'stats-chart-outline' },
  { key: 'LogVisit', label: 'Log Visit', icon: 'clipboard-outline' },
  { key: 'Holidays', label: 'School Holidays', icon: 'sunny-outline' },
  { key: 'Celebrations', label: 'Celebrations', icon: 'sparkles-outline' },
  { key: 'Banners', label: 'Banners', icon: 'images-outline' },
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
  MonthlyReport: 'form',
  LogVisit: 'form',
  Holidays: 'list',
  Celebrations: 'list',
  Banners: 'form',
};

// The CEO is a read-only super-viewer: no create/manage, no holidays. They keep
// Monitoring, Profiles, Reports and can log their own visit reports — plus
// Celebrations, which is a preview: the section hides its edit controls for
// anyone who isn't creator_admin.
const CEO_TABS = ['Monitoring', 'Profiles', 'Reports', 'LogVisit', 'Celebrations'];

/**
 * One person in the Profiles list.
 *
 * Pulled out of the screen and memoised because the Profiles tab renders a card
 * for every head, leader and trainer in the organisation — well over fifty
 * rows. Written inline, each keystroke in the search box rebuilt all of them.
 * With this, only the rows whose props actually changed re-render, so filtering
 * repaints the few cards that came or went instead of the whole list.
 *
 * `theme` is safe as a prop because ThemeContext now hands out a stable object
 * that only changes on a real light/dark switch, and `onOpen` is a stable
 * useCallback — so the memo comparison genuinely holds.
 */
const ProfileRow = React.memo(function ProfileRow({
  id, name, email, meta, metaColor, metaSize, metaWeight, theme, onOpen,
}) {
  return (
    <View style={[styles.formCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, padding: 16, marginBottom: 12 }]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.colors.textPrimary, fontSize: 16, fontWeight: 'bold' }}>{name}</Text>
          <Text style={{ color: theme.colors.textSecondary, marginTop: 4 }}>{email}</Text>
          <Text
            style={{
              color: metaColor || theme.colors.textSecondary,
              marginTop: 4,
              ...(metaSize ? { fontSize: metaSize } : null),
              ...(metaWeight ? { fontWeight: metaWeight } : null),
            }}
          >
            {meta}
          </Text>
        </View>
        <TouchableOpacity
          style={{ backgroundColor: theme.colors.primary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 }}
          onPress={() => onOpen(id)}
        >
          <Text style={{ color: '#fff', fontWeight: 'bold' }}>View Profile</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});

export default function CreatorAdminPortal({ navigation, route }) {
  const { user, logout } = useContext(AuthContext);
  const { theme } = useContext(ThemeContext);
  const { unread, sections, total } = useBadges();
  const insets = useSafeAreaInsets();
  // Phone values are the screen's existing ones (20px inset, single column), so
  // this only changes anything once there is a wide window to lay out into.
  const { contentInset, columns } = useResponsiveLayout();

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
  // Teams tab drill-in: tap a team to see its people (members + heads).
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [teamDetail, setTeamDetail] = useState(null);
  const [teamDetailLoading, setTeamDetailLoading] = useState(false);
  const [teamMemberSearch, setTeamMemberSearch] = useState('');
  const [reportToView, setReportToView] = useState(null);
  const [reportFormVisible, setReportFormVisible] = useState(false);
  // Everyone a visit report can be logged on (all field staff).
  const reportTargets = [...teamLeaders, ...trainers, ...heads];
  const myId = user?._id || user?.id;
  const [reports, setReports] = useState([]);
  const myReports = reports.filter(r => (r.teamLeaderId?._id || r.teamLeaderId) === myId);
  const [loadingData, setLoadingData] = useState(true);
  const [alertConfig, setAlertConfig] = useState({ visible: false, title: '', message: '', type: 'info' });
  const [secureTextEntry, setSecureTextEntry] = useState(true);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [bannerDesc, setBannerDesc] = useState('');
  const [isUploadingBanner, setIsUploadingBanner] = useState(false);
  const [isUploadingMou, setIsUploadingMou] = useState(false);
  
  // Banner flow state
  const [bannerImageAsset, setBannerImageAsset] = useState(null);
  // "Invisible to": the people this banner will NOT be shown to. Held as whole
  // user objects so the chips can be drawn without another lookup; only the ids
  // are sent to the server.
  const [bannerHiddenFor, setBannerHiddenFor] = useState([]);
  const [audiencePickerFor, setAudiencePickerFor] = useState(null); // 'new' | banner id
  const [editingBanner, setEditingBanner] = useState(null);         // banner being edited
  const [editBannerDesc, setEditBannerDesc] = useState('');
  const [editBannerHiddenFor, setEditBannerHiddenFor] = useState([]);
  const [savingBannerEdit, setSavingBannerEdit] = useState(false);

  // Monitoring state — the school drill-in opened from the live dashboard.
  const [selectedSchool, setSelectedSchool] = useState(null);
  const [schoolActivities, setSchoolActivities] = useState([]);
  const [schoolActivityPage, setSchoolActivityPage] = useState(1);
  const [schoolActivityPages, setSchoolActivityPages] = useState(1);
  const [schoolActivityTotal, setSchoolActivityTotal] = useState(0);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  // The drill-in panel is a compact list, so it holds more per page than a
  // card grid without becoming a wall.
  const ADMIN_ACTIVITY_PAGE = 10;
  
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

  // ---- Profiles tab search -------------------------------------------------
  // The three lists were filtered inline in the JSX, and each list was filtered
  // TWICE — once to test for emptiness and again to map the rows — with
  // `profilesSearchQuery.toLowerCase()` re-evaluated for every person on every
  // pass. That is six full scans of the whole organisation, plus a rebuild of
  // every card, for each character typed. Memoised here so a keystroke costs
  // one pass and the untouched rows are left alone (see ProfileRow).
  const filteredProfiles = useMemo(() => {
    const q = profilesSearchQuery.trim().toLowerCase();
    const match = (p) =>
      !q || p.name?.toLowerCase().includes(q) || p.email?.toLowerCase().includes(q);
    return {
      heads: heads.filter(match),
      teamLeaders: teamLeaders.filter(match),
      trainers: trainers.filter(match),
    };
  }, [profilesSearchQuery, heads, teamLeaders, trainers]);

  // Stable across renders so the memoised rows are not invalidated by a new
  // arrow function on every pass.
  const openProfile = useCallback(
    (userId) => navigation.navigate('UserProfile', { userId }),
    [navigation]
  );

  const [refreshing, setRefreshing] = useState(false);
  // Bumped on every pull-to-refresh so the live Monitoring dashboard — which
  // owns its own data — can resync alongside the portal's own lists.
  const [refreshTick, setRefreshTick] = useState(0);

  const onRefresh = React.useCallback(() => {
    setRefreshing(true);
    setRefreshTick(t => t + 1);
    // Keep an open team drill-in in sync with the pull-to-refresh too.
    const openDetail = selectedTeam ? openTeam(selectedTeam, { silent: true }) : Promise.resolve();
    Promise.all([fetchDropdownData(), openDetail]).finally(() => setRefreshing(false));
  }, [selectedTeam]);

  const fetchDropdownData = async () => {
    try {
      // Use allSettled so a single failing endpoint can't blank unrelated data
      // (e.g. the Visit Reports list staying empty just because /media failed).
      // `/activities` used to be fetched here and its result was never read —
      // not stored, not counted, not rendered. It pulled EVERY activity in the
      // organisation, photo URLs and all, on every load of this screen, and
      // threw the lot away. Removed rather than paginated: the cheapest request
      // is the one that is not made.
      const [schoolsRes, tlsRes, trainersRes, bannerRes, reportsRes, teamsRes, headsRes] = await Promise.allSettled([
        api.get('/admin/schools'),
        api.get('/admin/team-leaders'),
        api.get('/admin/users?role=trainer&limit=100'),
        // scope=manage: the admin manages every banner, including any they were
        // themselves made invisible to — the filtered list is for Home only.
        api.get('/media?scope=manage'),
        api.get('/reports'),
        api.get('/admin/teams'),
        api.get('/admin/users?role=zonal_head,cluster_head,regional_head&limit=100')
      ]);
      if (schoolsRes.status === 'fulfilled') setSchools(schoolsRes.value.data.data);
      if (tlsRes.status === 'fulfilled') setTeamLeaders(tlsRes.value.data.data);
      if (trainersRes.status === 'fulfilled') setTrainers(trainersRes.value.data.data);
      if (bannerRes.status === 'fulfilled') setBanners(bannerRes.value.data.data);
      if (reportsRes.status === 'fulfilled') setReports(reportsRes.value.data.data);
      if (teamsRes.status === 'fulfilled') setTeams(teamsRes.value.data.data);
      if (headsRes.status === 'fulfilled') setHeads(headsRes.value.data.data);
      [schoolsRes, tlsRes, trainersRes, bannerRes, reportsRes, teamsRes, headsRes].forEach((r, i) => {
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
              // Drop out of the drill-in if the team being viewed is the one gone.
              if (selectedTeam?._id === team._id) closeTeam();
              fetchDropdownData();
            } catch (err) {
              showAlert('Error', err.response?.data?.error || 'Failed to delete team', 'error');
            }
          },
        },
      ]
    );
  };

  // Open a team's detail view — its leaders, trainers, overseeing heads and
  // the schools the team covers. `silent` re-fetches in place (pull-to-refresh)
  // instead of blanking the view behind a spinner.
  const openTeam = async (team, { silent = false } = {}) => {
    setSelectedTeam(team);
    if (!silent) {
      setTeamDetail(null);
      setTeamMemberSearch('');
      setTeamDetailLoading(true);
    }
    try {
      const res = await api.get(`/admin/team/${team._id}`);
      setTeamDetail(res.data.data);
    } catch (err) {
      if (!silent) {
        setTeamDetail(null);
        showAlert('Error', err.response?.data?.error || 'Could not load team details', 'error');
      }
    } finally {
      if (!silent) setTeamDetailLoading(false);
    }
  };

  const closeTeam = () => {
    setSelectedTeam(null);
    setTeamDetail(null);
    setTeamMemberSearch('');
  };

  // Leaving the Teams tab drops the drill-in, so coming back always lands on
  // the team list rather than a stale team. Monitoring behaves the same way:
  // returning to it should show the live dashboard, not a school opened an hour
  // ago from a drill-down.
  useEffect(() => {
    if (activeTab !== 'Teams' && selectedTeam) closeTeam();
    if (activeTab !== 'Monitoring' && selectedSchool) setSelectedSchool(null);
  }, [activeTab]);

  const uploadFile = async (fileUri, mimeType, name) => {
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
    const url = await uploadFile(bannerImageAsset.uri, bannerImageAsset.mimeType || 'image/jpeg', bannerImageAsset.fileName || 'banner.jpg');
    if (url) {
      try {
        await api.post('/media', {
          imageUrl: url,
          description: bannerDesc,
          hiddenFor: bannerHiddenFor.map(u => u._id),
        });
        showAlert('Success', 'Banner published successfully!', 'success');
        setBannerDesc('');
        setBannerImageAsset(null);
        setBannerHiddenFor([]);
        fetchDropdownData();
      } catch (err) {
        showAlert('Error', 'Failed to save media record', 'error');
      }
    }
    setIsUploadingBanner(false);
  };

  const openBannerEditor = (banner) => {
    setEditingBanner(banner);
    setEditBannerDesc(banner.description || '');
    setEditBannerHiddenFor(banner.hiddenFor || []);
  };

  const saveBannerEdit = async () => {
    if (!editingBanner) return;
    if (!editBannerDesc.trim()) {
      showAlert('Error', 'Banner description is required', 'error');
      return;
    }
    setSavingBannerEdit(true);
    try {
      await api.put(`/media/${editingBanner._id}`, {
        description: editBannerDesc.trim(),
        hiddenFor: editBannerHiddenFor.map(u => u._id),
      });
      setEditingBanner(null);
      showAlert('Success', 'Banner updated successfully!', 'success');
      fetchDropdownData();
    } catch (err) {
      showAlert('Error', err.response?.data?.error || 'Failed to update banner', 'error');
    } finally {
      setSavingBannerEdit(false);
    }
  };

  const deleteBanner = (id) => {
    showAlert('Confirm Deletion', 'Are you sure you want to delete this banner?', 'warning', [
      { text: 'Cancel', type: 'secondary' },
      { text: 'Delete', type: 'primary', onPress: async () => {
          try {
            const res = await api.delete(`/media/${id}`);
            // Deleting a banner now removes its image from cloud storage too, and
            // the server refuses to drop the row if that failed — so report
            // what it actually says instead of a blanket success.
            showAlert('Success', res.data?.message || 'Banner deleted successfully!', 'success');
            fetchDropdownData();
          } catch (err) {
            showAlert('Error', err.response?.data?.error || 'Failed to delete banner', 'error');
            fetchDropdownData();
          }
      }}
    ]);
  };

  const handlePickMOU = async (handleChange) => {
    let result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'] });
    if (!result.canceled) {
      setIsUploadingMou(true);
      const asset = result.assets[0];
      const url = await uploadFile(asset.uri, asset.mimeType || 'application/pdf', asset.name);
      if (url) {
        handleChange('mouPdfUrl')(url);
        showAlert('Success', 'MOU uploaded and attached!', 'success');
      } else {
        showAlert('Error', 'Failed to upload MOU to server.', 'error');
      }
      setIsUploadingMou(false);
    }
  };

  // Opened from a school row in the live dashboard's drill-down. `school` may be
  // a dashboard row (which carries `id`) or a full school document (`_id`), so
  // both shapes are accepted and the real record is looked up for the detail.
  const viewSchoolDetails = async (school) => {
    const full = schools.find(s => String(s._id) === String(school._id || school.id)) || school;
    setSelectedSchool(full);
    loadSchoolActivities(full, 1);
  };

  /**
   * One page of a school's activities.
   *
   * Paged for the same reason as everywhere else: each row draws a cover image,
   * so a school with a long history used to pull a photo for every activity it
   * had ever run just to fill the panel.
   */
  const loadSchoolActivities = async (school, page) => {
    const schoolId = school?._id || school?.id;
    if (!schoolId) return;
    setActivitiesLoading(true);
    try {
      const res = await getActivitiesPage({ schoolId, page, limit: ADMIN_ACTIVITY_PAGE });
      setSchoolActivities(res.items);
      // The server clamps the page against the real total, so take its answer.
      setSchoolActivityPage(res.page);
      setSchoolActivityPages(res.pages);
      setSchoolActivityTotal(res.total);
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
      {/* Same inset as the content below, so the title and the actions line up
          with the cards instead of hugging the two edges of the monitor. The bar
          and its bottom border still span the full width. */}
      <View style={[styles.header, { borderBottomColor: theme.colors.border, paddingHorizontal: contentInset }]}>
        <View style={styles.headerTitleContainer}>
          <TouchableOpacity
            onPress={() => sidebarRef.current?.open()}
            activeOpacity={0.7}
            style={[styles.menuBtn, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
            accessibilityLabel="Open menu"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="menu" size={24} color={theme.colors.textPrimary} />
            <CountBadge count={total} overlay borderColor={theme.colors.surface} />
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
          // One shared scroller feeds every admin tab, so setting the centred
          // inset here centres the whole console in a single place.
          contentContainerStyle={[styles.scrollContent, { paddingHorizontal: contentInset }]}
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
          
          {/* Monitoring Tab — the live organisation dashboard.
              The India map that used to live here is gone: a static map of
              states told the Admin nothing about the day. Schools are still
              reachable, but now through the dashboard's live coverage list,
              which knows who is actually at each of them right now.
              Mounted only while the tab is open so the realtime socket is never
              held by a screen nobody is looking at. */}
          <View style={[{ display: activeTab === 'Monitoring' ? 'flex' : 'none' }, activeTab === 'Monitoring' && { flex: 1 }]}>
            {activeTab === 'Monitoring' && !selectedSchool && (
              <MonitoringDashboard
                navigation={navigation}
                onOpenSchool={viewSchoolDetails}
                refreshSignal={refreshTick}
              />
            )}

            {selectedSchool && (
              <View>
                <TouchableOpacity onPress={() => setSelectedSchool(null)} style={{ flexDirection: 'row', marginBottom: 16 }}>
                  <Ionicons name="arrow-back" size={20} color={theme.colors.primary} />
                  <Text style={{ color: theme.colors.primary, marginLeft: 8 }}>Back to Monitoring</Text>
                </TouchableOpacity>
                <View style={[styles.formCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                  <Text style={[styles.formTitle, { color: theme.colors.textPrimary }]}>{selectedSchool.name}</Text>
                  <Text style={{ color: theme.colors.textSecondary }}>Association Year: {selectedSchool.associationYear}</Text>
                  <Text style={{ color: theme.colors.textSecondary, marginBottom: 16 }}>Class Coverage: {selectedSchool.classCoverage}</Text>
                  
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
                    schoolActivities.length > 0 ? (<>
                    {schoolActivities.map(act => (
                      <View key={act._id} style={styles.activityItem}>
                        <View style={{ flexDirection: 'row', marginBottom: 6 }}>
                          <ActivityCover activity={act} size={48} radius={10} style={{ marginRight: 10 }} />
                          <View style={{ flex: 1, justifyContent: 'center' }}>
                            <Text style={{ color: theme.colors.textPrimary, fontWeight: 'bold' }}>{act.name}</Text>
                            <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>Trainer: {act.uploaderId?.name || 'N/A'}</Text>
                          </View>
                        </View>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                          <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>Date: {act.activityDate ? new Date(act.activityDate).toLocaleDateString() : 'N/A'}</Text>
                          <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, backgroundColor: act.status === 'approved' ? '#4CAF5020' : act.status === 'rejected' ? '#FF444420' : '#FFC10720' }}>
                            <Text style={{ fontSize: 10, fontWeight: 'bold', color: act.status === 'approved' ? '#4CAF50' : act.status === 'rejected' ? '#FF4444' : '#FFC107' }}>
                              {act.status.toUpperCase()}
                            </Text>
                          </View>
                        </View>
                        {/* Activities are decided by team leaders, heads OR either
                            admin — this line is the only way to tell which. */}
                        <ApprovedBy record={act} compact style={{ marginTop: 8 }} />
                      </View>
                    ))}
                    <Paginator
                      page={schoolActivityPage}
                      pages={schoolActivityPages}
                      total={schoolActivityTotal}
                      label="activities"
                      onChange={(p) => loadSchoolActivities(selectedSchool, p)}
                    />
                    </>) : <Text style={{ color: theme.colors.textSecondary }}>No activities assigned yet.</Text>
                  )}
                </View>
              </View>
            )}
          </View>

          {/* Reports Tab */}
          <LazyTab active={activeTab === 'Reports'}>
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

                     {/* Which chairman signed this report off. The push used to
                         say only "approved by the chairman", which is useless
                         once a school changes hands. */}
                     <ApprovedBy record={report} compact style={{ marginTop: 4 }} />

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
          </LazyTab>

          {/* Monthly Performance Report — generate any person's or team's report
              for any of the last 12 months and have it emailed to the admin who
              asked for it. Admin-only (absent from CEO_TABS): the CEO still
              receives the automatic organisation-wide report on the 1st, but
              does not generate reports about individuals on demand. */}
          <LazyTab active={activeTab === 'MonthlyReport'}>
            <MonthlyReportSection />
          </LazyTab>

          {/* Log Visit Tab — admin & CEO can log a physical visit report on any staff */}
          <LazyTab active={activeTab === 'LogVisit'}>
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
          </LazyTab>

          {/* Profiles Tab */}
          <LazyTab active={activeTab === 'Profiles'}>
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
            {filteredProfiles.heads.length === 0 ? <Text style={{ color: theme.colors.textSecondary, marginBottom: 20 }}>No Heads found.</Text> : (
               filteredProfiles.heads.map(h => (
                 <ProfileRow
                   key={h._id}
                   id={h._id}
                   name={h.name}
                   email={h.email}
                   meta={`${roleLabel(h.role)} · ${(h.teamIds?.length || 0)} team(s)`}
                   metaColor={theme.colors.primary}
                   metaSize={12}
                   metaWeight="600"
                   theme={theme}
                   onOpen={openProfile}
                 />
               ))
            )}

            <Text style={[styles.formTitle, { color: theme.colors.textPrimary, marginBottom: 12, marginTop: 12 }]}>Team Leaders</Text>
            {filteredProfiles.teamLeaders.length === 0 ? <Text style={{ color: theme.colors.textSecondary, marginBottom: 20 }}>No Team Leaders found.</Text> : (
               filteredProfiles.teamLeaders.map(tl => (
                 <ProfileRow
                   key={tl._id}
                   id={tl._id}
                   name={tl.name}
                   email={tl.email}
                   meta={`${roleLabel(tl.role)}${tl.teamId?.name ? ` · ${tl.teamId.name}` : ''}`}
                   metaColor={theme.colors.textSecondary}
                   metaSize={12}
                   theme={theme}
                   onOpen={openProfile}
                 />
               ))
            )}

            <Text style={[styles.formTitle, { color: theme.colors.textPrimary, marginBottom: 12, marginTop: 12 }]}>Trainers</Text>
            {filteredProfiles.trainers.length === 0 ? <Text style={{ color: theme.colors.textSecondary, marginBottom: 20 }}>No Trainers found.</Text> : (
               filteredProfiles.trainers.map(trainer => (
                 <ProfileRow
                   key={trainer._id}
                   id={trainer._id}
                   name={trainer.name}
                   email={trainer.email}
                   meta={`School: ${trainer.schoolIds?.length ? trainer.schoolIds.map(s => s.name).join(', ') : (trainer.schoolId?.name || 'N/A')}`}
                   theme={theme}
                   onOpen={openProfile}
                 />
               ))
            )}
          </LazyTab>

          {/* Trainer Form */}
          <LazyTab active={activeTab === 'Trainer'}>
            <MotiView from={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
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
          </LazyTab>

          {/* Chairman Form */}
          <LazyTab active={activeTab === 'Chairman'}>
            <MotiView from={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
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
          </LazyTab>

          {/* Team Leader / Trainee Team Leader Form */}
          <LazyTab active={activeTab === 'TeamLeader'}>
            <MotiView from={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
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
          </LazyTab>

          {/* Head Form (Zonal / Cluster / Regional) */}
          <LazyTab active={activeTab === 'Head'}>
            <MotiView from={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
              <View style={[styles.formCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                <Text style={[styles.formTitle, { color: theme.colors.textPrimary }]}>Create Head</Text>
                <Formik
                  initialValues={{ name: '', email: '', password: '', role: '', schoolIds: [], teamIds: [], anonymousLocation: false }}
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

                      {/* Anonymous Location — a head who works across many
                          places rather than out of one campus. Turning it on
                          detaches the school question entirely: no school to
                          pick, no geofence to stand inside, one face
                          registration that lets them check in from anywhere.
                          The school picker below is not merely ignored but
                          visibly disabled, so the two can never look as though
                          they are both in force. */}
                      <TouchableOpacity
                        activeOpacity={0.8}
                        onPress={() => {
                          const next = !values.anonymousLocation;
                          setFieldValue('anonymousLocation', next);
                          if (next) setFieldValue('schoolIds', []);
                        }}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'flex-start',
                          borderWidth: 1,
                          borderRadius: 12,
                          padding: 14,
                          marginBottom: 16,
                          borderColor: values.anonymousLocation ? theme.colors.primary : theme.colors.border,
                          backgroundColor: values.anonymousLocation ? theme.colors.primary + '10' : theme.colors.background,
                        }}
                      >
                        <Ionicons
                          name={values.anonymousLocation ? 'checkbox' : 'square-outline'}
                          size={22}
                          color={values.anonymousLocation ? theme.colors.primary : theme.colors.textSecondary}
                          style={{ marginRight: 10, marginTop: 1 }}
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: theme.colors.textPrimary, fontWeight: '700', fontSize: 14.5 }}>
                            Anonymous Location
                          </Text>
                          <Text style={{ color: theme.colors.textSecondary, fontSize: 12.5, marginTop: 3, lineHeight: 18 }}>
                            No school is assigned & No location check.
                          </Text>
                        </View>
                      </TouchableOpacity>

                      <View
                        style={{ opacity: values.anonymousLocation ? 0.45 : 1 }}
                        pointerEvents={values.anonymousLocation ? 'none' : 'auto'}
                      >
                        <MultiSelectField
                          label="Assign School(s)"
                          data={schools}
                          selectedIds={values.schoolIds}
                          onChange={(ids) => setFieldValue('schoolIds', ids)}
                          placeholder={values.anonymousLocation ? 'Not applicable — anonymous location' : 'Select one or more schools'}
                        />
                      </View>
                      {submitCount > 0 && !values.anonymousLocation && errors.schoolIds && <Text style={[styles.errorText, { color: theme.colors.error || 'red' }]}>{errors.schoolIds}</Text>}

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
          </LazyTab>

          {/* Teams TAB — create + manage teams, tap one to view its people */}
          <LazyTab active={activeTab === 'Teams'}>
            {!selectedTeam ? (
              <>
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

                <Text style={[styles.formTitle, { color: theme.colors.textPrimary, marginTop: 8, marginBottom: 4 }]}>All Teams</Text>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginBottom: 12 }}>
                  Tap a team to view its people — team leaders, trainee team leaders, trainers and the heads who oversee it.
                </Text>
                {teams.length === 0 ? (
                  <Text style={{ color: theme.colors.textSecondary, marginBottom: 20 }}>No teams yet. Create one above.</Text>
                ) : (
                  teams.map(team => (
                    <TouchableOpacity
                      key={team._id}
                      style={[styles.formCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, padding: 16, marginBottom: 12 }]}
                      onPress={() => openTeam(team)}
                      activeOpacity={0.8}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Ionicons name="people-circle-outline" size={34} color={theme.colors.primary} />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                          <Text style={{ color: theme.colors.textPrimary, fontSize: 16, fontWeight: 'bold' }}>{team.name}</Text>
                          <Text style={{ color: theme.colors.textSecondary, marginTop: 4, fontSize: 12 }}>
                            {typeof team.memberCount === 'number' ? `${team.memberCount} member${team.memberCount === 1 ? '' : 's'} · Tap to view` : 'Tap to view'}
                          </Text>
                        </View>
                        <TouchableOpacity
                          style={{ backgroundColor: (theme.colors.error || '#e53935') + '20', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, marginRight: 6 }}
                          onPress={() => handleDeleteTeam(team)}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Ionicons name="trash-outline" size={18} color={theme.colors.error || '#e53935'} />
                        </TouchableOpacity>
                        <Ionicons name="chevron-forward" size={20} color={theme.colors.textSecondary} />
                      </View>
                    </TouchableOpacity>
                  ))
                )}
              </>
            ) : (
              <>
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}
                  onPress={closeTeam}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="chevron-back" size={22} color={theme.colors.primary} />
                  <Text style={{ color: theme.colors.primary, fontWeight: '600', marginLeft: 2 }}>All Teams</Text>
                </TouchableOpacity>

                {teamDetailLoading ? (
                  <ActivityIndicator size="large" color={theme.colors.primary} style={{ marginTop: 30 }} />
                ) : !teamDetail ? (
                  <View style={{ alignItems: 'center', marginTop: 40 }}>
                    <Ionicons name="alert-circle-outline" size={48} color={theme.colors.border} />
                    <Text style={{ color: theme.colors.textSecondary, marginTop: 12 }}>Team details unavailable.</Text>
                    <TouchableOpacity
                      style={{ marginTop: 14, backgroundColor: theme.colors.primary, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 8 }}
                      onPress={() => openTeam(selectedTeam)}
                    >
                      <Text style={{ color: '#fff', fontWeight: 'bold' }}>Retry</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <>
                    {/* Team summary — name, provenance and headline counts */}
                    <View style={[styles.formCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, padding: 16 }]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Ionicons name="people-circle" size={40} color={theme.colors.primary} />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                          <Text style={{ color: theme.colors.textPrimary, fontSize: 20, fontWeight: 'bold' }}>{teamDetail.team?.name}</Text>
                          <Text style={{ color: theme.colors.textSecondary, marginTop: 3, fontSize: 12 }}>
                            Created {teamDetail.team?.createdAt ? new Date(teamDetail.team.createdAt).toLocaleDateString() : '—'}
                            {teamDetail.team?.createdBy?.name ? ` by ${teamDetail.team.createdBy.name}` : ''}
                          </Text>
                        </View>
                      </View>

                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 14 }}>
                        {[
                          { label: 'Members', value: teamDetail.counts?.members || 0, icon: 'people-outline' },
                          { label: 'Leaders', value: teamDetail.counts?.leaders || 0, icon: 'ribbon-outline' },
                          { label: 'Trainers', value: teamDetail.counts?.trainers || 0, icon: 'person-outline' },
                          { label: 'Heads', value: teamDetail.counts?.heads || 0, icon: 'shield-checkmark-outline' },
                          { label: 'Schools', value: teamDetail.counts?.schools || 0, icon: 'business-outline' },
                        ].map(stat => (
                          <View
                            key={stat.label}
                            style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.primary + '15', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, marginRight: 8, marginBottom: 8 }}
                          >
                            <Ionicons name={stat.icon} size={14} color={theme.colors.primary} />
                            <Text style={{ color: theme.colors.primary, fontWeight: '700', fontSize: 13, marginLeft: 6 }}>{stat.value}</Text>
                            <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginLeft: 4 }}>{stat.label}</Text>
                          </View>
                        ))}
                      </View>
                    </View>

                    {/* Heads overseeing this team */}
                    <Text style={[styles.formTitle, { color: theme.colors.textPrimary, marginTop: 8, marginBottom: 12 }]}>Overseeing Heads</Text>
                    {(teamDetail.heads || []).length === 0 ? (
                      <Text style={{ color: theme.colors.textSecondary, marginBottom: 20 }}>No head oversees this team yet.</Text>
                    ) : (
                      teamDetail.heads.map(head => (
                        <View key={head._id} style={[styles.formCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, padding: 16, marginBottom: 12 }]}>
                          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Avatar name={head.name} size={40} />
                            <View style={{ flex: 1, marginLeft: 12 }}>
                              <Text style={{ color: theme.colors.textPrimary, fontSize: 16, fontWeight: 'bold' }}>{head.name}</Text>
                              <Text style={{ color: theme.colors.textSecondary, marginTop: 2, fontSize: 12 }}>{head.email}</Text>
                              <Text style={{ color: theme.colors.primary, marginTop: 4, fontSize: 12, fontWeight: '600' }}>{roleLabel(head.role)}</Text>
                            </View>
                            <TouchableOpacity
                              style={{ backgroundColor: theme.colors.primary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 }}
                              onPress={() => navigation.navigate('UserProfile', { userId: head._id })}
                            >
                              <Text style={{ color: '#fff', fontWeight: 'bold' }}>View Profile</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      ))
                    )}

                    {/* Team people — leaders first, then trainers */}
                    <Text style={[styles.formTitle, { color: theme.colors.textPrimary, marginTop: 8, marginBottom: 12 }]}>
                      Team People ({teamDetail.counts?.members || 0})
                    </Text>

                    {(teamDetail.members || []).length > 0 && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, paddingHorizontal: 12, height: 48, marginBottom: 16 }}>
                        <Ionicons name="search" size={18} color={theme.colors.textSecondary} style={{ marginRight: 8 }} />
                        <TextInput
                          style={{ flex: 1, color: theme.colors.textPrimary, fontSize: 14 }}
                          placeholder="Search this team by name or email..."
                          placeholderTextColor={theme.colors.placeholder}
                          value={teamMemberSearch}
                          onChangeText={setTeamMemberSearch}
                          autoCapitalize="none"
                        />
                        {teamMemberSearch.length > 0 && (
                          <TouchableOpacity onPress={() => setTeamMemberSearch('')}>
                            <Ionicons name="close-circle" size={18} color={theme.colors.textSecondary} />
                          </TouchableOpacity>
                        )}
                      </View>
                    )}

                    {(() => {
                      const q = teamMemberSearch.trim().toLowerCase();
                      const visible = (teamDetail.members || []).filter(m =>
                        !q || m.name?.toLowerCase().includes(q) || m.email?.toLowerCase().includes(q)
                      );
                      if ((teamDetail.members || []).length === 0) {
                        return (
                          <View style={{ alignItems: 'center', marginTop: 20, marginBottom: 20 }}>
                            <Ionicons name="person-outline" size={48} color={theme.colors.border} />
                            <Text style={{ color: theme.colors.textSecondary, marginTop: 12 }}>No one is assigned to this team yet.</Text>
                          </View>
                        );
                      }
                      if (visible.length === 0) {
                        return <Text style={{ color: theme.colors.textSecondary, marginBottom: 20 }}>No member matches "{teamMemberSearch}".</Text>;
                      }
                      return visible.map(member => {
                        const memberSchools = (member.schoolIds?.length ? member.schoolIds : (member.schoolId ? [member.schoolId] : []))
                          .map(s => s?.name).filter(Boolean);
                        return (
                          <View key={member._id} style={[styles.formCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, padding: 16, marginBottom: 12 }]}>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                              <Avatar name={member.name} size={40} />
                              <View style={{ flex: 1, marginLeft: 12 }}>
                                <Text style={{ color: theme.colors.textPrimary, fontSize: 16, fontWeight: 'bold' }}>{member.name}</Text>
                                <Text style={{ color: theme.colors.textSecondary, marginTop: 2, fontSize: 12 }}>{member.email}</Text>
                                <Text style={{ color: theme.colors.primary, marginTop: 4, fontSize: 12, fontWeight: '600' }}>{roleLabel(member.role)}</Text>
                                {member.teamLeaderId?.name ? (
                                  <Text style={{ color: theme.colors.textSecondary, marginTop: 2, fontSize: 12 }}>Reports to {member.teamLeaderId.name}</Text>
                                ) : null}
                                {memberSchools.length ? (
                                  <Text style={{ color: theme.colors.textSecondary, marginTop: 2, fontSize: 12 }} numberOfLines={2}>
                                    {memberSchools.join(', ')}
                                  </Text>
                                ) : null}
                              </View>
                              <TouchableOpacity
                                style={{ backgroundColor: theme.colors.primary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 }}
                                onPress={() => navigation.navigate('UserProfile', { userId: member._id })}
                              >
                                <Text style={{ color: '#fff', fontWeight: 'bold' }}>View Profile</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        );
                      });
                    })()}

                    {/* Schools this team covers */}
                    {(teamDetail.schools || []).length > 0 && (
                      <>
                        <Text style={[styles.formTitle, { color: theme.colors.textPrimary, marginTop: 8, marginBottom: 12 }]}>Schools Covered</Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 20 }}>
                          {teamDetail.schools.map(school => (
                            <View
                              key={school._id}
                              style={{ backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, marginRight: 8, marginBottom: 8 }}
                            >
                              <Text style={{ color: theme.colors.textPrimary, fontSize: 12, fontWeight: '600' }}>{school.name}</Text>
                              {school.state ? <Text style={{ color: theme.colors.textSecondary, fontSize: 11 }}>{school.state}</Text> : null}
                            </View>
                          ))}
                        </View>
                      </>
                    )}
                  </>
                )}
              </>
            )}
          </LazyTab>

          {/* School Holidays TAB */}
          <LazyTab active={activeTab === 'Holidays'}>
            <SchoolHolidayApprovals refreshKey={activeTab === 'Holidays' ? 1 : 0} />
          </LazyTab>

          {/* Celebrations TAB */}
          <LazyTab active={activeTab === 'Celebrations'}>
            {/* `active` gates the preview's animation. Every tab stays mounted
                here, and `display: none` does not stop a Reanimated worklet —
                so without this the celebration scene would keep running on the
                UI thread behind every other section of the portal. */}
            <CelebrationsSection active={activeTab === 'Celebrations'} />
          </LazyTab>

          {/* Banners TAB */}
          <LazyTab active={activeTab === 'Banners'}>
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

                  {/* Step 3 — audience. A banner is public unless people are
                      named here; anyone named simply never sees it on Home. */}
                  <Text style={[styles.label, { color: theme.colors.textSecondary }]}>
                    Step 3: Invisible to (Optional)
                  </Text>
                  <Text style={{ color: theme.colors.textSecondary, fontSize: 11, marginBottom: 8, marginTop: -4 }}>
                    Anyone selected here will not see this banner. Leave empty to show it to everyone.
                  </Text>
                  <TouchableOpacity
                    style={[styles.audienceBtn, { borderColor: theme.colors.border, backgroundColor: theme.colors.background }]}
                    onPress={() => setAudiencePickerFor('new')}
                  >
                    <Ionicons name="eye-off-outline" size={18} color={theme.colors.primary} />
                    <Text style={{ color: theme.colors.textPrimary, marginLeft: 8, flex: 1, fontSize: 13 }}>
                      {bannerHiddenFor.length === 0
                        ? 'Select people to hide this banner from'
                        : `Hidden from ${bannerHiddenFor.length} ${bannerHiddenFor.length === 1 ? 'person' : 'people'}`}
                    </Text>
                    <Ionicons name="chevron-forward" size={18} color={theme.colors.textSecondary} />
                  </TouchableOpacity>

                  {bannerHiddenFor.length > 0 && (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                      {bannerHiddenFor.map(u => (
                        <TouchableOpacity
                          key={String(u._id)}
                          style={[styles.audienceChip, { backgroundColor: theme.colors.primary + '18', borderColor: theme.colors.primary }]}
                          onPress={() => setBannerHiddenFor(prev => prev.filter(p => String(p._id) !== String(u._id)))}
                        >
                          <Text style={{ color: theme.colors.primary, fontSize: 11, fontWeight: '700', marginRight: 4 }}>
                            {u.name} · {roleLabel(u.role)}
                          </Text>
                          <Ionicons name="close-circle" size={14} color={theme.colors.primary} />
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}

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
                  <ResponsiveGrid gap={12} minColumnWidth={380}>
                  {banners.slice((bannerPage - 1) * bannersPerPage, bannerPage * bannersPerPage).map((b) => (
                    <View key={b._id} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8, overflow: 'hidden' }}>
                      <Image source={{ uri: b.imageUrl }} style={{ width: 80, height: 45, resizeMode: 'cover' }} />
                      <View style={{ flex: 1, paddingHorizontal: 12, paddingVertical: 8 }}>
                        <Text style={{ color: theme.colors.textPrimary, fontSize: 12 }} numberOfLines={2}>{b.description || 'No description'}</Text>
                        {/* Who this banner is withheld from — visible at a glance
                            so a quietly-restricted banner is never a mystery. */}
                        {(b.hiddenFor?.length > 0) && (
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                            <Ionicons name="eye-off-outline" size={12} color="#F59E0B" />
                            <Text style={{ color: '#F59E0B', fontSize: 10, marginLeft: 4, fontWeight: '700' }}>
                              Hidden from {b.hiddenFor.length} {b.hiddenFor.length === 1 ? 'person' : 'people'}
                            </Text>
                          </View>
                        )}
                      </View>
                      <TouchableOpacity style={{ padding: 10 }} onPress={() => openBannerEditor(b)}>
                        <Ionicons name="create-outline" size={20} color={theme.colors.primary} />
                      </TouchableOpacity>
                      <TouchableOpacity style={{ padding: 10 }} onPress={() => deleteBanner(b._id)}>
                        <Ionicons name="trash-outline" size={20} color="#FF4444" />
                      </TouchableOpacity>
                    </View>
                  ))}
                  </ResponsiveGrid>
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
          </LazyTab>


        </ScrollView>
      )}

      {/* Sidebar Drawer */}
      <SidebarMenu
        ref={sidebarRef}
        title={isCEO ? 'IECE CEO' : 'IECE Admin'}
        subtitle={isCEO ? 'Executive Portal' : 'Management Portal'}
        tabs={visibleTabs.map((t) => (t.key === 'Holidays' ? { ...t, badge: sections.holidays || 0 } : t))}
        activeTab={activeTab}
        onSelectTab={selectTab}
        actions={[
          { label: 'Substitution Requests', icon: 'swap-horizontal-outline', badge: sections.substitution || 0, onPress: () => navigation.navigate('Substitution') },
          { label: 'Meeting Corner', icon: 'videocam-outline', onPress: () => navigation.navigate('MeetingCorner') },
          { label: 'Notifications', icon: 'notifications-outline', badge: unread || 0, onPress: () => navigation.navigate('Notifications') },
          // The approvals hub. For the Admin it holds BOTH queues — face scans
          // and activities. The CEO keeps their activity override at every level
          // of the hierarchy but no longer reviews faces (that is the Admin's
          // alone now), so their entry says what it actually opens.
          {
            label: isCEO ? 'Activity Approvals' : 'Approvals',
            icon: 'checkmark-done-outline',
            badge: sections.faces || 0,
            onPress: () => navigation.navigate('Approvals'),
          },
          // Who approved what, across every feature. Deliberately available to
          // the CEO as well as the Admin: with several admins sharing the job,
          // this is the CEO's only way to see which of them decided a given
          // thing — the question this whole feature exists to answer.
          { label: 'Approval Log', icon: 'time-outline', onPress: () => navigation.navigate('ApprovalLog') },
          // Staff management + create-admin + leave approvals stay admin-only.
          // CEO is read-only there (only notified about leave outcomes).
          ...(isCEO ? [] : [
            { label: 'Leave Requests', icon: 'calendar-outline', badge: sections.leave || 0, onPress: () => navigation.navigate('Leave') },
            { label: 'School Visits', icon: 'business-outline', badge: sections.schoolVisit || 0, onPress: () => navigation.navigate('SchoolVisit') },
            { label: 'IECE Staff', icon: 'people-outline', onPress: () => navigation.navigate('ManageScreen') },
            { label: 'Create Admin', icon: 'shield-checkmark-outline', onPress: () => navigation.navigate('CreateAdmin') },
          ]),
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

      {/* The picker for the UPLOAD form. The editor has its own copy inside its
          modal below: a modal opened as a SIBLING of an already-open one does
          not present on iOS, so each host renders the picker in its own tree. */}
      <DirectoryMultiSelectModal
        visible={audiencePickerFor === 'new'}
        title="Invisible to"
        subtitle="Selected people will not see this banner"
        confirmLabel="Done"
        selected={bannerHiddenFor}
        onConfirm={setBannerHiddenFor}
        onClose={() => setAudiencePickerFor(null)}
      />

      {/* Edit an existing banner: description + audience. The picture itself is
          not editable — a new picture is a new banner. */}
      <Modal
        visible={!!editingBanner}
        transparent
        animationType="slide"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => setEditingBanner(null)}
      >
        <View style={styles.editOverlay}>
          <View style={[styles.editSheet, { backgroundColor: theme.colors.background, borderColor: theme.colors.border }]}>
            <View style={[styles.editHeader, { borderBottomColor: theme.colors.border }]}>
              <Text style={{ fontSize: 18, fontWeight: 'bold', color: theme.colors.textPrimary, flex: 1 }}>Edit Banner</Text>
              <TouchableOpacity onPress={() => setEditingBanner(null)}>
                <Ionicons name="close" size={24} color={theme.colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
              {!!editingBanner && (
                <Image
                  source={{ uri: editingBanner.imageUrl }}
                  style={{ width: '100%', height: 160, borderRadius: 12, resizeMode: 'cover', borderWidth: 1, borderColor: theme.colors.border }}
                />
              )}

              <Text style={[styles.label, { color: theme.colors.textSecondary }]}>Description</Text>
              <TextInput
                style={[styles.input, { borderColor: theme.colors.border, color: theme.colors.textPrimary, height: 80, textAlignVertical: 'top' }]}
                placeholder="Enter banner description"
                placeholderTextColor={theme.colors.placeholder}
                value={editBannerDesc}
                onChangeText={setEditBannerDesc}
                multiline
              />

              <Text style={[styles.label, { color: theme.colors.textSecondary }]}>Invisible to</Text>
              <TouchableOpacity
                style={[styles.audienceBtn, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}
                onPress={() => setAudiencePickerFor(editingBanner?._id)}
              >
                <Ionicons name="eye-off-outline" size={18} color={theme.colors.primary} />
                <Text style={{ color: theme.colors.textPrimary, marginLeft: 8, flex: 1, fontSize: 13 }}>
                  {editBannerHiddenFor.length === 0
                    ? 'Visible to everyone'
                    : `Hidden from ${editBannerHiddenFor.length} ${editBannerHiddenFor.length === 1 ? 'person' : 'people'}`}
                </Text>
                <Ionicons name="chevron-forward" size={18} color={theme.colors.textSecondary} />
              </TouchableOpacity>

              {editBannerHiddenFor.length > 0 && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                  {editBannerHiddenFor.map(u => (
                    <TouchableOpacity
                      key={String(u._id)}
                      style={[styles.audienceChip, { backgroundColor: theme.colors.primary + '18', borderColor: theme.colors.primary }]}
                      onPress={() => setEditBannerHiddenFor(prev => prev.filter(p => String(p._id) !== String(u._id)))}
                    >
                      <Text style={{ color: theme.colors.primary, fontSize: 11, fontWeight: '700', marginRight: 4 }}>
                        {u.name} · {roleLabel(u.role)}
                      </Text>
                      <Ionicons name="close-circle" size={14} color={theme.colors.primary} />
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <TouchableOpacity
                style={[styles.submitBtn, { backgroundColor: theme.colors.primary, opacity: savingBannerEdit ? 0.7 : 1 }]}
                onPress={saveBannerEdit}
                disabled={savingBannerEdit}
              >
                {savingBannerEdit ? <ActivityIndicator color="#FFF" /> : <Text style={styles.submitBtnText}>Save Changes</Text>}
              </TouchableOpacity>
            </ScrollView>

            {/* Inside the editor's own modal — see the note on the upload copy. */}
            <DirectoryMultiSelectModal
              visible={!!audiencePickerFor && audiencePickerFor !== 'new'}
              title="Invisible to"
              subtitle="Selected people will not see this banner"
              confirmLabel="Done"
              selected={editBannerHiddenFor}
              onConfirm={setEditBannerHiddenFor}
              onClose={() => setAudiencePickerFor(null)}
            />
          </View>
        </View>
      </Modal>
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
  formCard: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    // Lists, dashboards and card grids use the full window width. Entry forms are
    // the one exception: a text input does not get more usable at 1400px wide, it
    // just makes the eye travel the whole monitor to read one label-value pair.
    ...Platform.select({ web: { maxWidth: 900, width: '100%' }, default: {} }),
  },
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
  audienceBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 14, borderRadius: 8, borderWidth: 1, marginBottom: 12 },
  audienceChip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, borderWidth: 1 },
  editOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  editSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '88%', borderWidth: 1 },
  editHeader: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1 },
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
