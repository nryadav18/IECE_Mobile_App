import React, { useState, useEffect, useContext } from 'react';
import { View, Text, StyleSheet, Modal, FlatList, TouchableOpacity, ActivityIndicator, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from '../services/api';
import { ThemeContext } from '../context/ThemeContext';
import Avatar from './Avatar';

export default function UserMultiSelectModal({ visible, onClose, onSelect, selectedIds = [] }) {
  const { theme } = useContext(ThemeContext);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [localSelection, setLocalSelection] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (visible) {
      setLocalSelection(selectedIds || []);
      fetchUsers();
    }
  }, [visible, selectedIds]);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      // Fetch Trainers and Team Leaders
      const [trainersRes, tlsRes] = await Promise.all([
        api.get('/admin/users?role=trainer&limit=100'),
        api.get('/admin/users?role=team_leader&limit=100')
      ]);
      const allUsers = [...trainersRes.data.data, ...tlsRes.data.data];
      setUsers(allUsers);
    } catch (error) {
      console.log('Error fetching users:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleSelection = (userObj) => {
    const exists = localSelection.find(u => u._id === userObj._id);
    if (exists) {
      setLocalSelection(localSelection.filter(u => u._id !== userObj._id));
    } else {
      setLocalSelection([...localSelection, userObj]);
    }
  };

  const handleConfirm = () => {
    onSelect(localSelection);
    onClose();
  };

  const renderItem = ({ item }) => {
    const isSelected = !!localSelection.find(u => u._id === item._id);
    return (
      <TouchableOpacity 
        style={[styles.userRow, { backgroundColor: isSelected ? theme.colors.surface : theme.colors.background, borderColor: theme.colors.border }]}
        onPress={() => toggleSelection(item)}
      >
        <Avatar name={item.name} size={36} />
        <View style={styles.userInfo}>
          <Text style={[styles.userName, { color: theme.colors.textPrimary }]}>{item.name}</Text>
          <Text style={[styles.userRole, { color: theme.colors.textSecondary }]}>{item.role.replace('_', ' ').toUpperCase()}</Text>
        </View>
        <Ionicons 
          name={isSelected ? 'checkmark-circle' : 'ellipse-outline'} 
          size={24} 
          color={isSelected ? theme.colors.primary : theme.colors.textSecondary} 
        />
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={true} onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { backgroundColor: theme.colors.background, borderColor: theme.colors.border }]}>
          
          <View style={[styles.header, { borderBottomColor: theme.colors.border }]}>
            <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>Select Organizers</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={theme.colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {/* Search Bar */}
          <View style={{ padding: 16, paddingBottom: 0 }}>
            <View style={[styles.searchBox, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
              <Ionicons name="search" size={20} color={theme.colors.textSecondary} style={{ marginRight: 8 }} />
              <TextInput 
                style={{ flex: 1, color: theme.colors.textPrimary }}
                placeholder="Search trainers or TLs..."
                placeholderTextColor={theme.colors.placeholder}
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
            </View>
          </View>

          {/* Selected Pills */}
          {localSelection.length > 0 && (
            <View style={{ padding: 16, paddingBottom: 0 }}>
              <Text style={{ fontSize: 12, color: theme.colors.textSecondary, marginBottom: 8 }}>Selected:</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {localSelection.map(org => (
                  <TouchableOpacity 
                    key={org._id} 
                    style={[styles.pill, { backgroundColor: theme.colors.primary + '20', borderColor: theme.colors.primary }]}
                    onPress={() => toggleSelection(org)}
                  >
                    <Text style={{ color: theme.colors.primary, fontSize: 12, fontWeight: '600', marginRight: 4 }}>{org.name}</Text>
                    <Ionicons name="close-circle" size={16} color={theme.colors.primary} />
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {loading ? (
            <ActivityIndicator size="large" color={theme.colors.primary} style={{ marginTop: 20 }} />
          ) : (
            <FlatList
              data={users.filter(u => u.name.toLowerCase().includes(searchQuery.toLowerCase()))}
              keyExtractor={item => item._id}
              renderItem={renderItem}
              contentContainerStyle={{ padding: 16 }}
              ListEmptyComponent={<Text style={{ textAlign: 'center', color: theme.colors.textSecondary, marginTop: 20 }}>No users found.</Text>}
            />
          )}

          <View style={[styles.footer, { borderTopColor: theme.colors.border }]}>
            <TouchableOpacity style={[styles.btn, { backgroundColor: theme.colors.surface }]} onPress={onClose}>
              <Text style={{ color: theme.colors.textPrimary, fontWeight: 'bold' }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, { backgroundColor: theme.colors.primary }]} onPress={handleConfirm}>
              <Text style={{ color: '#FFF', fontWeight: 'bold' }}>Confirm Selection</Text>
            </TouchableOpacity>
          </View>
          
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { borderTopLeftRadius: 20, borderTopRightRadius: 20, height: '85%', borderWidth: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1 },
  headerTitle: { fontSize: 18, fontWeight: 'bold' },
  searchBox: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8, borderWidth: 1 },
  pill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  userRow: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 8 },
  userInfo: { flex: 1, marginLeft: 12 },
  userName: { fontSize: 15, fontWeight: 'bold' },
  userRole: { fontSize: 11, marginTop: 2 },
  footer: { flexDirection: 'row', padding: 16, borderTopWidth: 1, justifyContent: 'space-between' },
  btn: { flex: 1, padding: 14, borderRadius: 12, alignItems: 'center', marginHorizontal: 8 }
});
