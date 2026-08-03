import React, { useCallback, useContext, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, RefreshControl, Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { ThemeContext } from '../../context/ThemeContext';
import { AuthContext } from '../../context/AuthContext';
import { useAlert } from '../../context/AlertContext';
import { roleLabel, canPostMeeting } from '../../utils/roles';
import Avatar from '../../components/Avatar';
import NotificationBell from '../../components/NotificationBell';
import MeetingPlatformBadge from '../../components/MeetingPlatformBadge';
import { SkeletonList } from '../../components/Skeleton';
import { getMeetings } from '../../services/meeting';

const timeAgo = (d) => {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
};

export default function MeetingCornerScreen({ navigation }) {
  const { theme } = useContext(ThemeContext);
  const { user } = useContext(AuthContext);
  const { showAlert } = useAlert();
  const insets = useSafeAreaInsets();

  const canPost = canPostMeeting(user?.role);
  const isAdmin = user?.role === 'creator_admin';

  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await getMeetings();
      setMeetings(res?.data || []);
    } catch (e) {
      // keep old data
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const join = (meeting) => {
    Linking.openURL(meeting.link).catch(() =>
      showAlert('Could not open', 'Unable to open this meeting link. It may be invalid.', 'error')
    );
  };

  const openDetail = (meeting) => navigation.navigate('MeetingDetail', { meeting, meetingId: meeting._id });

  // Compact thumbnail: platform, a trimmed agenda, who posted it and when, plus
  // the two things people actually want from the list — open it, or join it.
  // Everything else (full agenda, the raw link, the recipient list, edit and
  // remove) lives on the detail screen.
  const MeetingCard = ({ meeting }) => {
    const mine = String(meeting.createdBy?._id || meeting.createdBy) === String(user?._id || user?.id);
    const sharedCount = Array.isArray(meeting.recipients) ? meeting.recipients.length : 0;
    const wasEdited = !!meeting.updatedBy;

    return (
      <TouchableOpacity
        style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
        onPress={() => openDetail(meeting)}
        activeOpacity={0.75}
      >
        {/* Row 1 — platform, edited flag, and the affordance that this opens */}
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <MeetingPlatformBadge platform={meeting.platform} size="md" />
          {wasEdited && (
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#F59E0B18', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3, marginLeft: 8 }}>
              <Ionicons name="create-outline" size={11} color="#D97706" />
              <Text style={{ color: '#D97706', fontSize: 9.5, fontWeight: '800', marginLeft: 3 }}>EDITED</Text>
            </View>
          )}
          <View style={{ flex: 1 }} />
          <Text style={{ color: theme.colors.textSecondary, fontSize: 11.5 }}>{timeAgo(meeting.createdAt)}</Text>
          <Ionicons name="chevron-forward" size={16} color={theme.colors.textSecondary} style={{ marginLeft: 4 }} />
        </View>

        {/* Row 2 — the agenda, trimmed. The full text is on the detail screen. */}
        <Text
          style={{ color: theme.colors.textPrimary, fontSize: 15, fontWeight: '700', marginTop: 12, lineHeight: 21 }}
          numberOfLines={2}
        >
          {meeting.agenda}
        </Text>

        {/* Row 3 — who posted it, and how widely it was shared */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
          <Avatar name={meeting.createdBy?.name} size={26} />
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12.5, marginLeft: 8, flex: 1 }} numberOfLines={1}>
            {meeting.createdBy?.name || 'Unknown'} · {roleLabel(meeting.createdBy?.role)}
          </Text>
          {(mine || isAdmin) && sharedCount > 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 8 }}>
              <Ionicons name="people-outline" size={13} color={theme.colors.textSecondary} />
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginLeft: 4 }}>{sharedCount}</Text>
            </View>
          )}
        </View>

        {/* Row 4 — actions. Join is one tap from the list; details are a tap away. */}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
          <TouchableOpacity
            style={{ flex: 1, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}
            onPress={() => openDetail(meeting)}
            activeOpacity={0.8}
          >
            <Ionicons name="information-circle-outline" size={17} color={theme.colors.textPrimary} />
            <Text style={{ color: theme.colors.textPrimary, fontWeight: '700', fontSize: 14, marginLeft: 6 }}>Details</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={{ flex: 1, backgroundColor: '#10B981', borderRadius: 12, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}
            onPress={() => join(meeting)}
            activeOpacity={0.85}
          >
            <Ionicons name="videocam" size={17} color="#fff" />
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14, marginLeft: 6 }}>Join Now</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
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
            <Text style={{ color: theme.colors.textPrimary, fontSize: 19, fontWeight: '700', marginLeft: 12 }}>Meeting Corner</Text>
          </View>
          <NotificationBell navigation={navigation} />
        </View>
      </View>

      {/* Post button (creators only) */}
      {canPost && (
        <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
          <TouchableOpacity
            style={{ backgroundColor: theme.colors.primary, borderRadius: 12, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}
            onPress={() => navigation.navigate('CreateMeeting')}
            activeOpacity={0.85}
          >
            <Ionicons name="add-circle-outline" size={19} color="#fff" />
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15, marginLeft: 8 }}>Post Meeting Link</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Feed */}
      <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 12 }}>
        {loading ? (
          <SkeletonList count={4} avatar={false} lines={2} />
        ) : meetings.length === 0 ? (
          <View style={{ alignItems: 'center', marginTop: 70 }}>
            <Ionicons name="videocam-outline" size={54} color={theme.colors.border} />
            <Text style={{ color: theme.colors.textSecondary, marginTop: 14, fontSize: 14, textAlign: 'center' }}>
              No meetings yet.{canPost ? '\nPost a link to share one with your team.' : ''}
            </Text>
          </View>
        ) : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 30 }}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={theme.colors.primary} colors={[theme.colors.primary]} />
            }
          >
            {meetings.map((m) => (
              <MeetingCard key={m._id} meeting={m} />
            ))}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 12 },
});
