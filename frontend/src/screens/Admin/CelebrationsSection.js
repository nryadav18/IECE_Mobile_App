/**
 * Celebrations — the admin's window onto the header.
 *
 * Pick a year, find a day, tap an occasion, and the app opens **the real Home
 * screen on that date**. Not a scaled-down frame, not a mock-up: the same
 * `DashboardScreen` everyone else opens every morning, pushed onto the stack
 * with a different date in its route params. Whatever the admin sees there is
 * exactly, literally what the whole company will see on the day.
 *
 * That approach is the point. A preview built as a separate rendering of the
 * same idea is a second implementation, and second implementations drift — the
 * spacing goes stale, a new scene doesn't get wired in, the status bar behaves
 * differently. Opening the actual screen cannot drift, because there is
 * nothing to drift from. It is the same trick Approvals already uses to
 * preview an activity before approving it.
 *
 * The real Home stays on the stack underneath, untouched — same scroll
 * position, same loaded data — and is simply revealed again on Done.
 *
 * This screen is also where the catalogue's gaps get fixed: a handful of moving
 * festivals ship without a full ten-year table, and regional panchangams
 * disagree by a day now and then. Both are correctable here, and the correction
 * reaches every phone without an app release.
 */

import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { ThemeContext } from '../../context/ThemeContext';
import { AuthContext } from '../../context/AuthContext';
import { useAlert } from '../../context/AlertContext';
import api from '../../services/api';
import { makeCalendar, VERIFIED_THROUGH } from '../../celebrations/resolve';
import { TAG_LABEL, TAG_ORDER } from '../../celebrations/occasions';
import { MONTH_NAMES, fromYmd, prettyDate, shortDate, ymd } from '../../celebrations/dates';
import { withAlpha } from '../../celebrations/palette';

