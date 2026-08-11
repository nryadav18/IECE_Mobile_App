import React, { useContext, useMemo, useState, memo } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemeContext } from '../../context/ThemeContext';
import Avatar from '../Avatar';
import { roleLabel } from '../../utils/roles';
import { statusMeta, humanMinutes, ageSince, workedMinutesOf } from '../../utils/monitoringMeta';

// ---------------------------------------------------------------------------
// The drill-down. Every number on the dashboard opens this sheet with the exact
// rows behind it.
//
// It renders OVER the dashboard rather than navigating away, so the live feed
// keeps running underneath and the Admin never loses their place. Rows come
// from the snapshot already in memory — opening a drill-down issues no request
// at all, which is what makes it feel instant.
// ---------------------------------------------------------------------------

const PersonRow = memo(function PersonRow({ item, theme, onPress }) {
  const meta = statusMeta(item.status);
  const bits = [];
  if (item.checkInClock) bits.push(`In ${item.checkInClock}`);
  if (item.checkOutClock) bits.push(`Out ${item.checkOutClock}`);
  else if (item.stillIn) bits.push(`${humanMinutes(workedMinutesOf(item))} so far`);
  if (item.workedMin && item.checkOutClock) bits.push(humanMinutes(item.workedMin));

  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={onPress}
      style={{
        flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 14,
        backgroundColor: theme.colors.surface, borderRadius: 14, marginBottom: 8,
        borderWidth: 1, borderColor: theme.colors.border,
      }}
    >
      <Avatar name={item.name} size={40} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 14.5, fontWeight: '700', color: theme.colors.textPrimary }}>
            {item.name}
          </Text>
          {item.late && (
            <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: '#F59E0B22', marginLeft: 6 }}>
              <Text style={{ fontSize: 9, fontWeight: '900', color: '#B45309' }}>LATE</Text>
            </View>
          )}
        </View>
        <Text numberOfLines={1} style={{ fontSize: 11.5, color: theme.colors.textSecondary, marginTop: 2 }}>
          {roleLabel(item.role)}
          {item.schoolName ? ` · ${item.schoolName}` : item.anonymous ? ' · Anonymous location' : ''}
          {item.teamName ? ` · ${item.teamName}` : ''}
        </Text>
        {!!(bits.length || item.detail) && (
          <Text numberOfLines={1} style={{ fontSize: 11, color: theme.colors.textSecondary, marginTop: 3 }}>
            {item.detail || bits.join(' · ')}
          </Text>
        )}
      </View>
      <View style={{ alignItems: 'flex-end', marginLeft: 8 }}>
        <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: `${meta.color}1F` }}>
          <Text style={{ fontSize: 9.5, fontWeight: '900', color: meta.color }}>{meta.short.toUpperCase()}</Text>
        </View>
        {item.splitDay && (
          <Text style={{ fontSize: 9, color: theme.colors.textSecondary, marginTop: 4 }}>Split day</Text>
        )}
      </View>
    </TouchableOpacity>
  );
});

const RecordRow = memo(function RecordRow({ item, theme, accent }) {
  return (
    <View
      style={{
        paddingVertical: 11, paddingHorizontal: 14, backgroundColor: theme.colors.surface,
        borderRadius: 14, marginBottom: 8, borderWidth: 1, borderColor: theme.colors.border,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: accent, marginRight: 8 }} />
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, fontWeight: '700', color: theme.colors.textPrimary }}>
          {item.title}
        </Text>
        <Text style={{ fontSize: 10.5, color: theme.colors.textSecondary }}>{ageSince(item.at)}</Text>
      </View>
      {!!item.subtitle && (
        <Text numberOfLines={2} style={{ fontSize: 11.5, color: theme.colors.textSecondary, marginTop: 4, marginLeft: 16 }}>
          {item.subtitle}
        </Text>
      )}
      {!!item.from && (
        <Text style={{ fontSize: 11, color: theme.colors.textSecondary, marginTop: 3, marginLeft: 16 }}>
          {new Date(item.from).toLocaleDateString()}
          {item.to && item.to !== item.from ? ` → ${new Date(item.to).toLocaleDateString()}` : ''}
        </Text>
      )}
    </View>
  );
});

