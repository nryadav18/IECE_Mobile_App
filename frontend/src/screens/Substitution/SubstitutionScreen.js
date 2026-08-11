import React, { useCallback, useContext, useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Modal, ActivityIndicator, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { ThemeContext } from '../../context/ThemeContext';
import { AuthContext } from '../../context/AuthContext';
import { useAlert } from '../../context/AlertContext';
import { ADMIN_ROLES, roleLabel } from '../../utils/roles';
import { prettyDate } from '../../utils/dates';
import Avatar from '../../components/Avatar';
import StatusBadge from '../../components/StatusBadge';
import ApprovedBy from '../../components/ApprovedBy';
import StaffSearchList from '../../components/StaffSearchList';
import NotificationBell from '../../components/NotificationBell';
import {
  getSubjectStaff, getSubstitutionRequests, cancelSubstitution, substitutionError,
} from '../../services/substitution';

const schoolsOf = (u) => (u?.schoolIds || []).map((s) => s?.name).filter(Boolean).join(', ') || '—';

export default function SubstitutionScreen({ navigation, route }) {
  const { theme } = useContext(ThemeContext);
  const { user } = useContext(AuthContext);
  const { showAlert } = useAlert();
  const insets = useSafeAreaInsets();

  const isApprover = ADMIN_ROLES.includes(user?.role);

  // Tabs depend on role. Approvers get the approval queue first.
  const TABS = useMemo(
    () =>
      isApprover
        ? [
            { key: 'approvals', label: 'Approvals', icon: 'checkmark-done-outline' },
            { key: 'raise', label: 'Raise', icon: 'add-circle-outline' },
            { key: 'mine', label: 'My Requests', icon: 'time-outline' },
          ]
        : [
            { key: 'raise', label: 'Raise Request', icon: 'add-circle-outline' },
            { key: 'mine', label: 'My Requests', icon: 'time-outline' },
          ],
    [isApprover]
  );

  // Honour a deep-linked tab only if this role actually has it (e.g. a head
  // tapping a 'substitution_request' notification has no 'approvals' tab).
  const requestedTab = route?.params?.initialTab;
  const [activeTab, setActiveTab] = useState(
    TABS.some((t) => t.key === requestedTab) ? requestedTab : TABS[0].key
  );
  const [subject, setSubject] = useState(null); // for the raise-flow detail modal

  // Request lists
  const [approvals, setApprovals] = useState([]);
  const [mine, setMine] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const loadLists = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoadingList(true);
      try {
        const calls = [getSubstitutionRequests({ mine: true })];
        if (isApprover) calls.push(getSubstitutionRequests({ status: 'pending' }));
        const [mineRes, approvalsRes] = await Promise.all(calls);
        setMine(mineRes?.data || []);
        if (isApprover) setApprovals(approvalsRes?.data || []);
      } catch (e) {
        // Non-fatal — lists just stay as they are.
      } finally {
        setLoadingList(false);
        setRefreshing(false);
      }
    },
    [isApprover]
  );

  useFocusEffect(
    useCallback(() => {
      loadLists();
    }, [loadLists])
  );

  const confirmCancel = (req) => {
    showAlert('Cancel Request', `Withdraw the substitution request for ${req.subject?.name}?`, 'warning', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Withdraw',
        style: 'destructive',
        onPress: async () => {
          setBusyId(req._id);
          try {
            await cancelSubstitution(req._id);
            await loadLists();
          } catch (e) {
            showAlert('Error', substitutionError(e), 'error');
          } finally {
            setBusyId(null);
          }
        },
      },
    ]);
  };

  const RequestCard = ({ req, actionable }) => {
    const from = req.approvedFromDate || req.fromDate;
    const to = req.approvedToDate || req.toDate;
    return (
      <View
        style={[
          styles.card,
          { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
        ]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Avatar name={req.subject?.name} size={40} />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={{ color: theme.colors.textPrimary, fontWeight: '700', fontSize: 15 }} numberOfLines={1}>
              {req.subject?.name || 'Unknown'}
            </Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 1 }}>
              {roleLabel(req.subject?.role)}
            </Text>
          </View>
          <StatusBadge status={req.status} />
        </View>

        <View style={{ height: 1, backgroundColor: theme.colors.border, marginVertical: 10 }} />

        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
          <Ionicons name="calendar-outline" size={14} color={theme.colors.textSecondary} />
          <Text style={{ color: theme.colors.textPrimary, fontSize: 13, marginLeft: 6 }}>
            {prettyDate(from)} → {prettyDate(to)}
          </Text>
        </View>
        {!!req.reason && (
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12, fontStyle: 'italic', marginBottom: 4 }} numberOfLines={2}>
            “{req.reason}”
          </Text>
        )}
        {req.substitute ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
            <Ionicons name="swap-horizontal" size={14} color={theme.colors.success} />
            <Text style={{ color: theme.colors.textPrimary, fontSize: 13, marginLeft: 6 }}>
              Substitute: <Text style={{ fontWeight: '700' }}>{req.substitute.name}</Text>
            </Text>
          </View>
        ) : null}

        {/* Who decided it — Admin/CEO only, and only once decided. This one
            matters especially: substitutions are the single flow the CEO can
            decide as well as the Admin. */}
        <ApprovedBy record={req} compact style={{ marginTop: 8 }} />

        {/* Actions */}
        {actionable && req.status === 'pending' && (
          <TouchableOpacity
            style={[styles.reviewBtn, { backgroundColor: theme.colors.primary }]}
            onPress={() => navigation.navigate('SubstitutionApproval', { requestId: req._id })}
          >
            <Ionicons name="eye-outline" size={16} color="#fff" />
            <Text style={styles.reviewBtnText}>View & Approve</Text>
          </TouchableOpacity>
        )}
        {!actionable && req.status === 'pending' && (
          <TouchableOpacity
            style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', opacity: busyId === req._id ? 0.5 : 1 }}
            disabled={busyId === req._id}
            onPress={() => confirmCancel(req)}
          >
            <Ionicons name="close-circle-outline" size={16} color="#F44336" />
            <Text style={{ color: '#F44336', fontSize: 13, fontWeight: '600', marginLeft: 4 }}>Withdraw request</Text>
          </TouchableOpacity>
        )}
        {req.status === 'rejected' && !!req.decisionNote && (
          <Text style={{ color: '#F44336', fontSize: 12, marginTop: 8 }}>Remark: {req.decisionNote}</Text>
        )}
      </View>
    );
  };

  const EmptyState = ({ icon, text }) => (
    <View style={{ alignItems: 'center', marginTop: 60 }}>
      <Ionicons name={icon} size={52} color={theme.colors.border} />
      <Text style={{ color: theme.colors.textSecondary, marginTop: 12, fontSize: 14 }}>{text}</Text>
    </View>
  );

  const renderList = (items, { actionable, emptyIcon, emptyText }) => {
    if (loadingList) return <ActivityIndicator color={theme.colors.primary} style={{ marginTop: 40 }} />;
    if (!items.length) return <EmptyState icon={emptyIcon} text={emptyText} />;
    return (
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 30 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => loadLists(true)} tintColor={theme.colors.primary} colors={[theme.colors.primary]} />
        }
      >
        {items.map((req) => (
          <RequestCard key={req._id} req={req} actionable={actionable} />
        ))}
      </ScrollView>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      {/* Header */}
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
            <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="arrow-back" size={24} color={theme.colors.textPrimary} />
            </TouchableOpacity>
            <Text style={{ color: theme.colors.textPrimary, fontSize: 19, fontWeight: '700', marginLeft: 12 }}>Substitution Requests</Text>
          </View>
          <NotificationBell navigation={navigation} />
        </View>
      </View>

      {/* Segmented tabs */}
      <View style={{ flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 12, gap: 8 }}>
        {TABS.map((tab) => {
          const active = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              onPress={() => setActiveTab(tab.key)}
              style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                paddingVertical: 10,
                borderRadius: 12,
                backgroundColor: active ? theme.colors.primary : theme.colors.surface,
                borderWidth: 1,
                borderColor: active ? theme.colors.primary : theme.colors.border,
              }}
            >
              <Ionicons name={tab.icon} size={16} color={active ? '#fff' : theme.colors.textSecondary} />
              <Text style={{ color: active ? '#fff' : theme.colors.textSecondary, fontWeight: '700', fontSize: 12, marginLeft: 6 }} numberOfLines={1}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Body */}
      <View style={{ flex: 1, paddingHorizontal: 16 }}>
        {activeTab === 'raise' && (
          <StaffSearchList
            fetcher={getSubjectStaff}
            onSelect={(u) => setSubject(u)}
            placeholder="Search staff to substitute…"
            emptyText="No staff under your scope."
            ListHeaderComponent={
              <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginBottom: 12 }}>
                Select the staff member who needs to be temporarily substituted.
              </Text>
            }
          />
        )}

        {activeTab === 'approvals' &&
          renderList(approvals, { actionable: true, emptyIcon: 'checkmark-done-outline', emptyText: 'No pending requests to review.' })}

        {activeTab === 'mine' &&
          renderList(mine, { actionable: false, emptyIcon: 'time-outline', emptyText: 'You haven’t raised any requests yet.' })}
      </View>

      {/* Subject detail popup (raise flow) */}
      <Modal visible={!!subject} transparent statusBarTranslucent navigationBarTranslucent animationType="fade" onRequestClose={() => setSubject(null)}>
        <View style={styles.overlay}>
          <View style={[styles.popup, { backgroundColor: theme.colors.surface }]}>
            <View style={{ alignItems: 'center', marginBottom: 12 }}>
              <Avatar name={subject?.name} size={64} />
              <Text style={{ color: theme.colors.textPrimary, fontSize: 18, fontWeight: '700', marginTop: 10 }}>{subject?.name}</Text>
              <Text style={{ color: theme.colors.primary, fontSize: 13, fontWeight: '600', marginTop: 2 }}>{roleLabel(subject?.role)}</Text>
            </View>

            <View style={{ backgroundColor: theme.colors.background, borderRadius: 12, padding: 12, marginBottom: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 }}>
                <Ionicons name="school-outline" size={16} color={theme.colors.textSecondary} style={{ marginTop: 2 }} />
                <Text style={{ color: theme.colors.textPrimary, fontSize: 13, marginLeft: 8, flex: 1 }}>{schoolsOf(subject)}</Text>
              </View>
              {!!subject?.email && (
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name="mail-outline" size={16} color={theme.colors.textSecondary} />
                  <Text style={{ color: theme.colors.textPrimary, fontSize: 13, marginLeft: 8 }}>{subject.email}</Text>
                </View>
              )}
            </View>

            <Text style={{ color: theme.colors.textSecondary, fontSize: 11, textAlign: 'center', marginBottom: 14 }}>
              A substitution covers all of this person’s schools for the chosen period.
            </Text>

            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: theme.colors.primary }]}
              onPress={() => {
                const chosen = subject;
                setSubject(null);
                navigation.navigate('RaiseSubstitution', { subject: chosen });
              }}
            >
              <Ionicons name="swap-horizontal" size={18} color="#fff" />
              <Text style={styles.primaryBtnText}>Raise Request for this Staff</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ alignItems: 'center', paddingVertical: 12 }} onPress={() => setSubject(null)}>
              <Text style={{ color: theme.colors.textSecondary, fontWeight: '600' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 12 },
  reviewBtn: { marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 10 },
  reviewBtnText: { color: '#fff', fontWeight: '700', fontSize: 14, marginLeft: 6 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', paddingHorizontal: 28 },
  popup: { borderRadius: 20, padding: 20 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 12 },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15, marginLeft: 8 },
});
