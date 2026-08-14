import React, { useCallback, useContext, useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, FlatList, RefreshControl, ActivityIndicator, TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { ThemeContext } from '../../context/ThemeContext';
import { roleLabel } from '../../utils/roles';
import { decisionVerb, decisionColor, decisionIcon, decisionMoment } from '../../utils/approvals';
import NotificationBell from '../../components/NotificationBell';
import { SkeletonList } from '../../components/Skeleton';
import useResponsiveLayout from '../../hooks/useResponsiveLayout';
import {
  getApprovalLog, getApprovers, ENTITY_TYPES, entityMeta, approvalLogError,
} from '../../services/approvalLog';

/**
 * The Approval Log — every decision taken anywhere in the app, newest first.
 *
 * "Approved by" on each card answers the question one item at a time. This
 * answers it the other way round: show me everything a given admin has decided,
 * or everything decided this week, across leave, activities, face scans, school
 * visits, holidays, visit reports and the rest.
 *
 * Admin and CEO only — the route is not even registered for anyone else, and the
 * API refuses them independently.
 */
export default function ApprovalLogScreen({ navigation }) {
  const { theme } = useContext(ThemeContext);
  const insets = useSafeAreaInsets();
  const { contentInset, columns } = useResponsiveLayout({ baseGutter: 16 });

  const [rows, setRows] = useState([]);
  const [approvers, setApprovers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');

  // Filters
  const [entityType, setEntityType] = useState(null);
  const [actorId, setActorId] = useState(null);
  const [search, setSearch] = useState('');
  // The text actually sent to the server — only updated on submit, so typing
  // does not fire a request per keystroke.
  const [appliedSearch, setAppliedSearch] = useState('');

  const params = useMemo(
    () => ({
      ...(entityType ? { entityType } : {}),
      ...(actorId ? { actorId } : {}),
      ...(appliedSearch ? { search: appliedSearch } : {}),
    }),
    [entityType, actorId, appliedSearch]
  );

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError('');
      try {
        const logRes = await getApprovalLog({ ...params, page: 1, limit: 30 });
        setRows(logRes?.data || []);
        setTotal(logRes?.total || 0);
        setHasMore(!!logRes?.hasMore);
        setPage(1);
      } catch (e) {
        setError(approvalLogError(e));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [params]
  );

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // The approver list is a small aggregate over the whole log and does not
  // depend on the filters, so it is fetched once rather than on every change.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      getApprovers()
        .then((res) => { if (alive) setApprovers(res?.data || []); })
        .catch(() => {});
      return () => { alive = false; };
    }, [])
  );

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const next = page + 1;
      const res = await getApprovalLog({ ...params, page: next, limit: 30 });
      setRows((prev) => [...prev, ...(res?.data || [])]);
      setHasMore(!!res?.hasMore);
      setPage(next);
    } catch (e) {
      // Non-fatal — the list simply stops growing.
    } finally {
      setLoadingMore(false);
    }
  };

  const clearFilters = () => {
    setEntityType(null);
    setActorId(null);
    setSearch('');
    setAppliedSearch('');
  };

  const filtersActive = !!(entityType || actorId || appliedSearch);

  const Row = ({ item }) => {
    const meta = entityMeta(item.entityType);
    const color = decisionColor(item.action);
    const verb = decisionVerb(item.action);

    return (
      <View
        style={{
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderWidth: 1,
          borderRadius: 14,
          padding: 14,
          marginBottom: 10,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
          <View
            style={{
              width: 34, height: 34, borderRadius: 10,
              backgroundColor: color + '1A',
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Ionicons name={decisionIcon(item.action)} size={17} color={color} />
          </View>
          <View style={{ flex: 1, marginLeft: 10 }}>
            {/* The whole point of the screen, in bold, on every row. */}
            <Text style={{ fontSize: 14 }} numberOfLines={1}>
              <Text style={{ color, fontWeight: '800' }}>{verb} </Text>
              <Text style={{ color: theme.colors.textPrimary, fontWeight: '700' }}>
                {item.actorName || 'Unknown'}
              </Text>
              {!!item.actorRole && (
                <Text style={{ color: theme.colors.textSecondary, fontWeight: '600' }}>
                  {' '}({roleLabel(item.actorRole)})
                </Text>
              )}
            </Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 11.5, marginTop: 2 }}>
              {decisionMoment(item.decidedAt) || ''}
            </Text>
          </View>
          <View
            style={{
              flexDirection: 'row', alignItems: 'center',
              backgroundColor: theme.colors.background,
              borderRadius: 8, paddingHorizontal: 7, paddingVertical: 4,
            }}
          >
            <Ionicons name={meta.icon} size={11} color={theme.colors.textSecondary} />
            <Text style={{ color: theme.colors.textSecondary, fontSize: 10, fontWeight: '800', marginLeft: 4 }}>
              {meta.label.toUpperCase()}
            </Text>
          </View>
        </View>

        <View style={{ height: 1, backgroundColor: theme.colors.border, marginBottom: 10 }} />

        {!!item.entityLabel && (
          <Text style={{ color: theme.colors.textPrimary, fontSize: 13, fontWeight: '600' }} numberOfLines={2}>
            {item.entityLabel}
          </Text>
        )}
        {!!item.subjectName && (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 5 }}>
            <Ionicons name="person-outline" size={12} color={theme.colors.textSecondary} />
            <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginLeft: 5 }} numberOfLines={1}>
              {item.subjectName}
              {item.subjectRole ? ` · ${roleLabel(item.subjectRole)}` : ''}
            </Text>
          </View>
        )}
        {!!item.schoolName && (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
            <Ionicons name="business-outline" size={12} color={theme.colors.textSecondary} />
            <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginLeft: 5 }} numberOfLines={1}>
              {item.schoolName}
            </Text>
          </View>
        )}
        {!!item.note && (
          <View style={{ marginTop: 8, backgroundColor: theme.colors.background, borderRadius: 8, padding: 9 }}>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 10.5, fontWeight: '800', marginBottom: 2 }}>
              REMARK
            </Text>
            <Text style={{ color: theme.colors.textPrimary, fontSize: 12.5 }}>{item.note}</Text>
          </View>
        )}
      </View>
    );
  };

  const Chip = ({ active, label, icon, count, onPress }) => (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 11,
        paddingVertical: 7,
        borderRadius: 20,
        marginRight: 8,
        borderWidth: 1,
        borderColor: active ? theme.colors.primary : theme.colors.border,
        backgroundColor: active ? theme.colors.primary + '15' : theme.colors.surface,
      }}
    >
      {!!icon && (
        <Ionicons
          name={icon}
          size={13}
          color={active ? theme.colors.primary : theme.colors.textSecondary}
          style={{ marginRight: 5 }}
        />
      )}
      <Text
        style={{
          color: active ? theme.colors.primary : theme.colors.textSecondary,
          fontSize: 12.5,
          fontWeight: active ? '800' : '600',
        }}
      >
        {label}
      </Text>
      {count !== undefined && (
        <Text
          style={{
            color: active ? theme.colors.primary : theme.colors.textSecondary,
            fontSize: 11,
            fontWeight: '700',
            marginLeft: 5,
            opacity: 0.75,
          }}
        >
          {count}
        </Text>
      )}
    </TouchableOpacity>
  );

  const Header = (
    <View>
      {/* Who has been deciding things. The counts are the fastest way to see
          that one admin has taken almost every decision, or that one has taken
          none. */}
      {approvers.length > 0 && (
        <>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 11, fontWeight: '800', marginBottom: 8, letterSpacing: 0.4 }}>
            APPROVER
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
            <Chip active={!actorId} label="Everyone" onPress={() => setActorId(null)} />
            {approvers.map((a) => (
              <Chip
                key={String(a._id || 'unknown')}
                active={String(actorId) === String(a._id)}
                label={a.name || 'Unknown'}
                count={a.total}
                onPress={() => setActorId(String(actorId) === String(a._id) ? null : String(a._id))}
              />
            ))}
          </ScrollView>
        </>
      )}

      <Text style={{ color: theme.colors.textSecondary, fontSize: 11, fontWeight: '800', marginBottom: 8, letterSpacing: 0.4 }}>
        TYPE
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
        <Chip active={!entityType} label="All" onPress={() => setEntityType(null)} />
        {ENTITY_TYPES.map((t) => (
          <Chip
            key={t.key}
            active={entityType === t.key}
            label={t.label}
            icon={t.icon}
            onPress={() => setEntityType(entityType === t.key ? null : t.key)}
          />
        ))}
      </ScrollView>

      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
        <View
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
            borderWidth: 1,
            borderRadius: 12,
            paddingHorizontal: 12,
          }}
        >
          <Ionicons name="search-outline" size={16} color={theme.colors.textSecondary} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            onSubmitEditing={() => setAppliedSearch(search.trim())}
            returnKeyType="search"
            placeholder="Search approver, staff or item"
            placeholderTextColor={theme.colors.placeholder}
            style={{ flex: 1, color: theme.colors.textPrimary, fontSize: 13.5, paddingVertical: 10, marginLeft: 8 }}
          />
          {!!search && (
            <TouchableOpacity
              onPress={() => { setSearch(''); setAppliedSearch(''); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close-circle" size={17} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
        {filtersActive && (
          <TouchableOpacity onPress={clearFilters} style={{ marginLeft: 10 }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={{ color: theme.colors.primary, fontWeight: '700', fontSize: 13 }}>Clear</Text>
          </TouchableOpacity>
        )}
      </View>

      <Text style={{ color: theme.colors.textSecondary, fontSize: 12.5, marginBottom: 10 }}>
        {total} decision{total === 1 ? '' : 's'}
        {filtersActive ? ' matching these filters' : ' on record'}
      </Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View
        style={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 16,
          paddingBottom: 12,
          backgroundColor: theme.colors.surface,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="arrow-back" size={24} color={theme.colors.textPrimary} />
          </TouchableOpacity>
          <View style={{ marginLeft: 12, flex: 1 }}>
            <Text style={{ color: theme.colors.textPrimary, fontSize: 19, fontWeight: '700' }}>Approval Log</Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 11.5, marginTop: 1 }} numberOfLines={1}>
              Who approved what, across the whole app
            </Text>
          </View>
        </View>
        <NotificationBell navigation={navigation} />
      </View>

      {loading ? (
        <View style={{ padding: 16 }}>
          <SkeletonList count={5} avatar lines={2} trailing />
        </View>
      ) : error ? (
        <View style={{ alignItems: 'center', marginTop: 70, paddingHorizontal: 32 }}>
          <Ionicons name="alert-circle-outline" size={52} color={theme.colors.border} />
          <Text style={{ color: theme.colors.textSecondary, marginTop: 12, fontSize: 14, textAlign: 'center' }}>{error}</Text>
          <TouchableOpacity onPress={() => load()} style={{ marginTop: 16 }}>
            <Text style={{ color: theme.colors.primary, fontWeight: '700' }}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => String(item._id)}
          renderItem={({ item }) =>
            // Only wrapped when the list is actually running in columns, so the
            // single-column (mobile) tree is exactly the one it was before.
            columns > 1 ? (
              <View style={{ flex: 1, minWidth: 0 }}><Row item={item} /></View>
            ) : (
              <Row item={item} />
            )
          }
          ListHeaderComponent={Header}
          // `numColumns` cannot change in place, so it is part of the key.
          // `columns` is always 1 on a phone, so this is inert on mobile.
          key={`log-${columns}`}
          numColumns={columns}
          columnWrapperStyle={columns > 1 ? { gap: 12 } : undefined}
          contentContainerStyle={{ paddingHorizontal: contentInset, paddingVertical: 16, paddingBottom: insets.bottom + 24 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={theme.colors.primary} />
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            loadingMore ? <ActivityIndicator color={theme.colors.primary} style={{ marginVertical: 16 }} /> : null
          }
          ListEmptyComponent={
            <View style={{ alignItems: 'center', marginTop: 50 }}>
              <Ionicons name="file-tray-outline" size={52} color={theme.colors.border} />
              <Text style={{ color: theme.colors.textSecondary, marginTop: 12, fontSize: 14, textAlign: 'center', paddingHorizontal: 30 }}>
                {filtersActive
                  ? 'No decisions match these filters.'
                  : 'No decisions recorded yet. Every approval, rejection and cancellation from now on appears here.'}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}
