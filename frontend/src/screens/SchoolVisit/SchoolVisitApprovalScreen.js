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
import { SCHOOL_VISIT_MARK_COLOR } from '../../utils/schoolVisitMarks';
import Avatar from '../../components/Avatar';
import StatusBadge from '../../components/StatusBadge';
import ApprovedBy from '../../components/ApprovedBy';
import { SkeletonCard, SkeletonRow, SkeletonText, Skeleton } from '../../components/Skeleton';
import { getVisit, approveVisit, rejectVisit, updateVisitDates, schoolVisitError } from '../../services/schoolVisit';
import { REVIEW_PANE } from '../../utils/platform';

const sameDay = (a, b) => {
  if (!a || !b) return false;
  const x = new Date(a); const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
};

export default function SchoolVisitApprovalScreen({ navigation, route }) {
  const { theme } = useContext(ThemeContext);
  const { showAlert } = useAlert();
  const { refresh: refreshBadges } = useBadges();
  const insets = useSafeAreaInsets();
  const requestId = route?.params?.requestId;

  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState('');

  // The window the Admin is about to set. Seeded from the request and edited in
  // place — before approval it rides along with Approve; after approval it is
  // saved on its own via "Save new dates".
  const [fromDate, setFromDate] = useState(new Date());
  const [toDate, setToDate] = useState(new Date());
  const [showFrom, setShowFrom] = useState(false);
  const [showTo, setShowTo] = useState(false);
  const [editingDates, setEditingDates] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getVisit(requestId);
      const r = res?.data;
      setRequest(r);
      if (r) {
        setFromDate(new Date(r.fromDate));
        setToDate(new Date(r.toDate));
        setEditingDates(false);
      }
    } catch (e) {
      showAlert('Error', schoolVisitError(e), 'error');
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    load();
  }, [load]);

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

  // Save a new window on an ALREADY-APPROVED visit. Everything downstream —
  // the check-in pause, the calendar, the Visit Report prompt — is derived from
  // these dates on read, so this single save is the whole update.
  const onSaveDates = async () => {
    if (toDate < fromDate) {
      showAlert('Invalid dates', 'The “to” date cannot be before the “from” date.', 'warning');
      return;
    }
    const extended = new Date(toDate) > new Date(request.toDate);
    setSubmitting(true);
    try {
      const res = await updateVisitDates(requestId, { fromDate: toYMD(fromDate), toDate: toYMD(toDate) });
      setRequest(res?.data || request);
      setEditingDates(false);
      refreshBadges();
      showAlert(
        res?.changed === false ? 'No change' : 'Dates Updated',
        res?.changed === false
          ? 'These are already the visit’s dates.'
          : extended
            ? `The visit now runs to ${prettyDate(toDate)}. Check-in and check-out stay paused for the extra days and resume the day after the new end date. Everyone on the visit was notified.`
            : `The visit now runs ${prettyDate(fromDate)} → ${prettyDate(toDate)}. Check-in and check-out are handed back for any days no longer covered. Everyone on the visit was notified.`,
        'success'
      );
    } catch (e) {
      showAlert('Could not update dates', schoolVisitError(e), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const onApprove = () => {
    if (toDate < fromDate) {
      showAlert('Invalid dates', 'The “to” date cannot be before the “from” date.', 'warning');
      return;
    }
    const adjusted = !sameDay(fromDate, request.fromDate) || !sameDay(toDate, request.toDate);
    showAlert(
      'Approve School Visit',
      `Approve ${request.applicant?.name}'s visit to ${request.school?.name || 'this school'} from ${prettyDate(fromDate)} to ${prettyDate(toDate)}?${adjusted ? ' (You have changed the requested dates.)' : ''} Their check-in and check-out will be paused for these dates.`,
      'warning',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: async () => {
            setSubmitting(true);
            try {
              await approveVisit(requestId, { fromDate: toYMD(fromDate), toDate: toYMD(toDate) });
              refreshBadges();
              showAlert(
                'Approved',
                'The school visit was approved. These days now show as “On School Visit” and check-in is paused until the visit ends.',
                'success',
                [{ text: 'Done', onPress: () => navigation.goBack() }]
              );
            } catch (e) {
              showAlert('Could not approve', schoolVisitError(e), 'error');
            } finally {
              setSubmitting(false);
            }
          },
        },
      ]
    );
  };

  const onReject = async () => {
    if (!rejectNote.trim()) {
      showAlert('Reason required', 'Please enter a reason for rejecting this school visit request.', 'warning');
      return;
    }
    setSubmitting(true);
    try {
      await rejectVisit(requestId, rejectNote.trim());
      refreshBadges();
      setRejectOpen(false);
      showAlert('Rejected', 'The request was rejected and the applicant was notified with your reason.', 'success', [
        { text: 'Done', onPress: () => navigation.goBack() },
      ]);
    } catch (e) {
      showAlert('Could not reject', schoolVisitError(e), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        {/* Header (keeps the frame steady while the body loads) */}
        <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.border, flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="arrow-back" size={24} color={theme.colors.textPrimary} />
          </TouchableOpacity>
          <Text style={{ color: theme.colors.textPrimary, fontSize: 19, fontWeight: '700', marginLeft: 12 }}>School Visit</Text>
        </View>
        <View style={{ padding: 16 }}>
          <SkeletonCard style={{ marginBottom: 16 }}>
            <SkeletonRow avatar lines={2} />
            <SkeletonText plain lines={3} spacing={12} style={{ marginTop: 16 }} />
          </SkeletonCard>
          <SkeletonCard>
            <Skeleton plain width={'40%'} height={16} radius={8} style={{ marginBottom: 16 }} />
            <SkeletonText plain lines={3} spacing={12} />
          </SkeletonCard>
        </View>
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
          <Text style={{ color: theme.colors.textPrimary, fontSize: 19, fontWeight: '700', marginLeft: 12 }}>School Visit</Text>
        </View>
        <StatusBadge status={request.status} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: decided ? 40 : 120, ...REVIEW_PANE }} keyboardShouldPersistTaps="handled">
        {/* Applicant + visit */}
        <View style={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
            <Avatar name={request.applicant?.name} size={48} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={{ color: theme.colors.textPrimary, fontWeight: '700', fontSize: 16 }}>{request.applicant?.name}</Text>
              <Text style={{ color: theme.colors.primary, fontSize: 12, fontWeight: '600', marginTop: 1 }}>{roleLabel(request.applicant?.role)}</Text>
            </View>
          </View>
          <Row icon="business-outline" label="School to visit" value={request.school?.name || '—'} />
          {!!request.school?.state && <Row icon="location-outline" label="State" value={request.school.state} />}
          <Row icon="chatbubble-ellipses-outline" label="Reason" value={request.reason} />
          <Row
            icon="calendar-outline"
            label={decided ? 'Approved period' : 'Requested period'}
            value={`${prettyDate(request.fromDate)} → ${prettyDate(request.toDate)}  ·  ${dayCountInclusive(request.fromDate, request.toDate)} day(s)`}
          />
          {/* Only worth showing once the Admin has actually moved the window. */}
          {(!sameDay(request.requestedFromDate, request.fromDate) || !sameDay(request.requestedToDate, request.toDate)) && (
            <Row
              icon="swap-vertical-outline"
              label="Originally requested"
              value={`${prettyDate(request.requestedFromDate)} → ${prettyDate(request.requestedToDate)}`}
            />
          )}
        </View>

        {/* Date window — editable by the Admin BEFORE approval (rides along with
            Approve) and AFTER approval (saved on its own). */}
        {(!decided || request.status === 'approved') && (
          <View style={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
              <Text style={{ flex: 1, color: theme.colors.textPrimary, fontWeight: '700', fontSize: 15 }}>
                {decided ? 'Visit dates' : 'Set the visit dates'}
              </Text>
              {decided && !editingDates && (
                <TouchableOpacity
                  onPress={() => setEditingDates(true)}
                  style={{ flexDirection: 'row', alignItems: 'center' }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="create-outline" size={16} color={theme.colors.primary} />
                  <Text style={{ color: theme.colors.primary, fontWeight: '700', fontSize: 13, marginLeft: 4 }}>Edit</Text>
                </TouchableOpacity>
              )}
            </View>

            {decided && !editingDates ? (
              <Text style={{ color: theme.colors.textSecondary, fontSize: 13, lineHeight: 19 }}>
                {prettyDate(request.fromDate)} → {prettyDate(request.toDate)}  ·  {dayCountInclusive(request.fromDate, request.toDate)} day(s).
                {'\n'}Change these to extend or shorten the visit — check-in, check-out and the attendance calendar follow automatically.
              </Text>
            ) : (
              <>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.colors.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>From</Text>
                    <TouchableOpacity
                      style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center' }}
                      onPress={() => setShowFrom(true)}
                    >
                      <Ionicons name="calendar-outline" size={18} color={theme.colors.primary} style={{ marginRight: 8 }} />
                      <Text style={{ color: theme.colors.textPrimary, fontSize: 14 }}>{prettyDate(fromDate)}</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.colors.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>To</Text>
                    <TouchableOpacity
                      style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center' }}
                      onPress={() => setShowTo(true)}
                    >
                      <Ionicons name="calendar-outline" size={18} color={theme.colors.primary} style={{ marginRight: 8 }} />
                      <Text style={{ color: theme.colors.textPrimary, fontSize: 14 }}>{prettyDate(toDate)}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 8 }}>
                  Duration: {dayCountInclusive(fromDate, toDate)} day{dayCountInclusive(fromDate, toDate) > 1 ? 's' : ''}
                </Text>

                {showFrom && (
                  <DateTimePicker value={fromDate} mode="date" display="default" onChange={onPickFrom} />
                )}
                {showTo && (
                  <DateTimePicker value={toDate} mode="date" display="default" minimumDate={fromDate} onChange={onPickTo} />
                )}

                {/* Save/cancel only exist in the post-approval edit; before
                    approval the window is committed by the Approve button. */}
                {decided && editingDates && (
                  <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
                    <TouchableOpacity
                      style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border }}
                      onPress={() => {
                        setFromDate(new Date(request.fromDate));
                        setToDate(new Date(request.toDate));
                        setEditingDates(false);
                      }}
                      disabled={submitting}
                    >
                      <Text style={{ color: theme.colors.textSecondary, fontWeight: '600' }}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={{ flex: 1.4, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: SCHOOL_VISIT_MARK_COLOR, opacity: submitting ? 0.6 : 1 }}
                      onPress={onSaveDates}
                      disabled={submitting}
                    >
                      {submitting ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>Save new dates</Text>}
                    </TouchableOpacity>
                  </View>
                )}
              </>
            )}
          </View>
        )}

        {/* Who changed the window, and when. */}
        {Array.isArray(request.dateHistory) && request.dateHistory.length > 0 && (
          <View style={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 16 }}>
            <Text style={{ color: theme.colors.textPrimary, fontWeight: '700', fontSize: 15, marginBottom: 10 }}>Date changes</Text>
            {request.dateHistory.map((h, i) => (
              <View key={h._id || i} style={{ marginBottom: i === request.dateHistory.length - 1 ? 0 : 10 }}>
                <Text style={{ color: theme.colors.textPrimary, fontSize: 13, fontWeight: '600' }}>
                  {prettyDate(h.previousFromDate)} → {prettyDate(h.previousToDate)}
                  <Text style={{ color: theme.colors.textSecondary, fontWeight: '400' }}>{'  changed to  '}</Text>
                  {prettyDate(h.fromDate)} → {prettyDate(h.toDate)}
                </Text>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 11, marginTop: 2 }}>
                  {h.changedBy?.name ? `${h.changedBy.name} · ` : ''}{prettyDate(h.changedAt)}
                  {h.phase === 'approved' ? ' · after approval' : ' · before approval'}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* What approving does — spelled out, because it changes attendance. */}
        {!decided && (
          <View style={{ backgroundColor: SCHOOL_VISIT_MARK_COLOR + '12', borderColor: SCHOOL_VISIT_MARK_COLOR + '44', borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
              <Ionicons name="information-circle-outline" size={18} color={SCHOOL_VISIT_MARK_COLOR} />
              <Text style={{ color: theme.colors.textPrimary, fontWeight: '700', fontSize: 14, marginLeft: 6 }}>If you approve</Text>
            </View>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 13, lineHeight: 20 }}>
              • These dates are immediately marked <Text style={{ fontWeight: '700', color: SCHOOL_VISIT_MARK_COLOR }}>On School Visit</Text> on their attendance calendar.{'\n'}
              • They count as on-duty working days, not as leave.{'\n'}
              • Their check-in and check-out is paused for the whole period, and resumes automatically the day after it ends.{'\n'}
              • Their team leader, heads and the CEO are notified.
            </Text>
          </View>
        )}

        {/* Outcome (decided) */}
        {decided && (
          <View style={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 16, padding: 16 }}>
            <Text style={{ color: theme.colors.textPrimary, fontWeight: '700', fontSize: 15, marginBottom: 12 }}>Outcome</Text>
            {/* Replaces the old "Decided by" row — same fact, one shared
                component, with the exact time it was decided. */}
            <ApprovedBy record={request} style={{ marginBottom: 12 }} />
            {request.status === 'rejected' && !!request.decisionNote && <Row icon="document-text-outline" label="Reason for rejection" value={request.decisionNote} />}
          </View>
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
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15, marginLeft: 6 }}>Approve Visit</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* Reject reason modal — reason is mandatory */}
      <Modal visible={rejectOpen} transparent statusBarTranslucent navigationBarTranslucent animationType="fade" onRequestClose={() => setRejectOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', paddingHorizontal: 28 }}>
          <View style={{ backgroundColor: theme.colors.surface, borderRadius: 20, padding: 20 }}>
            <Text style={{ color: theme.colors.textPrimary, fontSize: 18, fontWeight: '700', marginBottom: 6 }}>Reject School Visit</Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginBottom: 14 }}>
              Enter a reason for rejection. This will be shown to the applicant.
            </Text>
            <TextInput
              style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 14, color: theme.colors.textPrimary, minHeight: 80, textAlignVertical: 'top', marginBottom: 16, backgroundColor: theme.colors.background }}
              value={rejectNote}
              onChangeText={setRejectNote}
              placeholder="Reason for rejection (required)"
              placeholderTextColor={theme.colors.placeholder}
              multiline
              autoFocus
            />
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border }} onPress={() => setRejectOpen(false)} disabled={submitting}>
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
