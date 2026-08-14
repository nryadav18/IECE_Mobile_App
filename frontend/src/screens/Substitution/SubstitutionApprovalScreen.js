import React, { useCallback, useContext, useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Platform, Modal, KeyboardAvoidingView,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemeContext } from '../../context/ThemeContext';
import { useAlert } from '../../context/AlertContext';
import { useBadges } from '../../context/BadgeContext';
import { roleLabel } from '../../utils/roles';
import { prettyDate, toYMD, dayCountInclusive } from '../../utils/dates';
import Avatar from '../../components/Avatar';
import StatusBadge from '../../components/StatusBadge';
import ApprovedBy from '../../components/ApprovedBy';
import StaffPickerModal from '../../components/StaffPickerModal';
import { REVIEW_PANE } from '../../utils/platform';
import {
  getSubstitutionRequest, approveSubstitution, rejectSubstitution,
  getCandidateSubstitutes, substitutionError,
} from '../../services/substitution';

const schoolsOf = (u) => (u?.schoolIds || []).map((s) => s?.name).filter(Boolean).join(', ') || '—';

export default function SubstitutionApprovalScreen({ navigation, route }) {
  const { theme } = useContext(ThemeContext);
  const { showAlert } = useAlert();
  const { refresh: refreshBadges } = useBadges();
  const insets = useSafeAreaInsets();
  const requestId = route?.params?.requestId;

  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [substitute, setSubstitute] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [fromDate, setFromDate] = useState(new Date());
  const [toDate, setToDate] = useState(new Date());
  const [showFrom, setShowFrom] = useState(false);
  const [showTo, setShowTo] = useState(false);

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getSubstitutionRequest(requestId);
      const r = res?.data;
      setRequest(r);
      if (r) {
        setFromDate(new Date(r.approvedFromDate || r.fromDate));
        setToDate(new Date(r.approvedToDate || r.toDate));
        if (r.substitute) setSubstitute(r.substitute);
      }
    } catch (e) {
      showAlert('Error', substitutionError(e), 'error');
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    load();
  }, [load]);

  const onApprove = () => {
    if (!substitute) {
      showAlert('Select a substitute', 'Please choose who will cover this substitution.', 'warning');
      return;
    }
    if (toDate < fromDate) {
      showAlert('Invalid dates', 'The “to” date cannot be before the “from” date.', 'warning');
      return;
    }
    showAlert(
      'Approve Substitution',
      `Confirm ${substitute.name} will substitute for ${request.subject?.name} from ${prettyDate(fromDate)} to ${prettyDate(toDate)}?`,
      'warning',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: async () => {
            setSubmitting(true);
            try {
              await approveSubstitution(requestId, {
                substituteId: substitute._id,
                fromDate: toYMD(fromDate),
                toDate: toYMD(toDate),
              });
              refreshBadges();
              showAlert('Approved', 'The substitution was approved and everyone involved has been notified.', 'success', [
                { text: 'Done', onPress: () => navigation.goBack() },
              ]);
            } catch (e) {
              showAlert('Could not approve', substitutionError(e), 'error');
            } finally {
              setSubmitting(false);
            }
          },
        },
      ]
    );
  };

  const onReject = async () => {
    setSubmitting(true);
    try {
      await rejectSubstitution(requestId, rejectNote.trim());
      refreshBadges();
      setRejectOpen(false);
      showAlert('Rejected', 'The request was rejected and the requester was notified.', 'success', [
        { text: 'Done', onPress: () => navigation.goBack() },
      ]);
    } catch (e) {
      showAlert('Could not reject', substitutionError(e), 'error');
    } finally {
      setSubmitting(false);
    }
  };

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

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.colors.primary} size="large" />
      </View>
    );
  }

  if (!request) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: theme.colors.textSecondary }}>Request not found.</Text>
      </View>
    );
  }

  const decided = request.status !== 'pending';

  const Row = ({ icon, label, value }) => (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 }}>
      <Ionicons name={icon} size={16} color={theme.colors.textSecondary} style={{ marginTop: 2, width: 22 }} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>{label}</Text>
        <Text style={{ color: theme.colors.textPrimary, fontSize: 14, fontWeight: '600', marginTop: 1 }}>{value}</Text>
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      {/* Header */}
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="arrow-back" size={24} color={theme.colors.textPrimary} />
          </TouchableOpacity>
          <Text style={{ color: theme.colors.textPrimary, fontSize: 19, fontWeight: '700', marginLeft: 12 }}>Review Request</Text>
        </View>
        <StatusBadge status={request.status} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: decided ? 40 : 120, ...REVIEW_PANE }} keyboardShouldPersistTaps="handled">
        {/* Subject */}
        <View style={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
            <Avatar name={request.subject?.name} size={48} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={{ color: theme.colors.textPrimary, fontWeight: '700', fontSize: 16 }}>{request.subject?.name}</Text>
              <Text style={{ color: theme.colors.primary, fontSize: 12, fontWeight: '600', marginTop: 1 }}>{roleLabel(request.subject?.role)}</Text>
            </View>
          </View>
          <Row icon="school-outline" label="Current school(s)" value={schoolsOf(request.subject)} />
          <Row icon="chatbubble-ellipses-outline" label="Reason" value={request.reason} />
          <Row icon="calendar-outline" label="Requested period" value={`${prettyDate(request.fromDate)} → ${prettyDate(request.toDate)}`} />
          <Row icon="person-outline" label="Raised by" value={`${request.raisedBy?.name} (${roleLabel(request.raisedBy?.role)})`} />
        </View>

        {decided ? (
          /* Read-only outcome for already-decided requests */
          <View style={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 16, padding: 16 }}>
            <Text style={{ color: theme.colors.textPrimary, fontWeight: '700', fontSize: 15, marginBottom: 12 }}>Outcome</Text>
            {request.substitute && <Row icon="swap-horizontal" label="Substitute" value={`${request.substitute.name} (${roleLabel(request.substitute.role)})`} />}
            {request.status === 'approved' && (
              <Row icon="calendar-outline" label="Approved period" value={`${prettyDate(request.approvedFromDate || request.fromDate)} → ${prettyDate(request.approvedToDate || request.toDate)}`} />
            )}
            {/* Replaces the old "Decided by" row — approvedBy is also written on
                a rejection here, so it could never say which of the two actually
                happened. ApprovedBy reads the stored action instead. */}
            <ApprovedBy record={request} style={{ marginBottom: 12 }} />
            {!!request.decisionNote && <Row icon="document-text-outline" label="Remark" value={request.decisionNote} />}
          </View>
        ) : (
          /* Approval controls */
          <>
            <Text style={{ color: theme.colors.textPrimary, fontWeight: '700', fontSize: 15, marginBottom: 10 }}>Select Substitute</Text>
            <TouchableOpacity
              onPress={() => setPickerOpen(true)}
              style={{ backgroundColor: theme.colors.surface, borderColor: substitute ? theme.colors.primary : theme.colors.border, borderWidth: 1, borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center', marginBottom: 20 }}
            >
              {substitute ? (
                <>
                  <Avatar name={substitute.name} size={38} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={{ color: theme.colors.textPrimary, fontWeight: '700', fontSize: 14 }}>{substitute.name}</Text>
                    <Text style={{ color: theme.colors.primary, fontSize: 12, fontWeight: '600' }}>{roleLabel(substitute.role)}</Text>
                  </View>
                  <Ionicons name="swap-horizontal" size={20} color={theme.colors.primary} />
                </>
              ) : (
                <>
                  <Ionicons name="person-add-outline" size={20} color={theme.colors.textSecondary} />
                  <Text style={{ color: theme.colors.textSecondary, marginLeft: 10, flex: 1 }}>Tap to choose a substitute</Text>
                  <Ionicons name="chevron-forward" size={20} color={theme.colors.textSecondary} />
                </>
              )}
            </TouchableOpacity>

            <Text style={{ color: theme.colors.textPrimary, fontWeight: '700', fontSize: 15, marginBottom: 10 }}>Substitution Period</Text>
            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 6 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>From</Text>
                <TouchableOpacity style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center' }} onPress={() => setShowFrom(true)}>
                  <Ionicons name="calendar-outline" size={18} color={theme.colors.primary} style={{ marginRight: 8 }} />
                  <Text style={{ color: theme.colors.textPrimary, fontSize: 14 }}>{prettyDate(fromDate)}</Text>
                </TouchableOpacity>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>To</Text>
                <TouchableOpacity style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center' }} onPress={() => setShowTo(true)}>
                  <Ionicons name="calendar-outline" size={18} color={theme.colors.primary} style={{ marginRight: 8 }} />
                  <Text style={{ color: theme.colors.textPrimary, fontSize: 14 }}>{prettyDate(toDate)}</Text>
                </TouchableOpacity>
              </View>
            </View>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
              Duration: {dayCountInclusive(fromDate, toDate)} day{dayCountInclusive(fromDate, toDate) > 1 ? 's' : ''} • You can edit the dates before approving.
            </Text>

            {showFrom && <DateTimePicker value={fromDate} mode="date" display="default" onChange={onPickFrom} />}
            {showTo && <DateTimePicker value={toDate} mode="date" display="default" minimumDate={fromDate} onChange={onPickTo} />}
          </>
        )}
      </ScrollView>

      {/* Action bar */}
      {!decided && (
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', gap: 12, padding: 16, paddingBottom: insets.bottom + 12, backgroundColor: theme.colors.surface, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
          <TouchableOpacity
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 12, borderWidth: 1.5, borderColor: '#EF4444', opacity: submitting ? 0.6 : 1 }}
            onPress={() => setRejectOpen(true)}
            disabled={submitting}
          >
            <Ionicons name="close" size={18} color="#EF4444" />
            <Text style={{ color: '#EF4444', fontWeight: '700', fontSize: 15, marginLeft: 6 }}>Reject</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={{ flex: 1.4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 12, backgroundColor: '#10B981', opacity: submitting ? 0.6 : 1 }}
            onPress={onApprove}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="checkmark" size={18} color="#fff" />
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15, marginLeft: 6 }}>Approve Substitution</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* Substitute picker */}
      <StaffPickerModal
        visible={pickerOpen}
        title="Select a Substitute"
        fetcher={getCandidateSubstitutes}
        selectedId={substitute?._id}
        onSelect={setSubstitute}
        onClose={() => setPickerOpen(false)}
      />

      {/* Reject reason modal */}
      <Modal visible={rejectOpen} transparent statusBarTranslucent navigationBarTranslucent animationType="fade" onRequestClose={() => setRejectOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', paddingHorizontal: 28 }}>
          <View style={{ backgroundColor: theme.colors.surface, borderRadius: 20, padding: 20 }}>
            <Text style={{ color: theme.colors.textPrimary, fontSize: 18, fontWeight: '700', marginBottom: 6 }}>Reject Request</Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginBottom: 14 }}>Optionally add a remark for the requester.</Text>
            <TextInput
              style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 14, color: theme.colors.textPrimary, minHeight: 70, textAlignVertical: 'top', marginBottom: 16 }}
              value={rejectNote}
              onChangeText={setRejectNote}
              placeholder="Reason for rejection (optional)"
              placeholderTextColor={theme.colors.placeholder}
              multiline
            />
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border }} onPress={() => setRejectOpen(false)}>
                <Text style={{ color: theme.colors.textSecondary, fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: '#EF4444', opacity: submitting ? 0.6 : 1 }} onPress={onReject} disabled={submitting}>
                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>Reject</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}
