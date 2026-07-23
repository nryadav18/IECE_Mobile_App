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
import CustomDropdown from '../components/CustomDropdown';
import MultiSelectField from '../components/MultiSelectField';
import TeamMultiSelectModal from '../components/TeamMultiSelectModal';
import { HEAD_ROLES, LEADER_ROLES, roleLabel } from '../utils/roles';

export default function ManageScreen({ navigation }) {
  const { theme } = useContext(ThemeContext);
  const insets = useSafeAreaInsets();

  const [activeTab, setActiveTab] = useState('Schools'); // 'Schools' | 'Trainers' | 'TeamLeaders' | 'Heads'

  const [schools, setSchools] = useState([]);
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
      const [schoolsRes, tlsRes, trainersRes, chairmenRes, teamsRes, headsRes] = await Promise.all([
        api.get('/admin/schools'),
        api.get('/admin/team-leaders'),
        api.get('/admin/users?role=trainer&limit=1000'),
        api.get('/admin/users?role=chairman&limit=1000'),
        api.get('/admin/teams'),
        api.get('/admin/users?role=zonal_head,cluster_head,regional_head&limit=1000')
      ]);
      setSchools(schoolsRes.data.data);
      setTeamLeaders(tlsRes.data.data);
      setTrainers(trainersRes.data.data);
      setChairmen(chairmenRes.data.data);
      setTeams(teamsRes.data.data);
      setHeads(headsRes.data.data);
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
    
    setUpdating(true);
    try {
      const payload = {
        name: editForm.name,
        email: editForm.email,
        schoolIds: editForm.schoolIds,
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

  const handleDeleteFaceRegistration = (id, name) => {
    showAlert(
      'Reset Face Registration',
      `Are you sure you want to delete the facial registration for ${name}? They will need to register again.`,
      'warning',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          type: 'primary',
          onPress: async () => {
            try {
              await api.delete(`/admin/face-registration/${id}`);
              showAlert('Success', `Face registration for ${name} has been reset.`, 'success');
              fetchData();
            } catch (err) {
              showAlert('Error', 'Failed to delete face registration.', 'error');
            }
          }
        }
      ]
    );
  };

  const handleDeletePress = (id, label) => {
    showAlert(
      'Confirm Deletion',
      `Are you sure you want to permanently delete ${label}? If this is a Chairman, their associated School, visit reports, and activities will be deleted too.`,
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

  const getSchoolName = (user) => {
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
  const skeletonColumns = {
    Schools: [60, 140, 120, 170, 90, 85, 85],
    Trainers: [60, 120, 170, 140, 120, 100],
    Heads: [60, 140, 190, 130, 130],
    TeamLeaders: [60, 130, 150, 180, 150, 130, 100],
  }[activeTab] || [60, 140, 170, 130, 120];

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
                        {/* Show delete-face button only for trainers and team leaders who have a face registered */}
                        {(activeTab === 'Trainers' || activeTab === 'TeamLeaders') && (item.facialRegistrationStatusV2 || item.facialRegistrationStatus) !== 'none' && (
                          <TouchableOpacity
                            style={[styles.miniActionBtn, { backgroundColor: '#F59E0B15', borderColor: '#F59E0B' }]}
                            onPress={() => handleDeleteFaceRegistration(item._id, item.name)}
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
        </ScrollView>

        {/* Edit Modal */}
        <Modal
          visible={!!editingUser}
          transparent
          animationType="slide"
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
                    <MultiSelectField
                      label="Assign School(s)"
                      data={schools}
                      selectedIds={editForm.schoolIds}
                      onChange={(ids) => setEditForm({ ...editForm, schoolIds: ids })}
                      placeholder="Select one or more schools"
                    />
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
  modalBtnText: { fontWeight: '700', fontSize: 14 }
});
