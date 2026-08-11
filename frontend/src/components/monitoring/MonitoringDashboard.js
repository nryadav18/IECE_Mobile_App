import React, { useContext, useMemo, useState, useEffect, useCallback, memo } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Platform, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MotiView } from 'moti';
import { useIsFocused } from '@react-navigation/native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { ThemeContext } from '../../context/ThemeContext';
import useMonitoring, { todayKey } from '../../hooks/useMonitoring';
import { CALENDAR_COLORS } from '../../utils/calendarColors';
import { roleLabel } from '../../utils/roles';
import {
  STATUS_META, STATUS_ORDER, statusMeta, FLAG_META,
  humanMinutes, ageSince, APPROVAL_META, SEVERITY_COLOR,
} from '../../utils/monitoringMeta';
import { SegmentBar, DonutRing, BarRow, HourBars, MiniStat } from './Charts';
import DrillSheet from './DrillSheet';
import FilterSheet from './FilterSheet';

// ---------------------------------------------------------------------------
// THE MONITORING DASHBOARD
//
// One screen holding everything an Admin has to keep an eye on today: where
// every staff member is, what is waiting on a decision, which schools are
// uncovered, how the day is actually going, and what needs attention right now.
//
// It is push-driven (see hooks/useMonitoring) and every number on it is
// tappable — tapping opens the exact rows behind it, with no request, because
// the rows travelled with the snapshot.
//
// Two rules keep it smooth while data arrives up to once a second:
//   * anything whose value did not change must not re-render — hence memo() on
//     every repeated row and useMemo on every derivation;
//   * the only per-second re-render on the screen is the tiny "updated Ns ago"
//     label, which owns its own timer and nothing else.
// ---------------------------------------------------------------------------

const CARD_GAP = 14;

/* ------------------------------------------------------------------ pieces */

const SectionCard = memo(function SectionCard({ title, icon, action, onAction, children, theme, subtitle }) {
  return (
    <View
      style={{
        backgroundColor: theme.colors.surface,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: theme.colors.border,
        padding: 16,
        marginBottom: CARD_GAP,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: subtitle ? 2 : 12 }}>
        {!!icon && <Ionicons name={icon} size={17} color={theme.colors.primary} style={{ marginRight: 8 }} />}
        <Text style={{ flex: 1, fontSize: 14.5, fontWeight: '800', color: theme.colors.textPrimary, letterSpacing: 0.2 }}>
          {title}
        </Text>
        {!!action && (
          <TouchableOpacity onPress={onAction} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: theme.colors.primary }}>{action}</Text>
          </TouchableOpacity>
        )}
      </View>
      {!!subtitle && (
        <Text style={{ fontSize: 11.5, color: theme.colors.textSecondary, marginBottom: 12, marginLeft: icon ? 25 : 0 }}>
          {subtitle}
        </Text>
      )}
      {children}
    </View>
  );
});

