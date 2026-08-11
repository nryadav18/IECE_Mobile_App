import React, { useCallback, useContext, useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Platform, RefreshControl,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { ThemeContext } from '../context/ThemeContext';
import { useAlert } from '../context/AlertContext';
import { roleLabel } from '../utils/roles';
import { prettyDate, toYMD, dayCountInclusive } from '../utils/dates';
import Avatar from './Avatar';
import StaffPickerModal from './StaffPickerModal';
import StatusBadge from './StatusBadge';
import ApprovedBy from './ApprovedBy';
import { SkeletonList } from './Skeleton';
import {
  getLeaveStaff, createEmergencyLeave, getLeaveRequests, cancelLeave,
  leaveError, leaveConflicts, needsConfirmation,
} from '../services/leave';

/**
 * EMERGENCY LEAVE — the Admin's own leave register.
 *
 * Everywhere else in this app leave flows upward: a staff member applies, the
 * Admin decides. This is the one place it flows the other way. Somebody has not
 * turned up, or has been sent home, and the Admin records that fact directly —
 * so the leave is created ALREADY APPROVED and everyone in that person's
 * reporting line is told at once. There is nothing left to approve.
 *
 * Two consequences shape this screen:
 *
 *  - No date floor. The self-service form forbids today and tomorrow so people
 *    cannot book leave retroactively; here the opposite is needed — an
 *    emergency is usually recorded after it has already started, and a day
 *    already marked Absent is repainted On Leave when it is covered.
 *
 *  - Clashes warn rather than block. The Admin is overruling the schedule on
 *    purpose, so the server reports what it found and this asks once, in plain
 *    words, before going ahead.
 *
 * The history below the form is the audit trail the Admin asked for: every
 * emergency leave ever granted, newest first, and visible to nobody else.
 */
export default function EmergencyLeaveSection() {
  const { theme } = useContext(ThemeContext);
  const { showAlert } = useAlert();

  const today = useMemo(() => new Date(), []);

  const [staff, setStaff] = useState(null);          // the chosen person
  const [pickerOpen, setPickerOpen] = useState(false);
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [showFrom, setShowFrom] = useState(false);
  const [showTo, setShowTo] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const loadHistory = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const res = await getLeaveRequests({ emergency: true });
      setHistory(res?.data || []);
    } catch (e) {
      // Non-fatal — the form still works without the register.
    } finally {
      setLoadingHistory(false);
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => { loadHistory(); }, [loadHistory]);

  const onPickFrom = (event, selected) => {
    setShowFrom(Platform.OS === 'ios');
    if (selected) {
      setFromDate(selected);
      if (selected > toDate) setToDate(selected);
    }
  };
  const onPickTo = (event, selected) => {
    setShowTo(Platform.OS === 'ios');
    if (selected) setToDate(selected);
  };

  const resetForm = () => {
    setStaff(null);
    setReason('');
    setFromDate(new Date());
    setToDate(new Date());
  };

  // One submit path, used for both the first attempt and the forced retry, so
  // the two can never validate differently.
  const send = async (force) => {
    setSubmitting(true);
    try {
      await createEmergencyLeave({
        applicantId: staff._id,
        reason: reason.trim(),
        fromDate: toYMD(fromDate),
        toDate: toYMD(toDate),
        force,
      });
      const name = staff.name;
      resetForm();
      await loadHistory();
      showAlert(
        'Emergency Leave Granted',
        `${name} is now on leave from ${prettyDate(fromDate)} to ${prettyDate(toDate)}. They, their reporting line and the CEO have been notified.`,
        'success'
      );
    } catch (e) {
      if (needsConfirmation(e)) {
        const clashes = leaveConflicts(e);
        showAlert(
          'Already booked',
          `${e.response.data.message}\n\n${clashes.map((c) => `• ${c.message}`).join('\n')}\n\nGrant the emergency leave anyway? Any pending request it replaces will be withdrawn.`,
          'warning',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Grant anyway', style: 'destructive', onPress: () => send(true) },
          ]
        );
        return;
      }
      showAlert('Could not grant leave', leaveError(e), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const submit = () => {
    if (!staff) {
      showAlert('Staff required', 'Please select the staff member this emergency leave is for.', 'warning');
      return;
    }
    if (!reason.trim()) {
      showAlert('Reason required', 'Please give the reason for this emergency leave.', 'warning');
      return;
    }
    if (toYMD(toDate) < toYMD(fromDate)) {
      showAlert('Invalid dates', 'The “to” date cannot be before the “from” date.', 'warning');
      return;
    }
    send(false);
  };

  const confirmWithdraw = (req) => {
    showAlert(
      'Withdraw Emergency Leave',
      `Withdraw the emergency leave granted to ${req.applicant?.name} (${prettyDate(req.fromDate)} → ${prettyDate(req.toDate)})? Those days will stop being marked as leave, and everyone who was told about it will be told it is withdrawn.`,
      'warning',
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Withdraw',
          style: 'destructive',
          onPress: async () => {
            setBusyId(req._id);
            try {
              await cancelLeave(req._id);
              await loadHistory();
            } catch (e) {
              showAlert('Could not withdraw', leaveError(e), 'error');
            } finally {
              setBusyId(null);
            }
          },
        },
      ]
    );
  };

  const DateField = ({ label, value, onPress }) => (
    <View style={{ flex: 1 }}>
      <Text style={{ color: theme.colors.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>
        {label} <Text style={{ color: '#F44336' }}>*</Text>
      </Text>
      <TouchableOpacity
        style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surface }}
        onPress={onPress}
      >
        <Ionicons name="calendar-outline" size={18} color={theme.colors.primary} style={{ marginRight: 8 }} />
        <Text style={{ color: theme.colors.textPrimary, fontSize: 14 }}>{prettyDate(value)}</Text>
      </TouchableOpacity>
    </View>
  );

  const days = dayCountInclusive(fromDate, toDate);

  return (
    <ScrollView
      contentContainerStyle={{ paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => loadHistory(true)} tintColor={theme.colors.primary} colors={[theme.colors.primary]} />
      }
    >
      {/* What this is, before they use it. */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', backgroundColor: '#DC262612', borderRadius: 12, padding: 12, marginBottom: 18, borderWidth: 1, borderColor: '#DC262633' }}>
        <Ionicons name="alert-circle-outline" size={18} color="#DC2626" style={{ marginRight: 8, marginTop: 1 }} />
        <Text style={{ color: theme.colors.textSecondary, fontSize: 12.5, flex: 1, lineHeight: 18 }}>
          You are granting leave <Text style={{ fontWeight: '700', color: theme.colors.textPrimary }}>on behalf of</Text> a staff member. It takes effect immediately — no approval step — and any date may be used, including today and days that have already passed.
        </Text>
      </View>

      {/* Who */}
      <Text style={{ color: theme.colors.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>
        Staff member <Text style={{ color: '#F44336' }}>*</Text>
      </Text>
      <TouchableOpacity
        onPress={() => setPickerOpen(true)}
        style={{ borderWidth: 1, borderColor: staff ? theme.colors.primary : theme.colors.border, borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'center', marginBottom: 18, backgroundColor: theme.colors.surface }}
      >
        {staff ? (
          <>
            <Avatar name={staff.name} size={38} />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={{ color: theme.colors.textPrimary, fontWeight: '700', fontSize: 14.5 }} numberOfLines={1}>{staff.name}</Text>
              <Text style={{ color: theme.colors.primary, fontSize: 12, fontWeight: '600', marginTop: 1 }}>{roleLabel(staff.role)}</Text>
            </View>
            <Ionicons name="swap-horizontal-outline" size={20} color={theme.colors.textSecondary} />
          </>
        ) : (
          <>
            <Ionicons name="person-add-outline" size={20} color={theme.colors.primary} style={{ marginRight: 10 }} />
            <Text style={{ color: theme.colors.textSecondary, fontSize: 14, flex: 1 }}>Select the staff member</Text>
            <Ionicons name="chevron-forward" size={20} color={theme.colors.textSecondary} />
          </>
        )}
      </TouchableOpacity>

      {/* When */}
      <View style={{ flexDirection: 'row', gap: 12, marginBottom: 6 }}>
        <DateField label="From date" value={fromDate} onPress={() => setShowFrom(true)} />
        <DateField label="To date" value={toDate} onPress={() => setShowTo(true)} />
      </View>
      <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginBottom: 20 }}>
        Duration: {days} day{days > 1 ? 's' : ''}
      </Text>

      {showFrom && <DateTimePicker value={fromDate} mode="date" display="default" onChange={onPickFrom} />}
      {showTo && <DateTimePicker value={toDate} mode="date" display="default" minimumDate={fromDate} onChange={onPickTo} />}

      {/* Why */}
      <Text style={{ color: theme.colors.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>
        Reason for emergency <Text style={{ color: '#F44336' }}>*</Text>
      </Text>
      <TextInput
        style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 14, color: theme.colors.textPrimary, marginBottom: 20, minHeight: 100, textAlignVertical: 'top', backgroundColor: theme.colors.surface }}
        value={reason}
        onChangeText={setReason}
        placeholder="e.g. Family medical emergency — informed by phone this morning"
        placeholderTextColor={theme.colors.placeholder}
        multiline
      />

      <TouchableOpacity
        style={{ backgroundColor: '#DC2626', borderRadius: 12, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', opacity: submitting ? 0.6 : 1 }}
        onPress={submit}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Ionicons name="flash-outline" size={18} color="#fff" />
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15, marginLeft: 8 }}>Grant Emergency Leave</Text>
          </>
        )}
      </TouchableOpacity>

      {/* ---- The register ---- */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 32, marginBottom: 12 }}>
        <Ionicons name="time-outline" size={17} color={theme.colors.textPrimary} />
        <Text style={{ color: theme.colors.textPrimary, fontSize: 16, fontWeight: '700', marginLeft: 7, flex: 1 }}>
          Emergency Leave History
        </Text>
        {history.length > 0 && (
          <View style={{ backgroundColor: '#DC262618', borderRadius: 10, paddingHorizontal: 9, paddingVertical: 3 }}>
            <Text style={{ color: '#DC2626', fontSize: 11.5, fontWeight: '800' }}>{history.length}</Text>
          </View>
        )}
      </View>

      {loadingHistory ? (
        <SkeletonList count={3} avatar lines={2} />
      ) : history.length === 0 ? (
        <View style={{ alignItems: 'center', paddingVertical: 34 }}>
          <Ionicons name="flash-off-outline" size={44} color={theme.colors.border} />
          <Text style={{ color: theme.colors.textSecondary, marginTop: 10, fontSize: 13.5 }}>
            No emergency leave has been granted yet.
          </Text>
        </View>
      ) : (
        history.map((req) => (
          <View
            key={req._id}
            style={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 12 }}
          >
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
                <Text style={{ color: theme.colors.textSecondary }}>
                  {'  ·  '}{dayCountInclusive(req.fromDate, req.toDate)} day{dayCountInclusive(req.fromDate, req.toDate) > 1 ? 's' : ''}
                </Text>
              </Text>
            </View>
            {!!req.reason && (
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12, fontStyle: 'italic' }} numberOfLines={2}>
                “{req.reason}”
              </Text>
            )}
            {/* "Granted by …" with the exact time, from the shared component.
                An emergency leave is granted outright rather than approved, and
                a withdrawal changes the verb to "Withdrawn by" — both of which
                the plain raisedBy line below could never express. */}
            <ApprovedBy record={req} style={{ marginTop: 8 }} />
            <Text style={{ color: theme.colors.textSecondary, fontSize: 11.5, marginTop: 6 }}>
              Raised by {req.raisedBy?.name || 'Admin'} · {prettyDate(req.decisionAt || req.createdAt)}
            </Text>

            {req.status === 'approved' && (
              <TouchableOpacity
                style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', opacity: busyId === req._id ? 0.5 : 1 }}
                disabled={busyId === req._id}
                onPress={() => confirmWithdraw(req)}
              >
                <Ionicons name="close-circle-outline" size={16} color="#F44336" />
                <Text style={{ color: '#F44336', fontSize: 13, fontWeight: '600', marginLeft: 4 }}>Withdraw this leave</Text>
              </TouchableOpacity>
            )}
          </View>
        ))
      )}

      <StaffPickerModal
        visible={pickerOpen}
        title="Select Staff Member"
        fetcher={getLeaveStaff}
        selectedId={staff?._id}
        onSelect={setStaff}
        onClose={() => setPickerOpen(false)}
      />
    </ScrollView>
  );
}
