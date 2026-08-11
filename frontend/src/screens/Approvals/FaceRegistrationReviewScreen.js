import React, { useContext, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, Dimensions, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemeContext } from '../../context/ThemeContext';
import { useAlert } from '../../context/AlertContext';
import { roleLabel } from '../../utils/roles';
import RejectReasonModal from '../../components/RejectReasonModal';
import DownloadButton from '../../components/DownloadButton';
import {
  RegistrationMap, RegistrationVideo, registrationLocation,
} from '../../components/RegistrationEvidence';
import {
  approveFaceRegistration, rejectFaceRegistration, approvalError,
  faceRegistrationKey,
} from '../../services/approvals';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

/**
 * The evidence behind one facial registration, so a decision is made on what
 * was actually captured rather than on a name in a list: the recorded video,
 * and the exact spot it was recorded from.
 *
 * That location becomes the permanent geofence anchor for that school, so the
 * map is the important half — a video of the right person taken at the wrong
 * place will break their attendance every day afterwards.
 */
export default function FaceRegistrationReviewScreen({ navigation, route }) {
  const { theme } = useContext(ThemeContext);
  const { showAlert } = useAlert();
  const insets = useSafeAreaInsets();

  const user = route?.params?.user;
  const reg = route?.params?.reg;

  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  // A registration with no school belongs to an anonymous-location head. It
  // anchors nothing, so the map below is a note of where they happened to
  // record — not the thing being judged.
  const anonymous = !(reg?.schoolId?._id || reg?.schoolId);
  const regKey = faceRegistrationKey(reg);
  const schoolName = reg?.schoolId?.name || 'this school';
  const location = registrationLocation(reg);
  const accuracy = reg?.locationAccuracy;

  const approve = async () => {
    setBusy(true);
    try {
      await approveFaceRegistration(user._id, regKey);
      showAlert(
        'Approved',
        anonymous
          ? `${user.name} can now check in and out from any location.`
          : `${user.name} can now mark attendance at ${schoolName}.`,
        'success'
      );
      navigation.goBack();
    } catch (e) {
      showAlert('Error', approvalError(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const reject = async (reason) => {
    setBusy(true);
    try {
      await rejectFaceRegistration(user._id, regKey, reason);
      setRejecting(false);
      showAlert('Rejected', `${user.name} has been told why and can register again.`, 'success');
      navigation.goBack();
    } catch (e) {
      showAlert('Error', approvalError(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const Row = ({ icon, label, value, color }) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10 }}>
      <Ionicons name={icon} size={16} color={theme.colors.textSecondary} style={{ marginRight: 10 }} />
      <Text style={{ color: theme.colors.textSecondary, fontSize: 13, fontWeight: '600', width: 74 }}>{label}</Text>
      <Text style={{ flex: 1, fontSize: 14, fontWeight: '700', color: color || theme.colors.textPrimary }} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );

  if (!user || !reg) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background, alignItems: 'center', justifyContent: 'center', padding: 30 }}>
        <Ionicons name="alert-circle-outline" size={50} color={theme.colors.border} />
        <Text style={{ color: theme.colors.textSecondary, marginTop: 12, textAlign: 'center' }}>
          This registration is no longer available.
        </Text>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginTop: 20 }}>
          <Text style={{ color: theme.colors.primary, fontWeight: '700' }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      {/* Header */}
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.border, flexDirection: 'row', alignItems: 'center' }}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={{ color: theme.colors.textPrimary, fontSize: 18, fontWeight: '700', marginLeft: 12 }}>Review Registration</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 30 }} showsVerticalScrollIndicator={false} bounces={false}>
        {/* The captured video */}
        <View style={{ width: SCREEN_WIDTH, height: 300, backgroundColor: '#000' }}>
          {reg.registrationPhotoUrl ? (
            <RegistrationVideo uri={reg.registrationPhotoUrl} style={{ width: '100%', height: '100%' }} />
          ) : (
            <View style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface }}>
              <Ionicons name="videocam-off-outline" size={48} color={theme.colors.textSecondary} />
              <Text style={{ color: theme.colors.textSecondary, marginTop: 8, fontWeight: '500' }}>No video recorded</Text>
            </View>
          )}
          {/* Admin / CEO can keep a copy of the capture for their records. */}
          <DownloadButton
            url={reg.registrationPhotoUrl}
            variant="icon"
            filename={`face-${(user.name || 'staff').replace(/[^\w.\- ]+/g, '_')}-${schoolName.replace(/[^\w.\- ]+/g, '_')}`}
            style={{ position: 'absolute', top: 12, right: 12 }}
          />
        </View>

        {/* Who + where */}
        <View style={{ marginHorizontal: 16, marginTop: 16, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: 16, paddingVertical: 4 }}>
          <Row icon="person-outline" label="Name" value={user.name} />
          <Row icon="shield-checkmark-outline" label="Role" value={roleLabel(user.role)} />
          {anonymous ? (
            <Row icon="navigate-circle-outline" label="Works" value="Anywhere — no school assigned" />
          ) : (
            <Row icon="business-outline" label="School" value={schoolName} />
          )}
          {accuracy != null && (
            <Row
              icon="locate-outline"
              label="GPS"
              value={`Accurate to ±${Math.round(accuracy)} m`}
              color={accuracy <= 25 ? '#10B981' : '#D97706'}
            />
          )}
        </View>

        {/* Where it was captured */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 20, marginBottom: 10 }}>
          <Ionicons name={require('react-native').Platform.OS === 'ios' ? 'map-outline' : 'globe-outline'} size={18} color={theme.colors.primary} />
          <Text style={{ fontSize: 15, fontWeight: '700', marginLeft: 8, color: theme.colors.textPrimary }}>
            Registration Location
          </Text>
        </View>

        {location ? (
          <>
            <View style={{ marginHorizontal: 16 }}>
              <RegistrationMap location={location} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 8 }}>
              <Ionicons name="location" size={14} color="#10B981" />
              <Text style={{ fontSize: 12, marginLeft: 6, color: theme.colors.textSecondary }}>
                {location.lat.toFixed(6)}, {location.lng.toFixed(6)}
              </Text>
            </View>
            <Text style={{ fontSize: 11.5, marginHorizontal: 16, marginTop: 8, lineHeight: 17, color: theme.colors.textSecondary }}>
              {anonymous
                ? 'Where they happened to record. This person is not tied to a school, so nothing is measured against this spot — judge the video, not the place.'
                : `This spot becomes their permanent check-in anchor for ${schoolName}. Approve only if it is genuinely at the school.`}
            </Text>
          </>
        ) : (
          <View style={{ marginHorizontal: 16, borderRadius: 14, borderWidth: 1, padding: 24, alignItems: 'center', backgroundColor: theme.colors.surface, borderColor: theme.colors.border }}>
            <Ionicons name="location-outline" size={36} color={theme.colors.textSecondary} />
            <Text style={{ fontSize: 13, marginTop: 10, textAlign: 'center', fontStyle: 'italic', color: theme.colors.textSecondary }}>
              {anonymous
                ? 'No location was captured — this person is not tied to a school, so none is needed.'
                : 'No location was captured for this registration.'}
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Decision */}
      <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingVertical: 16, paddingBottom: insets.bottom + 14, borderTopWidth: 1, borderTopColor: theme.colors.border, backgroundColor: theme.colors.surface }}>
        <TouchableOpacity
          style={[styles.btn, { backgroundColor: '#EF4444', opacity: busy ? 0.5 : 1 }]}
          onPress={() => setRejecting(true)}
          disabled={busy}
          activeOpacity={0.85}
        >
          <Ionicons name="close-circle-outline" size={20} color="#fff" style={{ marginRight: 8 }} />
          <Text style={styles.btnText}>Reject</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, { backgroundColor: '#10B981', opacity: busy ? 0.5 : 1 }]}
          onPress={approve}
          disabled={busy}
          activeOpacity={0.85}
        >
          <Ionicons name="checkmark-circle-outline" size={20} color="#fff" style={{ marginRight: 8 }} />
          <Text style={styles.btnText}>Approve</Text>
        </TouchableOpacity>
      </View>

      <RejectReasonModal
        visible={rejecting}
        submitting={busy}
        onClose={() => setRejecting(false)}
        title="Reject Face Registration"
        subject={`${user.name} — ${schoolName}`}
        placeholder="e.g. Face not clearly visible, or the location is not the school…"
        onSubmit={reject}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  btn: { flex: 1, flexDirection: 'row', paddingVertical: 15, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
