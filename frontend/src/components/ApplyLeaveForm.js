import React, { useContext, useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Platform, Image,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { ThemeContext } from '../context/ThemeContext';
import { useAlert } from '../context/AlertContext';
import { prettyDate, toYMD, dayCountInclusive } from '../utils/dates';
import { applyLeave, uploadProofs, leaveError } from '../services/leave';

// Start-of-day helper.
const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

// Earliest date a leave may start: the day after tomorrow (today + 2 days).
// A person cannot apply for today or tomorrow.
const earliestStart = () => {
  const d = startOfDay(new Date());
  d.setDate(d.getDate() + 2);
  return d;
};

/**
 * Self-service "Apply Leave" form. Mandatory reason + date window (earliest is
 * the day after tomorrow), optional PHOTO proofs. Calls onSubmitted() after
 * a successful submission so the parent can refresh "My Requests".
 */
export default function ApplyLeaveForm({ onSubmitted }) {
  const { theme } = useContext(ThemeContext);
  const { showAlert } = useAlert();

  const minDate = useMemo(() => earliestStart(), []);

  const [fromDate, setFromDate] = useState(minDate);
  const [toDate, setToDate] = useState(minDate);
  const [showFrom, setShowFrom] = useState(false);
  const [showTo, setShowTo] = useState(false);
  const [reason, setReason] = useState('');
  const [proofs, setProofs] = useState([]); // [{ uri, name, mimeType }] — photos only
  const [submitting, setSubmitting] = useState(false);

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

  const addPhoto = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
        allowsMultipleSelection: true,
      });
      if (result.canceled) return;
      const picked = (result.assets || []).map((a, i) => ({
        uri: a.uri,
        name: a.fileName || `photo_${Date.now()}_${i}.jpg`,
        mimeType: a.mimeType || 'image/jpeg',
      }));
      setProofs((prev) => [...prev, ...picked]);
    } catch (e) {
      showAlert('Could not add photo', leaveError(e), 'error');
    }
  };

  const removeProof = (index) => setProofs((prev) => prev.filter((_, i) => i !== index));

  const resetForm = () => {
    setReason('');
    setProofs([]);
    setFromDate(minDate);
    setToDate(minDate);
  };

  const submit = async () => {
    if (!reason.trim()) {
      showAlert('Reason required', 'Please provide a reason for applying leave.', 'warning');
      return;
    }
    if (startOfDay(toDate) < startOfDay(fromDate)) {
      showAlert('Invalid dates', 'The “to” date cannot be before the “from” date.', 'warning');
      return;
    }
    if (startOfDay(fromDate) < startOfDay(minDate)) {
      showAlert(
        'Date not allowed',
        `Leave can only start from the day after tomorrow (${prettyDate(minDate)}) onwards. You cannot apply for today or tomorrow.`,
        'warning'
      );
      return;
    }
    setSubmitting(true);
    try {
      const proofUrls = await uploadProofs(proofs);
      await applyLeave({
        reason: reason.trim(),
        fromDate: toYMD(fromDate),
        toDate: toYMD(toDate),
        proofs: proofUrls,
      });
      showAlert('Leave Applied', 'Your leave request was submitted to the Admin for approval.', 'success', [
        { text: 'Done', onPress: () => { resetForm(); onSubmitted && onSubmitted(); } },
      ]);
    } catch (e) {
      showAlert('Could not apply', leaveError(e), 'error');
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
    <ScrollView contentContainerStyle={{ paddingBottom: 30 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      {/* Rule banner */}
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.primary + '12', borderRadius: 12, padding: 12, marginBottom: 18 }}>
        <Ionicons name="information-circle-outline" size={18} color={theme.colors.primary} style={{ marginRight: 8 }} />
        <Text style={{ color: theme.colors.textSecondary, fontSize: 12.5, flex: 1, lineHeight: 18 }}>
          Leave can be applied starting from <Text style={{ fontWeight: '700', color: theme.colors.textPrimary }}>{prettyDate(minDate)}</Text> onwards. You cannot apply for today or tomorrow.
        </Text>
      </View>

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
        Reason for applying leave <Text style={{ color: '#F44336' }}>*</Text>
      </Text>
      <TextInput
        style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 14, color: theme.colors.textPrimary, marginBottom: 20, minHeight: 100, textAlignVertical: 'top', backgroundColor: theme.colors.surface }}
        value={reason}
        onChangeText={setReason}
        placeholder="Why are you applying for leave? (required)"
        placeholderTextColor={theme.colors.placeholder}
        multiline
      />

      {/* Proofs (optional) */}
      <Text style={{ color: theme.colors.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 2 }}>
        Proofs <Text style={{ color: theme.colors.textSecondary, fontWeight: '400' }}>(if any)</Text>
      </Text>
      {/* Photos only. Said here rather than left to be discovered at submit
          time, because "why was my PDF rejected" is a worse experience than
          knowing before you go looking for one. */}
      <Text style={{ color: theme.colors.textSecondary, fontSize: 11.5, marginBottom: 8 }}>
        Photos only — if your proof is a document, attach a photo of it.
      </Text>
      <View style={{ marginBottom: proofs.length ? 12 : 20 }}>
        <TouchableOpacity
          onPress={addPhoto}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, paddingVertical: 12, borderStyle: 'dashed' }}
        >
          <Ionicons name="image-outline" size={18} color={theme.colors.primary} style={{ marginRight: 6 }} />
          <Text style={{ color: theme.colors.textPrimary, fontWeight: '600', fontSize: 13 }}>Add Photo</Text>
        </TouchableOpacity>
      </View>

      {proofs.length > 0 && (
        <View style={{ marginBottom: 20 }}>
          {proofs.map((p, i) => (
            <View key={`${p.uri}_${i}`} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, padding: 8, marginBottom: 8 }}>
              <Image source={{ uri: p.uri }} style={{ width: 38, height: 38, borderRadius: 6 }} />
              <Text style={{ flex: 1, color: theme.colors.textPrimary, fontSize: 13, marginLeft: 10 }} numberOfLines={1}>{p.name}</Text>
              <TouchableOpacity onPress={() => removeProof(i)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close-circle" size={20} color="#F44336" />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

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
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15, marginLeft: 8 }}>Submit Leave Request</Text>
          </>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}
