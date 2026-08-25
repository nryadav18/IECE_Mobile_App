import React, { useCallback, useContext, useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Platform, Modal, KeyboardAvoidingView, Image, Linking,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ProofViewer from '../../components/ProofViewer';
import { optimizedImageUrl } from '../../utils/media';
import { ThemeContext } from '../../context/ThemeContext';
import { useAlert } from '../../context/AlertContext';
import { useBadges } from '../../context/BadgeContext';
import { roleLabel } from '../../utils/roles';
import { prettyDate, toYMD, dayCountInclusive } from '../../utils/dates';
import Avatar from '../../components/Avatar';
import StatusBadge from '../../components/StatusBadge';
import ApprovedBy from '../../components/ApprovedBy';
import { SkeletonCard, SkeletonRow, SkeletonText, Skeleton } from '../../components/Skeleton';
import { REVIEW_PANE } from '../../utils/platform';
import {
  getLeaveRequest, approveLeave, rejectLeave, updateLeaveDates,
  leaveError, leaveConflicts, needsConfirmation,
} from '../../services/leave';

const schoolsOf = (u) => (u?.schoolIds || []).map((s) => s?.name).filter(Boolean).join(', ') || '—';
// Leave proofs are photographs. That is enforced on upload (see UPLOAD_SCOPES
// in backend/utils/storage) against the file's actual bytes, so nothing new can
// arrive here that is not an image.
//
// The non-image branch below is therefore about HISTORY, not about what the app
// accepts: two already-approved requests carry a PDF from before the rule, and
// those are evidence attached to decided records. They are shown as a document
// that opens externally, which is honest about what they are. Removing the
// branch would render them as a broken image — the one outcome this screen
// exists to avoid.
const isImageUrl = (url = '') => /\.(jpe?g|png|gif|webp|heic|bmp)(\?|$)/i.test(url);

/**
 * A proof thumbnail that always shows something.
 *
 * A bare <Image> whose URL fails renders as an empty box, and an empty box in a
 * list of evidence reads as "there is nothing here" rather than "this did not
 * load". The two are completely different facts to somebody deciding a leave
 * request, so they are drawn differently.
 */
function ProofThumb({ url, theme }) {
  const [failed, setFailed] = useState(false);
  const box = { width: 44, height: 44, borderRadius: 6 };

  if (failed) {
    return (
      <View style={[box, { backgroundColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' }]}>
        <Ionicons name="image-outline" size={20} color={theme.colors.textSecondary} />
      </View>
    );
  }
  return (
    <Image
      source={{ uri: optimizedImageUrl(url, 44) }}
      style={box}
      onError={() => setFailed(true)}
    />
  );
}

export default function LeaveApprovalScreen({ navigation, route }) {
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
  // Which photo the full-screen viewer is showing; null when it is closed.
  const [viewerIndex, setViewerIndex] = useState(null);

  /* ---------------- date editing (Admin) ----------------
   * The Admin may move a leave's window at any point it still means something:
   * before deciding (to grant different dates than were asked for) and after
   * approving (to extend or correct it). Both go through the same modal and the
   * same endpoint, so "granted 10–12" and "extended to 10–15" are one mechanism
   * rather than two features that can disagree.
   *
   * No date floor is imposed here. The app's day-after-tomorrow rule exists to
   * stop STAFF booking leave retroactively; the Admin correcting the record is
   * precisely the case that rule is not meant to catch. */
  const [editOpen, setEditOpen] = useState(false);
  const [editFrom, setEditFrom] = useState(new Date());
  const [editTo, setEditTo] = useState(new Date());
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getLeaveRequest(requestId);
      setRequest(res?.data);
    } catch (e) {
      showAlert('Error', leaveError(e), 'error');
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    load();
  }, [load]);

  const onApprove = () => {
    showAlert(
      'Approve Leave',
      `Approve ${request.applicant?.name}'s leave from ${prettyDate(request.fromDate)} to ${prettyDate(request.toDate)}?`,
      'warning',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: async () => {
            setSubmitting(true);
            try {
              await approveLeave(requestId);
              refreshBadges();
              showAlert('Approved', 'The leave was approved. The applicant, their heads and the CEO have been notified.', 'success', [
                { text: 'Done', onPress: () => navigation.goBack() },
              ]);
            } catch (e) {
              showAlert('Could not approve', leaveError(e), 'error');
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
      showAlert('Reason required', 'Please enter a reason for rejecting this leave request.', 'warning');
      return;
    }
    setSubmitting(true);
    try {
      await rejectLeave(requestId, rejectNote.trim());
      refreshBadges();
      setRejectOpen(false);
      showAlert('Rejected', 'The request was rejected and the applicant was notified with your reason.', 'success', [
        { text: 'Done', onPress: () => navigation.goBack() },
      ]);
    } catch (e) {
      showAlert('Could not reject', leaveError(e), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const openEdit = () => {
    setEditFrom(new Date(request.fromDate));
    setEditTo(new Date(request.toDate));
    setEditOpen(true);
  };

  // One submit path for the first attempt and the forced retry, so the two can
  // never validate differently.
  const saveDates = async (force) => {
    setSubmitting(true);
    try {
      const res = await updateLeaveDates(requestId, {
        fromDate: toYMD(editFrom),
        toDate: toYMD(editTo),
        force,
      });
      setEditOpen(false);
      setRequest(res?.data || request);
      refreshBadges();

      if (res?.changed === false) {
        showAlert('No change', 'These are already the dates on this request.', 'info');
        return;
      }
      showAlert(
        res?.approved ? 'Approved with new dates' : 'Dates updated',
        res?.approved
          ? `The leave is approved for ${prettyDate(editFrom)} → ${prettyDate(editTo)}. The applicant, their heads and the CEO have been notified.`
          : `The leave now runs ${prettyDate(editFrom)} → ${prettyDate(editTo)}. The applicant has been notified.`,
        'success'
      );
    } catch (e) {
      if (needsConfirmation(e)) {
        const clashes = leaveConflicts(e);
        showAlert(
          'Already booked',
          `${e.response.data.message}\n\n${clashes.map((c) => `• ${c.message}`).join('\n')}\n\nApply these dates anyway? Any pending request they replace will be withdrawn.`,
          'warning',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Apply anyway', style: 'destructive', onPress: () => saveDates(true) },
          ]
        );
        return;
      }
      showAlert('Could not update dates', leaveError(e), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // A photo opens in the app. A legacy document has nothing to render inline,
  // so it still hands off to the system — and says so if that fails, rather
  // than doing nothing.
  const openDocument = (url) =>
    Linking.openURL(url).catch(() =>
      showAlert('Could not open', 'This document could not be opened on your device.', 'error'));

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        {/* Header (keeps the frame steady while the body loads) */}
        <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.border, flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="arrow-back" size={24} color={theme.colors.textPrimary} />
          </TouchableOpacity>
          <Text style={{ color: theme.colors.textPrimary, fontSize: 19, fontWeight: '700', marginLeft: 12 }}>Leave Request</Text>
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
  const editable = request.status === 'pending' || request.status === 'approved';
  const history = Array.isArray(request.dateHistory) ? request.dateHistory : [];

  const Row = ({ icon, label, value }) => (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 }}>
      <Ionicons name={icon} size={16} color={theme.colors.textSecondary} style={{ marginTop: 2, width: 22 }} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>{label}</Text>
        <Text style={{ color: theme.colors.textPrimary, fontSize: 14, fontWeight: '600', marginTop: 1 }}>{value}</Text>
      </View>
    </View>
  );

  const proofs = Array.isArray(request.proofs) ? request.proofs : [];
  // Only the photos go to the viewer, and its indexes are into THIS list — not
  // into `proofs` — or a request mixing a legacy document with photos would
  // open the wrong one.
  const photoUrls = proofs.filter(isImageUrl);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      {/* Header */}
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="arrow-back" size={24} color={theme.colors.textPrimary} />
          </TouchableOpacity>
          <Text style={{ color: theme.colors.textPrimary, fontSize: 19, fontWeight: '700', marginLeft: 12 }}>Leave Request</Text>
        </View>
        <StatusBadge status={request.status} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: decided ? 40 : 120, ...REVIEW_PANE }} keyboardShouldPersistTaps="handled">
        {/* Applicant */}
        <View style={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
            <Avatar name={request.applicant?.name} size={48} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={{ color: theme.colors.textPrimary, fontWeight: '700', fontSize: 16 }}>{request.applicant?.name}</Text>
              <Text style={{ color: theme.colors.primary, fontSize: 12, fontWeight: '600', marginTop: 1 }}>{roleLabel(request.applicant?.role)}</Text>
            </View>
          </View>
          <Row icon="school-outline" label="School(s)" value={schoolsOf(request.applicant)} />
          <Row icon="chatbubble-ellipses-outline" label="Reason" value={request.reason} />
          <Row icon="calendar-outline" label="Period" value={`${prettyDate(request.fromDate)} → ${prettyDate(request.toDate)}  ·  ${dayCountInclusive(request.fromDate, request.toDate)} day(s)`} />

          {/* Editable for as long as the window still means something: while it
              waits for a decision, and after it has been granted. */}
          {editable && (
            <TouchableOpacity
              onPress={openEdit}
              disabled={submitting}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: theme.colors.primary, borderRadius: 12, paddingVertical: 11, marginTop: 2, opacity: submitting ? 0.6 : 1 }}
            >
              <Ionicons name="create-outline" size={17} color={theme.colors.primary} />
              <Text style={{ color: theme.colors.primary, fontWeight: '700', fontSize: 14, marginLeft: 6 }}>
                {decided ? 'Change or Extend Dates' : 'Change Dates'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Every window change ever made, so an extended leave still shows what
            it originally said and who moved it. */}
        {history.length > 0 && (
          <View style={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 16 }}>
            <Text style={{ color: theme.colors.textPrimary, fontWeight: '700', fontSize: 15, marginBottom: 12 }}>
              Date Changes ({history.length})
            </Text>
            {history.map((h, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: i === history.length - 1 ? 0 : 12 }}>
                <Ionicons name="swap-horizontal-outline" size={16} color={theme.colors.textSecondary} style={{ marginTop: 2, width: 22 }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.textPrimary, fontSize: 13.5, fontWeight: '600' }}>
                    {prettyDate(h.previousFromDate)} → {prettyDate(h.previousToDate)}
                    <Text style={{ color: theme.colors.textSecondary }}>{'  becomes  '}</Text>
                    {prettyDate(h.fromDate)} → {prettyDate(h.toDate)}
                  </Text>
                  <Text style={{ color: theme.colors.textSecondary, fontSize: 11.5, marginTop: 2 }}>
                    {h.changedBy?.name || 'Admin'} · {prettyDate(h.changedAt)} · while {h.phase}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Proofs */}
        <View style={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 16 }}>
          <Text style={{ color: theme.colors.textPrimary, fontWeight: '700', fontSize: 15, marginBottom: proofs.length ? 12 : 0 }}>
            Proofs {proofs.length ? `(${proofs.length})` : ''}
          </Text>
          {proofs.length === 0 ? (
            <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>No proofs were attached.</Text>
          ) : (
            proofs.map((url, i) => {
              const image = isImageUrl(url);
              return (
                <TouchableOpacity
                  key={`${url}_${i}`}
                  // Photos open the in-app viewer at this photo; the viewer is
                  // given every photo so the approver can swipe between them.
                  onPress={() => (image ? setViewerIndex(photoUrls.indexOf(url)) : openDocument(url))}
                  style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.background, borderRadius: 10, padding: 8, marginBottom: 8 }}
                >
                  {image ? (
                    <ProofThumb url={url} theme={theme} />
                  ) : (
                    <View style={{ width: 44, height: 44, borderRadius: 6, backgroundColor: theme.colors.primary + '18', alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name="document-text-outline" size={22} color={theme.colors.primary} />
                    </View>
                  )}
                  <Text style={{ flex: 1, color: theme.colors.textPrimary, fontSize: 13, marginLeft: 10 }} numberOfLines={1}>
                    {image ? `Photo ${i + 1}` : `Document ${i + 1}`}
                  </Text>
                  <Ionicons name={image ? 'expand-outline' : 'open-outline'} size={18} color={theme.colors.primary} />
                </TouchableOpacity>
              );
            })
          )}
        </View>

        {/* Outcome (decided) */}
        {decided && (
          <View style={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 16, padding: 16 }}>
            <Text style={{ color: theme.colors.textPrimary, fontWeight: '700', fontSize: 15, marginBottom: 12 }}>Outcome</Text>
            {/* Replaces the old "Decided by" row: the same fact, but from the
                one component the whole app uses, with the exact time and an
                honest "Not recorded" for requests decided before it existed. */}
            <ApprovedBy record={request} style={{ marginBottom: 12 }} />
            {request.status === 'rejected' && !!request.decisionNote && <Row icon="document-text-outline" label="Reason for rejection" value={request.decisionNote} />}
          </View>
        )}
      </ScrollView>

      {/* Full-screen photo viewer. Kept outside the ScrollView so it covers the
          action bar as well as the content. */}
      <ProofViewer
        visible={viewerIndex !== null}
        urls={photoUrls}
        initialIndex={viewerIndex ?? 0}
        onClose={() => setViewerIndex(null)}
      />

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
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15, marginLeft: 6 }}>Approve Leave</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* Change-dates modal. Deliberately unconstrained: any date, in either
          direction, including days already past. */}
      <Modal visible={editOpen} transparent statusBarTranslucent navigationBarTranslucent animationType="fade" onRequestClose={() => setEditOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', paddingHorizontal: 24 }}>
          <View style={{ backgroundColor: theme.colors.surface, borderRadius: 20, padding: 20 }}>
            <Text style={{ color: theme.colors.textPrimary, fontSize: 18, fontWeight: '700', marginBottom: 6 }}>
              {decided ? 'Change or Extend Leave' : 'Change Leave Dates'}
            </Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginBottom: 16 }}>
              {decided
                ? `Currently ${prettyDate(request.fromDate)} → ${prettyDate(request.toDate)}. The applicant will be notified of the new period.`
                : `Requested ${prettyDate(request.fromDate)} → ${prettyDate(request.toDate)}. Saving new dates also approves this request, and the applicant, their heads and the CEO are notified.`}
            </Text>

            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 8 }}>
              {[
                { label: 'From date', value: editFrom, open: () => setShowFromPicker(true) },
                { label: 'To date', value: editTo, open: () => setShowToPicker(true) },
              ].map((f) => (
                <View key={f.label} style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.textSecondary, fontSize: 12.5, fontWeight: '600', marginBottom: 6 }}>{f.label}</Text>
                  <TouchableOpacity
                    onPress={f.open}
                    style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 13, flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.background }}
                  >
                    <Ionicons name="calendar-outline" size={17} color={theme.colors.primary} style={{ marginRight: 7 }} />
                    <Text style={{ color: theme.colors.textPrimary, fontSize: 13.5 }}>{prettyDate(f.value)}</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginBottom: 18 }}>
              New duration: {dayCountInclusive(editFrom, editTo)} day(s)
            </Text>

            {showFromPicker && (
              <DateTimePicker
                value={editFrom}
                mode="date"
                display="default"
                onChange={(e, selected) => {
                  setShowFromPicker(Platform.OS === 'ios');
                  if (selected) {
                    setEditFrom(selected);
                    if (selected > editTo) setEditTo(selected);
                  }
                }}
              />
            )}
            {showToPicker && (
              <DateTimePicker
                value={editTo}
                mode="date"
                display="default"
                minimumDate={editFrom}
                onChange={(e, selected) => {
                  setShowToPicker(Platform.OS === 'ios');
                  if (selected) setEditTo(selected);
                }}
              />
            )}

            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity
                style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border }}
                onPress={() => setEditOpen(false)}
                disabled={submitting}
              >
                <Text style={{ color: theme.colors.textSecondary, fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1.3, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: theme.colors.primary, opacity: submitting ? 0.6 : 1 }}
                onPress={() => saveDates(false)}
                disabled={submitting}
              >
                {submitting ? <ActivityIndicator color="#fff" /> : (
                  <Text style={{ color: '#fff', fontWeight: '700' }}>{decided ? 'Save Dates' : 'Save & Approve'}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Reject reason modal — reason is mandatory */}
      <Modal visible={rejectOpen} transparent statusBarTranslucent navigationBarTranslucent animationType="fade" onRequestClose={() => setRejectOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', paddingHorizontal: 28 }}>
          <View style={{ backgroundColor: theme.colors.surface, borderRadius: 20, padding: 20 }}>
            <Text style={{ color: theme.colors.textPrimary, fontSize: 18, fontWeight: '700', marginBottom: 6 }}>Reject Leave Request</Text>
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
