import React, { useState, useEffect, useContext, useMemo, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, Modal, FlatList, TouchableOpacity,
  ActivityIndicator, TextInput, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from '../services/api';
import { ThemeContext } from '../context/ThemeContext';
import Avatar from './Avatar';
import { roleLabel } from '../utils/roles';

/**
 * Pick any number of people out of the WHOLE directory — every login, whatever
 * their role.
 *
 * UserMultiSelectModal already exists but deliberately offers trainers and team
 * leaders only (it picks activity organisers). This one is the opposite: it
 * makes no judgement about who belongs in the list, because its callers — the
 * banner "Invisible to" audience, say — have to be able to name a chairman, a
 * head, the CEO or another admin just as easily as a trainer.
 *
 * The directory is fetched once per app run and kept in module scope: it is a
 * few hundred rows of name/email/role, it barely changes, and re-opening the
 * picker should be instant. A background refresh still runs on every open, so a
 * newly created login appears without restarting the app.
 */

// Shared across mounts on purpose — see above.
let directoryCache = null;

const ROLE_ORDER = [
  'creator_admin', 'ceo', 'zonal_head', 'cluster_head', 'regional_head',
  'team_leader', 'trainee_team_leader', 'trainer', 'chairman',
];

const byRoleThenName = (a, b) => {
  const ra = ROLE_ORDER.indexOf(a.role);
  const rb = ROLE_ORDER.indexOf(b.role);
  if (ra !== rb) return (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb);
  return String(a.name || '').localeCompare(String(b.name || ''));
};

const ROW_HEIGHT = 64;

export default function DirectoryMultiSelectModal({
  visible,
  onClose,
  onConfirm,
  selected = [],
  title = 'Select People',
  subtitle,
  confirmLabel = 'Confirm Selection',
  excludeIds = [],
}) {
  const { theme } = useContext(ThemeContext);
  const [users, setUsers] = useState(directoryCache || []);
  const [loading, setLoading] = useState(!directoryCache);
  const [localSelection, setLocalSelection] = useState([]);
  const [query, setQuery] = useState('');
  const alive = useRef(true);

  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => {
    if (!visible) return;
    // Seed from the caller every time it opens, so cancelling really cancels.
    setLocalSelection(Array.isArray(selected) ? selected : []);
    setQuery('');
    fetchDirectory();
    // `selected` is read as the opening snapshot only; adding it here would
    // reset the user's in-progress ticks on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const fetchDirectory = async () => {
    if (!directoryCache) setLoading(true);
    try {
      const res = await api.get('/admin/directory');
      const list = (res.data?.data || []).slice().sort(byRoleThenName);
      directoryCache = list;
      if (alive.current) setUsers(list);
    } catch (error) {
      console.log('Directory fetch failed:', error?.message);
    } finally {
      if (alive.current) setLoading(false);
    }
  };

  const selectedIds = useMemo(
    () => new Set(localSelection.map((u) => String(u._id))),
    [localSelection]
  );

  const excluded = useMemo(
    () => new Set((excludeIds || []).map((id) => String(id?._id || id))),
    [excludeIds]
  );

  const visibleUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      if (excluded.has(String(u._id))) return false;
      if (!q) return true;
      return (
        String(u.name || '').toLowerCase().includes(q) ||
        String(u.email || '').toLowerCase().includes(q) ||
        roleLabel(u.role).toLowerCase().includes(q)
      );
    });
  }, [users, query, excluded]);

  const toggle = useCallback((user) => {
    setLocalSelection((prev) =>
      prev.some((u) => String(u._id) === String(user._id))
        ? prev.filter((u) => String(u._id) !== String(user._id))
        : [...prev, { _id: user._id, name: user.name, role: user.role, email: user.email }]
    );
  }, []);

  const renderItem = useCallback(({ item }) => {
    const isSelected = selectedIds.has(String(item._id));
    return (
      <TouchableOpacity
        style={[styles.row, {
          backgroundColor: isSelected ? theme.colors.primary + '12' : theme.colors.surface,
          borderColor: isSelected ? theme.colors.primary : theme.colors.border,
        }]}
        onPress={() => toggle(item)}
        activeOpacity={0.8}
      >
        <Avatar name={item.name} size={36} />
        <View style={styles.rowInfo}>
          <Text style={[styles.rowName, { color: theme.colors.textPrimary }]} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={[styles.rowMeta, { color: theme.colors.textSecondary }]} numberOfLines={1}>
            {roleLabel(item.role)}{item.email ? ` · ${item.email}` : ''}
          </Text>
        </View>
        <Ionicons
          name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
          size={24}
          color={isSelected ? theme.colors.primary : theme.colors.textSecondary}
        />
      </TouchableOpacity>
    );
  }, [selectedIds, theme, toggle]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: theme.colors.background, borderColor: theme.colors.border }]}>

          <View style={[styles.header, { borderBottomColor: theme.colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>{title}</Text>
              {!!subtitle && (
                <Text style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 2 }}>{subtitle}</Text>
              )}
            </View>
            <TouchableOpacity onPress={onClose} style={{ padding: 4 }}>
              <Ionicons name="close" size={24} color={theme.colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
            <View style={[styles.searchBox, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
              <Ionicons name="search" size={18} color={theme.colors.textSecondary} style={{ marginRight: 8 }} />
              <TextInput
                style={{ flex: 1, color: theme.colors.textPrimary, paddingVertical: 0 }}
                placeholder="Search by name, role or email…"
                placeholderTextColor={theme.colors.placeholder}
                value={query}
                onChangeText={setQuery}
                autoCorrect={false}
              />
              {!!query && (
                <TouchableOpacity onPress={() => setQuery('')}>
                  <Ionicons name="close-circle" size={18} color={theme.colors.textSecondary} />
                </TouchableOpacity>
              )}
            </View>
          </View>

          {localSelection.length > 0 && (
            <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                <Text style={{ fontSize: 12, color: theme.colors.textSecondary, flex: 1 }}>
                  Selected · {localSelection.length}
                </Text>
                <TouchableOpacity onPress={() => setLocalSelection([])}>
                  <Text style={{ fontSize: 12, color: theme.colors.primary, fontWeight: '700' }}>Clear all</Text>
                </TouchableOpacity>
              </View>
              {/* Horizontal so a long list never eats the rows below it. */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
                {localSelection.map((u) => (
                  <TouchableOpacity
                    key={String(u._id)}
                    style={[styles.pill, { backgroundColor: theme.colors.primary + '20', borderColor: theme.colors.primary }]}
                    onPress={() => toggle(u)}
                  >
                    <Text style={{ color: theme.colors.primary, fontSize: 12, fontWeight: '600', marginRight: 4 }}>
                      {u.name}
                    </Text>
                    <Ionicons name="close-circle" size={14} color={theme.colors.primary} />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          {loading ? (
            <ActivityIndicator size="large" color={theme.colors.primary} style={{ marginTop: 24 }} />
          ) : (
            <FlatList
              data={visibleUsers}
              keyExtractor={(item) => String(item._id)}
              renderItem={renderItem}
              contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
              keyboardShouldPersistTaps="handled"
              initialNumToRender={12}
              windowSize={7}
              removeClippedSubviews
              getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
              ListEmptyComponent={
                <Text style={{ textAlign: 'center', color: theme.colors.textSecondary, marginTop: 20 }}>
                  No one matches “{query}”.
                </Text>
              }
            />
          )}

          <View style={[styles.footer, { borderTopColor: theme.colors.border }]}>
            <TouchableOpacity style={[styles.btn, { backgroundColor: theme.colors.surface }]} onPress={onClose}>
              <Text style={{ color: theme.colors.textPrimary, fontWeight: 'bold' }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: theme.colors.primary }]}
              onPress={() => { onConfirm(localSelection); onClose(); }}
            >
              <Text style={{ color: '#FFF', fontWeight: 'bold' }}>{confirmLabel}</Text>
            </TouchableOpacity>
          </View>

        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, height: '85%', borderWidth: 1 },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1 },
  headerTitle: { fontSize: 18, fontWeight: 'bold' },
  searchBox: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, height: 44, borderRadius: 10, borderWidth: 1 },
  pill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, height: ROW_HEIGHT - 8, borderRadius: 12, borderWidth: 1, marginBottom: 8 },
  rowInfo: { flex: 1, marginLeft: 12 },
  rowName: { fontSize: 15, fontWeight: '700' },
  rowMeta: { fontSize: 11, marginTop: 2 },
  footer: { flexDirection: 'row', padding: 16, borderTopWidth: 1, gap: 12 },
  btn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
});
