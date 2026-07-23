import React, { useContext, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Platform, KeyboardAvoidingView,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemeContext } from '../../context/ThemeContext';
import { useAlert } from '../../context/AlertContext';
import { roleLabel } from '../../utils/roles';
import { prettyDate, toYMD, dayCountInclusive } from '../../utils/dates';
import Avatar from '../../components/Avatar';
import { raiseSubstitution, substitutionError } from '../../services/substitution';

const schoolsOf = (u) => (u?.schoolIds || []).map((s) => s?.name).filter(Boolean).join(', ') || '—';

export default function RaiseSubstitutionScreen({ navigation, route }) {
  const { theme } = useContext(ThemeContext);
  const { showAlert } = useAlert();
  const insets = useSafeAreaInsets();

  const subject = route?.params?.subject;

  const today = new Date();
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [showFrom, setShowFrom] = useState(false);
  const [showTo, setShowTo] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!subject) {
    // Defensive — should never happen via normal navigation.
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: theme.colors.textSecondary }}>No staff selected.</Text>
      </View>
    );
  }

  const onPickFrom = (event, selected) => {
    setShowFrom(Platform.OS === 'ios');
    if (selected) {
      setFromDate(selected);
      // Keep to-date valid.
      if (selected > toDate) setToDate(selected);
    }
  };
  const onPickTo = (event, selected) => {
    setShowTo(Platform.OS === 'ios');
    if (selected) setToDate(selected);
  };

  const submit = async () => {
    if (!reason.trim()) {
      showAlert('Reason required', 'Please provide a reason for this substitution.', 'warning');
      return;
    }
    if (toDate < fromDate) {
      showAlert('Invalid dates', 'The “to” date cannot be before the “from” date.', 'warning');
      return;
    }
    setSubmitting(true);
    try {
      await raiseSubstitution({
        subjectId: subject._id,
        reason: reason.trim(),
        fromDate: toYMD(fromDate),
        toDate: toYMD(toDate),
      });
      showAlert('Request Raised', `Your substitution request for ${subject.name} was submitted and the approvers have been notified.`, 'success', [
        { text: 'Done', onPress: () => navigation.goBack() },
      ]);
    } catch (e) {
      showAlert('Could not raise request', substitutionError(e), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const DateField = ({ label, value, onPress }) => (
    <View style={{ flex: 1 }}>
      <Text style={{ color: theme.colors.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>{label}</Text>
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
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.colors.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Header */}
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.border, flexDirection: 'row', alignItems: 'center' }}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={{ color: theme.colors.textPrimary, fontSize: 19, fontWeight: '700', marginLeft: 12 }}>Raise Substitution</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        {/* Subject card */}
        <View style={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 20, flexDirection: 'row', alignItems: 'center' }}>
          <Avatar name={subject.name} size={48} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={{ color: theme.colors.textPrimary, fontWeight: '700', fontSize: 16 }}>{subject.name}</Text>
            <Text style={{ color: theme.colors.primary, fontSize: 12, fontWeight: '600', marginTop: 1 }}>{roleLabel(subject.role)}</Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 11, marginTop: 3 }} numberOfLines={2}>
              <Ionicons name="school-outline" size={11} color={theme.colors.textSecondary} /> {schoolsOf(subject)}
            </Text>
          </View>
        </View>

        {/* Reason */}
        <Text style={{ color: theme.colors.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>
          Reason <Text style={{ color: '#F44336' }}>*</Text>
        </Text>
        <TextInput
          style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 14, color: theme.colors.textPrimary, marginBottom: 20, minHeight: 90, textAlignVertical: 'top' }}
          value={reason}
          onChangeText={setReason}
          placeholder="Why does this person need to be substituted? (required)"
          placeholderTextColor={theme.colors.placeholder}
          multiline
        />

        {/* Dates */}
        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 8 }}>
          <DateField label="From date" value={fromDate} onPress={() => setShowFrom(true)} />
          <DateField label="To date" value={toDate} onPress={() => setShowTo(true)} />
        </View>
        <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginBottom: 22 }}>
          Duration: {dayCountInclusive(fromDate, toDate)} day{dayCountInclusive(fromDate, toDate) > 1 ? 's' : ''}
        </Text>

        {showFrom && (
          <DateTimePicker value={fromDate} mode="date" display="default" minimumDate={new Date()} onChange={onPickFrom} />
        )}
        {showTo && (
          <DateTimePicker value={toDate} mode="date" display="default" minimumDate={fromDate} onChange={onPickTo} />
        )}

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
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15, marginLeft: 8 }}>Raise Substitution Request</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
