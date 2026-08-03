import React, { useContext, useEffect, useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemeContext } from '../context/ThemeContext';

/**
 * Asks WHY before letting anything be rejected.
 *
 * A rejection with no reason is useless to the person receiving it — they are
 * told "no" and left guessing what to fix. The server enforces the same rule,
 * so this dialog is the honest front end of a real requirement rather than a
 * politeness prompt: the Reject button stays disabled until a reason is typed.
 *
 * Props:
 *  - visible, onClose
 *  - title / subject: what is being rejected ("Ravi's face registration")
 *  - placeholder: hint text for the reason field
 *  - submitting: shows a spinner and locks the buttons
 *  - onSubmit(reason)
 */
export default function RejectReasonModal({
  visible,
  onClose,
  title = 'Reason for Rejection',
  subject,
  placeholder = 'Explain what is wrong so they can fix it and try again…',
  submitting = false,
  onSubmit,
}) {
  const { theme } = useContext(ThemeContext);
  const [reason, setReason] = useState('');

  // Start clean every time it opens — a stale reason from a previous rejection
  // must never be attached to a different person.
  useEffect(() => {
    if (visible) setReason('');
  }, [visible]);

  const canSubmit = reason.trim().length > 0 && !submitting;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={submitting ? undefined : onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 }}
      >
        <View style={{
          width: '100%', maxWidth: 440, borderRadius: 20, borderWidth: 1,
          backgroundColor: theme.colors.surface, borderColor: theme.colors.border,
          padding: 20,
        }}>
          <View style={{ alignItems: 'center', marginBottom: 14 }}>
            <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: '#EF444418', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="close-circle-outline" size={30} color="#EF4444" />
            </View>
          </View>

          <Text style={{ color: theme.colors.textPrimary, fontSize: 17, fontWeight: '800', textAlign: 'center' }}>
            {title}
          </Text>
          {!!subject && (
            <Text style={{ color: theme.colors.textSecondary, fontSize: 13, textAlign: 'center', marginTop: 6, lineHeight: 19 }}>
              {subject}
            </Text>
          )}

          <TextInput
            style={{
              borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12,
              padding: 13, marginTop: 16, minHeight: 100, textAlignVertical: 'top',
              color: theme.colors.textPrimary, backgroundColor: theme.colors.background, fontSize: 14,
            }}
            value={reason}
            onChangeText={setReason}
            placeholder={placeholder}
            placeholderTextColor={theme.colors.placeholder}
            multiline
            autoFocus
            editable={!submitting}
          />
          <Text style={{ color: theme.colors.textSecondary, fontSize: 11.5, marginTop: 7 }}>
            This reason is sent to them, so be specific about what to correct.
          </Text>

          <View style={{ flexDirection: 'row', gap: 12, marginTop: 18 }}>
            <TouchableOpacity
              style={{
                flex: 1, height: 48, borderRadius: 12, borderWidth: 1,
                borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center',
                opacity: submitting ? 0.5 : 1,
              }}
              onPress={onClose}
              disabled={submitting}
            >
              <Text style={{ color: theme.colors.textPrimary, fontWeight: '700', fontSize: 14 }}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={{
                flex: 1, height: 48, borderRadius: 12, backgroundColor: '#EF4444',
                alignItems: 'center', justifyContent: 'center', opacity: canSubmit ? 1 : 0.45,
              }}
              onPress={() => onSubmit && onSubmit(reason.trim())}
              disabled={!canSubmit}
            >
              {submitting
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>Reject</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
