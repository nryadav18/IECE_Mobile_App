import React, { useCallback, useContext, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, RefreshControl, Linking, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { ThemeContext } from '../../context/ThemeContext';
import { AuthContext } from '../../context/AuthContext';
import { useAlert } from '../../context/AlertContext';
import { roleLabel } from '../../utils/roles';
import Avatar from '../../components/Avatar';
import MeetingPlatformBadge from '../../components/MeetingPlatformBadge';
import { platformMeta } from '../../utils/meetingPlatform';
import { getMeeting, deleteMeeting, meetingError } from '../../services/meeting';

const fullDateTime = (d) =>
  new Date(d).toLocaleString('en-GB', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

/**
 * Everything about one meeting. The corner shows only a compact thumbnail, so
 * this is where the full agenda, the raw link, and the complete recipient list
 * live — and where the creator / an admin edits or removes it.
 *
 * Accepts either a `meeting` object (tapped from the feed, renders instantly)
 * or just a `meetingId` (opened from a notification), and refetches on focus so
 * it is correct after an edit.
 */
export default function MeetingDetailScreen({ navigation, route }) {
  const { theme } = useContext(ThemeContext);
  const { user } = useContext(AuthContext);
  const { showAlert } = useAlert();
  const insets = useSafeAreaInsets();

  const passed = route?.params?.meeting || null;
  const meetingId = route?.params?.meetingId || passed?._id;

  const [meeting, setMeeting] = useState(passed);
  const [loading, setLoading] = useState(!passed);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async (isRefresh = false) => {
    if (!meetingId) return;
    if (isRefresh) setRefreshing(true);
    try {
      const res = await getMeeting(meetingId);
      setMeeting(res?.data || null);
      setError(null);
    } catch (e) {
      // Only surface the failure when there is nothing to show; otherwise keep
      // the copy we already have on screen.
      if (!meeting) setError(meetingError(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [meetingId, meeting]);

  // Refetch on focus so returning from the edit screen shows the new values.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [meetingId])
  );

  const mine = String(meeting?.createdBy?._id || meeting?.createdBy) === String(user?._id || user?.id);
  const isAdmin = user?.role === 'creator_admin';
  const canManage = !!meeting && (mine || isAdmin);

  const join = () => {
    Linking.openURL(meeting.link).catch(() =>
      showAlert('Could not open', 'Unable to open this meeting link. It may be invalid.', 'error')
    );
  };

  const confirmDelete = () => {
    showAlert('Remove Meeting', 'Remove this meeting from the corner?', 'warning', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await deleteMeeting(meeting._id);
            navigation.goBack();
          } catch (e) {
            showAlert('Error', meetingError(e), 'error');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const Header = () => (
    <View style={{
      paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 12,
      backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.border,
      flexDirection: 'row', alignItems: 'center',
    }}>
      <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Ionicons name="arrow-back" size={24} color={theme.colors.textPrimary} />
      </TouchableOpacity>
      <Text style={{ color: theme.colors.textPrimary, fontSize: 19, fontWeight: '700', marginLeft: 12, flex: 1 }}>
        Meeting Details
      </Text>
      {canManage && (
        <TouchableOpacity
          onPress={() => navigation.navigate('CreateMeeting', { meeting })}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={{ flexDirection: 'row', alignItems: 'center' }}
        >
          <Ionicons name="create-outline" size={20} color={theme.colors.primary} />
          <Text style={{ color: theme.colors.primary, fontWeight: '700', fontSize: 14, marginLeft: 5 }}>Edit</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <Header />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      </View>
    );
  }

  if (!meeting) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <Header />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <Ionicons name="videocam-off-outline" size={54} color={theme.colors.border} />
          <Text style={{ color: theme.colors.textSecondary, marginTop: 14, fontSize: 14, textAlign: 'center' }}>
            {error || 'This meeting is no longer available.'}
          </Text>
        </View>
      </View>
    );
  }

  const meta = platformMeta(meeting.platform);
  const recipients = Array.isArray(meeting.recipients) ? meeting.recipients : [];
  const wasEdited = !!meeting.updatedBy;

  const Section = ({ icon, title, children }) => (
    <View style={{
      backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border,
      borderRadius: 16, padding: 14, marginBottom: 12,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
        <Ionicons name={icon} size={15} color={theme.colors.textSecondary} />
        <Text style={{
          color: theme.colors.textSecondary, fontSize: 11.5, fontWeight: '800',
          letterSpacing: 0.6, textTransform: 'uppercase', marginLeft: 7,
        }}>
          {title}
        </Text>
      </View>
      {children}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Header />

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={theme.colors.primary} colors={[theme.colors.primary]} />
        }
      >
        {/* Platform + agenda headline */}
        <View style={{
          backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border,
          borderRadius: 16, padding: 16, marginBottom: 12,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <MeetingPlatformBadge platform={meeting.platform} size="md" />
            {wasEdited && (
              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#F59E0B18', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
                <Ionicons name="create-outline" size={12} color="#D97706" />
                <Text style={{ color: '#D97706', fontSize: 10.5, fontWeight: '800', marginLeft: 4 }}>EDITED</Text>
              </View>
            )}
          </View>
          <Text style={{ color: theme.colors.textPrimary, fontSize: 18, fontWeight: '800', marginTop: 14, lineHeight: 25 }}>
            {meeting.agenda}
          </Text>
        </View>

        {/* Who posted it, and when */}
        <Section icon="person-outline" title="Posted by">
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Avatar name={meeting.createdBy?.name} size={40} />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={{ color: theme.colors.textPrimary, fontSize: 14.5, fontWeight: '700' }} numberOfLines={1}>
                {meeting.createdBy?.name || 'Unknown'}
              </Text>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12.5, marginTop: 1 }}>
                {roleLabel(meeting.createdBy?.role)}
              </Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
            <Ionicons name="time-outline" size={14} color={theme.colors.textSecondary} />
            <Text style={{ color: theme.colors.textSecondary, fontSize: 12.5, marginLeft: 6 }}>
              Shared on {fullDateTime(meeting.createdAt)}
            </Text>
          </View>
          {wasEdited && (
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginTop: 8 }}>
              <Ionicons name="create-outline" size={14} color="#D97706" style={{ marginTop: 1 }} />
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12.5, marginLeft: 6, flex: 1 }}>
                Last edited by {meeting.updatedBy?.name || 'someone'} on {fullDateTime(meeting.updatedAt)}
              </Text>
            </View>
          )}
        </Section>

        {/* The raw link, so people can copy it or see where it goes */}
        <Section icon="link-outline" title="Meeting link">
          <Text selectable style={{ color: meta.color, fontSize: 13, fontWeight: '600', lineHeight: 19 }}>
            {meeting.link}
          </Text>
        </Section>

        {/* Full recipient list */}
        <Section icon="people-outline" title={`Shared with ${recipients.length} ${recipients.length === 1 ? 'person' : 'people'}`}>
          {recipients.length === 0 ? (
            <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>No recipients on this meeting.</Text>
          ) : (
            recipients.map((r, i) => (
              <View
                key={r?._id || i}
                style={{
                  flexDirection: 'row', alignItems: 'center', paddingVertical: 8,
                  borderTopWidth: i === 0 ? 0 : 1, borderTopColor: theme.colors.border,
                }}
              >
                <Avatar name={r?.name} size={32} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={{ color: theme.colors.textPrimary, fontSize: 13.5, fontWeight: '600' }} numberOfLines={1}>
                    {r?.name || 'Unknown'}
                  </Text>
                  <Text style={{ color: theme.colors.textSecondary, fontSize: 11.5, marginTop: 1 }}>
                    {roleLabel(r?.role)}
                  </Text>
                </View>
              </View>
            ))
          )}
        </Section>

        {canManage && (
          <TouchableOpacity
            onPress={confirmDelete}
            disabled={busy}
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
              borderWidth: 1, borderColor: '#EF4444', borderRadius: 12,
              paddingVertical: 13, marginTop: 4, opacity: busy ? 0.5 : 1,
            }}
          >
            <Ionicons name="trash-outline" size={17} color="#EF4444" />
            <Text style={{ color: '#EF4444', fontWeight: '700', fontSize: 14.5, marginLeft: 8 }}>Remove Meeting</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Join is the primary action — pinned so it is always one tap away. */}
      <View style={{
        padding: 16, paddingBottom: insets.bottom + 12,
        backgroundColor: theme.colors.surface, borderTopWidth: 1, borderTopColor: theme.colors.border,
      }}>
        <TouchableOpacity
          style={{
            backgroundColor: '#10B981', borderRadius: 12, paddingVertical: 15,
            flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
          }}
          onPress={join}
          activeOpacity={0.85}
        >
          <Ionicons name="videocam" size={19} color="#fff" />
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15.5, marginLeft: 8 }}>Join Now</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