export default function CelebrationsSection({ active = true }) {
  const { theme } = useContext(ThemeContext);
  const { user } = useContext(AuthContext);
  const { showAlert } = useAlert();
  const navigation = useNavigation();

  const canEdit = user?.role === 'creator_admin';

  const [overrides, setOverrides] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [year, setYear] = useState(() => new Date().getFullYear());
  const [selectedKey, setSelectedKey] = useState(() => ymd(new Date()));
  const [tag, setTag] = useState(null);
  const [query, setQuery] = useState('');
  const [showPicker, setShowPicker] = useState(false);

  /* "Set a date" form. */
  const [chooserOpen, setChooserOpen] = useState(false);
  const [chooserQuery, setChooserQuery] = useState('');
  const [chosenKey, setChosenKey] = useState(null);
  const [chosenDateKey, setChosenDateKey] = useState(() => ymd(new Date()));
  const [showChosenPicker, setShowChosenPicker] = useState(false);

  /* ------------------------------------------------------------------ *
   * Data — self-contained, following the SchoolHolidayApprovals pattern *
   * ------------------------------------------------------------------ */
  const load = useCallback(async () => {
    try {
      const res = await api.get('/occasions');
      setOverrides(Array.isArray(res.data?.data) ? res.data.data : []);
    } catch {
      // The bundled catalogue is the source of truth; overrides are a bonus.
      setOverrides([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Re-read overrides whenever this tab comes back into view, so a change made
  // on another device — or a save that happened before a preview — is reflected.
  useEffect(() => {
    if (active && !loading) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const calendar = useMemo(() => makeCalendar(overrides), [overrides]);
  const yearDays = useMemo(() => calendar.forYear(year), [calendar, year]);
  const missing = useMemo(() => calendar.missingDatesFor(year), [calendar, year]);

  const selectedDate = useMemo(() => fromYmd(selectedKey) || new Date(), [selectedKey]);
  const dayOccasions = useMemo(() => calendar.forDate(selectedDate), [calendar, selectedDate]);

  /* ------------------------------------------------------------------ *
   * The preview                                                         *
   * ------------------------------------------------------------------ */
  const openPreview = useCallback(
    (dateKey, occasionKey = null) => {
      navigation.navigate('CelebrationPreview', {
        preview: true,
        previewDateKey: dateKey,
        previewOccasionKey: occasionKey,
      });
    },
    [navigation]
  );

  /* Filtered listing. */
  const listed = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = yearDays
      .map((d) => ({
        ...d,
        occasions: d.occasions.filter(
          (o) =>
            (!tag || (o.tags || []).includes(tag)) &&
            (!q || o.name.toLowerCase().includes(q) || o.wish.toLowerCase().includes(q))
        ),
      }))
      .filter((d) => d.occasions.length > 0);

    // Grouped by month, because a flat list of ~45 days is unscannable.
    const byMonth = [];
    for (const row of rows) {
      const m = row.date.getMonth();
      const last = byMonth[byMonth.length - 1];
      if (!last || last.month !== m) byMonth.push({ month: m, days: [row] });
      else last.days.push(row);
    }
    return byMonth;
  }, [yearDays, tag, query]);

  const totalDays = useMemo(() => listed.reduce((n, m) => n + m.days.length, 0), [listed]);

  /* ------------------------------------------------------------------ *
   * Overrides                                                           *
   * ------------------------------------------------------------------ */
  const saveOverride = async (body, successMsg) => {
    if (!canEdit) return;
    setSaving(true);
    try {
      await api.post('/occasions', body);
      await load();
      showAlert('Saved', successMsg, 'success');
    } catch (err) {
      showAlert('Error', err.response?.data?.message || 'Could not save that change.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const clearOverride = async (key) => {
    if (!canEdit) return;
    setSaving(true);
    try {
      await api.delete(`/occasions/${encodeURIComponent(key)}`);
      await load();
      showAlert('Restored', 'This occasion is back to its built-in settings.', 'success');
    } catch (err) {
      showAlert('Error', err.response?.data?.message || 'Could not restore that occasion.', 'error');
    } finally {
      setSaving(false);
    }
  };

  /* ------------------------------------------------------------------ *
   * "Set a date" — the chooser                                          *
   *                                                                     *
   * The moving festivals are the reason this exists. An occasion with no *
   * date for a given year never appears on any day, so it can't be       *
   * reached by picking a date and editing what's there — it has to be    *
   * selectable from the whole catalogue. Ones missing a date for the     *
   * chosen year sort to the top.                                        *
   * ------------------------------------------------------------------ */
  const chooserRows = useMemo(() => {
    const q = chooserQuery.trim().toLowerCase();
    return calendar.catalogue
      .map((o) => {
        const isTable = o.when?.type === 'table';
        return { o, isTable, needs: isTable && !o.when.dates?.[year] };
      })
      .filter(({ o }) => !q || o.name.toLowerCase().includes(q) || o.wish.toLowerCase().includes(q))
      .sort((a, b) => Number(b.needs) - Number(a.needs) || a.o.name.localeCompare(b.o.name));
  }, [calendar, year, chooserQuery]);

  const chosen = useMemo(
    () => calendar.catalogue.find((o) => o.key === chosenKey) || null,
    [calendar, chosenKey]
  );
  const chosenDate = useMemo(() => fromYmd(chosenDateKey) || new Date(), [chosenDateKey]);
  const chosenIsFixed = chosen?.when?.type === 'fixed';
  const chosenIsRule = chosen?.when?.type === 'nthWeekday' || chosen?.when?.type === 'easter';

  const submitDate = async () => {
    if (!chosen) return;
    await saveOverride(
      { key: chosen.key, date: chosenDateKey },
      chosenIsFixed
        ? `${chosen.name} now falls on ${chosenDate.getDate()} ${MONTH_NAMES[chosenDate.getMonth()]} — every year.`
        : `${chosen.name} is set for ${prettyDate(chosenDate)}.`
    );
    setSelectedKey(chosenDateKey);
  };

  const c = theme.colors;

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={c.primary} />
      </View>
    );
  }

  return (
    <View>
      {/* ---------- Year + date ---------- */}
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
        <View style={styles.yearRow}>
          <TouchableOpacity
            onPress={() => setYear((y) => y - 1)}
            style={[styles.stepBtn, { borderColor: c.border }]}
            accessibilityLabel="Previous year"
          >
            <Ionicons name="chevron-back" size={18} color={c.textPrimary} />
          </TouchableOpacity>

          <View style={styles.yearLabel}>
            <Text style={[styles.year, { color: c.textPrimary }]}>{year}</Text>
            <Text style={[styles.yearSub, { color: c.textSecondary }]}>
              {totalDays} celebrated {totalDays === 1 ? 'day' : 'days'}
            </Text>
          </View>

          <TouchableOpacity
            onPress={() => setYear((y) => y + 1)}
            style={[styles.stepBtn, { borderColor: c.border }]}
            accessibilityLabel="Next year"
          >
            <Ionicons name="chevron-forward" size={18} color={c.textPrimary} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          onPress={() => setShowPicker(true)}
          style={[styles.field, { borderColor: c.border, backgroundColor: c.background }]}
        >
          <Ionicons name="calendar-outline" size={16} color={c.primary} />
          <Text style={[styles.fieldText, { color: c.textPrimary }]}>{prettyDate(selectedDate)}</Text>
          <Text style={[styles.fieldHint, { color: c.textSecondary }]}>Jump to a date</Text>
        </TouchableOpacity>

        {showPicker && (
          <DateTimePicker
            value={selectedDate}
            mode="date"
            display="default"
            onChange={(event, picked) => {
              setShowPicker(Platform.OS === 'ios');
              if (event.type === 'dismissed' || !picked) return;
              // Local date parts, never toISOString() — that shifts to UTC and
              // lands on the previous day for any evening pick in IST.
              setSelectedKey(ymd(picked));
              setYear(picked.getFullYear());
            }}
          />
        )}

        {/* What that day actually is, and the way into the real thing. */}
        {dayOccasions.length > 0 ? (
          <>
            {dayOccasions.map((o) => (
              <View key={o.key} style={[styles.dayRow, { borderColor: c.border }]}>
                <View style={[styles.dayIcon, { backgroundColor: withAlpha(c.primary, 0.1) }]}>
                  <Ionicons name={o.emblem || 'sparkles-outline'} size={16} color={c.primary} />
                </View>
                <View style={styles.dayBody}>
                  <Text style={[styles.dayName, { color: c.textPrimary }]} numberOfLines={1}>
                    {o.name}
                  </Text>
                  <Text style={[styles.dayWish, { color: c.textSecondary }]} numberOfLines={1}>
                    {o.wish}
                  </Text>
                </View>

                <TouchableOpacity
                  onPress={() => openPreview(selectedKey, o.key)}
                  style={[styles.ghostBtn, { borderColor: c.primary }]}
                >
                  <Ionicons name="eye-outline" size={14} color={c.primary} />
                  <Text style={[styles.ghostBtnText, { color: c.primary }]}>Preview</Text>
                </TouchableOpacity>
              </View>
            ))}

            {canEdit && (
              <View style={styles.actions}>
                {dayOccasions.map((o) => (
                  <React.Fragment key={o.key}>
                    <TouchableOpacity
                      disabled={saving}
                      onPress={() =>
                        saveOverride(
                          { key: o.key, muted: true },
                          `${o.name} will no longer take over the header.`
                        )
                      }
                      style={[styles.action, { borderColor: c.border }]}
                    >
                      <Ionicons name="eye-off-outline" size={14} color={c.textSecondary} />
                      <Text style={[styles.actionText, { color: c.textSecondary }]}>
                        Mute {o.name}
                      </Text>
                    </TouchableOpacity>

                    {o.overridden && (
                      <TouchableOpacity
                        disabled={saving}
                        onPress={() => clearOverride(o.key)}
                        style={[styles.action, { borderColor: c.border }]}
                      >
                        <Ionicons name="refresh-outline" size={14} color={c.textSecondary} />
                        <Text style={[styles.actionText, { color: c.textSecondary }]}>
                          Restore {o.name}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </React.Fragment>
                ))}
              </View>
            )}

            <TouchableOpacity
              onPress={() => openPreview(selectedKey)}
              style={[styles.primaryBtn, { backgroundColor: c.primary }]}
            >
              <Ionicons name="phone-portrait-outline" size={17} color="#FFFFFF" />
              <Text style={styles.primaryBtnText}>
                {dayOccasions.length > 1
                  ? `Open the full screen — all ${dayOccasions.length} in turn`
                  : 'Open the full Home screen'}
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <View style={[styles.notice, { backgroundColor: withAlpha(c.textSecondary, 0.1) }]}>
            <Ionicons name="moon-outline" size={15} color={c.textSecondary} />
            <Text style={[styles.noticeText, { color: c.textSecondary }]}>
              Nothing on {shortDate(selectedDate)} — Home shows the usual IECE Pulse hero and the
              time-of-day greeting.
            </Text>
          </View>
        )}

        {year > VERIFIED_THROUGH && (
          <View style={[styles.notice, { backgroundColor: withAlpha(c.error, 0.1) }]}>
            <Ionicons name="alert-circle-outline" size={15} color={c.error} />
            <Text style={[styles.noticeText, { color: c.error }]}>
              Moving festivals are only tabulated through {VERIFIED_THROUGH}. {year} will show
              fixed-date occasions only.
            </Text>
          </View>
        )}

        {missing.length > 0 && (
          <View style={[styles.notice, { backgroundColor: withAlpha(c.primary, 0.1) }]}>
            <Ionicons name="information-circle-outline" size={15} color={c.primary} />
            <Text style={[styles.noticeText, { color: c.primary }]}>
              No {year} date yet for {missing.map((o) => o.name).join(', ')}. Add one below and it
              reaches every phone without an app update.
            </Text>
          </View>
        )}
      </View>

      {/* ---------- Set a date ---------- */}
      {canEdit && (
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Text style={[styles.cardTitle, { color: c.textPrimary }]}>Set a date</Text>
          <Text style={[styles.cardHint, { color: c.textSecondary }]}>
            Pick any occasion the app already animates and tell it when it falls this year.
            It goes live on every phone — no app update.
          </Text>

          <TouchableOpacity
            onPress={() => setChooserOpen(true)}
            style={[styles.field, { borderColor: c.border, backgroundColor: c.background }]}
          >
            <Ionicons
              name={chosen ? chosen.emblem || 'sparkles-outline' : 'list-outline'}
              size={16}
              color={c.primary}
            />
            <Text style={[styles.fieldText, { color: chosen ? c.textPrimary : c.placeholder }]}>
              {chosen ? chosen.name : 'Choose an occasion'}
            </Text>
            <Ionicons name="chevron-down" size={16} color={c.textSecondary} />
          </TouchableOpacity>

          {!!chosen && (
            <>
              <TouchableOpacity
                onPress={() => setShowChosenPicker(true)}
                style={[styles.field, { borderColor: c.border, backgroundColor: c.background }]}
              >
                <Ionicons name="calendar-outline" size={16} color={c.primary} />
                <Text style={[styles.fieldText, { color: c.textPrimary }]}>
                  {prettyDate(chosenDate)}
                </Text>
              </TouchableOpacity>

              {showChosenPicker && (
                <DateTimePicker
                  value={chosenDate}
                  mode="date"
                  display="default"
                  onChange={(event, picked) => {
                    setShowChosenPicker(Platform.OS === 'ios');
                    if (event.type === 'dismissed' || !picked) return;
                    setChosenDateKey(ymd(picked));
                  }}
                />
              )}

              {/* What this will actually do — spelled out, because the three
                  kinds of occasion behave differently and a surprise here
                  would be a bad one. */}
              <View
                style={[
                  styles.notice,
                  { backgroundColor: withAlpha(chosenIsRule ? c.error : c.primary, 0.1) },
                ]}
              >
                <Ionicons
                  name={chosenIsRule ? 'alert-circle-outline' : 'information-circle-outline'}
                  size={15}
                  color={chosenIsRule ? c.error : c.primary}
                />
                <Text style={[styles.noticeText, { color: chosenIsRule ? c.error : c.primary }]}>
                  {chosenIsFixed
                    ? `${chosen.name} already recurs on the same date every year. Saving moves it to ${chosenDate.getDate()} ${MONTH_NAMES[chosenDate.getMonth()]} — and it stays annual.`
                    : chosenIsRule
                      ? `${chosen.name} is worked out by a rule (${chosen.when.type === 'easter' ? 'from Easter' : 'an nth weekday'}) and is already correct every year. Setting a date turns it into a one-off for this date only.`
                      : `Sets ${chosen.name} for ${chosenDate.getFullYear()} only. Its other years are untouched.`}
                </Text>
              </View>

              <TouchableOpacity
                disabled={saving}
                onPress={submitDate}
                style={[styles.primaryBtn, { backgroundColor: c.primary, opacity: saving ? 0.6 : 1 }]}
              >
                {saving ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle-outline" size={17} color="#FFFFFF" />
                    <Text style={styles.primaryBtnText}>Save this date</Text>
                  </>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      {/* ---------- Occasion chooser ---------- */}
      <Modal
        visible={chooserOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setChooserOpen(false)}
        // Without both of these an Android transparent modal draws a black
        // border and visibly shrinks the app behind it.
        statusBarTranslucent
        navigationBarTranslucent
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.sheet, { backgroundColor: c.surface }]}>
            <View style={styles.sheetHead}>
              <Text style={[styles.cardTitle, { color: c.textPrimary }]}>Choose an occasion</Text>
              <TouchableOpacity onPress={() => setChooserOpen(false)} accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={c.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={[styles.search, { borderColor: c.border, backgroundColor: c.background }]}>
              <Ionicons name="search-outline" size={15} color={c.textSecondary} />
              <TextInput
                value={chooserQuery}
                onChangeText={setChooserQuery}
                placeholder="Search all occasions"
                placeholderTextColor={c.placeholder}
                style={[styles.searchInput, { color: c.textPrimary }]}
              />
            </View>

            <FlatList
              data={chooserRows}
              keyExtractor={(r) => r.o.key}
              keyboardShouldPersistTaps="handled"
              style={{ marginTop: 10 }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  onPress={() => {
                    setChosenKey(item.o.key);
                    // Land on a sensible starting date: the one it already has
                    // for this year, or the day being looked at.
                    const existing = item.isTable ? item.o.when.dates?.[year] : null;
                    setChosenDateKey(existing || selectedKey);
                    setChooserOpen(false);
                    setChooserQuery('');
                  }}
                  style={[styles.sheetRow, { borderColor: c.border }]}
                >
                  <View style={[styles.dayIcon, { backgroundColor: withAlpha(c.primary, 0.1) }]}>
                    <Ionicons name={item.o.emblem || 'sparkles-outline'} size={16} color={c.primary} />
                  </View>
                  <View style={styles.dayBody}>
                    <Text style={[styles.dayName, { color: c.textPrimary }]} numberOfLines={1}>
                      {item.o.name}
                    </Text>
                    <Text style={[styles.dayWish, { color: c.textSecondary }]} numberOfLines={1}>
                      {item.needs
                        ? `No ${year} date yet`
                        : item.isTable
                          ? `${year}: ${shortDate(fromYmd(item.o.when.dates[year]))}`
                          : 'Recurs every year'}
                    </Text>
                  </View>
                  {item.needs && (
                    <View style={[styles.pill, { backgroundColor: withAlpha(c.error, 0.14) }]}>
                      <Text style={[styles.pillText, { color: c.error }]}>needs date</Text>
                    </View>
                  )}
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>

      {/* ---------- The year ---------- */}
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Text style={[styles.cardTitle, { color: c.textPrimary }]}>Every celebrated day</Text>
        <Text style={[styles.cardHint, { color: c.textSecondary }]}>
          Tap any occasion to open the real Home screen on that date.
        </Text>

        <View style={[styles.search, { borderColor: c.border, backgroundColor: c.background }]}>
          <Ionicons name="search-outline" size={15} color={c.textSecondary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search occasions"
            placeholderTextColor={c.placeholder}
            style={[styles.searchInput, { color: c.textPrimary }]}
          />
          {!!query && (
            <TouchableOpacity onPress={() => setQuery('')} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={16} color={c.textSecondary} />
            </TouchableOpacity>
          )}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tagRow}>
          {[null, ...TAG_ORDER].map((t) => {
            const on = tag === t;
            return (
              <TouchableOpacity
                key={t || 'all'}
                onPress={() => setTag(t)}
                style={[
                  styles.tag,
                  {
                    backgroundColor: on ? c.primary : c.background,
                    borderColor: on ? c.primary : c.border,
                  },
                ]}
              >
                <Text style={[styles.tagText, { color: on ? '#FFFFFF' : c.textSecondary }]}>
                  {t ? TAG_LABEL[t] : 'All'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {listed.length === 0 ? (
          <Text style={[styles.emptySub, { color: c.textSecondary, paddingVertical: 18 }]}>
            No occasions match that filter in {year}.
          </Text>
        ) : (
          listed.map((group) => (
            <View key={group.month} style={styles.month}>
              <Text style={[styles.monthName, { color: c.textSecondary }]}>
                {MONTH_NAMES[group.month]}
              </Text>

              {group.days.map((day) => (
                <View key={day.key} style={styles.dayGroup}>
                  {day.occasions.map((o, i) => (
                    <TouchableOpacity
                      key={o.key}
                      // Straight into the real screen. Selecting the day as
                      // well keeps the card above in step for muting/editing.
                      onPress={() => {
                        setSelectedKey(day.key);
                        openPreview(day.key, o.key);
                      }}
                      style={[
                        styles.row,
                        {
                          borderColor: day.key === selectedKey ? c.primary : c.border,
                          backgroundColor:
                            day.key === selectedKey ? withAlpha(c.primary, 0.06) : 'transparent',
                        },
                      ]}
                    >
                      <View style={[styles.rowDate, { backgroundColor: withAlpha(c.primary, 0.1) }]}>
                        {i === 0 ? (
                          <Text style={[styles.rowDay, { color: c.primary }]}>
                            {day.date.getDate()}
                          </Text>
                        ) : (
                          <Ionicons name="add" size={14} color={c.primary} />
                        )}
                      </View>

                      <View style={styles.dayBody}>
                        <Text style={[styles.dayName, { color: c.textPrimary }]} numberOfLines={1}>
                          {o.name}
                        </Text>
                        <Text style={[styles.dayWish, { color: c.textSecondary }]} numberOfLines={1}>
                          {o.wish}
                          {day.occasions.length > 1 ? ` · ${i + 1} of ${day.occasions.length}` : ''}
                        </Text>
                      </View>

                      {o.overridden && (
                        <View style={[styles.pill, { backgroundColor: withAlpha(c.primary, 0.14) }]}>
                          <Text style={[styles.pillText, { color: c.primary }]}>edited</Text>
                        </View>
                      )}

                      <Ionicons name="chevron-forward" size={16} color={c.textSecondary} />
                    </TouchableOpacity>
                  ))}
                </View>
              ))}
            </View>
          ))
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { paddingVertical: 40, alignItems: 'center' },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
  },
  cardTitle: { fontSize: 15.5, fontWeight: '800' },
  cardHint: { fontSize: 11.5, fontWeight: '600', lineHeight: 16, marginTop: 4 },

  /* year */
  yearRow: { flexDirection: 'row', alignItems: 'center', gap: 16, justifyContent: 'center' },
  yearLabel: { alignItems: 'center', minWidth: 130 },
  year: { fontSize: 26, fontWeight: '900', letterSpacing: -0.5 },
  yearSub: { fontSize: 11.5, fontWeight: '600' },
  stepBtn: {
    width: 34, height: 34, borderRadius: 17, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },

  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginTop: 14,
  },
  fieldText: { fontSize: 14, fontWeight: '700', flex: 1 },
  fieldHint: { fontSize: 11, fontWeight: '600' },

  notice: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    borderRadius: 12,
    padding: 10,
    marginTop: 12,
  },
  noticeText: { fontSize: 11.5, fontWeight: '600', flex: 1, lineHeight: 16 },

  /* the selected day */
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    borderWidth: 1,
    borderRadius: 13,
    padding: 10,
    marginTop: 12,
  },
  dayIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  dayBody: { flex: 1, gap: 2 },
  dayName: { fontSize: 13.5, fontWeight: '800' },
  dayWish: { fontSize: 11.5, fontWeight: '600' },
  ghostBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: 1, borderRadius: 11, paddingHorizontal: 10, paddingVertical: 7,
  },
  ghostBtnText: { fontSize: 11.5, fontWeight: '800' },

  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  action: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderRadius: 11, paddingHorizontal: 11, paddingVertical: 8,
  },
  actionText: { fontSize: 11.5, fontWeight: '700' },

  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    minHeight: 46,
    paddingHorizontal: 14,
    borderRadius: 13,
    marginTop: 14,
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 13.5, fontWeight: '800', flexShrink: 1 },

  /* chooser sheet */
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '82%',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 26,
  },
  sheetHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12,
  },
  sheetRow: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    borderWidth: 1, borderRadius: 13, padding: 10, marginBottom: 8,
  },

  /* listing */
  search: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, height: 42, marginTop: 12,
  },
  searchInput: { flex: 1, fontSize: 13.5, padding: 0 },
  tagRow: { marginTop: 12, marginBottom: 4 },
  tag: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6, marginRight: 7 },
  tagText: { fontSize: 11.5, fontWeight: '700' },

  month: { marginTop: 14 },
  monthName: {
    fontSize: 11.5, fontWeight: '800', letterSpacing: 0.6,
    textTransform: 'uppercase', marginBottom: 7,
  },
  dayGroup: { marginBottom: 2 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    borderWidth: 1, borderRadius: 13, padding: 9, marginBottom: 7,
  },
  rowDate: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  rowDay: { fontSize: 14.5, fontWeight: '900' },
  pill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 7 },
  pillText: { fontSize: 9.5, fontWeight: '800' },
  emptySub: { fontSize: 11.5, fontWeight: '600', textAlign: 'center', lineHeight: 16 },
});
