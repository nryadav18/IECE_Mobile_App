import React, { useEffect, useState, useCallback, useContext } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import api from '../services/api';
import { ThemeContext } from '../context/ThemeContext';
import { useAlert } from '../context/AlertContext';
import { dayKey } from '../utils/holiday';

const STATUS_COLORS = {
  pending: '#F59E0B',
  approved: '#4CAF50',
  rejected: '#F44336',
};

/**
 * "Apply School Holiday" section used inside the Trainer & Team Leader portals
 * (reached from the hamburger menu). Lets a user request a date as a school
 * holiday (needs school/admin approval) and shows the status of their requests.
 *
 * Props:
 *  - onChanged(): optional callback fired after a successful apply/cancel so the
 *    parent can refresh its calendar marking.
 */
export default function ApplyHolidaySection({ onChanged }) {
  const { theme } = useContext(ThemeContext);
  const { showAlert } = useAlert();

  const [holidays, setHolidays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const [date, setDate] = useState(new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [reason, setReason] = useState('');

  const fetchHolidays = useCallback(async () => {
    try {
      const res = await api.get('/holidays');
      setHolidays(res.data.data || []);
    } catch (e) {
      console.log('Error fetching holidays', e?.response?.data?.message || e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHolidays();
  }, [fetchHolidays]);

  const onPickDate = (event, selected) => {
    setShowPicker(Platform.OS === 'ios');
    if (selected) setDate(selected);
  };

  const submit = async () => {
    const dateStr = dayKey(date);
    if (date.getDay() === 0) {
      showAlert('Sunday', `${dateStr} is a Sunday — already a weekly holiday.`, 'info');
      return;
    }
    if (!reason.trim()) {
      showAlert('Reason required', 'Please enter a reason for the holiday so your school/admin can review it.', 'warning');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/holidays', { date: dateStr, reason: reason.trim() });
      showAlert('Requested', `Holiday request for ${dateStr} was submitted for approval.`, 'success');
      setReason('');
      await fetchHolidays();
      onChanged && onChanged();
    } catch (e) {
      showAlert('Error', e?.response?.data?.message || 'Failed to apply for holiday.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const cancelRequest = (h) => {
    showAlert('Cancel Request', `Cancel your holiday request for ${h.date}?`, 'warning', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Cancel Request',
        style: 'destructive',
        onPress: async () => {
          setBusyId(h._id);
          try {
            await api.delete(`/holidays/${h._id}`);
            await fetchHolidays();
            onChanged && onChanged();
          } catch (e) {
            showAlert('Error', e?.response?.data?.message || 'Failed to cancel request.', 'error');
          } finally {
            setBusyId(null);
          }
        },
      },
    ]);
  };

  return (
    <View>
      {/* Apply form */}
      <View style={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 20 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
          <Ionicons name="sunny-outline" size={20} color={theme.colors.primary} />
          <Text style={{ color: theme.colors.textPrimary, fontWeight: '700', fontSize: 16, marginLeft: 8 }}>Apply School Holiday</Text>
        </View>

        <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginBottom: 12 }}>
          Request a date as a holiday for your school. It needs approval from your school/admin. Once approved it is marked on the calendar and check-in/out is disabled that day.
        </Text>

        <Text style={{ color: theme.colors.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>Date</Text>
        <TouchableOpacity
          style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 14, marginBottom: 14, flexDirection: 'row', alignItems: 'center' }}
          onPress={() => setShowPicker(true)}
        >
          <Ionicons name="calendar-outline" size={18} color={theme.colors.primary} style={{ marginRight: 8 }} />
          <Text style={{ color: theme.colors.textPrimary }}>{dayKey(date)}</Text>
        </TouchableOpacity>
        {showPicker && (
          <DateTimePicker
            value={date}
            mode="date"
            display="default"
            minimumDate={new Date()}
            onChange={onPickDate}
          />
        )}

        <Text style={{ color: theme.colors.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>Reason <Text style={{ color: '#F44336' }}>*</Text></Text>
        <TextInput
          style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 14, color: theme.colors.textPrimary, marginBottom: 16, minHeight: 44 }}
          value={reason}
          onChangeText={setReason}
          placeholder="e.g. Local festival, exam holiday (required)"
          placeholderTextColor={theme.colors.placeholder}
          multiline
        />

        <TouchableOpacity
          style={{ backgroundColor: theme.colors.primary, borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', opacity: submitting ? 0.6 : 1 }}
          onPress={submit}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="send-outline" size={18} color="#fff" />
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15, marginLeft: 8 }}>Submit Holiday Request</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* My requests */}
      <Text style={{ color: theme.colors.textPrimary, fontWeight: '700', fontSize: 15, marginBottom: 10 }}>My Holiday Requests</Text>
      {loading ? (
        <ActivityIndicator color={theme.colors.primary} style={{ marginVertical: 16 }} />
      ) : holidays.length === 0 ? (
        <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>No holiday requests yet.</Text>
      ) : (
        holidays.map((h) => (
          <View key={h._id} style={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={{ color: theme.colors.textPrimary, fontWeight: '700', fontSize: 15 }}>{h.date}</Text>
                {!!h.reason && <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 4, fontStyle: 'italic' }}>"{h.reason}"</Text>}
                <Text style={{ color: theme.colors.textSecondary, fontSize: 11, marginTop: 4 }}>{h.schoolId?.name || 'School'}</Text>
              </View>
              <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, backgroundColor: (STATUS_COLORS[h.status] || '#999') + '20' }}>
                <Text style={{ fontSize: 10, fontWeight: '800', color: STATUS_COLORS[h.status] || '#999', textTransform: 'uppercase' }}>{h.status}</Text>
              </View>
            </View>

            {h.status === 'pending' && (
              <TouchableOpacity
                style={{ marginTop: 10, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', opacity: busyId === h._id ? 0.5 : 1 }}
                onPress={() => cancelRequest(h)}
                disabled={busyId === h._id}
              >
                <Ionicons name="trash-outline" size={15} color="#F44336" />
                <Text style={{ color: '#F44336', fontSize: 12, fontWeight: '600', marginLeft: 4 }}>Cancel request</Text>
              </TouchableOpacity>
            )}
          </View>
        ))
      )}
    </View>
  );
}
