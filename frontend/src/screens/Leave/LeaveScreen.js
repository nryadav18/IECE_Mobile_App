import React, { useCallback, useContext, useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, RefreshControl, Platform, KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { ThemeContext } from '../../context/ThemeContext';
import { AuthContext } from '../../context/AuthContext';
import { useAlert } from '../../context/AlertContext';
import { roleLabel } from '../../utils/roles';
import { prettyDate, dayCountInclusive } from '../../utils/dates';
import Avatar from '../../components/Avatar';
import StatusBadge from '../../components/StatusBadge';
import NotificationBell from '../../components/NotificationBell';
import ApplyLeaveForm from '../../components/ApplyLeaveForm';
import { SkeletonList } from '../../components/Skeleton';
import { getLeaveRequests, cancelLeave, leaveError } from '../../services/leave';

export default function LeaveScreen({ navigation, route }) {
  const { theme } = useContext(ThemeContext);
  const { user } = useContext(AuthContext);
  const { showAlert } = useAlert();
  const insets = useSafeAreaInsets();

  // Only the Admin decides leave requests.
  const isApprover = user?.role === 'creator_admin';

  const TABS = useMemo(
    () =>
      isApprover
        ? [
            { key: 'approvals', label: 'Approvals', icon: 'checkmark-done-outline' },
            { key: 'history', label: 'History', icon: 'time-outline' },
          ]
        : [
            { key: 'apply', label: 'Apply Leave', icon: 'add-circle-outline' },
            { key: 'mine', label: 'My Requests', icon: 'time-outline' },
          ],
    [isApprover]
  );

  const requestedTab = route?.params?.initialTab;
  const [activeTab, setActiveTab] = useState(
    TABS.some((t) => t.key === requestedTab) ? requestedTab : TABS[0].key
  );

  const [approvals, setApprovals] = useState([]);
  const [history, setHistory] = useState([]);
  const [mine, setMine] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const loadLists = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoadingList(true);
      try {
        if (isApprover) {
          const [pendingRes, allRes] = await Promise.all([
            getLeaveRequests({ status: 'pending' }),
            getLeaveRequests(),
          ]);
          setApprovals(pendingRes?.data || []);
          setHistory(allRes?.data || []);
        } else {
          const mineRes = await getLeaveRequests({ mine: true });
          setMine(mineRes?.data || []);
        }
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
    showAlert('Withdraw Request', 'Withdraw this pending leave request?', 'warning', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Withdraw',
        style: 'destructive',
        onPress: async () => {
          setBusyId(req._id);
          try {
            await cancelLeave(req._id);
            await loadLists();
          } catch (e) {
            showAlert('Error', leaveError(e), 'error');
          } finally {
            setBusyId(null);
          }
        },
      },
    ]);
  };

  const RequestCard = ({ req, actionable }) => (
    <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Avatar name={req.applicant?.name} size={40} />
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={{ color: theme.colors.textPrimary, fontWeight: '700', fontSize: 15 }} numberOfLines={1}>
            {req.applicant?.name || 'Unknown'}
          </Text>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 1 }}>
            {roleLabel(req.applicant?.role)}
          </Text>
        </View>
        <StatusBadge status={req.status} />
      </View>

      <View style={{ height: 1, backgroundColor: theme.colors.border, marginVertical: 10 }} />

      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
        <Ionicons name="calendar-outline" size={14} color={theme.colors.textSecondary} />
        <Text style={{ color: theme.colors.textPrimary, fontSize: 13, marginLeft: 6 }}>
          {prettyDate(req.fromDate)} → {prettyDate(req.toDate)}
          <Text style={{ color: theme.colors.textSecondary }}>  ·  {dayCountInclusive(req.fromDate, req.toDate)} day{dayCountInclusive(req.fromDate, req.toDate) > 1 ? 's' : ''}</Text>
        </Text>
      </View>
      {!!req.reason && (
        <Text style={{ color: theme.colors.textSecondary, fontSize: 12, fontStyle: 'italic', marginBottom: 4 }} numberOfLines={2}>
          “{req.reason}”
        </Text>
      )}
      {Array.isArray(req.proofs) && req.proofs.length > 0 && (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
          <Ionicons name="attach-outline" size={14} color={theme.colors.textSecondary} />
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginLeft: 4 }}>
            {req.proofs.length} proof{req.proofs.length > 1 ? 's' : ''} attached
          </Text>
        </View>
      )}

      {/* Actions */}
      {actionable && req.status === 'pending' && (
        <TouchableOpacity
          style={[styles.reviewBtn, { backgroundColor: theme.colors.primary }]}
          onPress={() => navigation.navigate('LeaveApproval', { requestId: req._id })}
        >
          <Ionicons name="eye-outline" size={16} color="#fff" />
          <Text style={styles.reviewBtnText}>View & Decide</Text>
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
        <View style={{ marginTop: 10, backgroundColor: '#F4433611', borderRadius: 8, padding: 10 }}>
          <Text style={{ color: '#F44336', fontSize: 12, fontWeight: '700', marginBottom: 2 }}>Reason for rejection</Text>
          <Text style={{ color: theme.colors.textPrimary, fontSize: 13 }}>{req.decisionNote}</Text>
        </View>
      )}
    </View>
  );

  const EmptyState = ({ icon, text }) => (
    <View style={{ alignItems: 'center', marginTop: 60 }}>
      <Ionicons name={icon} size={52} color={theme.colors.border} />
      <Text style={{ color: theme.colors.textSecondary, marginTop: 12, fontSize: 14 }}>{text}</Text>
    </View>
  );

  const renderList = (items, { actionable, emptyIcon, emptyText }) => {
    if (loadingList) return <SkeletonList count={4} avatar lines={2} trailing style={{ marginTop: 4 }} />;
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
            <Text style={{ color: theme.colors.textPrimary, fontSize: 19, fontWeight: '700', marginLeft: 12 }}>
              {isApprover ? 'Leave Requests' : 'Apply Leave'}
            </Text>
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
      <KeyboardAvoidingView
        style={{ flex: 1, paddingHorizontal: 16 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top + 80}
      >
        {activeTab === 'apply' && (
          <ApplyLeaveForm
            onSubmitted={() => {
              setActiveTab('mine');
              loadLists();
            }}
          />
        )}
        {activeTab === 'mine' &&
          renderList(mine, { actionable: false, emptyIcon: 'time-outline', emptyText: 'You haven’t applied for any leave yet.' })}
        {activeTab === 'approvals' &&
          renderList(approvals, { actionable: true, emptyIcon: 'checkmark-done-outline', emptyText: 'No pending leave requests to review.' })}
        {activeTab === 'history' &&
          renderList(history, { actionable: false, emptyIcon: 'time-outline', emptyText: 'No leave requests yet.' })}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 12 },
  reviewBtn: { marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 10 },
  reviewBtnText: { color: '#fff', fontWeight: '700', fontSize: 14, marginLeft: 6 },
});
