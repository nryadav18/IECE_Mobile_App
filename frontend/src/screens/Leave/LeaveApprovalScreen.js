import React, { useCallback, useContext, useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Platform, Modal, KeyboardAvoidingView, Image, Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemeContext } from '../../context/ThemeContext';
import { useAlert } from '../../context/AlertContext';
import { useBadges } from '../../context/BadgeContext';
import { roleLabel } from '../../utils/roles';
import { prettyDate, dayCountInclusive } from '../../utils/dates';
import Avatar from '../../components/Avatar';
import StatusBadge from '../../components/StatusBadge';
import { SkeletonCard, SkeletonRow, SkeletonText, Skeleton } from '../../components/Skeleton';
import { getLeaveRequest, approveLeave, rejectLeave, leaveError } from '../../services/leave';

const schoolsOf = (u) => (u?.schoolIds || []).map((s) => s?.name).filter(Boolean).join(', ') || '—';
const isImageUrl = (url = '') => /\.(jpe?g|png|gif|webp|heic|bmp)(\?|$)/i.test(url);

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

  const openProof = (url) => Linking.openURL(url).catch(() => showAlert('Could not open', 'Unable to open this file.', 'error'));

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

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: decided ? 40 : 120 }} keyboardShouldPersistTaps="handled">
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
        </View>

        {/* Proofs */}
        <View style={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 16 }}>
          <Text style={{ color: theme.colors.textPrimary, fontWeight: '700', fontSize: 15, marginBottom: proofs.length ? 12 : 0 }}>
            Proofs {proofs.length ? `(${proofs.length})` : ''}
          </Text>
          {proofs.length === 0 ? (
            <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>No proofs were attached.</Text>
          ) : (
            proofs.map((url, i) => (
              <TouchableOpacity
                key={`${url}_${i}`}
                onPress={() => openProof(url)}
                style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.background, borderRadius: 10, padding: 8, marginBottom: 8 }}
              >
                {isImageUrl(url) ? (
                  <Image source={{ uri: url }} style={{ width: 44, height: 44, borderRadius: 6 }} />
                ) : (
                  <View style={{ width: 44, height: 44, borderRadius: 6, backgroundColor: theme.colors.primary + '18', alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="document-text-outline" size={22} color={theme.colors.primary} />
                  </View>
                )}
                <Text style={{ flex: 1, color: theme.colors.textPrimary, fontSize: 13, marginLeft: 10 }} numberOfLines={1}>
                  {isImageUrl(url) ? `Photo ${i + 1}` : `Document ${i + 1}`}
                </Text>
                <Ionicons name="open-outline" size={18} color={theme.colors.primary} />
              </TouchableOpacity>
            ))
          )}
        </View>

        {/* Outcome (decided) */}
        {decided && (
          <View style={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 16, padding: 16 }}>
            <Text style={{ color: theme.colors.textPrimary, fontWeight: '700', fontSize: 15, marginBottom: 12 }}>Outcome</Text>
            {request.reviewedBy && <Row icon="shield-checkmark-outline" label="Decided by" value={`${request.reviewedBy.name} (${roleLabel(request.reviewedBy.role)})`} />}
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
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15, marginLeft: 6 }}>Approve Leave</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}

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
