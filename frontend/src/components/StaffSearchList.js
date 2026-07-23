import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemeContext } from '../context/ThemeContext';
import Avatar from './Avatar';
import { roleLabel } from '../utils/roles';

/**
 * Searchable, self-fetching staff list. Reused by the "Raise" tab (inline) and
 * the substitute picker (inside a modal).
 *
 * Props:
 *  - fetcher(search): async -> { data: [users] }         (required)
 *  - onSelect(user):  called when a row is tapped         (required)
 *  - selectedId:      id to render with a check mark       (optional)
 *  - placeholder:     search box placeholder               (optional)
 *  - emptyText:       text when the list is empty          (optional)
 *  - ListHeaderComponent, contentContainerStyle           (optional passthrough)
 */
export default function StaffSearchList({
  fetcher,
  onSelect,
  selectedId,
  placeholder = 'Search by name…',
  emptyText = 'No staff found.',
  ListHeaderComponent,
  contentContainerStyle,
}) {
  const { theme } = useContext(ThemeContext);
  const [search, setSearch] = useState('');
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const debounceRef = useRef(null);
  const reqIdRef = useRef(0);

  const load = useCallback(
    async (term, isRefresh = false) => {
      const myReq = ++reqIdRef.current;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      try {
        const res = await fetcher(term);
        // Ignore stale responses from earlier keystrokes.
        if (myReq === reqIdRef.current) setData(res?.data || []);
      } catch (e) {
        if (myReq === reqIdRef.current) setData([]);
      } finally {
        if (myReq === reqIdRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [fetcher]
  );

  // Initial load.
  useEffect(() => {
    load('');
  }, [load]);

  // Debounced search.
  const onChangeSearch = (text) => {
    setSearch(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(text), 350);
  };

  useEffect(() => () => debounceRef.current && clearTimeout(debounceRef.current), []);

  const renderItem = ({ item }) => {
    const schools = (item.schoolIds || []).map((s) => s?.name).filter(Boolean).join(', ');
    const isSelected = selectedId && String(selectedId) === String(item._id);
    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => onSelect(item)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: theme.colors.surface,
          borderColor: isSelected ? theme.colors.primary : theme.colors.border,
          borderWidth: 1,
          borderRadius: 12,
          padding: 12,
          marginBottom: 10,
        }}
      >
        <Avatar name={item.name} size={42} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={{ color: theme.colors.textPrimary, fontWeight: '700', fontSize: 15 }} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={{ color: theme.colors.primary, fontSize: 12, fontWeight: '600', marginTop: 1 }}>
            {roleLabel(item.role)}
          </Text>
          {!!schools && (
            <Text style={{ color: theme.colors.textSecondary, fontSize: 11, marginTop: 2 }} numberOfLines={1}>
              <Ionicons name="school-outline" size={11} color={theme.colors.textSecondary} /> {schools}
            </Text>
          )}
        </View>
        {isSelected ? (
          <Ionicons name="checkmark-circle" size={22} color={theme.colors.primary} />
        ) : (
          <Ionicons name="chevron-forward" size={20} color={theme.colors.textSecondary} />
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={{ flex: 1 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
          borderRadius: 12,
          paddingHorizontal: 12,
          marginBottom: 14,
        }}
      >
        <Ionicons name="search" size={20} color={theme.colors.textSecondary} />
        <TextInput
          style={{ flex: 1, color: theme.colors.textPrimary, paddingVertical: 12, marginLeft: 8 }}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.placeholder}
          value={search}
          onChangeText={onChangeSearch}
          autoCorrect={false}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => onChangeSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={18} color={theme.colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <ActivityIndicator color={theme.colors.primary} style={{ marginTop: 30 }} />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => String(item._id)}
          renderItem={renderItem}
          ListHeaderComponent={ListHeaderComponent}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[{ paddingBottom: 24 }, contentContainerStyle]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(search, true)}
              tintColor={theme.colors.primary}
              colors={[theme.colors.primary]}
            />
          }
          ListEmptyComponent={
            <View style={{ alignItems: 'center', marginTop: 40 }}>
              <Ionicons name="people-outline" size={48} color={theme.colors.border} />
              <Text style={{ color: theme.colors.textSecondary, marginTop: 10 }}>{emptyText}</Text>
            </View>
          }
        />
      )}
    </View>
  );
}
