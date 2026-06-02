import React, { useState, useEffect, useContext } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { ThemeContext } from '../context/ThemeContext';
import api from '../services/api';
import CustomDropdown from './CustomDropdown';
import GlobalLoader from './GlobalLoader';

export default function EditReportModal({
  visible,
  report,
  trainers,
  onClose,
  onReportUpdated,
  onError,
}) {
  const { theme } = useContext(ThemeContext);

  const [trainerId, setTrainerId] = useState('');
  const [schoolId, setSchoolId] = useState('');
  const [dateOfInspection, setDateOfInspection] = useState(new Date());
  const [personMet, setPersonMet] = useState('');
  const [discussionContext, setDiscussionContext] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (visible && report) {
      setTrainerId(report.trainerId?._id || report.trainerId || '');
      setSchoolId(report.schoolId?._id || report.schoolId || '');
      setDateOfInspection(
        report.dateOfInspection ? new Date(report.dateOfInspection) : new Date()
      );
      setPersonMet(report.personMet || '');
      setDiscussionContext(report.discussionContext || '');
    }
  }, [visible, report]);

  const handleSubmit = async () => {
    if (!trainerId || !schoolId || !personMet.trim() || !discussionContext.trim()) {
      return onError('Please fill in all required fields.');
    }

    setUploading(true);
    try {
      await api.put(`/reports/${report._id}`, {
        trainerId,
        schoolId,
        dateOfInspection: dateOfInspection.toISOString(),
        personMet: personMet.trim(),
        discussionContext: discussionContext.trim(),
      });

      const wasResolved = report.status === 'approved' || report.status === 'rejected';
      onReportUpdated(
        wasResolved
          ? 'Report updated and resubmitted for chairman approval.'
          : 'Report updated successfully.'
      );
    } catch (error) {
      onError(error.response?.data?.error || 'Failed to update report.');
    } finally {
      setUploading(false);
    }
  };

  if (!visible || !report) return null;

  const selectedTrainer = trainers.find((t) => t._id === trainerId);
  const schoolOptions = selectedTrainer?.schoolId ? [selectedTrainer.schoolId] : [];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <GlobalLoader visible={uploading} />
      <View style={styles.modalOverlay}>
        <View
          style={[
            styles.modalContent,
            { backgroundColor: theme.colors.background, borderColor: theme.colors.border },
          ]}
        >
          <View style={[styles.header, { borderBottomColor: theme.colors.border }]}>
            <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>
              Edit Visit Report
            </Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={theme.colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16 }}>
            {(report.status === 'approved' || report.status === 'rejected') && (
              <View style={[styles.infoBox, { backgroundColor: theme.colors.surface }]}>
                <Ionicons
                  name="information-circle"
                  size={20}
                  color={theme.colors.primary}
                  style={{ marginRight: 8 }}
                />
                <Text style={{ color: theme.colors.textSecondary, fontSize: 13, flex: 1 }}>
                  Saving will resubmit this report to the chairman for approval.
                </Text>
              </View>
            )}

            <Text style={[styles.label, { color: theme.colors.textSecondary }]}>Trainer</Text>
            <CustomDropdown
              data={trainers}
              selectedValue={trainerId}
              onSelect={(item) => {
                setTrainerId(item._id);
                if (item.schoolId) {
                  setSchoolId(item.schoolId._id || item.schoolId);
                } else {
                  setSchoolId('');
                }
              }}
              placeholder="Select Trainer"
              theme={theme}
            />

            <Text style={[styles.label, { color: theme.colors.textSecondary }]}>School</Text>
            <CustomDropdown
              data={schoolOptions}
              selectedValue={schoolId}
              onSelect={() => {}}
              placeholder="Auto-selected based on Trainer"
              theme={theme}
            />

            <Text style={[styles.label, { color: theme.colors.textSecondary }]}>
              Date of Inspection
            </Text>
            <TouchableOpacity
              style={[styles.input, { borderColor: theme.colors.border, justifyContent: 'center' }]}
              onPress={() => setShowDatePicker(true)}
            >
              <Text style={{ color: theme.colors.textPrimary }}>
                {dateOfInspection.toLocaleDateString()}
              </Text>
            </TouchableOpacity>
            {showDatePicker && (
              <DateTimePicker
                value={dateOfInspection}
                mode="date"
                display="default"
                onChange={(event, selectedDate) => {
                  setShowDatePicker(false);
                  if (selectedDate) setDateOfInspection(selectedDate);
                }}
              />
            )}

            <Text style={[styles.label, { color: theme.colors.textSecondary }]}>Person Met</Text>
            <TextInput
              style={[styles.input, { borderColor: theme.colors.border, color: theme.colors.textPrimary }]}
              value={personMet}
              onChangeText={setPersonMet}
              placeholder="Enter name"
              placeholderTextColor={theme.colors.placeholder}
            />

            <Text style={[styles.label, { color: theme.colors.textSecondary }]}>
              Discussion Context
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  borderColor: theme.colors.border,
                  color: theme.colors.textPrimary,
                  height: 100,
                  textAlignVertical: 'top',
                },
              ]}
              value={discussionContext}
              onChangeText={setDiscussionContext}
              placeholder="What was discussed?"
              placeholderTextColor={theme.colors.placeholder}
              multiline
              numberOfLines={4}
            />
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: theme.colors.border }]}>
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: theme.colors.surface }]}
              onPress={onClose}
            >
              <Text style={{ color: theme.colors.textPrimary, fontWeight: 'bold' }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: theme.colors.primary }]}
              onPress={handleSubmit}
              disabled={uploading}
            >
              {uploading ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={{ color: '#FFF', fontWeight: 'bold' }}>Save Changes</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    height: '85%',
    borderWidth: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 18, fontWeight: 'bold' },
  label: { fontSize: 12, marginBottom: 8, marginTop: 12, fontWeight: '600' },
  input: { padding: 12, borderRadius: 8, borderWidth: 1, marginBottom: 8 },
  infoBox: { flexDirection: 'row', padding: 12, borderRadius: 12, marginBottom: 8 },
  footer: {
    flexDirection: 'row',
    padding: 16,
    borderTopWidth: 1,
    justifyContent: 'space-between',
  },
  btn: { flex: 1, padding: 14, borderRadius: 12, alignItems: 'center', marginHorizontal: 8 },
});
