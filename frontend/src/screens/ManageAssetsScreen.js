import React, { useState, useEffect, useContext } from 'react';
import { 
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert, RefreshControl 
} from 'react-native';
import { ThemeContext } from '../context/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import api from '../services/api';
import Avatar from '../components/Avatar';
import CustomAlert from '../components/CustomAlert';
import EditUserModal from '../components/EditUserModal';

export default function ManageAssetsScreen({ navigation }) {
  const { theme } = useContext(ThemeContext);
  const insets = useSafeAreaInsets();
  
  const [activeTab, setActiveTab] = useState('trainer');
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  
  const [alertConfig, setAlertConfig] = useState({ visible: false, title: '', message: '', type: 'info', buttons: [] });
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);

  const [schools, setSchools] = useState([]);
  const [teamLeaders, setTeamLeaders] = useState([]);

  useEffect(() => {
    fetchData();
  }, [activeTab, page]);

  useEffect(() => {
    fetchMetadata();
  }, []);

  const fetchMetadata = async () => {
    try {
      const [schoolRes, tlRes] = await Promise.all([
        api.get('/admin/schools'),
        api.get('/admin/team-leaders')
      ]);
      setSchools(schoolRes.data.data);
      setTeamLeaders(tlRes.data.data);
    } catch (error) {
      console.log('Error fetching metadata');
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const role = activeTab === 'trainer' ? 'trainer' : activeTab === 'chairman' ? 'chairman' : 'team_leader';
      const res = await api.get(`/admin/users?role=${role}&page=${page}&limit=10`);
      setData(res.data.data);
      setTotalPages(res.data.pagination.pages || 1);
    } catch (error) {
      showAlert('Error', 'Failed to fetch data.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = React.useCallback(() => {
    setRefreshing(true);
    fetchData().finally(() => setRefreshing(false));
  }, [activeTab, page]);

  const showAlert = (title, message, type = 'info', buttons = []) => {
    setAlertConfig({ visible: true, title, message, type, buttons });
  };

  const handleDeleteClick = (user) => {
    showAlert('Confirm Deletion', `Are you sure you want to delete ${user.name}?`, 'warning', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', type: 'primary', onPress: () => performDelete(user._id) }
    ]);
  };

  const performDelete = async (id) => {
    try {
      await api.delete(`/admin/user/${id}`);
      showAlert('Success', 'User deleted successfully.', 'success');
      fetchData();
    } catch (error) {
      const msg = error.response?.data?.error || 'Failed to delete user.';
      showAlert('Deletion Failed', msg, 'error');
    }
  };

  const handleEditClick = (user) => {
    setSelectedUser(user);
    setEditModalVisible(true);
  };

  const renderItem = ({ item }) => (
    <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
      <View style={styles.cardHeader}>
        <Avatar name={item.name} size={40} />
        <View style={styles.cardInfo}>
          <Text style={[styles.cardName, { color: theme.colors.textPrimary }]}>{item.name}</Text>
          <Text style={[styles.cardEmail, { color: theme.colors.textSecondary }]}>{item.email}</Text>
        </View>
      </View>
      
      {activeTab === 'trainer' && (
        <View style={styles.extraInfo}>
          <Text style={[styles.detailText, { color: theme.colors.textSecondary }]}>
            School: {item.schoolId ? item.schoolId.name : 'Not Assigned'}
          </Text>
          <Text style={[styles.detailText, { color: theme.colors.textSecondary }]}>
            TL: {item.teamLeaderId ? item.teamLeaderId.name : 'Not Assigned'}
          </Text>
        </View>
      )}

      {activeTab === 'chairman' && item.schoolId && (
        <View style={styles.extraInfo}>
          <Text style={[styles.detailText, { color: theme.colors.textSecondary }]}>
            School: {item.schoolId.name}
          </Text>
        </View>
      )}

      <View style={styles.actions}>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: theme.colors.primary }]} onPress={() => handleEditClick(item)}>
          <Ionicons name="pencil" size={16} color="#FFF" />
          <Text style={styles.actionBtnText}>Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: theme.colors.error || '#e74c3c' }]} onPress={() => handleDeleteClick(item)}>
          <Ionicons name="trash" size={16} color="#FFF" />
          <Text style={styles.actionBtnText}>Delete</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const TabButton = ({ title, value }) => (
    <TouchableOpacity 
      style={[styles.tabBtn, activeTab === value && { borderBottomColor: theme.colors.primary }, { borderBottomColor: theme.colors.border }]}
      onPress={() => { setActiveTab(value); setPage(1); }}
    >
      <Text style={[styles.tabText, { color: theme.colors.textSecondary }, activeTab === value && { color: theme.colors.primary, fontWeight: 'bold' }]}>
        {title}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: theme.colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ paddingRight: 10 }}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>Manage Assets</Text>
      </View>

      <View style={styles.tabsContainer}>
        <TabButton title="Trainers" value="trainer" />
        <TabButton title="Chairmen" value="chairman" />
        <TabButton title="Team Leaders" value="team_leader" />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => item._id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={<Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>No data found.</Text>}
          refreshControl={
            <RefreshControl 
              refreshing={refreshing} 
              onRefresh={onRefresh} 
              tintColor={theme.colors.primary} 
              colors={[theme.colors.primary]} 
              progressBackgroundColor={theme.colors.surface}
            />
          }
        />
      )}

      {/* Pagination Controls */}
      <View style={[styles.pagination, { borderTopColor: theme.colors.border, backgroundColor: theme.colors.surface, paddingBottom: insets.bottom + 10 }]}>
        <TouchableOpacity 
          disabled={page === 1} 
          onPress={() => setPage(page - 1)}
          style={[styles.pageBtn, page === 1 && { opacity: 0.5 }]}
        >
          <Ionicons name="chevron-back" size={20} color={theme.colors.primary} />
        </TouchableOpacity>
        
        <Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>
          Page {page} of {totalPages}
        </Text>

        <TouchableOpacity 
          disabled={page === totalPages || totalPages === 0} 
          onPress={() => setPage(page + 1)}
          style={[styles.pageBtn, (page === totalPages || totalPages === 0) && { opacity: 0.5 }]}
        >
          <Ionicons name="chevron-forward" size={20} color={theme.colors.primary} />
        </TouchableOpacity>
      </View>

      <CustomAlert 
        visible={alertConfig.visible}
        title={alertConfig.title}
        message={alertConfig.message}
        type={alertConfig.type}
        buttons={alertConfig.buttons}
        onDismiss={() => setAlertConfig({ ...alertConfig, visible: false })}
      />

      <EditUserModal 
        visible={editModalVisible}
        user={selectedUser}
        role={activeTab}
        schools={schools}
        teamLeaders={teamLeaders}
        onClose={() => setEditModalVisible(false)}
        onSuccess={() => {
          setEditModalVisible(false);
          showAlert('Success', 'User updated successfully', 'success');
          fetchData();
        }}
        onError={(err) => showAlert('Error', err, 'error')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1 },
  headerTitle: { fontSize: 20, fontWeight: 'bold' },
  tabsContainer: { flexDirection: 'row', paddingHorizontal: 20 },
  tabBtn: { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2 },
  tabText: { fontWeight: '600' },
  listContent: { padding: 20 },
  card: { padding: 16, borderRadius: 12, borderWidth: 1, marginBottom: 16 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  cardInfo: { marginLeft: 12, flex: 1 },
  cardName: { fontSize: 16, fontWeight: 'bold' },
  cardEmail: { fontSize: 13, marginTop: 2 },
  extraInfo: { marginBottom: 12, padding: 8, backgroundColor: 'rgba(0,0,0,0.03)', borderRadius: 8 },
  detailText: { fontSize: 13, marginBottom: 4 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6 },
  actionBtnText: { color: '#FFF', fontSize: 13, fontWeight: '600', marginLeft: 4 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { textAlign: 'center', marginTop: 40 },
  pagination: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderTopWidth: 1 },
  pageBtn: { padding: 8 },
});
