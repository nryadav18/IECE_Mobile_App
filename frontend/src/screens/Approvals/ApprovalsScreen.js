import React, { useCallback, useContext, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { ThemeContext } from '../../context/ThemeContext';
import { AuthContext } from '../../context/AuthContext';
import { useAlert } from '../../context/AlertContext';
import { roleLabel } from '../../utils/roles';
import Avatar from '../../components/Avatar';
import NotificationBell from '../../components/NotificationBell';
import RejectReasonModal from '../../components/RejectReasonModal';
import ActivityCover from '../../components/ActivityCover';
import { SkeletonList } from '../../components/Skeleton';
import useResponsiveLayout from '../../hooks/useResponsiveLayout';
import {
  getPendingFaceApprovals, getPendingActivityApprovals,
  approveFaceRegistration, rejectFaceRegistration,
  approveActivity, rejectActivity, approvalError,
  faceRegistrationKey,
} from '../../services/approvals';

/**
 * Everything waiting on this person's decision, in one place.
 *
 * Two queues, two different audiences:
 *
 *  - FACE SCANS are the Admin's alone. Admitting a face into the attendance
 *    system is an identity decision, so it is not delegated down the hierarchy.
 *    For everyone else the tab does not exist and the endpoint would refuse
 *    them anyway — the screen simply becomes the activities queue.
 *
 *  - ACTIVITIES stay scoped by the SERVER to the people this approver is
 *    actually responsible for: a team leader sees their trainers, a head sees
 *    their whole teams, Admin/CEO see everyone.
 *
 * So anything shown here can genuinely be actioned; there is no "you don't have
 * permission" surprise on tap. Nothing can be rejected without a reason, and
 * that reason is delivered to the person concerned.
 */
export default function ApprovalsScreen({ navigation }) {
  const { theme } = useContext(ThemeContext);
  const { user } = useContext(AuthContext);
  const { showAlert } = useAlert();
  const insets = useSafeAreaInsets();
  const { contentInset } = useResponsiveLayout({ baseGutter: 16 });

  const canReviewFaces = user?.role === 'creator_admin';

  const [tab, setTab] = useState(canReviewFaces ? 'faces' : 'activities'); // 'faces' | 'activities'
  const [faces, setFaces] = useState([]);       // [{ user, reg }]
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyKey, setBusyKey] = useState(null);
  // What is being rejected right now: { kind: 'face'|'activity', ... }
  const [rejecting, setRejecting] = useState(null);
  const [submittingReject, setSubmittingReject] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const [faceRes, actRes] = await Promise.allSettled([
        // Not even asked for unless it can be acted on — otherwise every team
        // leader opening this screen would fire a request the server rejects.
        canReviewFaces ? getPendingFaceApprovals() : Promise.resolve({ data: [] }),
        getPendingActivityApprovals(),
      ]);

      if (faceRes.status === 'fulfilled') {
        // Flatten to one row per (person, school) — someone may have several
        // schools awaiting a decision at once.
        const rows = [];
        (faceRes.value?.data || []).forEach((u) => {
          (u.faceRegistrations || []).forEach((reg) => {
            if (reg.status === 'pending') rows.push({ user: u, reg });
          });
        });
        setFaces(rows);
      }
      if (actRes.status === 'fulfilled') setActivities(actRes.value?.data || []);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [canReviewFaces]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Identifies one (person, registration) pair. Goes through the shared helper
  // so a school-less registration gets a real key instead of "…_undefined",
  // which would collide with every other school-less row.
  const faceKey = (row) => `${row.user._id}_${faceRegistrationKey(row.reg)}`;

  // What this registration lets them do — a school, or anywhere at all.
  const faceWhere = (row) => row.reg?.schoolId?.name || 'Anonymous location (no school)';

  /* ---------------- face registrations ---------------- */

  const onApproveFace = async (row) => {
    const key = faceKey(row);
    setBusyKey(key);
    try {
      await approveFaceRegistration(row.user._id, faceRegistrationKey(row.reg));
      setFaces((prev) => prev.filter((r) => faceKey(r) !== key));
      showAlert(
        'Approved',
        row.reg?.schoolId?.name
          ? `${row.user.name} can now mark attendance at ${row.reg.schoolId.name}.`
          : `${row.user.name} can now check in and out from any location.`,
        'success'
      );
    } catch (e) {
      showAlert('Error', approvalError(e), 'error');
    } finally {
      setBusyKey(null);
    }
  };

  /* ---------------- activities ---------------- */

  const onApproveActivity = async (act) => {
    setBusyKey(act._id);
    try {
      await approveActivity(act._id);
      setActivities((prev) => prev.filter((a) => a._id !== act._id));
      showAlert('Approved', `"${act.name}" is now published.`, 'success');
    } catch (e) {
      showAlert('Error', approvalError(e), 'error');
    } finally {
      setBusyKey(null);
    }
  };

  /* ---------------- rejection (shared) ---------------- */

  const submitRejection = async (reason) => {
    if (!rejecting) return;
    setSubmittingReject(true);
    try {
      if (rejecting.kind === 'face') {
        const row = rejecting.row;
        await rejectFaceRegistration(row.user._id, faceRegistrationKey(row.reg), reason);
        const key = faceKey(row);
        setFaces((prev) => prev.filter((r) => faceKey(r) !== key));
        showAlert('Rejected', `${row.user.name} has been told why and can register again.`, 'success');
      } else {
        const act = rejecting.activity;
        await rejectActivity(act._id, reason);
        setActivities((prev) => prev.filter((a) => a._id !== act._id));
        showAlert('Rejected', `${act.uploaderId?.name || 'The uploader'} has been told why.`, 'success');
      }
      setRejecting(null);
    } catch (e) {
      showAlert('Error', approvalError(e), 'error');
    } finally {
      setSubmittingReject(false);
    }
  };

  /* ---------------- shared pieces ---------------- */

  const ActionRow = ({ onApprove, onReject, busy }) => (
    <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
      <TouchableOpacity
        style={{ flex: 1, borderWidth: 1, borderColor: '#EF4444', backgroundColor: '#EF444410', borderRadius: 12, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.5 : 1 }}
        onPress={onReject}
        disabled={busy}
      >
        <Ionicons name="close-circle-outline" size={17} color="#EF4444" />
        <Text style={{ color: '#EF4444', fontWeight: '700', fontSize: 14, marginLeft: 6 }}>Reject</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={{ flex: 1, backgroundColor: '#10B981', borderRadius: 12, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.5 : 1 }}
        onPress={onApprove}
        disabled={busy}
      >
        <Ionicons name="checkmark-circle-outline" size={17} color="#fff" />
        <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14, marginLeft: 6 }}>Approve</Text>
      </TouchableOpacity>
    </View>
  );

  const Card = ({ children }) => (
    <View style={{ backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 16, padding: 14, marginBottom: 12 }}>
      {children}
    </View>
  );

  const Empty = ({ icon, text }) => (
    <View style={{ alignItems: 'center', marginTop: 70 }}>
      <Ionicons name={icon} size={54} color={theme.colors.border} />
      <Text style={{ color: theme.colors.textSecondary, marginTop: 14, fontSize: 14, textAlign: 'center' }}>{text}</Text>
    </View>
  );

  const Tab = ({ id, label, count, icon }) => {
    const on = tab === id;
    return (
      <TouchableOpacity
        onPress={() => setTab(id)}
        style={{
          flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
          paddingVertical: 11, borderRadius: 12,
          backgroundColor: on ? theme.colors.primary : 'transparent',
        }}
      >
        <Ionicons name={icon} size={16} color={on ? '#fff' : theme.colors.textSecondary} />
        <Text style={{ color: on ? '#fff' : theme.colors.textSecondary, fontWeight: '700', fontSize: 13.5, marginLeft: 6 }}>
          {label}
        </Text>
        {count > 0 && (
          <View style={{ marginLeft: 6, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? 'rgba(255,255,255,0.28)' : '#EF4444' }}>
            <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>{count}</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      {/* Header */}
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: contentInset, paddingBottom: 12, backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="arrow-back" size={24} color={theme.colors.textPrimary} />
          </TouchableOpacity>
          <Text style={{ color: theme.colors.textPrimary, fontSize: 19, fontWeight: '700', marginLeft: 12, flex: 1 }}>
            {canReviewFaces ? 'Approvals' : 'Activity Approvals'}
          </Text>
          <NotificationBell navigation={navigation} />
        </View>
      </View>

      {/* Queue switcher — only a switcher when there are two queues to switch
          between. Face scans belong to the Admin, so for everyone else this
          screen is simply the activities queue. */}
      {canReviewFaces && (
        <View style={{ flexDirection: 'row', margin: 16, marginBottom: 8, padding: 4, borderRadius: 14, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border }}>
          <Tab id="faces" label="Face Scans" count={faces.length} icon="scan-outline" />
          <Tab id="activities" label="Activities" count={activities.length} icon="images-outline" />
        </View>
      )}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: contentInset, paddingTop: 8, paddingBottom: insets.bottom + 30, flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={theme.colors.primary} colors={[theme.colors.primary]} />}
      >
        {loading ? (
          <SkeletonList count={4} avatar lines={2} trailing />
        ) : tab === 'faces' ? (
          faces.length === 0 ? (
            <Empty icon="checkmark-done-circle-outline" text={'No face registrations waiting.\nYou are all caught up.'} />
          ) : (
            faces.map((row) => {
              const key = faceKey(row);
              const busy = busyKey === key;
              return (
                <Card key={key}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Avatar name={row.user.name} size={44} />
                    <View style={{ flex: 1, marginLeft: 11 }}>
                      <Text style={{ color: theme.colors.textPrimary, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>
                        {row.user.name}
                      </Text>
                      <Text style={{ color: theme.colors.textSecondary, fontSize: 12.5, marginTop: 2 }}>
                        {roleLabel(row.user.role)}
                      </Text>
                    </View>
                  </View>

                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
                    <Ionicons
                      name={row.reg?.schoolId?.name ? 'business-outline' : 'navigate-circle-outline'}
                      size={14}
                      color={theme.colors.textSecondary}
                    />
                    <Text style={{ color: theme.colors.textSecondary, fontSize: 12.5, marginLeft: 6, flex: 1 }} numberOfLines={1}>
                      {faceWhere(row)}
                    </Text>
                  </View>

                  {/* Reviewing a face means WATCHING it — the captured video and
                      the exact spot they registered from are the whole decision. */}
                  <TouchableOpacity
                    style={{ marginTop: 12, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}
                    onPress={() => navigation.navigate('FaceRegistrationReview', { user: row.user, reg: row.reg })}
                  >
                    <Ionicons name="play-circle-outline" size={17} color={theme.colors.primary} />
                    <Text style={{ color: theme.colors.primary, fontWeight: '700', fontSize: 14, marginLeft: 6 }}>
                      Review Video & Location
                    </Text>
                  </TouchableOpacity>

                  <ActionRow
                    busy={busy}
                    onApprove={() => onApproveFace(row)}
                    onReject={() => setRejecting({ kind: 'face', row })}
                  />
                </Card>
              );
            })
          )
        ) : (
          activities.length === 0 ? (
            <Empty icon="checkmark-done-circle-outline" text={'No activities waiting.\nYou are all caught up.'} />
          ) : (
            activities.map((act) => {
              const busy = busyKey === act._id;
              return (
                <Card key={act._id}>
                  <View style={{ flexDirection: 'row' }}>
                    <ActivityCover activity={act} size={72} style={{ marginRight: 12 }} />
                    <View style={{ flex: 1, justifyContent: 'center' }}>
                      <Text style={{ color: theme.colors.textPrimary, fontSize: 15, fontWeight: '700' }} numberOfLines={2}>{act.name}</Text>
                      <Text style={{ color: theme.colors.textSecondary, fontSize: 12.5, marginTop: 3 }} numberOfLines={1}>
                        {act.uploaderId?.name || 'Unknown'} · {roleLabel(act.uploaderId?.role)}
                      </Text>
                      <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                        {act.schoolId?.name || ''}
                      </Text>
                    </View>
                  </View>

                  {/* Preview opens the SAME screen everyone sees after approval,
                      so what is judged here is exactly what gets published. */}
                  <TouchableOpacity
                    style={{ marginTop: 12, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}
                    onPress={() => navigation.navigate('ActivityDetails', { activityId: act._id, preview: true })}
                  >
                    <Ionicons name="eye-outline" size={17} color={theme.colors.primary} />
                    <Text style={{ color: theme.colors.primary, fontWeight: '700', fontSize: 14, marginLeft: 6 }}>
                      Preview Activity
                    </Text>
                  </TouchableOpacity>

                  <ActionRow
                    busy={busy}
                    onApprove={() => onApproveActivity(act)}
                    onReject={() => setRejecting({ kind: 'activity', activity: act })}
                  />
                </Card>
              );
            })
          )
        )}
      </ScrollView>

      <RejectReasonModal
        visible={!!rejecting}
        submitting={submittingReject}
        onClose={() => setRejecting(null)}
        title={rejecting?.kind === 'face' ? 'Reject Face Registration' : 'Reject Activity'}
        subject={
          rejecting?.kind === 'face'
            ? `${rejecting.row.user.name} — ${faceWhere(rejecting.row)}`
            : rejecting?.activity
              ? `"${rejecting.activity.name}" by ${rejecting.activity.uploaderId?.name || 'unknown'}`
              : ''
        }
        placeholder={
          rejecting?.kind === 'face'
            ? 'e.g. Face not clearly visible, or the location is not the school…'
            : 'e.g. Photos are blurry, or the description is incomplete…'
        }
        onSubmit={submitRejection}
      />
    </View>
  );
}