const SchoolRow = memo(function SchoolRow({ item, theme, onPress }) {
  return (
    <TouchableOpacity
      activeOpacity={onPress ? 0.75 : 1}
      onPress={onPress}
      disabled={!onPress}
      style={{
        paddingVertical: 11, paddingHorizontal: 14, backgroundColor: theme.colors.surface,
        borderRadius: 14, marginBottom: 8, borderWidth: 1, borderColor: theme.colors.border,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Ionicons
          name={item.onHoliday ? 'sunny' : item.covered ? 'business' : 'alert-circle'}
          size={16}
          color={item.onHoliday ? statusMeta('holiday').color : item.covered ? statusMeta('present').color : statusMeta('absent').color}
          style={{ marginRight: 8 }}
        />
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, fontWeight: '700', color: theme.colors.textPrimary }}>
          {item.name}
        </Text>
        <Text style={{ fontSize: 11.5, fontWeight: '800', color: theme.colors.textSecondary }}>
          {item.onDuty}/{item.assigned}
        </Text>
        {!!onPress && <Ionicons name="chevron-forward" size={15} color={theme.colors.textSecondary} style={{ marginLeft: 4 }} />}
      </View>
      <Text style={{ fontSize: 11, color: theme.colors.textSecondary, marginTop: 4, marginLeft: 24 }}>
        {item.state || 'State not set'}
        {item.onHoliday ? ` · Holiday${item.holidayReason ? `: ${item.holidayReason}` : ''}` : ''}
        {!item.onHoliday && !item.covered && item.assigned > 0 ? ' · Nobody on duty' : ''}
        {item.assigned === 0 ? ' · No staff assigned' : ''}
      </Text>
    </TouchableOpacity>
  );
});

/**
 * @param {object} drill  { kind: 'people'|'records'|'schools', title, subtitle,
 *                          rows, accent, emptyText }
 */
export default function DrillSheet({ drill, onClose, onOpenPerson, onOpenSchool }) {
  const { theme } = useContext(ThemeContext);
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');

  const rows = drill?.rows || [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.name, r.title, r.subtitle, r.schoolName, r.teamName, r.role, r.state, r.detail]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [rows, query]);

  const renderItem = ({ item }) => {
    if (drill.kind === 'records') return <RecordRow item={item} theme={theme} accent={drill.accent || theme.colors.primary} />;
    if (drill.kind === 'schools') {
      return <SchoolRow item={item} theme={theme} onPress={onOpenSchool ? () => onOpenSchool(item) : undefined} />;
    }
    return <PersonRow item={item} theme={theme} onPress={() => onOpenPerson?.(item)} />;
  };

  return (
    <Modal
      visible={!!drill}
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
        {/* Tapping the dimmed area closes, matching every other sheet in the app. */}
        <TouchableOpacity activeOpacity={1} onPress={onClose} style={{ flex: 1 }} />
        <View
          style={{
            maxHeight: '86%',
            backgroundColor: theme.colors.background,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            paddingBottom: insets.bottom + 10,
          }}
        >
          <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 4 }}>
            <View style={{ width: 42, height: 4, borderRadius: 2, backgroundColor: theme.colors.border }} />
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingTop: 6, paddingBottom: 10 }}>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ fontSize: 17, fontWeight: '800', color: theme.colors.textPrimary }}>
                {drill?.title}
              </Text>
              <Text numberOfLines={2} style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 2 }}>
                {rows.length} {rows.length === 1 ? 'record' : 'records'}
                {drill?.subtitle ? ` · ${drill.subtitle}` : ''}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close-circle" size={28} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {rows.length > 6 && (
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
                placeholder="Search this list..."
                placeholderTextColor={theme.colors.placeholder}
                autoCapitalize="none"
                style={{ flex: 1, marginLeft: 8, color: theme.colors.textPrimary, fontSize: 13.5 }}
              />
              {query.length > 0 && (
                <TouchableOpacity onPress={() => setQuery('')}>
                  <Ionicons name="close-circle" size={17} color={theme.colors.textSecondary} />
                </TouchableOpacity>
              )}
            </View>
          )}

          <FlatList
            data={filtered}
            keyExtractor={(item, i) => String(item.id || i)}
            renderItem={renderItem}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={12}
            maxToRenderPerBatch={12}
            windowSize={7}
            removeClippedSubviews
            ListEmptyComponent={
              <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                <Ionicons name="checkmark-done-circle-outline" size={40} color={theme.colors.textSecondary} />
                <Text style={{ color: theme.colors.textSecondary, marginTop: 10, fontSize: 13 }}>
                  {query ? 'Nothing matches that search.' : drill?.emptyText || 'Nothing here.'}
                </Text>
              </View>
            }
          />

          {drill?.truncated > 0 && (
            <Text style={{ textAlign: 'center', fontSize: 11, color: theme.colors.textSecondary, paddingBottom: 6 }}>
              Showing the {rows.length} oldest — {drill.truncated} more not shown.
            </Text>
          )}
        </View>
      </View>
    </Modal>
  );
}
