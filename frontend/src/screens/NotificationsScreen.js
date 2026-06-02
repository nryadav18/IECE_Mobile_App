import React, { useState, useEffect, useContext } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl } from 'react-native';
import { ThemeContext } from '../context/ThemeContext';
import { AuthContext } from '../context/AuthContext';
import api from '../services/api';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { MotiView } from 'moti';
import ScreenLoader from '../components/ScreenLoader';

export default function NotificationsScreen({ navigation }) {
  const { theme } = useContext(ThemeContext);
  const { user } = useContext(AuthContext);
  const insets = useSafeAreaInsets();
  
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchNotifications = async () => {
    try {
      const res = await api.get('/notifications');
      setNotifications(res.data.data);
    } catch (error) {
      console.log('Error fetching notifications:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifications();
  }, []);

  const onRefresh = React.useCallback(() => {
    setRefreshing(true);
    fetchNotifications().finally(() => setRefreshing(false));
  }, []);

  const handleNotificationPress = async (item) => {
    try {
      if (!item.isRead) {
        await api.put(`/notifications/${item._id}/read`);
        setNotifications(notifications.map(n => n._id === item._id ? { ...n, isRead: true } : n));
      }
      
      if (item.type === 'report_approval' && user.role === 'chairman') {
        navigation.goBack(); // They are already in Chairman Portal most likely, but this is a simplified approach
      } else if (item.type === 'general' && user.role === 'creator_admin') {
        navigation.goBack();
      }
    } catch (err) {
      console.log('Failed to read notification');
    }
  };

  const handleDismiss = async (id) => {
    try {
      await api.put(`/notifications/${id}/process`);
      setNotifications(notifications.filter(n => n._id !== id));
    } catch (error) {
      console.log('Error dismissing notification', error);
    }
  };

  if (loading) return <ScreenLoader message="Loading Notifications..." />;

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: theme.colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={[styles.backBtn, { borderColor: theme.colors.border }]}>
          <Ionicons name="arrow-back" size={20} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>Notifications</Text>
        <View style={{ width: 40 }} />
      </View>

      <FlatList
        data={notifications}
        keyExtractor={item => item._id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />
        }
        contentContainerStyle={{ padding: 20 }}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="notifications-off-outline" size={48} color={theme.colors.border} />
            <Text style={{ color: theme.colors.textSecondary, marginTop: 12, fontSize: 16 }}>All caught up!</Text>
          </View>
        }
        renderItem={({ item, index }) => (
          <MotiView
            from={{ opacity: 0, translateY: 10 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ delay: index * 50 }}
            style={[styles.notificationCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderLeftColor: item.isRead ? theme.colors.border : theme.colors.primary, borderLeftWidth: 4 }]}
          >
            <TouchableOpacity style={{ flex: 1 }} onPress={() => handleNotificationPress(item)}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                <Text style={{ color: theme.colors.textPrimary, fontWeight: '700', fontSize: 16, flex: 1 }}>{item.title}</Text>
                <TouchableOpacity onPress={() => handleDismiss(item._id)} style={{ padding: 4 }}>
                  <Ionicons name="close" size={20} color={theme.colors.textSecondary} />
                </TouchableOpacity>
              </View>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 14, marginBottom: 8 }}>{item.message}</Text>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>{new Date(item.createdAt).toLocaleString()}</Text>
            </TouchableOpacity>
          </MotiView>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, borderBottomWidth: 1 },
  backBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 20, fontWeight: '700' },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', marginTop: 100 },
  notificationCard: { padding: 16, borderRadius: 12, borderWidth: 1, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 5, elevation: 2 }
});
