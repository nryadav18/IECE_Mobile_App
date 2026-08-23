import React, { useContext, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemeContext } from '../../context/ThemeContext';
import { roleLabel } from '../../utils/roles';

// The quick-filter picker. Narrowing happens entirely on the client against the
// `people` array already in memory — picking a team re-derives every count on
// the screen without a single request, which is why the filter feels instant.
//
// It narrows what the viewer was ALREADY sent, so it can never widen anything:
// a leader's snapshot holds only their trainers, and every option offered here
// is built from that snapshot. Ways of slicing that this viewer has none of
// (a leader has no heads to filter by) are dropped rather than shown empty.

const ALL_TYPES = [
  { key: 'team', label: 'Team', icon: 'people-circle-outline' },
  { key: 'head', label: 'Head', icon: 'ribbon-outline' },
  { key: 'leader', label: 'Leader', icon: 'person-circle-outline' },
  { key: 'school', label: 'School', icon: 'business-outline' },
  { key: 'role', label: 'Role', icon: 'person-outline' },
];

/** The rows offered for one way of slicing, straight off the snapshot. */
function optionsFor(snapshot, type) {
  if (!snapshot) return [];
  if (type === 'team') return (snapshot.teams || []).map((t) => ({ id: t.id, label: t.name, sub: `${t.headcount} staff` }));
  if (type === 'head') return (snapshot.heads || []).map((h) => ({ id: h.id, label: h.name, sub: `${roleLabel(h.role)} · ${h.headcount} staff` }));
  if (type === 'leader') return (snapshot.leaders || []).map((l) => ({ id: l.id, label: l.name, sub: `${roleLabel(l.role)} · ${l.headcount} trainers` }));
  if (type === 'school') return (snapshot.schools || []).map((s) => ({ id: s.id, label: s.name, sub: `${s.state || 'State not set'} · ${s.assigned} assigned` }));
  return Object.entries(snapshot.roleCounts || {})
    .sort((a, b) => b[1] - a[1])
    .map(([r, n]) => ({ id: r, label: roleLabel(r), sub: `${n} staff` }));
}

export default function FilterSheet({ visible, snapshot, scope, filter, onApply, onClose }) {
  const { theme } = useContext(ThemeContext);
  const insets = useSafeAreaInsets();
  const [type, setType] = useState(filter?.type && filter.type !== 'all' ? filter.type : 'team');
  const [query, setQuery] = useState('');

  const types = useMemo(
    () => ALL_TYPES.filter((t) => optionsFor(snapshot, t.key).length > 0),
    [snapshot]
  );

  // The chip that was selected can disappear when the snapshot changes shape
  // (a head loses their last team), which would otherwise leave the sheet
  // showing a list for a tab that is no longer there.
  const activeType = types.some((t) => t.key === type) ? type : (types[0]?.key || 'role');

  const options = useMemo(() => optionsFor(snapshot, activeType), [snapshot, activeType]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q) || (o.sub || '').toLowerCase().includes(q));
  }, [options, query]);

  return (
    <Modal visible={visible} transparent statusBarTranslucent navigationBarTranslucent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
        <TouchableOpacity activeOpacity={1} onPress={onClose} style={{ flex: 1 }} />
        <View
          style={{
            maxHeight: '80%', backgroundColor: theme.colors.background,
            borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: insets.bottom + 10,
          }}
        >
          <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 6 }}>
            <View style={{ width: 42, height: 4, borderRadius: 2, backgroundColor: theme.colors.border }} />
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingBottom: 12 }}>
            <Text style={{ flex: 1, fontSize: 17, fontWeight: '800', color: theme.colors.textPrimary }}>Narrow the dashboard</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close-circle" size={26} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 8, marginBottom: 12 }}>
            {types.map((t) => {
              const active = t.key === activeType;
              return (
                <TouchableOpacity
                  key={t.key}
                  onPress={() => { setType(t.key); setQuery(''); }}
                  activeOpacity={0.8}
                  style={{
                    // Grow to share the row, but never below a legible width —
                    // the Admin gets five ways to slice, a leader gets two.
                    flexGrow: 1, flexBasis: 0, minWidth: 62,
                    alignItems: 'center', paddingVertical: 9, borderRadius: 12,
                    backgroundColor: active ? theme.colors.primary : theme.colors.surface,
                    borderWidth: 1, borderColor: active ? theme.colors.primary : theme.colors.border,
                  }}
                >
                  <Ionicons name={t.icon} size={16} color={active ? '#FFF' : theme.colors.textSecondary} />
                  <Text style={{ fontSize: 11, fontWeight: '700', marginTop: 3, color: active ? '#FFF' : theme.colors.textSecondary }}>
                    {t.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View
            style={{
              flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 10,
              paddingHorizontal: 12, height: 42, borderRadius: 12,
              backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border,
            }}
          >
            <Ionicons name="search" size={16} color={theme.colors.textSecondary} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search..."
              placeholderTextColor={theme.colors.placeholder}
              autoCapitalize="none"
              style={{ flex: 1, marginLeft: 8, color: theme.colors.textPrimary, fontSize: 13.5 }}
            />
          </View>

          <TouchableOpacity
            onPress={() => { onApply({ type: 'all' }); onClose(); }}
            activeOpacity={0.8}
            style={{
              marginHorizontal: 16, marginBottom: 10, paddingVertical: 12, borderRadius: 12,
              alignItems: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: theme.colors.border,
            }}
          >
            <Text style={{ fontSize: 13, fontWeight: '700', color: theme.colors.textSecondary }}>
              {scope?.orgWide === false ? `Show all of ${(scope.label || 'my people').toLowerCase()}` : 'Show the whole organisation'}
            </Text>
          </TouchableOpacity>

          <FlatList
            data={filtered}
            keyExtractor={(o) => String(o.id)}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
            initialNumToRender={14}
            renderItem={({ item }) => {
              const active = filter?.type === activeType && filter?.id === item.id;
              return (
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => { onApply({ type: activeType, id: item.id, label: item.label }); onClose(); }}
                  style={{
                    flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 14,
                    borderRadius: 12, marginBottom: 8, backgroundColor: theme.colors.surface,
                    borderWidth: 1, borderColor: active ? theme.colors.primary : theme.colors.border,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '700', color: theme.colors.textPrimary }}>{item.label}</Text>
                    {!!item.sub && <Text numberOfLines={1} style={{ fontSize: 11.5, color: theme.colors.textSecondary, marginTop: 2 }}>{item.sub}</Text>}
                  </View>
                  {active && <Ionicons name="checkmark-circle" size={20} color={theme.colors.primary} />}
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              <Text style={{ textAlign: 'center', color: theme.colors.textSecondary, paddingVertical: 30, fontSize: 13 }}>
                Nothing to filter by here yet.
              </Text>
            }
          />
        </View>
      </View>
    </Modal>
  );
}
