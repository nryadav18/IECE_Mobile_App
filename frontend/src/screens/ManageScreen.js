import React, { useState, useEffect, useContext, useCallback } from 'react';
import { 
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Modal, KeyboardAvoidingView, Platform, FlatList, RefreshControl
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ThemeContext } from '../context/ThemeContext';
import api from '../services/api';
import { Skeleton, ShineSweep } from '../components/Skeleton';
import CustomAlert from '../components/CustomAlert';
import ApprovedBy from '../components/ApprovedBy';
import CustomDropdown from '../components/CustomDropdown';
import MultiSelectField from '../components/MultiSelectField';
import TeamMultiSelectModal from '../components/TeamMultiSelectModal';
import { HEAD_ROLES, LEADER_ROLES, roleLabel } from '../utils/roles';

export default function ManageScreen({ navigation }) {
  const { theme } = useContext(ThemeContext);
  const insets = useSafeAreaInsets();

  const [activeTab, setActiveTab] = useState('Schools'); // 'Schools' | 'Trainers' | 'TeamLeaders' | 'Heads'

  const [schools, setSchools] = useState([]);
  // Schools whose login was deleted. The school record is kept so every
  // activity, visit report and attendance entry logged there still resolves.
  const [archivedSchools, setArchivedSchools] = useState([]);
  const [showArchived, setShowArchived] = useState(false);
  const [restoringSchoolId, setRestoringSchoolId] = useState(null);
  const [teamLeaders, setTeamLeaders] = useState([]);
  const [trainers, setTrainers] = useState([]);
  const [chairmen, setChairmen] = useState([]);
  const [teams, setTeams] = useState([]);
  const [heads, setHeads] = useState([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Edit modals state
  const [editingUser, setEditingUser] = useState(null); // The user object being edited
  const [editForm, setEditForm] = useState({
    name: '',
    email: '',
    password: '',
    anonymousLocation: false,
    schoolIds: [],
    teamLeaderId: '',
    teamId: '',
    teamIds: [],
    schoolName: '',
    associationYear: '',
    classCoverage: ''
  });
  const [teamModalVisible, setTeamModalVisible] = useState(false);
  const [updating, setUpdating] = useState(false);
  // Face-registration removal is per-school: a person may be registered at
  // several schools, so we pick one before confirming the delete.
  const [faceTarget, setFaceTarget] = useState(null); // { user, registrations: [...] }
  const [faceStep, setFaceStep] = useState('select'); // 'select' | 'confirm'
  const [faceSelection, setFaceSelection] = useState(null); // one registration
  const [faceDeleting, setFaceDeleting] = useState(false);
  const [alertConfig, setAlertConfig] = useState({ visible: false, title: '', message: '', type: 'info', buttons: [] });

  const showAlert = (title, message, type = 'info', buttons = []) => {
    setAlertConfig({ visible: true, title, message, type, buttons });
  };

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async (isRefresh = false) => {
    // On pull-to-refresh keep the list visible and show only the pull spinner;
    // don't flip the whole screen back to the full-screen ScreenLoader.
    if (!isRefresh) setLoading(true);
    try {
      const [schoolsRes, tlsRes, trainersRes, chairmenRes, teamsRes, headsRes, archivedRes] = await Promise.all([
        api.get('/admin/schools'),
        api.get('/admin/team-leaders'),
        api.get('/admin/users?role=trainer&limit=1000'),
        api.get('/admin/users?role=chairman&limit=1000'),
        api.get('/admin/teams'),
        api.get('/admin/users?role=zonal_head,cluster_head,regional_head&limit=1000'),
        api.get('/admin/schools/archived')
      ]);
      setSchools(schoolsRes.data.data);
      setTeamLeaders(tlsRes.data.data);
      setTrainers(trainersRes.data.data);
      setChairmen(chairmenRes.data.data);
      setTeams(teamsRes.data.data);
      setHeads(headsRes.data.data);
      setArchivedSchools(archivedRes.data.data);
    } catch (err) {
      console.log('Error fetching management data', err);
      showAlert('Error', 'Failed to load entries.', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData(true);
  }, []);

  const handleEditPress = (item) => {
    setEditingUser(item);
    setEditForm({
      name: item.name || '',
      email: item.email || '',
      password: '',
      anonymousLocation: !!item.anonymousLocation,
      schoolIds: Array.isArray(item.schoolIds) && item.schoolIds.length
        ? item.schoolIds.map(s => s?._id || s)
        : (item.schoolId ? [item.schoolId?._id || item.schoolId] : []),
      teamLeaderId: item.teamLeaderId?._id || item.teamLeaderId || '',
      teamId: item.teamId?._id || item.teamId || '',
      // teamIds may be populated ({_id,name}) or raw ids — normalize to ids.
      teamIds: (item.teamIds || []).map(t => t?._id || t),
      schoolName: item.schoolId?.name || '',
      associationYear: item.schoolId?.associationYear || '',
      classCoverage: item.schoolId?.classCoverage || ''
    });
  };

  const handleUpdate = async () => {
    if (!editForm.name.trim() || !editForm.email.trim()) {
      showAlert('Validation Error', 'Name and Email are required.', 'warning');
      return;
    }
    
    const isHeadEdit = HEAD_ROLES.includes(editingUser?.role);
    const goingAnonymous = isHeadEdit && editForm.anonymousLocation;

    setUpdating(true);
    try {
      const payload = {
        name: editForm.name,
        email: editForm.email,
        // A head switched to Anonymous Location belongs to no school by
        // definition, so the empty list travels WITH the flag — sending the old
        // schools alongside it is what lets the two states half-apply.
        ...(isHeadEdit ? { anonymousLocation: !!editForm.anonymousLocation } : null),
        schoolIds: goingAnonymous ? [] : editForm.schoolIds,
        teamLeaderId: editForm.teamLeaderId || undefined,
        teamId: editForm.teamId || undefined,
        teamIds: HEAD_ROLES.includes(editingUser?.role) ? editForm.teamIds : undefined,
        schoolName: editForm.schoolName || undefined,
        associationYear: editForm.associationYear || undefined,
        classCoverage: editForm.classCoverage || undefined,
      };
      if (editForm.password.trim()) {
        payload.password = editForm.password;
      }

      await api.put(`/admin/user/${editingUser._id}`, payload);
      showAlert('Success', 'Updated successfully.', 'success');
      setEditingUser(null);
      fetchData();
    } catch (err) {
      showAlert('Error', err.response?.data?.error || 'Failed to update user.', 'error');
    } finally {
      setUpdating(false);
    }
  };

  // "Created by" for the staff table. Only the Admin and CEO ever receive
  // createdByAdmin (the server strips it for everyone else), and accounts made
  // by the onboarding scripts or before this field existed have none — those
  // read "—" rather than inventing a creator.
  const createdByText = (item) => {
    const c = item?.createdByAdmin;
    if (!c?.name) return '—';
    const label = roleLabel(c.role);
    return label ? `${c.name} (${label})` : c.name;
  };

  // Normalize a user's per-school face registrations into what the picker needs.
  // `schoolId` arrives populated ({_id, name}) but may be a bare id on older
  // payloads, so fall back to looking the name up in the schools list.
  const getFaceRegistrations = (user) =>
    (user?.faceRegistrations || []).map((reg) => {
      const raw = reg.schoolId;
      const id = raw?._id || raw;
      // No school at all: an anonymous-location head's single registration. It
      // is addressed by the literal 'anonymous' rather than by an id — see
      // services/approvals.
      // decidedBy rides along so the picker can show which admin let this face
      // into the attendance system. It is only present for Admin/CEO callers —
      // the server strips it for everyone else.
      if (!id) return { id: 'anonymous', name: 'Anonymous location (no school)', status: reg.status, decidedBy: reg.decidedBy };
      const name = raw?.name || schools.find((s) => s._id === String(id))?.name || 'Unknown school';
      return { id: String(id), name, status: reg.status, decidedBy: reg.decidedBy };
    });

  const handleDeleteFaceRegistration = (user) => {
    const registrations = getFaceRegistrations(user);

    if (registrations.length === 0) {
      showAlert(
        'Nothing to Delete',
        `${user.name} has no facial registration on record.`,
        'info'
      );
      return;
    }

    setFaceTarget({ user, registrations });
    // A single registration needs no choice — go straight to the confirmation.
    if (registrations.length === 1) {
      setFaceSelection(registrations[0]);
      setFaceStep('confirm');
    } else {
      setFaceSelection(null);
      setFaceStep('select');
    }
  };

  const closeFaceModal = () => {
    if (faceDeleting) return;
    setFaceTarget(null);
    setFaceSelection(null);
    setFaceStep('select');
  };

  const confirmDeleteFaceRegistration = async () => {
    if (!faceTarget || !faceSelection) return;

    const { user } = faceTarget;
    const { id: schoolId, name: schoolName } = faceSelection;

    setFaceDeleting(true);
    try {
      await api.delete(`/admin/face-registration/${user._id}/${schoolId}`);
      setFaceTarget(null);
      setFaceSelection(null);
      setFaceStep('select');
      showAlert(
        'Deleted',
        `${user.name}'s face registration for ${schoolName} has been removed. They will need to register again at that school.`,
        'success'
      );
      fetchData();
    } catch (err) {
      showAlert('Error', err.response?.data?.error || 'Failed to delete face registration.', 'error');
    } finally {
      setFaceDeleting(false);
    }
  };

  const handleDeletePress = (id, label) => {
    showAlert(
      'Confirm Deletion',
      `Delete the login for ${label}? If this is a Chairman, their school is archived — its activities, visit reports and attendance are all kept, and everyone who worked there keeps it in their profile history. Archived schools can be restored.`,
      'warning',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          type: 'primary',
          onPress: async () => {
            try {
              await api.delete(`/admin/user/${id}`);
              showAlert('Success', 'Deleted successfully.', 'success');
              fetchData();
            } catch (err) {
              showAlert('Error', 'Failed to delete.', 'error');
            }
          }
        }
      ]
    );
  };

  const handleRestoreSchool = (school) => {
    showAlert(
      'Restore School',
      `Bring "${school.name}" back? Its work history is already intact. You will need to create a new Chairman login for it, and re-assign any staff who worked there.`,
      'info',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore',
          type: 'primary',
          onPress: async () => {
            setRestoringSchoolId(school._id);
            try {
              const res = await api.put(`/admin/school/${school._id}/restore`);
              showAlert(
                'Restored',
                res.data?.needsChairman
                  ? `${school.name} is active again. Create a Chairman login for it so the school can sign in.`
                  : `${school.name} is active again.`,
                'success'
              );
              fetchData();
            } catch (err) {
              showAlert('Error', err.response?.data?.error || 'Failed to restore school.', 'error');
            } finally {
              setRestoringSchoolId(null);
            }
          }
        }
      ]
    );
  };

  const getSchoolName = (user) => {
    // An anonymous-location head has no school BY DESIGN, so "None" would read
    // as something missing rather than as the setting it is.
    if (user?.anonymousLocation && HEAD_ROLES.includes(user.role)) return 'Anonymous Location';

    // Prefer the multi-school list; fall back to the legacy single school.
    if (Array.isArray(user?.schoolIds) && user.schoolIds.length) {
      const names = user.schoolIds.map((s) =>
        typeof s === 'object' ? s.name : (schools.find((sc) => sc._id === s)?.name)
      ).filter(Boolean);
      if (names.length) return names.join(', ');
    }

    if (!user?.schoolId) return 'None';

    if (typeof user.schoolId === 'object') {
      return user.schoolId.name || 'None';
    }

    const matchedSchool = schools.find((school) => school._id === user.schoolId);
    return matchedSchool?.name || 'None';
  };

  // The Schools table lists chairmen, so a school whose login is gone — a
  // restored one, most often — would otherwise be invisible here even though
  // it is active and assignable everywhere else.
  const loginlessSchools = (() => {
    const chairmanIds = new Set(chairmen.map(c => String(c._id)));
    return schools.filter(s => !chairmanIds.has(String(s.chairmanId?._id || s.chairmanId)));
  })();

  // Filter items based on active tab and search query
  const getFilteredData = () => {
    const q = searchQuery.toLowerCase().trim();
    if (activeTab === 'Schools') {
      return chairmen.filter(c => 
        c.name?.toLowerCase().includes(q) || 
        c.schoolId?.name?.toLowerCase().includes(q) ||
        c.schoolId?.state?.toLowerCase().includes(q)
      );
    } else if (activeTab === 'Trainers') {
      return trainers.filter(t =>
        t.name?.toLowerCase().includes(q) ||
        t.email?.toLowerCase().includes(q) ||
        getSchoolName(t).toLowerCase().includes(q)
      );
    } else if (activeTab === 'Heads') {
      return heads.filter(h =>
        h.name?.toLowerCase().includes(q) ||
        h.email?.toLowerCase().includes(q) ||
        roleLabel(h.role).toLowerCase().includes(q)
      );
    } else {
      return teamLeaders.filter(tl =>
        tl.name?.toLowerCase().includes(q) ||
        tl.email?.toLowerCase().includes(q) ||
        getSchoolName(tl).toLowerCase().includes(q)
      );
    }
  };

  const filteredData = getFilteredData();

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, searchQuery]);

  const totalPages = Math.ceil(filteredData.length / itemsPerPage) || 1;
  const activePage = Math.min(currentPage, totalPages);
  const paginatedData = filteredData.slice((activePage - 1) * itemsPerPage, activePage * itemsPerPage);

  // Show the skeleton on the very first load and whenever we're refreshing data,
  // so a data update animates in cleanly instead of flashing stale content.
  const showSkeleton = loading || refreshing;

  // Column widths per tab — kept in sync with the real header/rows below so the
  // skeleton rows line up perfectly with the loaded table (feels seamless).
  // (The trailing 150 on each row is the "Created By" column.)
  const skeletonColumns = {
    Schools: [60, 140, 120, 170, 90, 85, 85, 150],
    Trainers: [60, 120, 170, 140, 120, 100, 150],
    Heads: [60, 140, 190, 130, 130, 150],
    TeamLeaders: [60, 130, 150, 180, 150, 130, 100, 150],
  }[activeTab] || [60, 140, 170, 130, 120, 150];

  const renderSkeletonTable = () => (
    <ScrollView key={`sk-${activeTab}`} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 10 }}>
      {/* Static bars mount instantly; a SINGLE ShineSweep animates the whole card. */}
      <View style={[styles.tableContainer, { borderColor: theme.colors.border }]}>
        {/* Skeleton header row */}
        <View style={[styles.tableHeaderRow, { backgroundColor: theme.colors.primary + '10', borderBottomColor: theme.colors.border }]}>
          {skeletonColumns.map((w, i) => (
            <View key={i} style={[styles.thContainer, { width: w }]}>
              <Skeleton plain width={i === 0 ? 28 : w * 0.55} height={10} radius={4} />
            </View>
          ))}
          <View style={[styles.thContainer, { width: 100, alignItems: 'center' }]}>
            <Skeleton plain width={44} height={10} radius={4} />
          </View>
        </View>

        {/* Skeleton body rows */}
        {Array.from({ length: itemsPerPage }).map((_, r) => (
          <View key={r} style={[styles.tableRow, { backgroundColor: r % 2 === 0 ? theme.colors.surface : theme.colors.background, borderBottomColor: theme.colors.border }]}>
            {skeletonColumns.map((w, i) => (
              <View key={i} style={[styles.tdContainer, { width: w }]}>
                <Skeleton
                  plain
                  width={i === 0 ? 22 : Math.max(30, w * (0.5 + ((r + i) % 3) * 0.15))}
                  height={i === 0 ? 12 : 13}
                  radius={i === 0 ? 6 : 7}
                />
              </View>
            ))}
            {/* Action buttons placeholder */}
            <View style={[styles.tdActions, { width: 100 }]}>
              <Skeleton plain width={28} height={28} radius={7} />
              <Skeleton plain width={28} height={28} radius={7} />
            </View>
          </View>
        ))}

        {/* One shared shine band sweeping the whole skeleton card. */}
        <ShineSweep />
      </View>
    </ScrollView>
  );

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <View style={[styles.container, { backgroundColor: theme.colors.background, paddingTop: insets.top }]}>
        
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTitleContainer}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={[styles.backBtn, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
              <Ionicons name="arrow-back" size={20} color={theme.colors.textPrimary} />
            </TouchableOpacity>
            <View>
              <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>Manage Directory</Text>
              <Text style={[styles.headerSubtitle, { color: theme.colors.textSecondary }]}>IEC staff & schools</Text>
            </View>
          </View>
          <View style={[styles.headerCountPill, { backgroundColor: theme.colors.primary + '15' }]}>
            <Ionicons name="people" size={14} color={theme.colors.primary} style={{ marginRight: 5 }} />
            <Text style={[styles.headerCountText, { color: theme.colors.primary }]}>
              {chairmen.length + trainers.length + teamLeaders.length + heads.length}
            </Text>
          </View>
        </View>

        {/* Tab Selection — modern scrollable pills with live counts */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tabsScroll}
          contentContainerStyle={styles.tabs}
        >
          {[
            { key: 'Schools', label: 'Schools & Chairmen', icon: 'business', count: chairmen.length },
            { key: 'Trainers', label: 'Trainers', icon: 'person', count: trainers.length },
            { key: 'TeamLeaders', label: 'Leaders', icon: 'people', count: teamLeaders.length },
            { key: 'Heads', label: 'Heads', icon: 'ribbon', count: heads.length },
          ].map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                activeOpacity={0.85}
                style={[
                  styles.tab,
                  {
                    backgroundColor: isActive ? theme.colors.primary : theme.colors.surface,
                    borderColor: isActive ? theme.colors.primary : theme.colors.border,
                  },
                  isActive && styles.tabActiveShadow,
                ]}
                onPress={() => {
                  setActiveTab(tab.key);
                  setSearchQuery('');
                }}
              >
                <Ionicons
                  name={tab.icon}
                  size={15}
                  color={isActive ? '#FFF' : theme.colors.textSecondary}
                  style={{ marginRight: 7 }}
                />
                <Text style={[
                  styles.tabText,
                  { color: isActive ? '#FFF' : theme.colors.textSecondary },
                  isActive && { fontWeight: '800' }
                ]}>
                  {tab.label}
                </Text>
                <View style={[
                  styles.tabCount,
                  { backgroundColor: isActive ? 'rgba(255,255,255,0.25)' : theme.colors.primary + '15' }
                ]}>
                  <Text style={[styles.tabCountText, { color: isActive ? '#FFF' : theme.colors.primary }]}>
                    {tab.count}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <View style={[styles.searchBar, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
            <Ionicons name="search" size={18} color={theme.colors.textSecondary} style={{ marginRight: 8 }} />
            <TextInput
              style={[styles.searchInput, { color: theme.colors.textPrimary }]}
              placeholder={`Search ${activeTab.toLowerCase()}...`}
              placeholderTextColor={theme.colors.placeholder}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="none"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <Ionicons name="close-circle" size={18} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Top Pagination Paginator */}
        <View style={[styles.paginationHeader, { borderBottomColor: theme.colors.border }]}>
          {loading ? (
            <Skeleton width={150} height={13} radius={6} />
          ) : (
            <Text style={{ color: theme.colors.textSecondary, fontSize: 13, fontWeight: '600' }}>
              Showing {filteredData.length > 0 ? (activePage - 1) * itemsPerPage + 1 : 0}-{Math.min(filteredData.length, activePage * itemsPerPage)} of {filteredData.length} entries
            </Text>
          )}
          <View style={styles.paginationButtons}>
            <TouchableOpacity 
              disabled={activePage === 1} 
              onPress={() => setCurrentPage(p => Math.max(1, p - 1))}
              style={[styles.pageBtn, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface, opacity: activePage === 1 ? 0.4 : 1 }]}
            >
              <Ionicons name="chevron-back" size={16} color={theme.colors.textPrimary} />
            </TouchableOpacity>
            <View style={[styles.pageIndicator, { backgroundColor: theme.colors.primary + '15' }]}>
              <Text style={{ color: theme.colors.primary, fontWeight: 'bold', fontSize: 13 }}>
                {activePage} / {totalPages}
              </Text>
            </View>
            <TouchableOpacity 
              disabled={activePage === totalPages} 
              onPress={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              style={[styles.pageBtn, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface, opacity: activePage === totalPages ? 0.4 : 1 }]}
            >
              <Ionicons name="chevron-forward" size={16} color={theme.colors.textPrimary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Scrollable Responsive Table */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom + 20 }}
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
          {showSkeleton ? renderSkeletonTable() : (
          <ScrollView key={activeTab} horizontal showsHorizontalScrollIndicator={true} contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 10 }}>
            <View style={[styles.tableContainer, { borderColor: theme.colors.border }]}>

              {/* Table Header Row */}
              <View style={[styles.tableHeaderRow, { backgroundColor: theme.colors.primary + '15', borderBottomColor: theme.colors.border }]}>
                <View style={[styles.thContainer, { width: 60, alignItems: 'center' }]}>
                  <Text style={[styles.thText, { color: theme.colors.textPrimary, textAlign: 'center' }]}>S.No.</Text>
                </View>
                {activeTab === 'Schools' ? (
                  <>
                    <View style={[styles.thContainer, { width: 140 }]}>
                      <Text style={[styles.thText, { color: theme.colors.textPrimary }]}>School</Text>
                    </View>
                    <View style={[styles.thContainer, { width: 120 }]}>
                      <Text style={[styles.thText, { color: theme.colors.textPrimary }]}>Chairman</Text>
                    </View>
                    <View style={[styles.thContainer, { width: 170 }]}>
                      <Text style={[styles.thText, { color: theme.colors.textPrimary }]}>Email</Text>
                    </View>
                    <View style={[styles.thContainer, { width: 90 }]}>
                      <Text style={[styles.thText, { color: theme.colors.textPrimary }]}>State</Text>
                    </View>
                    <View style={[styles.thContainer, { width: 85 }]}>
                      <Text style={[styles.thText, { color: theme.colors.textPrimary }]}>Assoc.</Text>
                    </View>
                    <View style={[styles.thContainer, { width: 85 }]}>
                      <Text style={[styles.thText, { color: theme.colors.textPrimary }]}>Classes</Text>
                    </View>
                    <View style={[styles.thContainer, { width: 150 }]}>
                      <Text style={[styles.thText, { color: theme.colors.textPrimary }]}>Created By</Text>
                    </View>
                    <View style={[styles.thContainer, { width: 80, alignItems: 'center' }]}>
                      <Text style={[styles.thText, { color: theme.colors.textPrimary, textAlign: 'center' }]}>Actions</Text>
                    </View>
                  </>
                ) : activeTab === 'Trainers' ? (
                  <>
                    <View style={[styles.thContainer, { width: 120 }]}>
                      <Text style={[styles.thText, { color: theme.colors.textPrimary }]}>Trainer</Text>
                    </View>
                    <View style={[styles.thContainer, { width: 170 }]}>
                      <Text style={[styles.thText, { color: theme.colors.textPrimary }]}>Email</Text>
                    </View>
                    <View style={[styles.thContainer, { width: 140 }]}>
                      <Text style={[styles.thText, { color: theme.colors.textPrimary }]}>School</Text>
                    </View>
                    <View style={[styles.thContainer, { width: 120 }]}>
                      <Text style={[styles.thText, { color: theme.colors.textPrimary }]}>Leader</Text>
                    </View>
                    <View style={[styles.thContainer, { width: 100, alignItems: 'center' }]}>
                      <Text style={[styles.thText, { color: theme.colors.textPrimary, textAlign: 'center' }]}>Face Status</Text>
                    </View>
                    <View style={[styles.thContainer, { width: 150 }]}>
                      <Text style={[styles.thText, { color: theme.colors.textPrimary }]}>Created By</Text>
                    </View>
                    <View style={[styles.thContainer, { width: 100, alignItems: 'center' }]}>
                      <Text style={[styles.thText, { color: theme.colors.textPrimary, textAlign: 'center' }]}>Actions</Text>
                    </View>
                  </>
                ) : activeTab === 'Heads' ? (
                  <>
                    <View style={[styles.thContainer, { width: 140 }]}>
                      <Text style={[styles.thText, { color: theme.colors.textPrimary }]}>Head</Text>
                    </View>
                    <View style={[styles.thContainer, { width: 190 }]}>
                      <Text style={[styles.thText, { color: theme.colors.textPrimary }]}>Email</Text>
                    </View>
                    <View style={[styles.thContainer, { width: 130 }]}>
                      <Text style={[styles.thText, { color: theme.colors.textPrimary }]}>Role</Text>
                    </View>
                    <View style={[styles.thContainer, { width: 130 }]}>
                      <Text style={[styles.thText, { color: theme.colors.textPrimary }]}>Teams</Text>
                    </View>
                    <View style={[styles.thContainer, { width: 150 }]}>
                      <Text style={[styles.thText, { color: theme.colors.textPrimary }]}>Created By</Text>
                    </View>
                    <View style={[styles.thContainer, { width: 100, alignItems: 'center' }]}>
                      <Text style={[styles.thText, { color: theme.colors.textPrimary, textAlign: 'center' }]}>Actions</Text>
                    </View>
                  </>
                ) : (
                  <>
                    <View style={[styles.thContainer, { width: 130 }]}>
                      <Text style={[styles.thText, { color: theme.colors.textPrimary }]}>Leader Name</Text>
                    </View>
                    <View style={[styles.thContainer, { width: 150 }]}>
                      <Text style={[styles.thText, { color: theme.colors.textPrimary }]}>Role</Text>
                    </View>
                    <View style={[styles.thContainer, { width: 180 }]}>
                      <Text style={[styles.thText, { color: theme.colors.textPrimary }]}>Email</Text>
                    </View>
                    <View style={[styles.thContainer, { width: 150 }]}>
                      <Text style={[styles.thText, { color: theme.colors.textPrimary }]}>School</Text>
                    </View>
                    <View style={[styles.thContainer, { width: 130 }]}>
                      <Text style={[styles.thText, { color: theme.colors.textPrimary }]}>Team</Text>
                    </View>
                    <View style={[styles.thContainer, { width: 100, alignItems: 'center' }]}>
                      <Text style={[styles.thText, { color: theme.colors.textPrimary, textAlign: 'center' }]}>Face Status</Text>
                    </View>
                    <View style={[styles.thContainer, { width: 150 }]}>
                      <Text style={[styles.thText, { color: theme.colors.textPrimary }]}>Created By</Text>
                    </View>
                    <View style={[styles.thContainer, { width: 100, alignItems: 'center' }]}>
                      <Text style={[styles.thText, { color: theme.colors.textPrimary, textAlign: 'center' }]}>Actions</Text>
                    </View>
                  </>
                )}
              </View>

              {/* Table Data Rows */}
              {paginatedData.length === 0 ? (
                <View style={styles.tableEmpty}>
                  <Ionicons name="folder-open-outline" size={36} color={theme.colors.textSecondary} style={{ marginBottom: 8 }} />
                  <Text style={{ color: theme.colors.textSecondary }}>No records found</Text>
                </View>
              ) : (
                paginatedData.map((item, idx) => {
                  const isEven = idx % 2 === 0;
                  const rowBg = isEven ? theme.colors.surface : theme.colors.background;
                  const serialNumber = (activePage - 1) * itemsPerPage + idx + 1;
                  return (
                    <View key={item._id} style={[styles.tableRow, { backgroundColor: rowBg, borderBottomColor: theme.colors.border }]}>
                      <View style={[styles.tdContainer, { width: 60, alignItems: 'center' }]}>
                        <Text style={[styles.tdText, { color: theme.colors.textSecondary, fontWeight: 'bold', textAlign: 'center' }]}>{serialNumber}</Text>
                      </View>
                      {activeTab === 'Schools' ? (
                        <>
                          <View style={[styles.tdContainer, { width: 140 }]}>
                            <Text style={[styles.tdText, { color: theme.colors.textPrimary, fontWeight: '600' }]} numberOfLines={1}>{item.schoolId?.name || 'N/A'}</Text>
                          </View>
                          <View style={[styles.tdContainer, { width: 120 }]}>
                            <Text style={[styles.tdText, { color: theme.colors.textPrimary }]} numberOfLines={1}>{item.name}</Text>
                          </View>
                          <View style={[styles.tdContainer, { width: 170 }]}>
                            <Text style={[styles.tdText, { color: theme.colors.textSecondary }]} numberOfLines={1}>{item.email}</Text>
                          </View>
                          <View style={[styles.tdContainer, { width: 90 }]}>
                            <View style={[styles.badgeContainer, { backgroundColor: theme.colors.primary + '10', borderColor: theme.colors.primary + '30' }]}>
                              <Text style={[styles.badgeText, { color: theme.colors.primary }]} numberOfLines={1}>{item.schoolId?.state || 'N/A'}</Text>
                            </View>
                          </View>
                          <View style={[styles.tdContainer, { width: 85 }]}>
                            <View style={[styles.badgeContainer, { backgroundColor: '#F39C1210', borderColor: '#F39C1230' }]}>
                              <Text style={[styles.badgeText, { color: '#F39C12' }]} numberOfLines={1}>{item.schoolId?.associationYear || 'N/A'}</Text>
                            </View>
                          </View>
                          <View style={[styles.tdContainer, { width: 85 }]}>
                            <Text style={[styles.tdText, { color: theme.colors.textSecondary }]} numberOfLines={1}>{item.schoolId?.classCoverage || 'N/A'}</Text>
                          </View>
                          <View style={[styles.tdContainer, { width: 150 }]}>
                            <Text style={[styles.tdText, { color: theme.colors.textSecondary }]} numberOfLines={1}>{createdByText(item)}</Text>
                          </View>
                        </>
                      ) : activeTab === 'Trainers' ? (
                        <>
                          <View style={[styles.tdContainer, { width: 120 }]}>
                            <Text style={[styles.tdText, { color: theme.colors.textPrimary, fontWeight: '600' }]} numberOfLines={1}>{item.name}</Text>
                          </View>
                          <View style={[styles.tdContainer, { width: 170 }]}>
                            <Text style={[styles.tdText, { color: theme.colors.textSecondary }]} numberOfLines={1}>{item.email}</Text>
                          </View>
                          <View style={[styles.tdContainer, { width: 140 }]}>
                            <Text style={[styles.tdText, { color: theme.colors.textSecondary }]} numberOfLines={1}>{getSchoolName(item)}</Text>
                          </View>
                          <View style={[styles.tdContainer, { width: 120 }]}>
                            <View style={[styles.badgeContainer, { backgroundColor: '#27AE6010', borderColor: '#27AE6030' }]}>
                              <Text style={[styles.badgeText, { color: '#27AE60' }]} numberOfLines={1}>{item.teamLeaderId?.name || 'None'}</Text>
                            </View>
                          </View>
                          {/* Face Status Badge */}
                          <View style={[styles.tdContainer, { width: 100, alignItems: 'center' }]}>
                            {(item.facialRegistrationStatusV2 || item.facialRegistrationStatus) === 'approved' ? (
                              <View style={[styles.badgeContainer, { backgroundColor: '#10B98115', borderColor: '#10B981' }]}>
                                <Text style={[styles.badgeText, { color: '#10B981' }]}>Approved</Text>
                              </View>
                            ) : (item.facialRegistrationStatusV2 || item.facialRegistrationStatus) === 'pending' ? (
                              <View style={[styles.badgeContainer, { backgroundColor: '#F59E0B15', borderColor: '#F59E0B' }]}>
                                <Text style={[styles.badgeText, { color: '#D97706' }]}>Pending</Text>
                              </View>
                            ) : (
                              <View style={[styles.badgeContainer, { backgroundColor: theme.colors.border + '30', borderColor: theme.colors.border }]}>
                                <Text style={[styles.badgeText, { color: theme.colors.textSecondary }]}>None</Text>
                              </View>
                            )}
                          </View>
                          <View style={[styles.tdContainer, { width: 150 }]}>
                            <Text style={[styles.tdText, { color: theme.colors.textSecondary }]} numberOfLines={1}>{createdByText(item)}</Text>
                          </View>
                        </>
                      ) : activeTab === 'Heads' ? (
                        <>
                          <View style={[styles.tdContainer, { width: 140 }]}>
                            <Text style={[styles.tdText, { color: theme.colors.textPrimary, fontWeight: '600' }]} numberOfLines={1}>{item.name}</Text>
                          </View>
                          <View style={[styles.tdContainer, { width: 190 }]}>
                            <Text style={[styles.tdText, { color: theme.colors.textSecondary }]} numberOfLines={1}>{item.email}</Text>
                          </View>
                          <View style={[styles.tdContainer, { width: 130 }]}>
                            <View style={[styles.badgeContainer, { backgroundColor: theme.colors.primary + '10', borderColor: theme.colors.primary + '30' }]}>
                              <Text style={[styles.badgeText, { color: theme.colors.primary }]} numberOfLines={1}>{roleLabel(item.role)}</Text>
                            </View>
                          </View>
                          <View style={[styles.tdContainer, { width: 130 }]}>
                            <Text style={[styles.tdText, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                              {(item.teamIds || []).map(t => t?.name || '').filter(Boolean).join(', ') || `${item.teamIds?.length || 0} team(s)`}
                            </Text>
                          </View>
                          <View style={[styles.tdContainer, { width: 150 }]}>
                            <Text style={[styles.tdText, { color: theme.colors.textSecondary }]} numberOfLines={1}>{createdByText(item)}</Text>
                          </View>
                        </>
                      ) : (
                        <>
                          <View style={[styles.tdContainer, { width: 130 }]}>
                            <Text style={[styles.tdText, { color: theme.colors.textPrimary, fontWeight: '600' }]} numberOfLines={1}>{item.name}</Text>
                          </View>
                          <View style={[styles.tdContainer, { width: 150 }]}>
                            <View style={[styles.badgeContainer, { backgroundColor: '#8E44AD10', borderColor: '#8E44AD30' }]}>
                              <Text style={[styles.badgeText, { color: '#8E44AD' }]} numberOfLines={1}>{roleLabel(item.role)}</Text>
                            </View>
                          </View>
                          <View style={[styles.tdContainer, { width: 180 }]}>
                            <Text style={[styles.tdText, { color: theme.colors.textSecondary }]} numberOfLines={1}>{item.email}</Text>
                          </View>
                          <View style={[styles.tdContainer, { width: 150 }]}>
                            <Text style={[styles.tdText, { color: theme.colors.textSecondary }]} numberOfLines={1}>{getSchoolName(item)}</Text>
                          </View>
                          <View style={[styles.tdContainer, { width: 130 }]}>
                            <Text style={[styles.tdText, { color: theme.colors.textSecondary }]} numberOfLines={1}>{item.teamId?.name || 'None'}</Text>
                          </View>
                          {/* Face Status Badge */}
                          <View style={[styles.tdContainer, { width: 100, alignItems: 'center' }]}>
                            {(item.facialRegistrationStatusV2 || item.facialRegistrationStatus) === 'approved' ? (
                              <View style={[styles.badgeContainer, { backgroundColor: '#10B98115', borderColor: '#10B981' }]}>
                                <Text style={[styles.badgeText, { color: '#10B981' }]}>Approved</Text>
                              </View>
                            ) : (item.facialRegistrationStatusV2 || item.facialRegistrationStatus) === 'pending' ? (
                              <View style={[styles.badgeContainer, { backgroundColor: '#F59E0B15', borderColor: '#F59E0B' }]}>
                                <Text style={[styles.badgeText, { color: '#D97706' }]}>Pending</Text>
                              </View>
                            ) : (
                              <View style={[styles.badgeContainer, { backgroundColor: theme.colors.border + '30', borderColor: theme.colors.border }]}>
                                <Text style={[styles.badgeText, { color: theme.colors.textSecondary }]}>None</Text>
                              </View>
                            )}
                          </View>
                          <View style={[styles.tdContainer, { width: 150 }]}>
                            <Text style={[styles.tdText, { color: theme.colors.textSecondary }]} numberOfLines={1}>{createdByText(item)}</Text>
                          </View>
                        </>
                      )}

                      {/* Action buttons inside the row cell */}
                      <View style={[styles.tdActions, { width: 100 }]}>
                        <TouchableOpacity 
                          style={[styles.miniActionBtn, { backgroundColor: theme.colors.primary + '15', borderColor: theme.colors.primary }]}
                          onPress={() => handleEditPress(item)}
                        >
                          <Ionicons name="pencil" size={14} color={theme.colors.primary} />
                        </TouchableOpacity>
                        {/* Delete-face button for field staff who actually have a
                            registration on record (any school). */}
                        {activeTab !== 'Schools' && (item.faceRegistrations?.length > 0) && (
                          <TouchableOpacity
                            style={[styles.miniActionBtn, { backgroundColor: '#F59E0B15', borderColor: '#F59E0B' }]}
                            onPress={() => handleDeleteFaceRegistration(item)}
                          >
                            <Ionicons name="scan" size={14} color="#D97706" />
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity 
                          style={[styles.miniActionBtn, { backgroundColor: '#FF444415', borderColor: '#FF4444' }]}
                          onPress={() => handleDeletePress(item._id, item.name)}
                        >
                          <Ionicons name="trash" size={14} color="#FF4444" />
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })
              )}

            </View>
          </ScrollView>
          )}

          {/* Active schools with no chairman login — typically just restored. */}
          {activeTab === 'Schools' && !showSkeleton && loginlessSchools.length > 0 && (
            <View style={{ paddingHorizontal: 20, paddingBottom: 4 }}>
              <View style={[styles.archiveCard, { backgroundColor: '#F59E0B10', borderColor: '#F59E0B' }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                  <Ionicons name="alert-circle-outline" size={18} color="#D97706" style={{ marginRight: 8 }} />
                  <Text style={{ color: theme.colors.textPrimary, fontWeight: '700', fontSize: 14 }}>
                    Schools Without a Login ({loginlessSchools.length})
                  </Text>
                </View>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginBottom: 10, lineHeight: 18 }}>
                  These schools are active and can be assigned to staff, but nobody can sign in as them. Create a
                  Chairman login for each from the admin portal.
                </Text>
                {loginlessSchools.map(s => (
                  <Text key={s._id} style={{ color: theme.colors.textPrimary, fontSize: 13, marginBottom: 3 }}>
                    • {s.name}{s.state ? ` — ${s.state}` : ''}
                  </Text>
                ))}
              </View>
            </View>
          )}

          {/* Archived schools — deleting a school login never destroys the work
              done there, so the school is kept here and can be brought back. */}
          {activeTab === 'Schools' && !showSkeleton && archivedSchools.length > 0 && (
            <View style={{ paddingHorizontal: 20, paddingBottom: 10 }}>
              <TouchableOpacity
                style={[styles.archiveHeader, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
                onPress={() => setShowArchived(v => !v)}
                activeOpacity={0.8}
              >
                <Ionicons name="archive-outline" size={18} color={theme.colors.textSecondary} style={{ marginRight: 8 }} />
                <Text style={{ flex: 1, color: theme.colors.textPrimary, fontWeight: '700', fontSize: 14 }}>
                  Archived Schools ({archivedSchools.length})
                </Text>
                <Ionicons name={showArchived ? 'chevron-up' : 'chevron-down'} size={18} color={theme.colors.textSecondary} />
              </TouchableOpacity>

              {showArchived && (
                <>
                  <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 8, marginBottom: 10, lineHeight: 18 }}>
                    These schools had their login removed. Nothing they hold was deleted — the activities, visit reports
                    and attendance logged there are all intact, and everyone who worked there keeps the school in their
                    profile history.
                  </Text>

                  {archivedSchools.map(school => (
                    <View
                      key={school._id}
                      style={[styles.archiveCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: theme.colors.textPrimary, fontWeight: '700', fontSize: 15 }}>{school.name}</Text>
                          <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 }}>
                            {[school.state, school.associationYear, school.classCoverage].filter(Boolean).join(' · ')}
                          </Text>
                          <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 4 }}>
                            Archived {school.deletedAt ? new Date(school.deletedAt).toLocaleDateString() : '—'}
                            {school.archivedChairman?.name ? ` · login was ${school.archivedChairman.name}` : ''}
                          </Text>
                        </View>
                        <TouchableOpacity
                          style={[styles.restoreBtn, { borderColor: theme.colors.primary, opacity: restoringSchoolId === school._id ? 0.6 : 1 }]}
                          onPress={() => handleRestoreSchool(school)}
                          disabled={restoringSchoolId === school._id}
                        >
                          {restoringSchoolId === school._id ? (
                            <ActivityIndicator size="small" color={theme.colors.primary} />
                          ) : (
                            <>
                              <Ionicons name="refresh" size={14} color={theme.colors.primary} style={{ marginRight: 5 }} />
                              <Text style={{ color: theme.colors.primary, fontWeight: '700', fontSize: 12 }}>Restore</Text>
                            </>
                          )}
                        </TouchableOpacity>
                      </View>

                      {/* Proof that nothing was thrown away with the login. */}
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 }}>
                        {[
                          { label: 'activities', value: school.preserved?.activities || 0 },
                          { label: 'visit reports', value: school.preserved?.visitReports || 0 },
                          { label: 'attendance records', value: school.preserved?.attendance || 0 },
                        ].map(item => (
                          <View
                            key={item.label}
                            style={{ backgroundColor: '#10B98115', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, marginRight: 6, marginBottom: 6 }}
                          >
                            <Text style={{ color: '#10B981', fontSize: 11, fontWeight: '600' }}>
                              {item.value} {item.label} kept
                            </Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  ))}
                </>
              )}
            </View>
          )}
        </ScrollView>

        {/* Edit Modal */}
        <Modal
          visible={!!editingUser}
          transparent
          animationType="slide"
          statusBarTranslucent
          navigationBarTranslucent
          onRequestClose={() => setEditingUser(null)}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContainer, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
              <Text style={[styles.modalTitle, { color: theme.colors.textPrimary }]}>Edit Details</Text>
              
              <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: Platform.OS === 'ios' ? 450 : 500, marginVertical: 12 }}>
                
                <Text style={[styles.inputLabel, { color: theme.colors.textSecondary }]}>Name</Text>
                <TextInput
                  style={[styles.input, { borderColor: theme.colors.border, color: theme.colors.textPrimary, backgroundColor: theme.colors.background }]}
                  value={editForm.name}
                  onChangeText={(text) => setEditForm({ ...editForm, name: text })}
                  placeholder="Enter name"
                  placeholderTextColor={theme.colors.placeholder}
                />

                <Text style={[styles.inputLabel, { color: theme.colors.textSecondary }]}>Email</Text>
                <TextInput
                  style={[styles.input, { borderColor: theme.colors.border, color: theme.colors.textPrimary, backgroundColor: theme.colors.background }]}
                  value={editForm.email}
                  onChangeText={(text) => setEditForm({ ...editForm, email: text })}
                  placeholder="Enter email"
                  placeholderTextColor={theme.colors.placeholder}
                  autoCapitalize="none"
                  keyboardType="email-address"
                />

                <Text style={[styles.inputLabel, { color: theme.colors.textSecondary }]}>New Password (Optional)</Text>
                <TextInput
                  style={[styles.input, { borderColor: theme.colors.border, color: theme.colors.textPrimary, backgroundColor: theme.colors.background }]}
                  value={editForm.password}
                  onChangeText={(text) => setEditForm({ ...editForm, password: text })}
                  placeholder="Leave blank to keep current"
                  placeholderTextColor={theme.colors.placeholder}
                  secureTextEntry
                />

                {editingUser?.role === 'trainer' && (
                  <>
                    <MultiSelectField
                      label="Assign School(s)"
                      data={schools}
                      selectedIds={editForm.schoolIds}
                      onChange={(ids) => setEditForm({ ...editForm, schoolIds: ids })}
                      placeholder="Select one or more schools"
                    />
                    <View style={{ height: 12 }} />
                    <CustomDropdown
                      label="Assign Team Leader"
                      data={teamLeaders}
                      selectedValue={editForm.teamLeaderId}
                      onSelect={(item) => setEditForm({ ...editForm, teamLeaderId: item._id })}
                      placeholder="Select a team leader"
                    />
                    <View style={{ height: 12 }} />
                    <CustomDropdown
                      label="Assign Team"
                      data={teams}
                      selectedValue={editForm.teamId}
                      onSelect={(item) => setEditForm({ ...editForm, teamId: item._id })}
                      placeholder="Select a team"
                    />
                  </>
                )}

                {LEADER_ROLES.includes(editingUser?.role) && (
                  <>
                    <MultiSelectField
                      label="Assign School(s)"
                      data={schools}
                      selectedIds={editForm.schoolIds}
                      onChange={(ids) => setEditForm({ ...editForm, schoolIds: ids })}
                      placeholder="Select one or more schools"
                    />
                    <View style={{ height: 12 }} />
                    <CustomDropdown
                      label="Assign Team"
                      data={teams}
                      selectedValue={editForm.teamId}
                      onSelect={(item) => setEditForm({ ...editForm, teamId: item._id })}
                      placeholder="Select a team"
                    />
                  </>
                )}

                {HEAD_ROLES.includes(editingUser?.role) && (
                  <>
                    {/* Heads only: work anywhere, attached to no school.
                        Switching it on here detaches their schools (the stint
                        stays in their school history) and takes effect the
                        moment Save is pressed — from then on they can check in
                        and out from anywhere, with no geofence. Switching it
                        off brings the school picker back and asks for schools
                        again, because a head with neither is not a valid state. */}
                    <TouchableOpacity
                      activeOpacity={0.8}
                      onPress={() => setEditForm({
                        ...editForm,
                        anonymousLocation: !editForm.anonymousLocation,
                        schoolIds: !editForm.anonymousLocation ? [] : (editForm.schoolIds || []),
                      })}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'flex-start',
                        borderWidth: 1,
                        borderRadius: 10,
                        padding: 14,
                        marginTop: 12,
                        marginBottom: 4,
                        borderColor: editForm.anonymousLocation ? theme.colors.primary : theme.colors.border,
                        backgroundColor: editForm.anonymousLocation ? theme.colors.primary + '10' : 'transparent',
                      }}
                    >
                      <Ionicons
                        name={editForm.anonymousLocation ? 'checkbox' : 'square-outline'}
                        size={22}
                        color={editForm.anonymousLocation ? theme.colors.primary : theme.colors.textSecondary}
                        style={{ marginRight: 10, marginTop: 1 }}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.colors.textPrimary, fontWeight: '700', fontSize: 14 }}>Anonymous Location</Text>
                        <Text style={{ color: theme.colors.textSecondary, fontSize: 12.5, marginTop: 3, lineHeight: 18 }}>
                          No school assigned — checks in and out from anywhere, with no location check.
                        </Text>
                      </View>
                    </TouchableOpacity>

                    {!editForm.anonymousLocation && (
                      <MultiSelectField
                        label="Assign School(s)"
                        data={schools}
                        selectedIds={editForm.schoolIds}
                        onChange={(ids) => setEditForm({ ...editForm, schoolIds: ids })}
                        placeholder="Select one or more schools"
                      />
                    )}
                    <Text style={[styles.inputLabel, { color: theme.colors.textSecondary, marginTop: 12 }]}>Assign Team(s)</Text>
                    <TouchableOpacity
                      style={[styles.input, { borderColor: theme.colors.border, backgroundColor: theme.colors.background, justifyContent: 'center' }]}
                      onPress={() => setTeamModalVisible(true)}
                    >
                      <Text style={{ color: editForm.teamIds.length ? theme.colors.textPrimary : theme.colors.placeholder }}>
                        {editForm.teamIds.length
                          ? teams.filter(t => editForm.teamIds.includes(t._id)).map(t => t.name).join(', ')
                          : 'Select one or more teams'}
                      </Text>
                    </TouchableOpacity>
                    <TeamMultiSelectModal
                      visible={teamModalVisible}
                      teams={teams}
                      selectedIds={editForm.teamIds}
                      onClose={() => setTeamModalVisible(false)}
                      onSelect={(ids) => setEditForm({ ...editForm, teamIds: ids })}
                    />
                  </>
                )}

                {editingUser?.role === 'chairman' && (
                  <>
                    <Text style={[styles.inputLabel, { color: theme.colors.textSecondary, marginTop: 12 }]}>School Name</Text>
                    <TextInput
                      style={[styles.input, { borderColor: theme.colors.border, color: theme.colors.textPrimary, backgroundColor: theme.colors.background }]}
                      value={editForm.schoolName}
                      onChangeText={(text) => setEditForm({ ...editForm, schoolName: text })}
                      placeholder="Enter school name"
                      placeholderTextColor={theme.colors.placeholder}
                    />

                    <Text style={[styles.inputLabel, { color: theme.colors.textSecondary }]}>Association Year</Text>
                    <TextInput
                      style={[styles.input, { borderColor: theme.colors.border, color: theme.colors.textPrimary, backgroundColor: theme.colors.background }]}
                      value={editForm.associationYear}
                      onChangeText={(text) => setEditForm({ ...editForm, associationYear: text })}
                      placeholder="e.g. 1st Year, 2nd Year"
                      placeholderTextColor={theme.colors.placeholder}
                    />

                    <Text style={[styles.inputLabel, { color: theme.colors.textSecondary }]}>Class Coverage</Text>
                    <TextInput
                      style={[styles.input, { borderColor: theme.colors.border, color: theme.colors.textPrimary, backgroundColor: theme.colors.background }]}
                      value={editForm.classCoverage}
                      onChangeText={(text) => setEditForm({ ...editForm, classCoverage: text })}
                      placeholder="e.g. 8th to 10th"
                      placeholderTextColor={theme.colors.placeholder}
                    />
                  </>
                )}

              </ScrollView>

              <View style={styles.modalButtons}>
                <TouchableOpacity 
                  style={[styles.modalBtn, styles.modalSecondaryBtn, { borderColor: theme.colors.border }]} 
                  onPress={() => setEditingUser(null)}
                >
                  <Text style={[styles.modalBtnText, { color: theme.colors.textPrimary }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.modalBtn, styles.modalPrimaryBtn, { backgroundColor: theme.colors.primary }]} 
                  onPress={handleUpdate}
                  disabled={updating}
                >
                  {updating ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={[styles.modalBtnText, { color: '#FFF' }]}>Save Changes</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Delete Face Registration — school picker, then confirmation */}
        <Modal
          visible={!!faceTarget}
          transparent
          animationType="fade"
          statusBarTranslucent
          navigationBarTranslucent
          onRequestClose={closeFaceModal}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.faceModal, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>

              {/* Header */}
              <View style={styles.faceModalHeader}>
                {faceStep === 'confirm' && faceTarget?.registrations.length > 1 ? (
                  <TouchableOpacity
                    onPress={() => setFaceStep('select')}
                    disabled={faceDeleting}
                    style={[styles.faceIconBtn, { borderColor: theme.colors.border }]}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="chevron-back" size={18} color={theme.colors.textPrimary} />
                  </TouchableOpacity>
                ) : (
                  <View style={styles.faceIconBtn} />
                )}

                <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: 8 }}>
                  <Text style={[styles.faceModalTitle, { color: theme.colors.textPrimary }]} numberOfLines={1}>
                    {faceStep === 'select' ? 'Select School' : 'Delete Face Registration'}
                  </Text>
                  <Text style={[styles.faceModalSubtitle, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                    {faceTarget?.user?.name}
                  </Text>
                </View>

                <TouchableOpacity
                  onPress={closeFaceModal}
                  disabled={faceDeleting}
                  style={[styles.faceIconBtn, { borderColor: theme.colors.border }]}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close" size={18} color={theme.colors.textSecondary} />
                </TouchableOpacity>
              </View>

              <View style={[styles.faceDivider, { backgroundColor: theme.colors.border }]} />

              {faceStep === 'select' ? (
                <>
                  <Text style={[styles.faceHelpText, { color: theme.colors.textSecondary }]}>
                    This person is registered at {faceTarget?.registrations.length} schools. Choose which
                    registration to delete — the others stay untouched.
                  </Text>

                  <ScrollView style={{ maxHeight: 300 }} showsVerticalScrollIndicator={false}>
                    {(faceTarget?.registrations || []).map((reg) => {
                      const approved = reg.status === 'approved';
                      const statusColor = approved ? '#10B981' : '#F59E0B';
                      return (
                        <TouchableOpacity
                          key={reg.id}
                          style={[styles.faceSchoolRow, { borderColor: theme.colors.border, backgroundColor: theme.colors.background }]}
                          onPress={() => {
                            setFaceSelection(reg);
                            setFaceStep('confirm');
                          }}
                          activeOpacity={0.75}
                        >
                          <View style={[styles.faceSchoolIcon, { backgroundColor: statusColor + '18' }]}>
                            <Ionicons name="business" size={16} color={statusColor} />
                          </View>
                          <View style={{ flex: 1, marginRight: 8 }}>
                            <Text style={[styles.faceSchoolName, { color: theme.colors.textPrimary }]} numberOfLines={2}>
                              {reg.name}
                            </Text>
                            <Text style={[styles.faceSchoolStatus, { color: statusColor }]}>
                              {approved ? 'Approved' : 'Pending approval'}
                            </Text>
                            <ApprovedBy record={reg} compact style={{ marginTop: 5 }} />
                          </View>
                          <Ionicons name="chevron-forward" size={18} color={theme.colors.textSecondary} />
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>

                  <TouchableOpacity
                    style={[styles.modalBtn, styles.modalSecondaryBtn, styles.faceCancelBtn, { borderColor: theme.colors.border, marginTop: 14 }]}
                    onPress={closeFaceModal}
                  >
                    <Text style={[styles.modalBtnText, { color: theme.colors.textPrimary }]}>Cancel</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <View style={styles.faceWarnIconWrap}>
                    <View style={styles.faceWarnIcon}>
                      <Ionicons name="scan" size={30} color="#EF4444" />
                    </View>
                  </View>

                  <Text style={[styles.faceConfirmText, { color: theme.colors.textSecondary }]}>
                    Delete the face registration of{' '}
                    <Text style={{ color: theme.colors.textPrimary, fontWeight: '700' }}>{faceTarget?.user?.name}</Text>
                    {' '}for{' '}
                    <Text style={{ color: theme.colors.textPrimary, fontWeight: '700' }}>{faceSelection?.name}</Text>?
                  </Text>

                  <View style={[styles.faceNoteBox, { borderColor: '#F59E0B55', backgroundColor: '#F59E0B12' }]}>
                    <Ionicons name="information-circle" size={16} color="#D97706" style={{ marginRight: 8 }} />
                    <Text style={[styles.faceNoteText, { color: theme.colors.textSecondary }]}>
                      They will not be able to mark attendance at this school until they register their
                      face there again.
                      {faceTarget?.registrations.length > 1
                        ? ' Registrations at their other schools are not affected.'
                        : ''}
                    </Text>
                  </View>

                  <View style={styles.modalButtons}>
                    <TouchableOpacity
                      style={[styles.modalBtn, styles.modalSecondaryBtn, { borderColor: theme.colors.border }]}
                      onPress={closeFaceModal}
                      disabled={faceDeleting}
                    >
                      <Text style={[styles.modalBtnText, { color: theme.colors.textPrimary }]}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.modalBtn, { backgroundColor: '#EF4444' }]}
                      onPress={confirmDeleteFaceRegistration}
                      disabled={faceDeleting}
                    >
                      {faceDeleting
                        ? <ActivityIndicator size="small" color="#FFF" />
                        : <Text style={[styles.modalBtnText, { color: '#FFF' }]}>Delete</Text>}
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          </View>
        </Modal>

        {/* Custom Alerts */}
        <CustomAlert
          visible={alertConfig.visible}
          title={alertConfig.title}
          message={alertConfig.message}
          type={alertConfig.type}
          onDismiss={() => setAlertConfig({ ...alertConfig, visible: false })}
          buttons={alertConfig.buttons}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  headerTitleContainer: { flexDirection: 'row', alignItems: 'center' },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12
  },
  headerTitle: { fontSize: 20, fontWeight: 'bold' },
  headerSubtitle: { fontSize: 12, fontWeight: '500', marginTop: 1 },
  headerCountPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 16,
  },
  headerCountText: { fontSize: 14, fontWeight: '800' },
  tabsScroll: { flexGrow: 0, flexShrink: 0 },
  tabs: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 10,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 22,
    borderWidth: 1,
  },
  tabActiveShadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 4,
  },
  tabCount: {
    marginLeft: 8,
    minWidth: 22,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabCountText: { fontSize: 11, fontWeight: '800' },
  tabText: { fontSize: 13, fontWeight: '600' },
  searchContainer: { paddingHorizontal: 20, paddingTop: 8 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 48,
  },
  searchInput: { flex: 1, fontSize: 14, height: '100%' },
  paginationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  paginationButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pageBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageIndicator: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tableContainer: {
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  tableHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 10,
  },
  thContainer: {
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  thText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  tdContainer: {
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  tdText: {
    fontSize: 13,
  },
  badgeContainer: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  tdActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 6,
  },
  miniActionBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tableEmpty: {
    padding: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  archiveHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  archiveCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  restoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 88,
  },
  emptyContainer: {
    alignItems: 'center',
    marginTop: 60
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center'
  },
  modalContainer: {
    width: '90%',
    maxWidth: 450,
    borderRadius: 20,
    padding: 24,
    borderWidth: 1
  },
  modalTitle: { fontSize: 18, fontWeight: 'bold', textAlign: 'center', marginBottom: 10 },
  inputLabel: { fontSize: 12, fontWeight: '600', marginBottom: 6, marginTop: 10 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 44,
    fontSize: 14,
    marginBottom: 10
  },
  modalButtons: { flexDirection: 'row', gap: 12, marginTop: 16 },
  modalBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  modalPrimaryBtn: {},
  modalSecondaryBtn: { borderWidth: 1 },
  modalBtnText: { fontWeight: '700', fontSize: 14 },

  // Delete face registration modal
  faceModal: {
    width: '90%',
    maxWidth: 440,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
  },
  faceModalHeader: { flexDirection: 'row', alignItems: 'center' },
  faceIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  faceModalTitle: { fontSize: 16, fontWeight: '800', textAlign: 'center' },
  faceModalSubtitle: { fontSize: 12, fontWeight: '600', marginTop: 2, textAlign: 'center' },
  faceDivider: { height: 1, marginVertical: 14, opacity: 0.7 },
  faceHelpText: { fontSize: 13, lineHeight: 19, marginBottom: 12 },
  faceSchoolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 10,
  },
  faceSchoolIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  faceSchoolName: { fontSize: 14, fontWeight: '700' },
  faceSchoolStatus: { fontSize: 11, fontWeight: '700', marginTop: 2 },
  // Standalone (non-row) button — cancel flex:1 so it keeps its own height.
  faceCancelBtn: { flex: 0, alignSelf: 'stretch' },
  faceWarnIconWrap: { alignItems: 'center', marginBottom: 14 },
  faceWarnIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#EF444418',
    alignItems: 'center',
    justifyContent: 'center',
  },
  faceConfirmText: { fontSize: 14, lineHeight: 21, textAlign: 'center' },
  faceNoteBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginTop: 16,
  },
  faceNoteText: { flex: 1, fontSize: 12, lineHeight: 18 },
});