/** A tappable headline count. The whole dashboard is built out of these. */
const StatTile = memo(function StatTile({ meta, value, onPress, theme, width }) {
  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={onPress}
      style={{
        width,
        backgroundColor: theme.colors.surface,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: theme.colors.border,
        paddingVertical: 13,
        paddingHorizontal: 12,
        // A left rule instead of a tinted background: one flat fill per tile
        // keeps the grid free of the overdraw that makes long lists stutter.
        borderLeftWidth: 4,
        borderLeftColor: meta.color,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
        <Ionicons name={meta.icon} size={14} color={meta.color} />
        <Text numberOfLines={1} style={{ flex: 1, marginLeft: 6, fontSize: 10.5, fontWeight: '800', color: theme.colors.textSecondary, letterSpacing: 0.3 }}>
          {meta.short.toUpperCase()}
        </Text>
      </View>
      <Text style={{ fontSize: 26, fontWeight: '900', color: theme.colors.textPrimary, letterSpacing: -0.8 }}>
        {value}
      </Text>
      <Text numberOfLines={1} style={{ fontSize: 10, color: theme.colors.textSecondary, marginTop: 1 }}>
        {meta.label}
      </Text>
    </TouchableOpacity>
  );
});

const AlertCard = memo(function AlertCard({ alert, onPress, theme }) {
  const color = SEVERITY_COLOR[alert.severity] || theme.colors.primary;
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={onPress}
      style={{
        width: 178,
        marginRight: 10,
        padding: 13,
        borderRadius: 15,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: color + '55',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Ionicons name={alert.icon} size={17} color={color} />
        <Text style={{ fontSize: 21, fontWeight: '900', color }}>{alert.count}</Text>
      </View>
      <Text numberOfLines={2} style={{ fontSize: 12, fontWeight: '700', color: theme.colors.textPrimary, marginTop: 7 }}>
        {alert.title}
      </Text>
      <Text numberOfLines={2} style={{ fontSize: 10.5, color: theme.colors.textSecondary, marginTop: 2 }}>
        {alert.subtitle}
      </Text>
    </TouchableOpacity>
  );
});

const ApprovalRow = memo(function ApprovalRow({ meta, queue, onPress, theme, slaHours }) {
  const overdue = queue.overdue > 0;
  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={onPress}
      disabled={queue.count === 0}
      style={{
        flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
        opacity: queue.count === 0 ? 0.45 : 1,
      }}
    >
      <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: meta.color + '1F', alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={meta.icon} size={15} color={meta.color} />
      </View>
      <View style={{ flex: 1, marginLeft: 11 }}>
        <Text style={{ fontSize: 13.5, fontWeight: '700', color: theme.colors.textPrimary }}>{meta.label}</Text>
        <Text style={{ fontSize: 10.5, color: overdue ? SEVERITY_COLOR.high : theme.colors.textSecondary, marginTop: 2 }}>
          {queue.count === 0
            ? 'Nothing waiting'
            : overdue
              ? `${queue.overdue} waiting over ${slaHours}h · oldest ${ageSince(queue.oldestAt)}`
              : `Oldest ${ageSince(queue.oldestAt)}`}
        </Text>
      </View>
      <Text style={{ fontSize: 18, fontWeight: '900', color: queue.count === 0 ? theme.colors.textSecondary : meta.color }}>
        {queue.count}
      </Text>
      {queue.count > 0 && <Ionicons name="chevron-forward" size={15} color={theme.colors.textSecondary} style={{ marginLeft: 4 }} />}
    </TouchableOpacity>
  );
});

/**
 * The only thing on the screen that re-renders every second. It owns its timer
 * so the freshness label can tick without dragging the whole dashboard with it.
 */
const LiveTicker = memo(function LiveTicker({ updatedAt, connected, theme }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const secs = updatedAt ? Math.max(0, Math.round((Date.now() - updatedAt) / 1000)) : null;
  const label = secs == null ? 'connecting…' : secs < 2 ? 'just now' : secs < 60 ? `${secs}s ago` : `${Math.floor(secs / 60)}m ago`;

  return (
    <Text style={{ fontSize: 10.5, color: theme.colors.textSecondary }}>
      {connected ? 'Live' : 'Syncing'} · updated {label}
    </Text>
  );
});

/* ------------------------------------------------------------- derivations */

function personMatches(p, filter) {
  if (!filter || filter.type === 'all') return true;
  if (filter.type === 'team') return p.teamId === filter.id;
  if (filter.type === 'head') return p.headIds.includes(filter.id);
  if (filter.type === 'school') {
    return p.schoolIds.includes(filter.id) || p.schoolId === filter.id || p.checkOutSchoolId === filter.id;
  }
  if (filter.type === 'role') return p.role === filter.id;
  return true;
}

/**
 * Re-derive the headline numbers from a set of people.
 *
 * Deliberately mirrors the server's own maths (including removing excused and
 * holiday staff from the attendance-rate denominator) so a filtered view and
 * the org-wide view are computed the same way — a team's rate on this screen
 * always means what the organisation's rate means.
 */
function rollup(people) {
  const t = { present: 0, partial: 0, absent: 0, not_marked: 0, leave: 0, substitution: 0, school_visit: 0, holiday: 0 };
  people.forEach((p) => { t[p.status] = (t[p.status] || 0) + 1; });
  const working = t.present + t.partial + t.substitution + t.school_visit;
  const expected = people.length - t.leave - t.holiday;
  return {
    ...t,
    total: people.length,
    working,
    expected,
    attendanceRate: expected > 0 ? Math.round((working / expected) * 100) : 0,
  };
}

function punctualityOf(people) {
  const checkedIn = people.filter((p) => p.checkInMin != null);
  const late = checkedIn.filter((p) => p.late).length;
  // Only completed days have a measurable length; an open day is still running.
  const closed = people.filter((p) => p.checkOutAt);
  const avgIn = checkedIn.length ? Math.round(checkedIn.reduce((a, p) => a + p.checkInMin, 0) / checkedIn.length) : null;
  const timeline = Array.from({ length: 18 }, (_, i) => ({ hour: i + 5, count: 0 }));
  checkedIn.forEach((p) => {
    const h = Math.floor(p.checkInMin / 60);
    if (h >= 5 && h <= 22) timeline[h - 5].count += 1;
  });
  return {
    checkedIn: checkedIn.length,
    late,
    onTime: checkedIn.length - late,
    stillIn: people.filter((p) => p.stillIn).length,
    completed: closed.length,
    avgCheckInClock: avgIn == null ? null
      : `${String(Math.floor(avgIn / 60)).padStart(2, '0')}:${String(avgIn % 60).padStart(2, '0')}`,
    avgWorkMin: closed.length ? Math.round(closed.reduce((a, p) => a + (p.workedMin || 0), 0) / closed.length) : 0,
    timeline,
  };
}

/* ------------------------------------------------------------------ screen */

export default function MonitoringDashboard({ navigation, onOpenSchool, refreshSignal = 0 }) {
  const { theme } = useContext(ThemeContext);
  const isFocused = useIsFocused();
  // The portal pads its scroll view by 20 on each side; tiles are sized against
  // the real content width so the two-up grid never overflows on small phones.
  const { width: screenWidth } = useWindowDimensions();

  const [dateKey, setDateKey] = useState(todayKey());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [filter, setFilter] = useState({ type: 'all' });
  const [filterOpen, setFilterOpen] = useState(false);
  const [drill, setDrill] = useState(null);

  // Leaving the screen pauses the stream; coming back resyncs immediately.
  const { snapshot, loading, error, connected, updatedAt, refresh } = useMonitoring(dateKey, { enabled: isFocused });

  const isToday = dateKey === todayKey();

  // The portal's pull-to-refresh bumps this counter. The feed is already live,
  // but a pull has to do something visible or it reads as broken.
  useEffect(() => {
    if (refreshSignal > 0) refresh();
  }, [refreshSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- everything the screen renders, derived once per snapshot ------------
  const view = useMemo(() => {
    if (!snapshot) return null;
    const filtered = filter.type === 'all' ? snapshot.people : snapshot.people.filter((p) => personMatches(p, filter));
    const counts = rollup(filtered);
    const punctuality = punctualityOf(filtered);

    const peopleIds = new Set(filtered.map((p) => p.id));
    const schools = filter.type === 'all'
      ? snapshot.schools
      : snapshot.schools.filter((s) => s.staffIds.some((id) => peopleIds.has(id)));

    const schoolSummary = {
      total: schools.length,
      onHoliday: schools.filter((s) => s.onHoliday).length,
      covered: schools.filter((s) => s.covered).length,
      uncovered: schools.filter((s) => !s.covered && !s.onHoliday && s.assigned > 0).length,
      unstaffed: schools.filter((s) => s.assigned === 0).length,
    };

    const teams = snapshot.teams
      .map((t) => {
        const members = filtered.filter((p) => p.teamId === t.id);
        return { ...t, ...rollup(members), memberIds: members.map((p) => p.id) };
      })
      .filter((t) => t.total > 0)
      .sort((a, b) => b.attendanceRate - a.attendanceRate || b.total - a.total);

    const heads = snapshot.heads
      .map((h) => {
        const members = filtered.filter((p) => p.headIds.includes(h.id));
        return { ...h, ...rollup(members), memberIds: members.map((p) => p.id) };
      })
      .filter((h) => h.total > 0)
      .sort((a, b) => b.total - a.total);

    const flagCounts = {};
    Object.entries(FLAG_META).forEach(([key, meta]) => {
      flagCounts[key] = filtered.filter(meta.test).length;
    });

    return { people: filtered, counts, punctuality, schools, schoolSummary, teams, heads, flagCounts };
  }, [snapshot, filter]);

  // ---- drill-down openers --------------------------------------------------
  const openPeople = useCallback((rows, title, subtitle, emptyText) => {
    setDrill({ kind: 'people', title, subtitle, rows, emptyText });
  }, []);

  const openStatus = useCallback((key) => {
    if (!view) return;
    const meta = statusMeta(key);
    openPeople(
      view.people.filter((p) => p.status === key),
      meta.label,
      meta.hint,
      `Nobody is ${meta.label.toLowerCase()} right now.`
    );
  }, [view, openPeople]);

  const openFlag = useCallback((key) => {
    if (!view) return;
    const meta = FLAG_META[key];
    if (!meta) return;
    openPeople(view.people.filter(meta.test), meta.label, null, 'Nothing flagged here.');
  }, [view, openPeople]);

  const openApproval = useCallback((key) => {
    if (!snapshot) return;
    const meta = APPROVAL_META.find((m) => m.key === key);
    const q = snapshot.approvals[key];
    if (!meta || !q) return;
    setDrill({
      kind: 'records',
      title: `${meta.label} — pending`,
      subtitle: q.overdue > 0 ? `${q.overdue} over ${snapshot.thresholds.slaHours}h` : 'Oldest first',
      rows: q.items,
      accent: meta.color,
      truncated: q.truncated,
      emptyText: 'This queue is clear.',
    });
  }, [snapshot]);

  const openSchools = useCallback((mode) => {
    if (!view) return;
    const map = {
      all: [view.schools, 'All Schools'],
      covered: [view.schools.filter((s) => s.covered), 'Schools Covered Today'],
      uncovered: [view.schools.filter((s) => !s.covered && !s.onHoliday && s.assigned > 0), 'Schools With Nobody Present'],
      holiday: [view.schools.filter((s) => s.onHoliday), 'Schools On Holiday'],
      unstaffed: [view.schools.filter((s) => s.assigned === 0), 'Schools With No Staff Assigned'],
    };
    const [rows, title] = map[mode] || map.all;
    setDrill({ kind: 'schools', title, rows, emptyText: 'No schools in this group.' });
  }, [view]);

  const openAlert = useCallback((alert) => {
    const d = alert.drill || {};
    if (d.type === 'people' && d.status) return openStatus(d.status);
    if (d.type === 'people' && d.flag) return openFlag(d.flag);
    if (d.type === 'schools') return openSchools(d.filter || 'all');
    if (d.type === 'approvals') {
      const rows = APPROVAL_META.flatMap((m) => {
        const q = snapshot?.approvals?.[m.key];
        if (!q) return [];
        const cutoff = Date.now() - (snapshot.thresholds.slaHours * 3600000);
        return q.items
          .filter((it) => new Date(it.at).getTime() < cutoff)
          .map((it) => ({ ...it, subtitle: `${m.label} · ${it.subtitle || ''}`.trim() }));
      }).sort((a, b) => new Date(a.at) - new Date(b.at));
      setDrill({ kind: 'records', title: 'Overdue Approvals', subtitle: 'Oldest first', rows, accent: SEVERITY_COLOR.high, emptyText: 'Nothing is overdue.' });
    }
  }, [openStatus, openFlag, openSchools, snapshot]);

  const openPerson = useCallback((person) => {
    setDrill(null);
    navigation?.navigate('UserProfile', { userId: person.id });
  }, [navigation]);

  const onPickDate = (event, selected) => {
    if (Platform.OS === 'android') setShowDatePicker(false);
    if (event?.type === 'dismissed' || !selected) return;
    const k = `${selected.getFullYear()}-${String(selected.getMonth() + 1).padStart(2, '0')}-${String(selected.getDate()).padStart(2, '0')}`;
    setDateKey(k > todayKey() ? todayKey() : k);
  };

  /* ------------------------------------------------------------- rendering */

  if (loading && !snapshot) {
    return (
      <View style={{ paddingVertical: 60, alignItems: 'center' }}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={{ color: theme.colors.textSecondary, marginTop: 12, fontSize: 13 }}>Building today's picture…</Text>
      </View>
    );
  }

  if (error && !snapshot) {
    return (
      <View style={{ paddingVertical: 50, alignItems: 'center' }}>
        <Ionicons name="cloud-offline-outline" size={40} color={theme.colors.textSecondary} />
        <Text style={{ color: theme.colors.textPrimary, marginTop: 12, fontSize: 14, fontWeight: '700' }}>Couldn't load monitoring</Text>
        <Text style={{ color: theme.colors.textSecondary, marginTop: 4, fontSize: 12.5 }}>{error}</Text>
        <TouchableOpacity
          onPress={refresh}
          style={{ marginTop: 16, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12, backgroundColor: theme.colors.primary }}
        >
          <Text style={{ color: '#FFF', fontWeight: '700', fontSize: 13 }}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!view || !snapshot) return null;

  const { counts, punctuality, schoolSummary, teams, heads, flagCounts, schools } = view;
  const width = Math.max(280, screenWidth - 40);
  const tileWidth = (width - 10) / 2;

  const ringSegments = STATUS_ORDER
    .map((k) => ({ key: k, value: counts[k] || 0, color: STATUS_META[k].color }))
    .filter((s) => s.value > 0);

  const nowHour = new Date().getHours();
  const filterActive = filter.type !== 'all';

  return (
    <View>
      {/* ---------------------------------------------------- live status bar */}
      <View
        style={{
          flexDirection: 'row', alignItems: 'center', marginBottom: 12,
          paddingVertical: 10, paddingHorizontal: 13, borderRadius: 15,
          backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border,
        }}
      >
        {/* The pulse is a leaf view — animating a parent's opacity here would
            re-composite the whole bar every frame. */}
        <MotiView
          from={{ opacity: 0.35, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'timing', duration: 900, loop: isToday && connected, repeatReverse: true }}
          style={{
            width: 9, height: 9, borderRadius: 5, marginRight: 9,
            backgroundColor: !isToday ? theme.colors.textSecondary : connected ? CALENDAR_COLORS.present : CALENDAR_COLORS.partial,
          }}
        />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, fontWeight: '800', color: theme.colors.textPrimary }}>
            {isToday ? 'Live Monitoring' : 'Day Snapshot'}
          </Text>
          {isToday
            ? <LiveTicker updatedAt={updatedAt} connected={connected} theme={theme} />
            : <Text style={{ fontSize: 10.5, color: theme.colors.textSecondary }}>A finished day — this view does not change.</Text>}
        </View>

        <TouchableOpacity
          onPress={() => setShowDatePicker(true)}
          activeOpacity={0.8}
          style={{
            flexDirection: 'row', alignItems: 'center', paddingHorizontal: 11, paddingVertical: 7,
            borderRadius: 11, borderWidth: 1, borderColor: theme.colors.border, marginRight: 8,
          }}
        >
          <Ionicons name="calendar-outline" size={13} color={theme.colors.primary} />
          <Text style={{ fontSize: 11.5, fontWeight: '700', color: theme.colors.textPrimary, marginLeft: 5 }}>
            {isToday ? 'Today' : dateKey}
          </Text>
        </TouchableOpacity>

        {!isToday && (
          <TouchableOpacity onPress={() => setDateKey(todayKey())} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="refresh-circle" size={26} color={theme.colors.primary} />
          </TouchableOpacity>
        )}
      </View>

      {showDatePicker && (
        <DateTimePicker
          value={new Date(`${dateKey}T00:00:00`)}
          mode="date"
          maximumDate={new Date()}
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={onPickDate}
        />
      )}

      {/* ------------------------------------------------------------- filter */}
      <TouchableOpacity
        onPress={() => setFilterOpen(true)}
        activeOpacity={0.8}
        style={{
          flexDirection: 'row', alignItems: 'center', marginBottom: 14,
          paddingVertical: 9, paddingHorizontal: 13, borderRadius: 13,
          backgroundColor: filterActive ? theme.colors.primary + '14' : theme.colors.surface,
          borderWidth: 1, borderColor: filterActive ? theme.colors.primary : theme.colors.border,
        }}
      >
        <Ionicons name="funnel-outline" size={14} color={filterActive ? theme.colors.primary : theme.colors.textSecondary} />
        <Text numberOfLines={1} style={{ flex: 1, marginLeft: 8, fontSize: 12.5, fontWeight: '700', color: filterActive ? theme.colors.primary : theme.colors.textSecondary }}>
          {filterActive ? `${filter.type === 'role' ? 'Role' : filter.type[0].toUpperCase() + filter.type.slice(1)}: ${filter.label}` : 'Whole organisation'}
        </Text>
        {filterActive
          ? <TouchableOpacity onPress={() => setFilter({ type: 'all' })} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close-circle" size={17} color={theme.colors.primary} />
            </TouchableOpacity>
          : <Ionicons name="chevron-down" size={15} color={theme.colors.textSecondary} />}
      </TouchableOpacity>

      {/* --------------------------------------------------------- hero ring */}
      <View
        style={{
          backgroundColor: theme.colors.surface, borderRadius: 20, borderWidth: 1,
          borderColor: theme.colors.border, padding: 16, marginBottom: CARD_GAP,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <DonutRing
            size={Math.min(168, width * 0.44)}
            thickness={12}
            ticks={60}
            segments={ringSegments}
            centerValue={`${counts.attendanceRate}%`}
            centerLabel="ON DUTY"
            centerSub={`${counts.working}/${counts.expected} expected`}
            centerColor={counts.attendanceRate >= 85 ? CALENDAR_COLORS.present : counts.attendanceRate >= 60 ? CALENDAR_COLORS.partial : CALENDAR_COLORS.absent}
          />
          <View style={{ flex: 1, marginLeft: 10 }}>
            {STATUS_ORDER.filter((k) => counts[k] > 0).map((k) => {
              const m = STATUS_META[k];
              return (
                <TouchableOpacity
                  key={k}
                  onPress={() => openStatus(k)}
                  activeOpacity={0.7}
                  style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 3.5 }}
                >
                  <View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: m.color, marginRight: 7 }} />
                  <Text numberOfLines={1} style={{ flex: 1, fontSize: 11.5, color: theme.colors.textSecondary }}>{m.short}</Text>
                  <Text style={{ fontSize: 12.5, fontWeight: '800', color: theme.colors.textPrimary }}>{counts[k]}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <SegmentBar
          height={10}
          style={{ marginTop: 14 }}
          segments={STATUS_ORDER.map((k) => ({ key: k, value: counts[k] || 0, color: STATUS_META[k].color }))}
        />
        <Text style={{ fontSize: 10.5, color: theme.colors.textSecondary, marginTop: 8, textAlign: 'center' }}>
          {counts.total} staff tracked{filterActive ? ' in this view' : ''} · {snapshot.isSunday ? 'Sunday' : new Date(`${dateKey}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
        </Text>
      </View>

      {/* -------------------------------------------------------- stat tiles */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: CARD_GAP }}>
        {STATUS_ORDER.map((k) => (
          <StatTile
            key={k}
            meta={STATUS_META[k]}
            value={counts[k] || 0}
            width={tileWidth}
            theme={theme}
            onPress={() => openStatus(k)}
          />
        ))}
      </View>

      {/* ----------------------------------------------------------- alerts */}
      {snapshot.alerts.length > 0 && (
        <View style={{ marginBottom: CARD_GAP }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
            <Ionicons name="warning-outline" size={16} color={SEVERITY_COLOR.high} />
            <Text style={{ marginLeft: 7, fontSize: 14.5, fontWeight: '800', color: theme.colors.textPrimary }}>Needs Attention</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 6 }}>
            {snapshot.alerts.map((a) => (
              <AlertCard key={a.key} alert={a} theme={theme} onPress={() => openAlert(a)} />
            ))}
          </ScrollView>
        </View>
      )}

      {/* -------------------------------------------------------- approvals */}
      <SectionCard
        theme={theme}
        icon="checkmark-done-outline"
        title="Approvals Waiting"
        subtitle={filterActive
          ? `${snapshot.approvals.totalPending} pending across the organisation (queues are not filtered)`
          : `${snapshot.approvals.totalPending} pending · ${snapshot.approvals.totalOverdue} over ${snapshot.thresholds.slaHours}h`}
      >
        {APPROVAL_META.map((m, i) => (
          <View key={m.key}>
            {i > 0 && <View style={{ height: 1, backgroundColor: theme.colors.border }} />}
            <ApprovalRow
              meta={m}
              queue={snapshot.approvals[m.key] || { count: 0, overdue: 0, items: [] }}
              slaHours={snapshot.thresholds.slaHours}
              theme={theme}
              onPress={() => openApproval(m.key)}
            />
          </View>
        ))}
      </SectionCard>

      {/* ---------------------------------------------------------- workday */}
      <SectionCard theme={theme} icon="time-outline" title="The Working Day">
        <View style={{ flexDirection: 'row', marginBottom: 14 }}>
          <MiniStat value={punctuality.onTime} label="On time" color={CALENDAR_COLORS.present} />
          <MiniStat value={punctuality.late} label="Late" color={CALENDAR_COLORS.partial} />
          <MiniStat value={punctuality.stillIn} label="Still in" color={theme.colors.primary} />
          <MiniStat value={punctuality.completed} label="Done" color={theme.colors.textPrimary} />
        </View>

        <View style={{ flexDirection: 'row', marginBottom: 16 }}>
          <MiniStat value={punctuality.avgCheckInClock || '—'} label="Avg check-in" />
          <MiniStat value={humanMinutes(punctuality.avgWorkMin)} label="Avg day length" />
          <MiniStat value={punctuality.checkedIn} label="Checked in" />
        </View>

        <Text style={{ fontSize: 11, fontWeight: '700', color: theme.colors.textSecondary, marginBottom: 7 }}>
          CHECK-INS BY HOUR
        </Text>
        <HourBars data={punctuality.timeline} color={CALENDAR_COLORS.present} markerHour={isToday ? nowHour : null} />

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
          {Object.entries(FLAG_META)
            .filter(([key]) => flagCounts[key] > 0)
            .map(([key, meta]) => (
              <TouchableOpacity
                key={key}
                activeOpacity={0.75}
                onPress={() => openFlag(key)}
                style={{
                  flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 7,
                  borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.background,
                }}
              >
                <Ionicons name={meta.icon} size={12.5} color={theme.colors.textSecondary} />
                <Text style={{ fontSize: 11, color: theme.colors.textSecondary, marginLeft: 5 }}>{meta.label}</Text>
                <Text style={{ fontSize: 11.5, fontWeight: '900', color: theme.colors.textPrimary, marginLeft: 6 }}>{flagCounts[key]}</Text>
              </TouchableOpacity>
            ))}
        </View>
      </SectionCard>

      {/* ---------------------------------------------------------- schools */}
      <SectionCard
        theme={theme}
        icon="business-outline"
        title="School Coverage"
        action="All schools"
        onAction={() => openSchools('all')}
      >
        <View style={{ flexDirection: 'row', marginBottom: 14 }}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={0.7} onPress={() => openSchools('covered')}>
            <MiniStat value={schoolSummary.covered} label="Covered" color={CALENDAR_COLORS.present} />
          </TouchableOpacity>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={0.7} onPress={() => openSchools('uncovered')}>
            <MiniStat value={schoolSummary.uncovered} label="Nobody there" color={CALENDAR_COLORS.absent} />
          </TouchableOpacity>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={0.7} onPress={() => openSchools('holiday')}>
            <MiniStat value={schoolSummary.onHoliday} label="On holiday" color={CALENDAR_COLORS.holiday} />
          </TouchableOpacity>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={0.7} onPress={() => openSchools('unstaffed')}>
            <MiniStat value={schoolSummary.unstaffed} label="No staff" color={CALENDAR_COLORS.unknown} />
          </TouchableOpacity>
        </View>

        {schools.length === 0 ? (
          <Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>No schools in this view.</Text>
        ) : (
          [...schools]
            .sort((a, b) => (b.onDuty / Math.max(1, b.assigned)) - (a.onDuty / Math.max(1, a.assigned)) || b.onDuty - a.onDuty)
            .slice(0, 6)
            .map((s) => (
              <BarRow
                key={s.id}
                label={s.name}
                sub={s.onHoliday ? 'Holiday' : s.state || ''}
                value={s.onDuty}
                max={Math.max(1, ...schools.map((x) => Math.max(x.assigned, x.onDuty)))}
                valueLabel={`${s.onDuty}/${s.assigned}`}
                color={s.onHoliday ? CALENDAR_COLORS.holiday : s.covered ? CALENDAR_COLORS.present : CALENDAR_COLORS.absent}
              />
            ))
        )}
        {schools.length > 6 && (
          <TouchableOpacity onPress={() => openSchools('all')} style={{ paddingTop: 4 }}>
            <Text style={{ fontSize: 11.5, fontWeight: '700', color: theme.colors.primary }}>
              View all {schools.length} schools
            </Text>
          </TouchableOpacity>
        )}
      </SectionCard>

      {/* ------------------------------------------------------------ teams */}
      {teams.length > 0 && (
        <SectionCard theme={theme} icon="people-circle-outline" title="Teams Today" subtitle="Ranked by on-duty rate — tap a team to see its people">
          {teams.slice(0, 8).map((t) => (
            <TouchableOpacity
              key={t.id}
              activeOpacity={0.75}
              onPress={() => openPeople(view.people.filter((p) => p.teamId === t.id), t.name, `${t.total} staff · ${t.attendanceRate}% on duty`)}
            >
              <BarRow
                label={t.name}
                sub={`${t.working}/${t.expected}`}
                value={t.attendanceRate}
                max={100}
                valueLabel={`${t.attendanceRate}%`}
                color={t.attendanceRate >= 85 ? CALENDAR_COLORS.present : t.attendanceRate >= 60 ? CALENDAR_COLORS.partial : CALENDAR_COLORS.absent}
              />
            </TouchableOpacity>
          ))}
        </SectionCard>
      )}

      {/* ------------------------------------------------------------ heads */}
      {heads.length > 0 && (
        <SectionCard theme={theme} icon="ribbon-outline" title="Heads & Their People" subtitle="Tap a head to see everyone under them">
          {heads.slice(0, 8).map((h) => (
            <TouchableOpacity
              key={h.id}
              activeOpacity={0.75}
              onPress={() => openPeople(view.people.filter((p) => p.headIds.includes(h.id)), h.name, `${roleLabel(h.role)} · ${h.total} staff`)}
            >
              <BarRow
                label={h.name}
                sub={`${roleLabel(h.role)} · ${h.total}`}
                value={h.attendanceRate}
                max={100}
                valueLabel={`${h.attendanceRate}%`}
                color={h.attendanceRate >= 85 ? CALENDAR_COLORS.present : h.attendanceRate >= 60 ? CALENDAR_COLORS.partial : CALENDAR_COLORS.absent}
              />
            </TouchableOpacity>
          ))}
        </SectionCard>
      )}

      {/* ----------------------------------------------------------- output */}
      <SectionCard theme={theme} icon="pulse-outline" title="Produced Today" subtitle="Everything created on this date, organisation-wide">
        <View style={{ flexDirection: 'row', marginBottom: 12 }}>
          <MiniStat value={snapshot.output.activities.total} label="Activities" color={theme.colors.primary} />
          <MiniStat value={snapshot.output.activities.approved} label="Approved" color={CALENDAR_COLORS.present} />
          <MiniStat value={snapshot.output.activities.pending} label="Pending" color={CALENDAR_COLORS.partial} />
        </View>
        <View style={{ height: 1, backgroundColor: theme.colors.border, marginBottom: 12 }} />
        <View style={{ flexDirection: 'row' }}>
          <MiniStat value={snapshot.output.reports.total} label="Visit reports" color={theme.colors.primary} />
          <MiniStat value={snapshot.output.meetings} label="Meetings" color={theme.colors.primary} />
          <MiniStat value={snapshot.output.banners} label="Banners" color={theme.colors.primary} />
        </View>
      </SectionCard>

      {/* ------------------------------------------------------- readiness */}
      <SectionCard theme={theme} icon="shield-checkmark-outline" title="Staff Readiness & Reach">
        <View style={{ flexDirection: 'row', marginBottom: 12 }}>
          <MiniStat value={snapshot.engagement.faceReady} label="Face approved" color={CALENDAR_COLORS.present} />
          <MiniStat value={snapshot.approvals.face.count} label="Face pending" color={CALENDAR_COLORS.partial} />
          <MiniStat value={snapshot.engagement.faceMissing} label="Not registered" color={CALENDAR_COLORS.absent} />
        </View>
        <View style={{ height: 1, backgroundColor: theme.colors.border, marginBottom: 12 }} />
        <View style={{ flexDirection: 'row' }}>
          <MiniStat value={snapshot.engagement.pushReady} label="Push enabled" color={theme.colors.primary} />
          <MiniStat value={snapshot.engagement.notificationsSent} label="Alerts sent" color={theme.colors.primary} />
          <MiniStat value={`${snapshot.engagement.readRate}%`} label="Read rate" color={theme.colors.primary} />
        </View>
        {snapshot.engagement.faceMissing > 0 && (
          <TouchableOpacity onPress={() => openFlag('noFace')} style={{ marginTop: 12 }}>
            <Text style={{ fontSize: 11.5, fontWeight: '700', color: theme.colors.primary }}>
              See who cannot check in yet →
            </Text>
          </TouchableOpacity>
        )}
      </SectionCard>

      {/* ----------------------------------------------------------- legend */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginBottom: 6 }}>
        {STATUS_ORDER.map((k) => (
          <View key={k} style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 6, marginVertical: 3 }}>
            <View style={{ width: 9, height: 9, borderRadius: 2.5, backgroundColor: STATUS_META[k].color, marginRight: 5 }} />
            <Text style={{ fontSize: 10.5, color: theme.colors.textSecondary }}>{STATUS_META[k].short}</Text>
          </View>
        ))}
      </View>
      <Text style={{ textAlign: 'center', fontSize: 10, color: theme.colors.textSecondary, marginBottom: 20 }}>
        Absent counts only once the day has ended ({Math.floor(snapshot.thresholds.dayEndMin / 60)}:00);
        before that, staff without attendance appear under “Not Marked”.
      </Text>

      <DrillSheet
        drill={drill}
        onClose={() => setDrill(null)}
        onOpenPerson={openPerson}
        onOpenSchool={onOpenSchool ? (s) => { setDrill(null); onOpenSchool(s); } : undefined}
      />
      <FilterSheet
        visible={filterOpen}
        snapshot={snapshot}
        filter={filter}
        onApply={setFilter}
        onClose={() => setFilterOpen(false)}
      />
    </View>
  );
}
