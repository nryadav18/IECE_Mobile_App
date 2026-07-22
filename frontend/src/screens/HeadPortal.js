import React, { useContext, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, RefreshControl, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { MotiView } from 'moti';
import { ThemeContext } from '../context/ThemeContext';
import { AuthContext } from '../context/AuthContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import api from '../services/api';
import CustomAlert from '../components/CustomAlert';
import SidebarMenu from '../components/SidebarMenu';
import VisitReportForm from '../components/VisitReportForm';
import VisitReportDetail from '../components/VisitReportDetail';
import { roleLabel } from '../utils/roles';

const TAB_ITEMS = [
  { key: 'Home', label: 'Home', icon: 'home-outline' },
  { key: 'MyTeams', label: 'My Teams', icon: 'people-outline' },
  { key: 'LogVisit', label: 'Log Visit', icon: 'document-text-outline' },
];

// Members of a team, grouped by seniority for a clean drill-in view.
const MEMBER_ROLE_QUERY = 'team_leader,trainee_team_leader,trainer';

const statusColor = (status, theme) => {
  if (status === 'approved') return '#4CAF50';
  if (status === 'rejected') return '#F44336';
  return '#F59E0B'; // pending
};

export default function HeadPortal({ navigation, route }) {
  const { theme } = useContext(ThemeContext);
  const { user, logout } = useContext(AuthContext);
  const insets = useSafeAreaInsets();
  const sidebarRef = React.useRef(null);

  const [activeTab, setActiveTab] = useState(route?.params?.initialTab || 'Home');
  const [activities, setActivities] = useState([]);
  const [teams, setTeams] = useState([]);
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [members, setMembers] = useState([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [allMembers, setAllMembers] = useState([]); // everyone across the head's teams (report targets)
  const [reports, setReports] = useState([]);
  const [reportFormVisible, setReportFormVisible] = useState(false);
  const [reportToView, setReportToView] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [alertConfig, setAlertConfig] = useState({ visible: false, title: '', message: '', type: 'info', buttons: [] });

  const fetchData = async () => {
    try {
      const [activitiesRes, teamsRes, reportsRes] = await Promise.allSettled([
        api.get('/activities'),
        api.get('/admin/teams'),
        api.get('/reports'),
      ]);
      if (activitiesRes.status === 'fulfilled') setActivities(activitiesRes.value.data.data || []);
      if (reportsRes.status === 'fulfilled') setReports(reportsRes.value.data.data || []);

      let teamList = [];
      if (teamsRes.status === 'fulfilled') {
        teamList = teamsRes.value.data.data || [];
        setTeams(teamList);
      }

      // Gather every member across the head's teams — these are the people the
      // head can log a visit report on.
      if (teamList.length) {
        const perTeam = await Promise.allSettled(
          teamList.map(t => api.get(`/admin/users?role=${MEMBER_ROLE_QUERY}&teamId=${t._id}&limit=200`))
        );
        const merged = {};
        perTeam.forEach(r => {
          if (r.status === 'fulfilled') {
            (r.value.data.data || []).forEach(u => { merged[u._id] = u; });
          }
        });
        setAllMembers(Object.values(merged));
      } else {
        setAllMembers([]);
      }
    } catch (err) {
      console.log('HeadPortal fetchData error', err?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
  }, []);

  const toggleStar = (activity) => {
    const willStar = !activity.isStarred;
    setAlertConfig({
      visible: true,
      title: willStar ? 'Mark as Star Activity?' : 'Remove Star?',
      message: willStar
        ? `Star "${activity.name}"? The uploader will be notified and it will show as a Star Activity to everyone.`
        : `Remove the star from "${activity.name}"?`,
      type: 'warning',
      buttons: [
        { text: 'Cancel', style: 'cancel' },
        {
          text: willStar ? 'Star' : 'Remove',
          onPress: async () => {
            // Optimistic update.
            setActivities(prev => prev.map(a => a._id === activity._id ? { ...a, isStarred: willStar } : a));
            try {
              await api.put(`/activities/${activity._id}/star`, { starred: willStar });
            } catch (err) {
              // Revert on failure.
              setActivities(prev => prev.map(a => a._id === activity._id ? { ...a, isStarred: !willStar } : a));
              setAlertConfig({ visible: true, title: 'Error', message: 'Could not update the star. Try again.', type: 'error', buttons: [] });
            }
          },
        },
      ],
    });
  };

  const openTeam = async (team) => {
    setSelectedTeam(team);
    setMembersLoading(true);
    try {
      const res = await api.get(`/admin/users?role=${MEMBER_ROLE_QUERY}&teamId=${team._id}&limit=200`);
      setMembers(res.data.data || []);
    } catch (err) {
      setMembers([]);
      setAlertConfig({ visible: true, title: 'Error', message: 'Could not load team members.', type: 'error', buttons: [] });
    } finally {
      setMembersLoading(false);
    }
  };

  const headerLabel = TAB_ITEMS.find(t => t.key === activeTab)?.label || 'Head';

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      {/* Fixed Header */}
      <View style={{ backgroundColor: theme.colors.background, paddingTop: insets.top }}>
        <View style={{ paddingHorizontal: 20, paddingTop: 4 }}>
          <View style={[styles.header, { borderBottomColor: theme.colors.border }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
              <TouchableOpacity
                style={[styles.menuBtn, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}
                onPress={() => sidebarRef.current?.open()}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="menu" size={24} color={theme.colors.textPrimary} />
              </TouchableOpacity>
              <View style={{ marginLeft: 14, flex: 1 }}>
                <Text style={[styles.title, { color: theme.colors.textPrimary }]} numberOfLines={1}>{headerLabel}</Text>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 1 }}>{roleLabel(user?.role)} Portal</Text>
              </View>
            </View>
          </View>
        </View>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} colors={[theme.colors.primary]} progressBackgroundColor={theme.colors.surface} />
          }
        >
          {/* ---------- HOME: activity feed of all my teams + my school ---------- */}
          <View style={{ display: activeTab === 'Home' ? 'flex' : 'none' }}>
            <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}>Team Activity Feed</Text>
            <Text style={{ color: theme.colors.textSecondary, marginBottom: 16, fontSize: 13 }}>
              Activities from everyone across your teams and your school.
            </Text>
            {activities.length === 0 ? (
              <View style={{ alignItems: 'center', marginTop: 40 }}>
                <Ionicons name="calendar-outline" size={48} color={theme.colors.border} />
                <Text style={{ color: theme.colors.textSecondary, marginTop: 12 }}>No activities yet.</Text>
              </View>
            ) : (
              activities.map(act => (
                <TouchableOpacity
                  key={act._id}
                  style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: act.isStarred ? '#F5B301' : theme.colors.border }]}
                  onPress={() => navigation.navigate('ActivityDetails', { activityId: act._id })}
                  activeOpacity={0.8}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <Text style={{ color: theme.colors.textPrimary, fontSize: 15, fontWeight: '700', flex: 1, marginRight: 8 }}>{act.name}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={{ backgroundColor: statusColor(act.status) + '20', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                        <Text style={{ color: statusColor(act.status), fontSize: 11, fontWeight: '700', textTransform: 'capitalize' }}>{act.status}</Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => toggleStar(act)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name={act.isStarred ? 'star' : 'star-outline'} size={22} color={act.isStarred ? '#F5B301' : theme.colors.textSecondary} />
                      </TouchableOpacity>
                    </View>
                  </View>
                  <Text style={{ color: theme.colors.textSecondary, marginTop: 6, fontSize: 12 }}>
                    {act.uploaderId?.name ? `${act.uploaderId.name} · ${roleLabel(act.uploaderId.role)}` : ''}
                  </Text>
                  {act.schoolId?.name ? (
                    <Text style={{ color: theme.colors.textSecondary, marginTop: 2, fontSize: 12 }}>{act.schoolId.name}</Text>
                  ) : null}
                </TouchableOpacity>
              ))
            )}
          </View>

          {/* ---------- MY TEAMS: teams → members → profile drill-in ---------- */}
          <View style={{ display: activeTab === 'MyTeams' ? 'flex' : 'none' }}>
            {!selectedTeam ? (
              <>
                <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}>My Teams</Text>
                <Text style={{ color: theme.colors.textSecondary, marginBottom: 16, fontSize: 13 }}>
                  Tap a team to see its team leaders, trainee team leaders and trainers.
                </Text>
                {teams.length === 0 ? (
                  <View style={{ alignItems: 'center', marginTop: 40 }}>
                    <Ionicons name="people-outline" size={48} color={theme.colors.border} />
                    <Text style={{ color: theme.colors.textSecondary, marginTop: 12 }}>No teams assigned to you yet.</Text>
                  </View>
                ) : (
                  teams.map(team => (
                    <TouchableOpacity
                      key={team._id}
                      style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, flexDirection: 'row', alignItems: 'center' }]}
                      onPress={() => openTeam(team)}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="people-circle-outline" size={34} color={theme.colors.primary} />
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={{ color: theme.colors.textPrimary, fontSize: 16, fontWeight: '700' }}>{team.name}</Text>
                        {typeof team.memberCount === 'number' && (
                          <Text style={{ color: theme.colors.textSecondary, marginTop: 2, fontSize: 12 }}>{team.memberCount} member{team.memberCount === 1 ? '' : 's'}</Text>
                        )}
                      </View>
                      <Ionicons name="chevron-forward" size={20} color={theme.colors.textSecondary} />
                    </TouchableOpacity>
                  ))
                )}
              </>
            ) : (
              <>
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}
                  onPress={() => { setSelectedTeam(null); setMembers([]); }}
                >
                  <Ionicons name="chevron-back" size={22} color={theme.colors.primary} />
                  <Text style={{ color: theme.colors.primary, fontWeight: '600', marginLeft: 2 }}>All Teams</Text>
                </TouchableOpacity>

                <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}>{selectedTeam.name}</Text>

                {membersLoading ? (
                  <ActivityIndicator size="large" color={theme.colors.primary} style={{ marginTop: 30 }} />
                ) : members.length === 0 ? (
                  <View style={{ alignItems: 'center', marginTop: 40 }}>
                    <Ionicons name="person-outline" size={48} color={theme.colors.border} />
                    <Text style={{ color: theme.colors.textSecondary, marginTop: 12 }}>No members in this team yet.</Text>
                  </View>
                ) : (
                  members.map(member => (
                    <View key={member._id} style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, flexDirection: 'row', alignItems: 'center' }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.colors.textPrimary, fontSize: 16, fontWeight: '700' }}>{member.name}</Text>
                        <Text style={{ color: theme.colors.textSecondary, marginTop: 2, fontSize: 12 }}>{member.email}</Text>
                        <Text style={{ color: theme.colors.primary, marginTop: 4, fontSize: 12, fontWeight: '600' }}>
                          {roleLabel(member.role)}{member.schoolIds?.length ? ` · ${member.schoolIds.map(s => s.name).join(', ')}` : (member.schoolId?.name ? ` · ${member.schoolId.name}` : '')}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={{ backgroundColor: theme.colors.primary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 }}
                        onPress={() => navigation.navigate('UserProfile', { userId: member._id })}
                      >
                        <Text style={{ color: '#fff', fontWeight: 'bold' }}>View Profile</Text>
                      </TouchableOpacity>
                    </View>
                  ))
                )}
              </>
            )}
          </View>

          {/* ---------- LOG VISIT: create + review visit reports ---------- */}
          <View style={{ display: activeTab === 'LogVisit' ? 'flex' : 'none' }}>
            <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
              <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary, marginBottom: 6 }]}>Log Visit Report</Text>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 13, lineHeight: 20, marginBottom: 14 }}>
                Visit a school and complete the full IECE EGM Visit report on any team leader, trainee team leader or
                trainer in your teams. Every field is mandatory.
              </Text>
              {allMembers.length === 0 ? (
                <Text style={{ color: theme.colors.textSecondary, fontStyle: 'italic' }}>No members in your teams yet.</Text>
              ) : (
                <TouchableOpacity
                  style={{ backgroundColor: theme.colors.primary, padding: 15, borderRadius: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'center' }}
                  onPress={() => setReportFormVisible(true)}
                  activeOpacity={0.85}
                >
                  <Ionicons name="add-circle-outline" size={18} color="#fff" style={{ marginRight: 6 }} />
                  <Text style={{ color: '#fff', fontWeight: '700' }}>Start Visit Report</Text>
                </TouchableOpacity>
              )}
            </View>

            <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary, marginBottom: 10 }]}>Reports</Text>
            {reports.length === 0 ? (
              <View style={{ alignItems: 'center', marginTop: 20 }}>
                <Ionicons name="document-text-outline" size={44} color={theme.colors.border} />
                <Text style={{ color: theme.colors.textSecondary, marginTop: 10 }}>No visit reports yet.</Text>
              </View>
            ) : (
              reports.map(r => (
                <TouchableOpacity
                  key={r._id}
                  style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, flexDirection: 'row', alignItems: 'center' }]}
                  onPress={() => setReportToView(r)}
                  activeOpacity={0.85}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.colors.textPrimary, fontWeight: '700' }}>{r.trainerId?.name || 'Member'}</Text>
                    <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 }}>{r.schoolId?.name || ''}</Text>
                    <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 }}>
                      By {r.teamLeaderId?.name || '—'} · {r.dateOfInspection ? new Date(r.dateOfInspection).toLocaleDateString() : ''}
                    </Text>
                  </View>
                  <View style={{ backgroundColor: statusColor(r.status) + '20', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, marginRight: 8 }}>
                    <Text style={{ color: statusColor(r.status), fontSize: 11, fontWeight: '700', textTransform: 'capitalize' }}>{r.status}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={theme.colors.textSecondary} />
                </TouchableOpacity>
              ))
            )}
          </View>
        </ScrollView>
      )}

      <VisitReportForm
        visible={reportFormVisible}
        targets={allMembers}
        author={user}
        onClose={() => setReportFormVisible(false)}
        onSubmitted={(message) => { setAlertConfig({ visible: true, title: 'Success', message, type: 'success', buttons: [] }); fetchData(); }}
        onError={(message) => setAlertConfig({ visible: true, title: 'Error', message, type: 'error', buttons: [] })}
      />

      <VisitReportDetail
        visible={!!reportToView}
        report={reportToView}
        onClose={() => setReportToView(null)}
      />

      <SidebarMenu
        ref={sidebarRef}
        title={roleLabel(user?.role)}
        subtitle={user?.name || 'Head'}
        tabs={TAB_ITEMS}
        activeTab={activeTab}
        onSelectTab={(t) => { setActiveTab(t); setSelectedTeam(null); setMembers([]); }}
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
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 16, borderBottomWidth: 1 },
  title: { fontSize: 20, fontWeight: '700', letterSpacing: -0.5 },
  menuBtn: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontSize: 18, fontWeight: '700', marginBottom: 4 },
  card: { padding: 16, borderRadius: 14, borderWidth: 1, marginBottom: 12 },
});
