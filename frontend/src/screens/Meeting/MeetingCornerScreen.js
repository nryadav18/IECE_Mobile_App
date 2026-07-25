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
import { getMeetings, deleteMeeting, meetingError } from '../../services/meeting';

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
  const [busyId, setBusyId] = useState(null);

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

  const confirmDelete = (meeting) => {
    showAlert('Remove Meeting', 'Remove this meeting from the corner?', 'warning', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setBusyId(meeting._id);
          try {
            await deleteMeeting(meeting._id);
            await load();
          } catch (e) {
            showAlert('Error', meetingError(e), 'error');
          } finally {
            setBusyId(null);
          }
        },
      },
    ]);
  };

  const MeetingCard = ({ meeting }) => {
    const mine = String(meeting.createdBy?._id || meeting.createdBy) === String(user?._id || user?.id);
    const canRemove = mine || isAdmin;
    const sharedCount = Array.isArray(meeting.recipients) ? meeting.recipients.length : 0;
    return (
      <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <MeetingPlatformBadge platform={meeting.platform} size="md" />
          {canRemove && (
            <TouchableOpacity
              onPress={() => confirmDelete(meeting)}
              disabled={busyId === meeting._id}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{ opacity: busyId === meeting._id ? 0.4 : 1 }}
            >
              <Ionicons name="trash-outline" size={18} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>

        <Text style={{ color: theme.colors.textPrimary, fontSize: 15, fontWeight: '700', marginTop: 12 }}>
          {meeting.agenda}
        </Text>

        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
          <Avatar name={meeting.createdBy?.name} size={26} />
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12.5, marginLeft: 8, flex: 1 }} numberOfLines={1}>
            {meeting.createdBy?.name || 'Unknown'} · {roleLabel(meeting.createdBy?.role)}
          </Text>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 11.5 }}>{timeAgo(meeting.createdAt)}</Text>
        </View>

        {(mine || isAdmin) && sharedCount > 0 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
            <Ionicons name="people-outline" size={14} color={theme.colors.textSecondary} />
            <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginLeft: 5 }}>
              Shared with {sharedCount} {sharedCount > 1 ? 'people' : 'person'}
            </Text>
          </View>
        )}

        <TouchableOpacity
          style={{ marginTop: 14, backgroundColor: '#10B981', borderRadius: 12, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}
          onPress={() => join(meeting)}
          activeOpacity={0.85}
        >
          <Ionicons name="videocam" size={18} color="#fff" />
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15, marginLeft: 8 }}>Join Now</Text>
        </TouchableOpacity>
      </View>
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
