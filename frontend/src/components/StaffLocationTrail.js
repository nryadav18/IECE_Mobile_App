import React, { useContext, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemeContext } from '../context/ThemeContext';
import LocationMap from './LocationMap';

/**
 * Where an anonymous-location head actually was when they marked their day.
 *
 * Everyone else in the app is measured against a school's geofence, so "where"
 * is already answered by "which school". These heads have no anchor by design
 * (see backend/utils/anonymousLocation.js), which leaves exactly one place the
 * answer can come from: the coordinates stored on each attendance record. This
 * section surfaces them — one month at a time, one point at a time.
 *
 * Shape of the interaction: pick a date, then pick Check-in or Check-out. The
 * map below reacts to that single choice and to nothing else — LocationMap is
 * memoised on the point, so scrolling the date list, switching months or a
 * parent re-render never disturbs the tiles already on screen.
 *
 * A month at a time is deliberate too: a head who has worked here for three
 * years has hundreds of days, and rendering all of them to look at one is work
 * done for nothing.
 */

const CHECK_IN_COLOR = '#10B981';
const CHECK_OUT_COLOR = '#EF4444';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const monthKeyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** A stored location, only if it is actually usable as a point on a map. */
const pointOf = (loc, at) => {
  const lat = parseFloat(loc?.lat);
  const lng = parseFloat(loc?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const accuracy = Number(loc?.accuracy);
  return { lat, lng, accuracy: Number.isFinite(accuracy) ? accuracy : null, at: at || null };
};

const timeText = (value) =>
  value ? new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—';

export default function StaffLocationTrail({ attendance = [], style }) {
  const { theme } = useContext(ThemeContext);

  // Every day that has at least one coordinate, newest first. Days with neither
  // (an absence, or a check-in from a build that predates location capture)
  // would be rows that can never show anything, so they are left out.
  const days = useMemo(() => {
    return (attendance || [])
      .map((a) => {
        const date = new Date(a.date);
        if (Number.isNaN(date.getTime())) return null;
        const checkIn = pointOf(a.checkInLocation, a.checkInTime);
        const checkOut = pointOf(a.checkOutLocation, a.checkOutTime);
        if (!checkIn && !checkOut) return null;
        return { id: String(a._id || a.date), date, status: a.status, checkIn, checkOut };
      })
      .filter(Boolean)
      .sort((a, b) => b.date - a.date);
  }, [attendance]);

  // Months that actually contain something, newest first.
  const months = useMemo(() => {
    const seen = new Map();
    days.forEach((d) => {
      const key = monthKeyOf(d.date);
      if (!seen.has(key)) {
        seen.set(key, { key, label: `${MONTH_NAMES[d.date.getMonth()]} ${d.date.getFullYear()}` });
      }
    });
    return [...seen.values()];
  }, [days]);

  const [monthIndex, setMonthIndex] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [mode, setMode] = useState('in'); // 'in' | 'out'

  // A month that no longer exists (the profile refreshed with different data)
  // must not leave the section pointing at nothing.
  useEffect(() => {
    if (monthIndex > months.length - 1) setMonthIndex(0);
  }, [months.length, monthIndex]);

  const currentMonth = months[monthIndex];

  const monthDays = useMemo(
    () => (currentMonth ? days.filter((d) => monthKeyOf(d.date) === currentMonth.key) : []),
    [days, currentMonth]
  );

  // Opening the section — or moving to another month — lands on that month's
  // most recent day rather than on an empty map.
  useEffect(() => {
    if (!monthDays.length) { setSelectedId(null); return; }
    if (!monthDays.some((d) => d.id === selectedId)) setSelectedId(monthDays[0].id);
    // selectedId is intentionally not a dependency: this only re-homes the
    // selection when the month's contents change, never when the user picks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthDays]);

  const selected = monthDays.find((d) => d.id === selectedId) || null;

  // Half a day is a real state: checked in, not yet out. The toggle follows the
  // data instead of offering a button that shows an empty map.
  useEffect(() => {
    if (!selected) return;
    if (mode === 'in' && !selected.checkIn && selected.checkOut) setMode('out');
    if (mode === 'out' && !selected.checkOut && selected.checkIn) setMode('in');
  }, [selected, mode]);

  const activePoint = selected ? (mode === 'in' ? selected.checkIn : selected.checkOut) : null;
  const activeColor = mode === 'in' ? CHECK_IN_COLOR : CHECK_OUT_COLOR;
  const activeLabel = selected
    ? `${mode === 'in' ? 'Check-in' : 'Check-out'} · ${selected.date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`
    : 'Location';

  if (!days.length) {
    return (
      <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }, style]}>
        <View style={styles.cardHeader}>
          <Ionicons name="map-outline" size={20} color={theme.colors.primary} style={{ marginRight: 8 }} />
          <Text style={[styles.cardTitle, { color: theme.colors.textPrimary }]}>Check-in / Check-out Locations</Text>
        </View>
        <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>
          No location has been recorded for this person yet. Coordinates appear here as soon as they mark a day.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }, style]}>
      <View style={styles.cardHeader}>
        <Ionicons name="map-outline" size={20} color={theme.colors.primary} style={{ marginRight: 8 }} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.cardTitle, { color: theme.colors.textPrimary }]}>Check-in / Check-out Locations</Text>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 11.5, marginTop: 2 }}>
            Where this anonymous-location staff member marked each day.
          </Text>
        </View>
      </View>

      {/* Selected day, the two options, and the map that follows them. */}
      {selected && (
        <View style={{ marginBottom: 16 }}>
          <Text style={{ color: theme.colors.textPrimary, fontWeight: '700', fontSize: 14, marginBottom: 8 }}>
            {selected.date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}
          </Text>

          <View style={[styles.segment, { borderColor: theme.colors.border, backgroundColor: theme.colors.background }]}>
            {[
              { key: 'in', label: 'Check-in', point: selected.checkIn, color: CHECK_IN_COLOR, icon: 'log-in-outline' },
              { key: 'out', label: 'Check-out', point: selected.checkOut, color: CHECK_OUT_COLOR, icon: 'log-out-outline' },
            ].map((opt) => {
              const active = mode === opt.key;
              const disabled = !opt.point;
              return (
                <TouchableOpacity
                  key={opt.key}
                  style={[styles.segmentBtn, active && { backgroundColor: opt.color + '1A', borderColor: opt.color }]}
                  onPress={() => setMode(opt.key)}
                  disabled={disabled}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name={opt.icon}
                    size={16}
                    color={disabled ? theme.colors.textSecondary : active ? opt.color : theme.colors.textSecondary}
                  />
                  <Text
                    style={{
                      marginLeft: 6,
                      fontSize: 13,
                      fontWeight: active ? '800' : '600',
                      color: disabled ? theme.colors.textSecondary : active ? opt.color : theme.colors.textPrimary,
                      opacity: disabled ? 0.5 : 1,
                    }}
                  >
                    {opt.label}
                  </Text>
                  <Text style={{ marginLeft: 6, fontSize: 11, color: theme.colors.textSecondary, opacity: disabled ? 0.5 : 1 }}>
                    {timeText(opt.point?.at)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <LocationMap
            lat={activePoint?.lat}
            lng={activePoint?.lng}
            accuracy={activePoint?.accuracy ?? null}
            color={activeColor}
            label={activeLabel}
            emptyText={mode === 'in' ? 'No check-in location recorded for this day.' : 'Not checked out on this day.'}
          />

          {!!activePoint && (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
              <Ionicons name="navigate-outline" size={13} color={theme.colors.textSecondary} />
              <Text style={{ color: theme.colors.textSecondary, fontSize: 11.5, marginLeft: 6 }}>
                {activePoint.lat.toFixed(5)}, {activePoint.lng.toFixed(5)}
                {activePoint.accuracy ? ` · ±${Math.round(activePoint.accuracy)} m` : ''}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Month switcher + the days inside it. */}
      <View style={[styles.monthBar, { borderColor: theme.colors.border }]}>
        <TouchableOpacity
          style={[styles.monthBtn, { opacity: monthIndex >= months.length - 1 ? 0.35 : 1 }]}
          disabled={monthIndex >= months.length - 1}
          onPress={() => setMonthIndex((i) => i + 1)}
        >
          <Ionicons name="chevron-back" size={18} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={{ color: theme.colors.textPrimary, fontWeight: '700', fontSize: 13 }}>
          {currentMonth?.label || '—'}
        </Text>
        <TouchableOpacity
          style={[styles.monthBtn, { opacity: monthIndex <= 0 ? 0.35 : 1 }]}
          disabled={monthIndex <= 0}
          onPress={() => setMonthIndex((i) => i - 1)}
        >
          <Ionicons name="chevron-forward" size={18} color={theme.colors.textPrimary} />
        </TouchableOpacity>
      </View>

      {monthDays.map((d) => {
        const active = d.id === selectedId;
        return (
          <TouchableOpacity
            key={d.id}
            style={[styles.dayRow, {
              borderColor: active ? theme.colors.primary : theme.colors.border,
              backgroundColor: active ? theme.colors.primary + '10' : theme.colors.background,
            }]}
            onPress={() => setSelectedId(d.id)}
            activeOpacity={0.85}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.colors.textPrimary, fontWeight: active ? '800' : '600', fontSize: 13 }}>
                {d.date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
              </Text>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 11, marginTop: 2 }}>
                {timeText(d.checkIn?.at)} → {timeText(d.checkOut?.at)}
                {d.status ? ` · ${d.status}` : ''}
              </Text>
            </View>
            {/* Which of the two points this day actually holds. */}
            <Ionicons
              name="ellipse"
              size={9}
              color={d.checkIn ? CHECK_IN_COLOR : theme.colors.border}
              style={{ marginRight: 4 }}
            />
            <Ionicons
              name="ellipse"
              size={9}
              color={d.checkOut ? CHECK_OUT_COLOR : theme.colors.border}
              style={{ marginRight: 8 }}
            />
            <Ionicons name="chevron-forward" size={16} color={active ? theme.colors.primary : theme.colors.textSecondary} />
          </TouchableOpacity>
        );
      })}

      {monthDays.length === 0 && (
        <Text style={{ color: theme.colors.textSecondary, fontSize: 12.5, marginTop: 4 }}>
          No location records in {currentMonth?.label}.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, borderRadius: 16, borderWidth: 1 },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14 },
  cardTitle: { fontSize: 15, fontWeight: '700' },
  segment: { flexDirection: 'row', borderWidth: 1, borderRadius: 12, padding: 4, marginBottom: 12, gap: 4 },
  segmentBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 10, paddingHorizontal: 6, borderRadius: 9, borderWidth: 1, borderColor: 'transparent',
  },
  monthBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderRadius: 12, paddingHorizontal: 6, paddingVertical: 6, marginBottom: 10,
  },
  monthBtn: { padding: 6, borderRadius: 8 },
  dayRow: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 8 },
});
