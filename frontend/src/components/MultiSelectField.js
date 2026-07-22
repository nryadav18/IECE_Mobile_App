import React, { useState, useEffect, useContext } from 'react';
import { View, Text, StyleSheet, Modal, FlatList, TouchableOpacity, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemeContext } from '../context/ThemeContext';

/**
 * Generic labelled multi-select field. Shows the current selection as pills in a
 * trigger box; tapping it opens a searchable checkbox sheet. Self-contained — it
 * owns its modal open state so it can be dropped straight into a Formik form:
 *
 *   <MultiSelectField
 *     label="Assign School(s)"
 *     data={schools}                       // [{ _id, name }]
 *     selectedIds={values.schoolIds}
 *     onChange={(ids) => setFieldValue('schoolIds', ids)}
 *     placeholder="Select one or more schools"
 *   />
 */
export default function MultiSelectField({
  label,
  data = [],
  selectedIds = [],
  onChange,
  placeholder = 'Select one or more options',
  keyExtractor = (item) => item._id,
  labelExtractor = (item) => item.name,
  emptyText = 'No options available.',
  title,
}) {
  const { theme } = useContext(ThemeContext);
  const [isOpen, setIsOpen] = useState(false);
  const [localSelection, setLocalSelection] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (isOpen) {
      setLocalSelection(selectedIds || []);
      setSearchQuery('');
    }
  }, [isOpen]);

  const toggle = (id) => {
    setLocalSelection((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const confirm = () => {
    onChange(localSelection);
    setIsOpen(false);
  };

  const selectedItems = data.filter((d) => (selectedIds || []).includes(keyExtractor(d)));
  const filtered = data.filter((d) =>
    labelExtractor(d).toLowerCase().includes(searchQuery.toLowerCase())
  );

  const renderItem = ({ item }) => {
    const isSelected = localSelection.includes(keyExtractor(item));
    return (
      <TouchableOpacity
        style={[
          styles.row,
          {
            backgroundColor: isSelected ? theme.colors.surface : theme.colors.background,
            borderColor: isSelected ? theme.colors.primary : theme.colors.border,
          },
        ]}
        onPress={() => toggle(keyExtractor(item))}
      >
        <Ionicons name="school-outline" size={24} color={isSelected ? theme.colors.primary : theme.colors.textSecondary} />
        <View style={styles.info}>
          <Text style={[styles.name, { color: theme.colors.textPrimary }]}>{labelExtractor(item)}</Text>
          {item.state ? (
            <Text style={[styles.meta, { color: theme.colors.textSecondary }]}>{item.state}</Text>
          ) : null}
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
    <View style={{ marginBottom: 16 }}>
      {label ? <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{label}</Text> : null}

      <TouchableOpacity
        style={[styles.trigger, { borderColor: theme.colors.border, backgroundColor: theme.colors.background }]}
        onPress={() => setIsOpen(true)}
        activeOpacity={0.7}
      >
        {selectedItems.length > 0 ? (
          <View style={styles.pillWrap}>
            {selectedItems.map((s) => (
              <View
                key={keyExtractor(s)}
                style={[styles.pill, { backgroundColor: theme.colors.primary + '20', borderColor: theme.colors.primary }]}
              >
                <Text style={{ color: theme.colors.primary, fontSize: 12, fontWeight: '600' }}>{labelExtractor(s)}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={{ color: theme.colors.placeholder, fontSize: 14 }}>{placeholder}</Text>
        )}
        <Ionicons name="chevron-down" size={20} color={theme.colors.textSecondary} />
      </TouchableOpacity>

      <Modal visible={isOpen} animationType="slide" transparent onRequestClose={() => setIsOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.colors.background, borderColor: theme.colors.border }]}>
            <View style={[styles.header, { borderBottomColor: theme.colors.border }]}>
              <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>{title || label || 'Select'}</Text>
              <TouchableOpacity onPress={() => setIsOpen(false)}>
                <Ionicons name="close" size={24} color={theme.colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <View style={{ padding: 16, paddingBottom: 0 }}>
              <View style={[styles.searchBox, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
                <Ionicons name="search" size={20} color={theme.colors.textSecondary} style={{ marginRight: 8 }} />
                <TextInput
                  style={{ flex: 1, color: theme.colors.textPrimary }}
                  placeholder="Search..."
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
                  {data.filter((d) => localSelection.includes(keyExtractor(d))).map((d) => (
                    <TouchableOpacity
                      key={keyExtractor(d)}
                      style={[styles.pill, { backgroundColor: theme.colors.primary + '20', borderColor: theme.colors.primary }]}
                      onPress={() => toggle(keyExtractor(d))}
                    >
                      <Text style={{ color: theme.colors.primary, fontSize: 12, fontWeight: '600', marginRight: 4 }}>{labelExtractor(d)}</Text>
                      <Ionicons name="close-circle" size={16} color={theme.colors.primary} />
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            <FlatList
              data={filtered}
              keyExtractor={(item) => keyExtractor(item)}
              renderItem={renderItem}
              contentContainerStyle={{ padding: 16 }}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={<Text style={{ textAlign: 'center', color: theme.colors.textSecondary, marginTop: 20 }}>{emptyText}</Text>}
            />

            <View style={[styles.footer, { borderTopColor: theme.colors.border }]}>
              <TouchableOpacity style={[styles.btn, { backgroundColor: theme.colors.surface }]} onPress={() => setIsOpen(false)}>
                <Text style={{ color: theme.colors.textPrimary, fontWeight: 'bold' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, { backgroundColor: theme.colors.primary }]} onPress={confirm}>
                <Text style={{ color: '#FFF', fontWeight: 'bold' }}>Confirm ({localSelection.length})</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, marginBottom: 8, fontWeight: '600' },
  trigger: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 14, borderRadius: 8, borderWidth: 1, minHeight: 50,
  },
  pillWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, flex: 1, marginRight: 8 },
  pill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { borderTopLeftRadius: 20, borderTopRightRadius: 20, height: '85%', borderWidth: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1 },
  headerTitle: { fontSize: 18, fontWeight: 'bold' },
  searchBox: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8, borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 8 },
  info: { flex: 1, marginLeft: 12 },
  name: { fontSize: 15, fontWeight: 'bold' },
  meta: { fontSize: 11, marginTop: 2 },
  footer: { flexDirection: 'row', padding: 16, borderTopWidth: 1, justifyContent: 'space-between' },
  btn: { flex: 1, padding: 14, borderRadius: 12, alignItems: 'center', marginHorizontal: 8 },
});
