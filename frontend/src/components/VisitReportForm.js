import React, { useState, useEffect, useContext } from 'react';
import {
  View, Text, StyleSheet, Modal, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Platform, KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { ThemeContext } from '../context/ThemeContext';
import api from '../services/api';
import CustomDropdown from './CustomDropdown';
import { REPORT_SECTIONS, RATING_OPTIONS, buildInitialForm, findMissingFields } from '../utils/visitReport';
import { roleLabel } from '../utils/roles';

/**
 * Full IECE EGM Visit / Sparked Visit report form.
 *  - `targets`  : people the author may report on ({_id, name, role, schoolId}).
 *  - `author`   : the logged-in inspector (prefills EGM name/designation).
 *  - `editReport`: pass an existing report to edit it (target locked, PUT).
 * Every field is mandatory.
 */
export default function VisitReportForm({ visible, onClose, targets = [], author, editReport = null, onSubmitted, onError }) {
  const { theme } = useContext(ThemeContext);

  const [targetId, setTargetId] = useState('');
  const [schoolId, setSchoolId] = useState('');
  const [form, setForm] = useState(buildInitialForm());
  const [picker, setPicker] = useState(null); // { key, mode }
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const isEdit = !!editReport;

  useEffect(() => {
    if (!visible) return;
    if (editReport) {
      setTargetId(editReport.trainerId?._id || editReport.trainerId || '');
      setSchoolId(editReport.schoolId?._id || editReport.schoolId || '');
      setForm(buildInitialForm(editReport.form || {}));
    } else {
      setTargetId('');
      setSchoolId('');
      setForm(buildInitialForm({
        egmName: author?.name || '',
        egmDesignation: author?.role ? roleLabel(author.role) : '',
      }));
    }
    setError('');
  }, [visible, editReport]);

  const setField = (key, value) => setForm(prev => ({ ...prev, [key]: value }));

  const onSelectTarget = (item) => {
    setTargetId(item._id);
    const sId = item.schoolId?._id || item.schoolId || '';
    setSchoolId(sId);
    // Prefill the header fields drawn from the selected person / their school.
    setForm(prev => ({
      ...prev,
      trainersName: item.name || prev.trainersName,
      schoolName: item.schoolId?.name || prev.schoolName,
    }));
  };

  const handleSubmit = async () => {
    if (!targetId || !schoolId) {
      setError('Select the person you are reporting on (they must have a school).');
      return;
    }
    const missing = findMissingFields(form);
    if (missing.length > 0) {
      const msg = `Please fill all fields. Missing: ${missing.slice(0, 4).map(m => m.label).join(', ')}${missing.length > 4 ? `, +${missing.length - 4} more` : ''}.`;
      setError(msg);
      if (onError) onError(msg);
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const payload = { trainerId: targetId, schoolId, form };
      if (isEdit) {
        await api.put(`/reports/${editReport._id}`, payload);
      } else {
        await api.post('/reports', payload);
      }
      onSubmitted && onSubmitted(isEdit ? 'Visit report updated and resubmitted for approval.' : 'Visit report submitted for approval.');
      onClose();
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed to submit the report.';
      setError(msg);
      if (onError) onError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyle = [styles.input, { borderColor: theme.colors.border, backgroundColor: theme.colors.background, color: theme.colors.textPrimary }];

  const renderField = (field) => {
    const value = form[field.key];
    if (field.type === 'rating' || field.type === 'radio') {
      const options = field.type === 'rating' ? RATING_OPTIONS : field.options;
      return (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {options.map(opt => {
            const selected = value === opt;
            return (
              <TouchableOpacity
                key={opt}
                onPress={() => setField(field.key, opt)}
                style={{
                  paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1,
                  backgroundColor: selected ? theme.colors.primary : theme.colors.background,
                  borderColor: selected ? theme.colors.primary : theme.colors.border,
                }}
              >
                <Text style={{ color: selected ? '#fff' : theme.colors.textPrimary, fontSize: 13, fontWeight: '600' }}>{opt}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      );
    }
    if (field.type === 'date' || field.type === 'time') {
      const display = field.type === 'date'
        ? (value ? new Date(value).toLocaleDateString() : 'Select date')
        : (value || 'Select time');
      return (
        <TouchableOpacity style={[...inputStyle, { justifyContent: 'center' }]} onPress={() => setPicker({ key: field.key, mode: field.type === 'date' ? 'date' : 'time' })}>
          <Text style={{ color: value ? theme.colors.textPrimary : theme.colors.placeholder }}>{display}</Text>
        </TouchableOpacity>
      );
    }
    // text / textarea
    return (
      <TextInput
        style={[...inputStyle, field.type === 'textarea' && { height: 84, textAlignVertical: 'top' }]}
        value={value}
        onChangeText={(t) => setField(field.key, t)}
        placeholder={field.label}
        placeholderTextColor={theme.colors.placeholder}
        multiline={field.type === 'textarea'}
      />
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: theme.colors.background }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={[styles.header, { borderBottomColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
          <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>{isEdit ? 'Edit Visit Report' : 'Log Visit Report'}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={26} color={theme.colors.textPrimary} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
          {/* Target person */}
          <Text style={[styles.sectionTitle, { color: theme.colors.primary }]}>Who are you reporting on?</Text>
          {isEdit ? (
            <View style={[...inputStyle, { justifyContent: 'center' }]}>
              <Text style={{ color: theme.colors.textPrimary }}>{editReport.trainerId?.name || 'Selected person'}</Text>
            </View>
          ) : (
            <CustomDropdown
              label="Person (Trainer / Leader)"
              data={targets}
              selectedValue={targetId}
              onSelect={onSelectTarget}
              placeholder="Select the person you visited"
              labelExtractor={(item) => `${item.name}${item.role ? ` · ${roleLabel(item.role)}` : ''}`}
            />
          )}

          {REPORT_SECTIONS.map(section => (
            <View key={section.title} style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
              <View style={styles.cardHeader}>
                <Ionicons name={section.icon} size={18} color={theme.colors.primary} />
                <Text style={[styles.cardTitle, { color: theme.colors.textPrimary }]}>{section.title}</Text>
              </View>
              {section.fields.map(field => (
                <View key={field.key} style={{ marginBottom: 12 }}>
                  <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{field.label} <Text style={{ color: '#E53935' }}>*</Text></Text>
                  {renderField(field)}
                </View>
              ))}
            </View>
          ))}

          {error ? <Text style={{ color: '#E53935', fontSize: 13, marginBottom: 12 }}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.submitBtn, { backgroundColor: theme.colors.primary, opacity: submitting ? 0.7 : 1 }]}
            onPress={handleSubmit}
            disabled={submitting}
          >
            {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>{isEdit ? 'Update Report' : 'Submit Report'}</Text>}
          </TouchableOpacity>
        </ScrollView>

        {picker && (
          <DateTimePicker
            value={picker.mode === 'date' && form[picker.key] ? new Date(form[picker.key]) : new Date()}
            mode={picker.mode}
            display="default"
            onChange={(event, selected) => {
              const key = picker.key;
              setPicker(null);
              if (event.type === 'dismissed' || !selected) return;
              if (picker.mode === 'date') {
                setField(key, selected.toISOString());
              } else {
                setField(key, selected.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
              }
            }}
          />
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: Platform.OS === 'ios' ? 54 : 18, paddingBottom: 14, paddingHorizontal: 16, borderBottomWidth: 1 },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  sectionTitle: { fontSize: 14, fontWeight: '700', marginBottom: 8 },
  card: { padding: 14, borderRadius: 14, borderWidth: 1, marginBottom: 14 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: '700', flex: 1 },
  label: { fontSize: 12.5, fontWeight: '600', marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 14 },
  submitBtn: { padding: 16, borderRadius: 10, alignItems: 'center' },
  submitText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
