import React, { useState, useEffect, useContext } from 'react';
import { View, Text, StyleSheet, Modal, FlatList, TouchableOpacity, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemeContext } from '../context/ThemeContext';

/**
 * Multi-select sheet for assigning Teams to a head. Teams are passed in via the
 * `teams` prop (already fetched by the parent). `selectedIds` seeds the current
 * selection; `onSelect` returns the array of selected team ids.
 */
export default function TeamMultiSelectModal({ visible, onClose, onSelect, teams = [], selectedIds = [] }) {
  const { theme } = useContext(ThemeContext);
  const [localSelection, setLocalSelection] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (visible) {
      setLocalSelection(selectedIds || []);
      setSearchQuery('');
    }
  }, [visible, selectedIds]);

  const toggleSelection = (id) => {
    if (localSelection.includes(id)) {
      setLocalSelection(localSelection.filter(x => x !== id));
    } else {
      setLocalSelection([...localSelection, id]);
    }
  };

  const handleConfirm = () => {
    onSelect(localSelection);
    onClose();
  };

  const renderItem = ({ item }) => {
    const isSelected = localSelection.includes(item._id);
    return (
      <TouchableOpacity
        style={[styles.row, { backgroundColor: isSelected ? theme.colors.surface : theme.colors.background, borderColor: isSelected ? theme.colors.primary : theme.colors.border }]}
        onPress={() => toggleSelection(item._id)}
      >
        <Ionicons name="people-circle-outline" size={30} color={isSelected ? theme.colors.primary : theme.colors.textSecondary} />
        <View style={styles.info}>
          <Text style={[styles.name, { color: theme.colors.textPrimary }]}>{item.name}</Text>
          {typeof item.memberCount === 'number' && (
            <Text style={[styles.meta, { color: theme.colors.textSecondary }]}>{item.memberCount} member{item.memberCount === 1 ? '' : 's'}</Text>
          )}
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
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { backgroundColor: theme.colors.background, borderColor: theme.colors.border }]}>

          <View style={[styles.header, { borderBottomColor: theme.colors.border }]}>
            <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>Assign Teams</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={theme.colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <View style={{ padding: 16, paddingBottom: 0 }}>
            <View style={[styles.searchBox, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
              <Ionicons name="search" size={20} color={theme.colors.textSecondary} style={{ marginRight: 8 }} />
              <TextInput
                style={{ flex: 1, color: theme.colors.textPrimary }}
                placeholder="Search teams..."
                placeholderTextColor={theme.colors.placeholder}
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
            </View>
          </View>

          {localSelection.length > 0 && (
            <View style={{ padding: 16, paddingBottom: 0 }}>
              <Text style={{ fontSize: 12, color: theme.colors.textSecondary, marginBottom: 8 }}>Selected:</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {teams.filter(t => localSelection.includes(t._id)).map(t => (
                  <TouchableOpacity
                    key={t._id}
                    style={[styles.pill, { backgroundColor: theme.colors.primary + '20', borderColor: theme.colors.primary }]}
                    onPress={() => toggleSelection(t._id)}
                  >
                    <Text style={{ color: theme.colors.primary, fontSize: 12, fontWeight: '600', marginRight: 4 }}>{t.name}</Text>
                    <Ionicons name="close-circle" size={16} color={theme.colors.primary} />
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          <FlatList
            data={teams.filter(t => t.name.toLowerCase().includes(searchQuery.toLowerCase()))}
            keyExtractor={item => item._id}
            renderItem={renderItem}
            contentContainerStyle={{ padding: 16 }}
            ListEmptyComponent={<Text style={{ textAlign: 'center', color: theme.colors.textSecondary, marginTop: 20 }}>No teams found. Create one first.</Text>}
          />

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
  row: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 8 },
  info: { flex: 1, marginLeft: 12 },
  name: { fontSize: 15, fontWeight: 'bold' },
  meta: { fontSize: 11, marginTop: 2 },
  footer: { flexDirection: 'row', padding: 16, borderTopWidth: 1, justifyContent: 'space-between' },
  btn: { flex: 1, padding: 14, borderRadius: 12, alignItems: 'center', marginHorizontal: 8 },
});
