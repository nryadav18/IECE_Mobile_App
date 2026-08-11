import React, { useCallback, useContext, useState } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, ActivityIndicator, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { ThemeContext } from '../context/ThemeContext';
import { AuthContext } from '../context/AuthContext';
import { useBadges } from '../context/BadgeContext';
import { canUseLeave, canUseMeetings, canUseSchoolVisit } from '../utils/roles';
import {
  getNotifications, markNotificationRead, markAllNotificationsRead,
} from '../services/inbox';

// type -> icon + colour
const META = {
  substitution_request: { icon: 'swap-horizontal', color: '#F59E0B' },
  substitution_approved: { icon: 'checkmark-circle', color: '#27AE60' },
  substitution_rejected: { icon: 'close-circle', color: '#F44336' },
  leave_request: { icon: 'calendar', color: '#F59E0B' },
  leave_approved: { icon: 'checkmark-circle', color: '#27AE60' },
  leave_rejected: { icon: 'close-circle', color: '#F44336' },
  leave_emergency: { icon: 'flash', color: '#DC2626' },
  leave_updated: { icon: 'create-outline', color: '#0D9488' },
  leave_cancelled: { icon: 'arrow-undo-circle', color: '#DC2626' },
  school_visit_request: { icon: 'business', color: '#F59E0B' },
  school_visit_approved: { icon: 'checkmark-circle', color: '#0D9488' },
  school_visit_updated: { icon: 'calendar', color: '#0D9488' },
  school_visit_rejected: { icon: 'close-circle', color: '#F44336' },
  school_visit_report_due: { icon: 'document-text', color: '#0D9488' },
  meeting_new: { icon: 'videocam', color: '#2D8CFF' },
  meeting_updated: { icon: 'create-outline', color: '#F59E0B' },
  face_rejected: { icon: 'close-circle', color: '#EF4444' },
  activity_tagged: { icon: 'pricetag', color: '#0D9488' },
  default: { icon: 'notifications', color: '#10B981' },
};

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

export default function NotificationsScreen({ navigation }) {
  const { theme } = useContext(ThemeContext);
  const { user } = useContext(AuthContext);
  const { refresh: refreshBadges } = useBadges();
  const insets = useSafeAreaInsets();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await getNotifications(1, 50);
      setItems(res?.data || []);
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

  const openItem = async (item) => {
    // Optimistically mark read.
    if (!item.read) {
      setItems((prev) => prev.map((n) => (n._id === item._id ? { ...n, read: true } : n)));
      markNotificationRead(item._id).then(() => refreshBadges()).catch(() => {});
    }
    // Deep-link only where the target screen is guaranteed to exist for this user.
    if (item.type === 'substitution_request') {
      navigation.navigate('Substitution', { initialTab: 'approvals' });
    } else if (canUseLeave(user?.role)) {
      // Leave screen exists for applicants + the Admin (not CEO).
      if (item.type === 'leave_request') {
        navigation.navigate('Leave', { initialTab: 'approvals' });
      } else if (
        item.type === 'leave_approved' ||
        item.type === 'leave_rejected' ||
        // An emergency leave the Admin granted, a window the Admin moved, or an
        // emergency leave withdrawn — all land on the same list as any other
        // outcome, where the person can see the dates that now apply.
        item.type === 'leave_emergency' ||
        item.type === 'leave_updated' ||
        item.type === 'leave_cancelled'
      ) {
        navigation.navigate('Leave', { initialTab: 'mine' });
      }
    }
    // School Visit screen exists for leaders/heads + the Admin (not CEO, not
    // trainers) — guard before navigating or the route simply won't be there.
    if (canUseSchoolVisit(user?.role)) {
      if (item.type === 'school_visit_request') {
        navigation.navigate('SchoolVisit', { initialTab: 'approvals' });
      } else if (
        item.type === 'school_visit_approved' ||
        item.type === 'school_visit_updated' ||
        item.type === 'school_visit_rejected' ||
        item.type === 'school_visit_report_due'
      ) {
        navigation.navigate('SchoolVisit', { initialTab: 'mine' });
      }
    }
    // Both approval queues live in the same hub.
    if (item.type === 'face_registration_pending' || item.type === 'activity_approval') {
      navigation.navigate('Approvals');
    }
    // An activity decision — open the activity so the uploader sees the outcome
    // and, if rejected, the reason. Same destination for an organiser who was
    // tagged in one that just went live.
    if ((item.type === 'activity_status_update' || item.type === 'activity_tagged') && item.data?.activityId) {
      navigation.navigate('ActivityDetails', { activityId: item.data.activityId });
    }
    // Open the meeting itself when we know which one; the corner is the
    // fallback for older notifications that carry no meetingId.
    if ((item.type === 'meeting_new' || item.type === 'meeting_updated') && canUseMeetings(user?.role)) {
      const meetingId = item.data?.meetingId;
      if (meetingId) navigation.navigate('MeetingDetail', { meetingId });
      else navigation.navigate('MeetingCorner');
    }
  };

  const markAll = async () => {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    try {
      await markAllNotificationsRead();
      refreshBadges();
    } catch (e) {
      load();
    }
  };

  const renderItem = ({ item }) => {
    const meta = META[item.type] || META.default;
    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => openItem(item)}
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          backgroundColor: item.read ? theme.colors.surface : theme.colors.primary + '0D',
          borderColor: theme.colors.border,
          borderWidth: 1,
          borderRadius: 14,
          padding: 14,
          marginBottom: 10,
        }}
      >
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: meta.color + '20', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={meta.icon} size={20} color={meta.color} />
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={{ color: theme.colors.textPrimary, fontWeight: item.read ? '600' : '800', fontSize: 14 }}>{item.title}</Text>
          {!!item.body && <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginTop: 3, lineHeight: 18 }}>{item.body}</Text>}
          <Text style={{ color: theme.colors.textSecondary, fontSize: 11, marginTop: 6 }}>{timeAgo(item.createdAt)}</Text>
        </View>
        {!item.read && <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: theme.colors.primary, marginTop: 4, marginLeft: 6 }} />}
      </TouchableOpacity>
    );
  };

  const hasUnread = items.some((n) => !n.read);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      {/* Header */}
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="arrow-back" size={24} color={theme.colors.textPrimary} />
          </TouchableOpacity>
          <Text style={{ color: theme.colors.textPrimary, fontSize: 19, fontWeight: '700', marginLeft: 12 }}>Notifications</Text>
        </View>
        {hasUnread && (
          <TouchableOpacity onPress={markAll} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={{ color: theme.colors.primary, fontWeight: '700', fontSize: 13 }}>Mark all read</Text>
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <ActivityIndicator color={theme.colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => String(item._id)}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, paddingBottom: 30, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={theme.colors.primary} colors={[theme.colors.primary]} />}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', marginTop: 80 }}>
              <Ionicons name="notifications-off-outline" size={56} color={theme.colors.border} />
              <Text style={{ color: theme.colors.textSecondary, marginTop: 14, fontSize: 14 }}>You’re all caught up.</Text>
            </View>
          }
        />
      )}
    </View>
  );
}
