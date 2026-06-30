import React, { useEffect, useState, useCallback, useContext } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from '../services/api';
import { ThemeContext } from '../context/ThemeContext';
import { useAlert } from '../context/AlertContext';

const STATUS_COLORS = {
  pending: '#F59E0B',
  approved: '#4CAF50',
  rejected: '#F44336',
};

/**
 * "School Holiday Section" — lists holiday requests and lets a chairman / admin
 * approve or reject them. Used inside the Chairman & Admin portals. Self-contained:
 * fetches /holidays and refreshes itself after each action.
 */
export default function SchoolHolidayApprovals({ refreshKey }) {
  const { theme } = useContext(ThemeContext);
  const { showAlert } = useAlert();
  const [holidays, setHolidays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

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
  }, [fetchHolidays, refreshKey]);

  const review = async (id, status) => {
    setBusyId(id);
    try {
      await api.put(`/holidays/${id}/status`, { status });
      showAlert('Done', `Holiday ${status}.`, status === 'approved' ? 'success' : 'info');
      await fetchHolidays();
    } catch (e) {
      showAlert('Error', e?.response?.data?.message || 'Action failed.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const confirmReview = (h, status) => {
    const verb = status === 'approved' ? 'Approve' : 'Reject';
    showAlert(
      `${verb} Holiday`,
      `${verb} ${h.date} for ${h.schoolId?.name || 'this school'}?`,
      status === 'approved' ? 'success' : 'warning',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: verb, onPress: () => review(h._id, status) },
      ]
    );
  };

  const pending = holidays.filter((h) => h.status === 'pending');
  const decided = holidays.filter((h) => h.status !== 'pending');

  const Card = ({ h, showActions }) => (
    <View style={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, paddingRight: 8 }}>
          <Text style={{ color: theme.colors.textPrimary, fontWeight: '700', fontSize: 15 }}>{h.date}</Text>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 }}>
            {h.schoolId?.name || 'School'} · by {h.appliedBy?.name || 'Unknown'}
          </Text>
          <View style={{ marginTop: 6, backgroundColor: theme.colors.background, borderRadius: 8, padding: 8 }}>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 11, fontWeight: '700' }}>REASON</Text>
            <Text style={{ color: theme.colors.textPrimary, fontSize: 13, marginTop: 2 }}>{h.reason || '—'}</Text>
          </View>
        </View>
        <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, backgroundColor: (STATUS_COLORS[h.status] || '#999') + '20' }}>
          <Text style={{ fontSize: 10, fontWeight: '800', color: STATUS_COLORS[h.status] || '#999', textTransform: 'uppercase' }}>{h.status}</Text>
        </View>
      </View>

      {showActions && (
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
          <TouchableOpacity
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 9, borderRadius: 9, backgroundColor: '#4CAF50', opacity: busyId === h._id ? 0.5 : 1 }}
            onPress={() => confirmReview(h, 'approved')}
            disabled={busyId === h._id}
          >
            <Ionicons name="checkmark-outline" size={16} color="#fff" />
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13, marginLeft: 4 }}>Approve</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 9, borderRadius: 9, backgroundColor: '#F44336', opacity: busyId === h._id ? 0.5 : 1 }}
            onPress={() => confirmReview(h, 'rejected')}
            disabled={busyId === h._id}
          >
            <Ionicons name="close-outline" size={16} color="#fff" />
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13, marginLeft: 4 }}>Reject</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  return (
    <View style={{ marginTop: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
        <Ionicons name="sunny-outline" size={20} color={theme.colors.primary} />
        <Text style={{ color: theme.colors.textPrimary, fontWeight: '700', fontSize: 16, marginLeft: 8 }}>School Holiday Section</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={theme.colors.primary} style={{ marginVertical: 16 }} />
      ) : (
        <>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12, fontWeight: '700', marginBottom: 8 }}>
            PENDING REQUESTS ({pending.length})
          </Text>
          {pending.length === 0 ? (
            <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginBottom: 12 }}>No pending holiday requests.</Text>
          ) : (
            pending.map((h) => <Card key={h._id} h={h} showActions />)
          )}

          {decided.length > 0 && (
            <>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12, fontWeight: '700', marginTop: 8, marginBottom: 8 }}>RECENT DECISIONS</Text>
              {decided.slice(0, 10).map((h) => <Card key={h._id} h={h} showActions={false} />)}
            </>
          )}
        </>
      )}
    </View>
  );
}
