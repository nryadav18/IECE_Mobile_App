import React, { useContext, useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Platform, Modal, FlatList,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemeContext } from '../context/ThemeContext';
import { useAlert } from '../context/AlertContext';
import { prettyDate, toYMD, dayCountInclusive } from '../utils/dates';
import { SCHOOL_VISIT_MARK_COLOR } from '../utils/schoolVisitMarks';
import { getVisitSchools, raiseVisit, schoolVisitError } from '../services/schoolVisit';

// Start-of-day helper.
const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

/**
 * "Raise School Visit" form. Mandatory school + detailed reason + date window.
 * Unlike Apply Leave there is no waiting period — inspections are short-notice,
 * so the earliest selectable date is TODAY. No attachments.
 *
 * Calls onSubmitted() after a successful submission so the parent can refresh
 * "My Visits".
 */
export default function RaiseSchoolVisitForm({ onSubmitted }) {
  const { theme } = useContext(ThemeContext);
  const { showAlert } = useAlert();
  const insets = useSafeAreaInsets();

  // A visit may start today, but never in the past.
  const minDate = useMemo(() => startOfDay(new Date()), []);

  const [schools, setSchools] = useState([]);
  const [loadingSchools, setLoadingSchools] = useState(true);
  const [school, setSchool] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');

  const [fromDate, setFromDate] = useState(minDate);
  const [toDate, setToDate] = useState(minDate);
  const [showFrom, setShowFrom] = useState(false);
  const [showTo, setShowTo] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await getVisitSchools();
        if (alive) setSchools(res?.data || []);
      } catch (e) {
        if (alive) showAlert('Could not load schools', schoolVisitError(e), 'error');
      } finally {
        if (alive) setLoadingSchools(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredSchools = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return schools;
    return schools.filter(
      (s) => (s.name || '').toLowerCase().includes(q) || (s.state || '').toLowerCase().includes(q)
    );
  }, [schools, search]);

  const onPickFrom = (event, selected) => {
    setShowFrom(Platform.OS === 'ios');
    if (selected) {
      setFromDate(selected);
      if (selected > toDate) setToDate(selected);
    }
  };
  const onPickTo = (event, selected) => {
    setShowTo(Platform.OS === 'ios');
    if (selected) setToDate(selected);
  };

  const resetForm = () => {
    setReason('');
    setSchool(null);
    setFromDate(minDate);
    setToDate(minDate);
  };

  const submit = async () => {
    if (!school) {
      showAlert('School required', 'Please select the school you are visiting.', 'warning');
      return;
    }
    if (!reason.trim()) {
      showAlert('Reason required', 'Please describe the purpose of this school visit in detail.', 'warning');
      return;
    }
    if (startOfDay(toDate) < startOfDay(fromDate)) {
      showAlert('Invalid dates', 'The “to” date cannot be before the “from” date.', 'warning');
      return;
    }
    if (startOfDay(fromDate) < startOfDay(minDate)) {
      showAlert('Date not allowed', 'A school visit cannot be raised for a past date. The earliest you can select is today.', 'warning');
      return;
    }
    setSubmitting(true);
    try {
      await raiseVisit({
        schoolId: school._id,
        reason: reason.trim(),
        fromDate: toYMD(fromDate),
        toDate: toYMD(toDate),
      });
      showAlert(
        'Request Submitted',
        'Your school visit request was sent to the Admin. Once approved, your check-in and check-out is paused for these dates and they are marked “On School Visit”.',
        'success',
        [{ text: 'Done', onPress: () => { resetForm(); onSubmitted && onSubmitted(); } }]
      );
    } catch (e) {
      showAlert('Could not submit', schoolVisitError(e), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const DateField = ({ label, value, onPress }) => (
    <View style={{ flex: 1 }}>
      <Text style={{ color: theme.colors.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>
        {label} <Text style={{ color: '#F44336' }}>*</Text>
      </Text>
      <TouchableOpacity
        style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center' }}
        onPress={onPress}
      >
        <Ionicons name="calendar-outline" size={18} color={theme.colors.primary} style={{ marginRight: 8 }} />
        <Text style={{ color: theme.colors.textPrimary, fontSize: 14 }}>{prettyDate(value)}</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <>
      <ScrollView contentContainerStyle={{ paddingBottom: 30 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {/* Rule banner */}
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: SCHOOL_VISIT_MARK_COLOR + '15', borderRadius: 12, padding: 12, marginBottom: 18 }}>
          <Ionicons name="information-circle-outline" size={18} color={SCHOOL_VISIT_MARK_COLOR} style={{ marginRight: 8 }} />
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12.5, flex: 1, lineHeight: 18 }}>
            Once the Admin approves, these days are marked{' '}
            <Text style={{ fontWeight: '700', color: theme.colors.textPrimary }}>On School Visit</Text> and count as
            working days. You will not check in or check out while you are away — it resumes automatically the day after
            your visit ends.
          </Text>
        </View>

        {/* School */}
        <Text style={{ color: theme.colors.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>
          School you are visiting <Text style={{ color: '#F44336' }}>*</Text>
        </Text>
        <TouchableOpacity
          style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center', marginBottom: 20, backgroundColor: theme.colors.surface }}
          onPress={() => setPickerOpen(true)}
          disabled={loadingSchools}
        >
          <Ionicons name="business-outline" size={18} color={theme.colors.primary} style={{ marginRight: 8 }} />
          {loadingSchools ? (
            <Text style={{ color: theme.colors.textSecondary, fontSize: 14, flex: 1 }}>Loading schools…</Text>
          ) : (
            <View style={{ flex: 1 }}>
              <Text style={{ color: school ? theme.colors.textPrimary : theme.colors.placeholder, fontSize: 14 }} numberOfLines={1}>
                {school ? school.name : 'Select a school'}
              </Text>
              {!!school?.state && (
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 }}>{school.state}</Text>
              )}
            </View>
          )}
          <Ionicons name="chevron-down" size={18} color={theme.colors.textSecondary} />
        </TouchableOpacity>

        {/* Dates */}
        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 6 }}>
          <DateField label="From date" value={fromDate} onPress={() => setShowFrom(true)} />
          <DateField label="To date" value={toDate} onPress={() => setShowTo(true)} />
        </View>
        <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginBottom: 20 }}>
          Duration: {dayCountInclusive(fromDate, toDate)} day{dayCountInclusive(fromDate, toDate) > 1 ? 's' : ''}
        </Text>

        {showFrom && (
          <DateTimePicker value={fromDate} mode="date" display="default" minimumDate={minDate} onChange={onPickFrom} />
        )}
        {showTo && (
          <DateTimePicker value={toDate} mode="date" display="default" minimumDate={fromDate < minDate ? minDate : fromDate} onChange={onPickTo} />
        )}

        {/* Reason */}
        <Text style={{ color: theme.colors.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>
          Reason for the visit <Text style={{ color: '#F44336' }}>*</Text>
        </Text>
        <TextInput
          style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 14, color: theme.colors.textPrimary, marginBottom: 20, minHeight: 120, textAlignVertical: 'top', backgroundColor: theme.colors.surface }}
          value={reason}
          onChangeText={setReason}
          placeholder="Describe the purpose of this visit in detail — what you will inspect, who you will meet, and why. (required)"
          placeholderTextColor={theme.colors.placeholder}
          multiline
        />

        {/* Submit */}
        <TouchableOpacity
          style={{ backgroundColor: theme.colors.primary, borderRadius: 12, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', opacity: submitting ? 0.6 : 1 }}
          onPress={submit}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="send-outline" size={18} color="#fff" />
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15, marginLeft: 8 }}>Submit Visit Request</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>

      {/* School picker — statusBar/navigationBar translucent so the transparent
          modal doesn't draw a black band and shrink the app on Android. */}
      <Modal
        visible={pickerOpen}
        transparent
        animationType="slide"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => setPickerOpen(false)}
      >
        <View style={{ flex: 1, backgroundColor: '#00000066', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: theme.colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '80%', paddingBottom: insets.bottom + 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
              <Text style={{ flex: 1, color: theme.colors.textPrimary, fontSize: 17, fontWeight: '700' }}>Select a school</Text>
              <TouchableOpacity onPress={() => setPickerOpen(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={24} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, paddingHorizontal: 12 }}>
                <Ionicons name="search" size={18} color={theme.colors.textSecondary} />
                <TextInput
                  style={{ flex: 1, padding: 12, color: theme.colors.textPrimary }}
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search by school or state"
                  placeholderTextColor={theme.colors.placeholder}
                />
              </View>
            </View>

            <FlatList
              data={filteredSchools}
              keyExtractor={(item) => String(item._id)}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ padding: 16 }}
              ListEmptyComponent={
                <Text style={{ color: theme.colors.textSecondary, textAlign: 'center', marginTop: 24 }}>
                  No schools match “{search}”.
                </Text>
              }
              renderItem={({ item }) => {
                const selected = school && String(school._id) === String(item._id);
                return (
                  <TouchableOpacity
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      padding: 14,
                      borderWidth: 1,
                      borderRadius: 12,
                      marginBottom: 8,
                      borderColor: selected ? theme.colors.primary : theme.colors.border,
                      backgroundColor: selected ? theme.colors.primary + '10' : 'transparent',
                    }}
                    onPress={() => {
                      setSchool(item);
                      setSearch('');
                      setPickerOpen(false);
                    }}
                  >
                    <Ionicons name="business" size={18} color={theme.colors.primary} style={{ marginRight: 10 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.colors.textPrimary, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>{item.name}</Text>
                      {!!item.state && <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 }}>{item.state}</Text>}
                    </View>
                    {selected && <Ionicons name="checkmark-circle" size={20} color={theme.colors.primary} />}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}
