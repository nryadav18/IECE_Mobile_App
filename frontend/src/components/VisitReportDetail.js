import React, { useContext, useState, useEffect } from 'react';
import { View, Text, StyleSheet, Modal, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemeContext } from '../context/ThemeContext';
import { REPORT_SECTIONS } from '../utils/visitReport';
import { roleLabel } from '../utils/roles';

const statusColor = (status) => (status === 'approved' ? '#4CAF50' : status === 'rejected' ? '#F44336' : '#F59E0B');

const formatValue = (field, value) => {
  if (value === undefined || value === null || String(value).trim() === '') return '—';
  if (field.type === 'date') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString();
  }
  return String(value);
};

/**
 * Read-only view of a full visit report, generated from the shared config.
 * When `reviewMode` is set (school authority), a mandatory feedback box plus
 * Approve / Reject controls are shown at the very bottom.
 *   onApprove(feedback)
 *   onReject(feedback, rejectionReason)
 */
export default function VisitReportDetail({ visible, report, onClose, reviewMode = false, onApprove, onReject }) {
  const { theme } = useContext(ThemeContext);

  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState('');

  useEffect(() => {
    if (visible) {
      setFeedback('');
      setError('');
      setRejectOpen(false);
      setRejectReason('');
      setRejectError('');
      setSubmitting(false);
    }
  }, [visible, report]);

  if (!report) return null;

  const form = report.form || {};

  const handleApprove = async () => {
    if (!feedback.trim()) {
      setError('Please add your feedback on the report before approving.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await onApprove?.(feedback.trim());
    } finally {
      setSubmitting(false);
    }
  };

  const handleRejectPress = () => {
    if (!feedback.trim()) {
      setError('Please add your feedback on the report first.');
      return;
    }
    setRejectReason('');
    setRejectError('');
    setRejectOpen(true);
  };

  const confirmReject = async () => {
    if (!rejectReason.trim()) {
      setRejectError('A reason for rejection is required.');
      return;
    }
    setSubmitting(true);
    try {
      await onReject?.(feedback.trim(), rejectReason.trim());
      setRejectOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <View style={[styles.header, { borderBottomColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>Visit Report</Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 }}>
              {report.trainerId?.name ? `On ${report.trainerId.name}` : ''}
              {report.trainerId?.role ? ` · ${roleLabel(report.trainerId.role)}` : ''}
            </Text>
          </View>
          <View style={{ backgroundColor: statusColor(report.status) + '20', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, marginRight: 12 }}>
            <Text style={{ color: statusColor(report.status), fontWeight: '700', fontSize: 12, textTransform: 'capitalize' }}>{report.status}</Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={26} color={theme.colors.textPrimary} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {/* Meta */}
          <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            <Row theme={theme} label="Reported by" value={report.teamLeaderId?.name || '—'} />
            <Row theme={theme} label="School" value={report.schoolId?.name || form.schoolName || '—'} />
            {report.chairmanFeedback ? <Row theme={theme} label="Feedback" value={report.chairmanFeedback} /> : null}
            {report.rejectionRemark ? <Row theme={theme} label="Reject reason" value={report.rejectionRemark} /> : null}
          </View>

          {REPORT_SECTIONS.map(section => (
            <View key={section.title} style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
              <View style={styles.cardHeader}>
                <Ionicons name={section.icon} size={18} color={theme.colors.primary} />
                <Text style={[styles.cardTitle, { color: theme.colors.textPrimary }]}>{section.title}</Text>
              </View>
              {section.fields.map(field => (
                <View key={field.key} style={{ marginBottom: 10 }}>
                  <Text style={[styles.fieldLabel, { color: theme.colors.textSecondary }]}>{field.label}</Text>
                  <Text style={[styles.fieldValue, { color: theme.colors.textPrimary }]}>{formatValue(field, form[field.key])}</Text>
                </View>
              ))}
            </View>
          ))}

          {/* Review controls (school authority) — appear after the full report */}
          {reviewMode && report.status === 'pending' && (
            <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.primary }]}>
              <Text style={[styles.cardTitle, { color: theme.colors.textPrimary, marginBottom: 8 }]}>Your Feedback <Text style={{ color: '#E53935' }}>*</Text></Text>
              <TextInput
                style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8, padding: 12, minHeight: 90, textAlignVertical: 'top', color: theme.colors.textPrimary, backgroundColor: theme.colors.background }}
                placeholder="Add your comment / feedback on this report (required)"
                placeholderTextColor={theme.colors.placeholder}
                value={feedback}
                onChangeText={(t) => { setFeedback(t); if (error) setError(''); }}
                multiline
              />
              {error ? <Text style={{ color: '#E53935', fontSize: 13, marginTop: 8 }}>{error}</Text> : null}

              <View style={{ flexDirection: 'row', gap: 12, marginTop: 14 }}>
                <TouchableOpacity
                  style={{ flex: 1, backgroundColor: '#4CAF50', padding: 15, borderRadius: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', opacity: submitting ? 0.7 : 1 }}
                  onPress={handleApprove}
                  disabled={submitting}
                >
                  <Ionicons name="checkmark-circle-outline" size={18} color="#fff" style={{ marginRight: 6 }} />
                  <Text style={{ color: '#fff', fontWeight: '700' }}>Approve</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ flex: 1, backgroundColor: '#F44336', padding: 15, borderRadius: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', opacity: submitting ? 0.7 : 1 }}
                  onPress={handleRejectPress}
                  disabled={submitting}
                >
                  <Ionicons name="close-circle-outline" size={18} color="#fff" style={{ marginRight: 6 }} />
                  <Text style={{ color: '#fff', fontWeight: '700' }}>Reject</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </ScrollView>
      </View>

      {/* Rejection reason popup (mandatory) */}
      <Modal visible={rejectOpen} transparent animationType="fade" onRequestClose={() => setRejectOpen(false)}>
        <View style={styles.overlay}>
          <View style={[styles.dialog, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            <Text style={[styles.dialogTitle, { color: theme.colors.textPrimary }]}>Reason for Rejection</Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginBottom: 12 }}>Please tell the reporter why this report is being rejected.</Text>
            <TextInput
              style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8, padding: 12, minHeight: 80, textAlignVertical: 'top', color: theme.colors.textPrimary, backgroundColor: theme.colors.background }}
              placeholder="Enter reason (required)"
              placeholderTextColor={theme.colors.placeholder}
              value={rejectReason}
              onChangeText={(t) => { setRejectReason(t); if (rejectError) setRejectError(''); }}
              multiline
            />
            {rejectError ? <Text style={{ color: '#E53935', fontSize: 13, marginTop: 8 }}>{rejectError}</Text> : null}
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
              <TouchableOpacity style={[styles.dialogBtn, { backgroundColor: theme.colors.background, borderWidth: 1, borderColor: theme.colors.border }]} onPress={() => setRejectOpen(false)} disabled={submitting}>
                <Text style={{ color: theme.colors.textPrimary, fontWeight: '700' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.dialogBtn, { backgroundColor: '#F44336' }]} onPress={confirmReject} disabled={submitting}>
                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>OK</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </Modal>
  );
}

const Row = ({ theme, label, value }) => (
  <View style={{ flexDirection: 'row', marginBottom: 6 }}>
    <Text style={{ color: theme.colors.textSecondary, width: 110, fontSize: 13 }}>{label}:</Text>
    <Text style={{ color: theme.colors.textPrimary, flex: 1, fontSize: 13, fontWeight: '500' }}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingTop: Platform.OS === 'ios' ? 54 : 18, paddingBottom: 14, paddingHorizontal: 16, borderBottomWidth: 1 },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  card: { padding: 14, borderRadius: 14, borderWidth: 1, marginBottom: 14 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: '700', flex: 1 },
  fieldLabel: { fontSize: 12, fontWeight: '600', marginBottom: 2 },
  fieldValue: { fontSize: 14, lineHeight: 20 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  dialog: { width: '100%', maxWidth: 440, borderRadius: 16, borderWidth: 1, padding: 20 },
  dialogTitle: { fontSize: 17, fontWeight: '700', marginBottom: 4 },
  dialogBtn: { flex: 1, padding: 14, borderRadius: 10, alignItems: 'center' },
});
