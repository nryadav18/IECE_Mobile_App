import React, { useContext, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemeContext } from '../../context/ThemeContext';
import { useAlert } from '../../context/AlertContext';
import {
  initiateAdminCreation, verifyAndCreateAdmin, resendAdminOtps, adminCreateError,
} from '../../services/adminCreate';

const EMAIL_RE = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/;

export default function CreateAdminScreen({ navigation }) {
  const { theme } = useContext(ThemeContext);
  const { showAlert } = useAlert();
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState('form'); // 'form' | 'otp'
  const [submitting, setSubmitting] = useState(false);

  // Form fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPass, setShowPass] = useState(false);

  // OTP step
  const [requestId, setRequestId] = useState(null);
  const [requesterMask, setRequesterMask] = useState('');
  const [newAdminMask, setNewAdminMask] = useState('');
  const [requesterOtp, setRequesterOtp] = useState('');
  const [newAdminOtp, setNewAdminOtp] = useState('');
  const [resending, setResending] = useState(false);

  const C = theme.colors;

  const inputStyle = {
    borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 14,
    color: C.textPrimary, backgroundColor: C.surface, fontSize: 15,
  };
  const labelStyle = { color: C.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 6, marginTop: 16 };

  const sendCodes = async () => {
    if (!name.trim()) return showAlert('Name required', 'Please enter the new admin’s full name.', 'warning');
    if (!EMAIL_RE.test(email.trim())) return showAlert('Invalid email', 'Please enter a valid email for the new admin.', 'warning');
    if (password.length < 6) return showAlert('Weak password', 'Password must be at least 6 characters.', 'warning');
    if (password !== confirm) return showAlert('Passwords don’t match', 'Please re-enter the confirmation password.', 'warning');

    setSubmitting(true);
    try {
      const res = await initiateAdminCreation({ name: name.trim(), email: email.trim(), password });
      setRequestId(res.requestId);
      setRequesterMask(res.requesterEmailMasked || 'your email');
      setNewAdminMask(res.newAdminEmailMasked || 'the new admin’s email');
      setRequesterOtp('');
      setNewAdminOtp('');
      setStep('otp');
    } catch (e) {
      showAlert('Could not send codes', adminCreateError(e), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const verifyAndCreate = async () => {
    if (requesterOtp.trim().length !== 6 || newAdminOtp.trim().length !== 6) {
      return showAlert('Enter both codes', 'Please enter both 6-digit verification codes.', 'warning');
    }
    setSubmitting(true);
    try {
      await verifyAndCreateAdmin({ requestId, requesterOtp: requesterOtp.trim(), newAdminOtp: newAdminOtp.trim() });
      showAlert('Admin Created', `${name.trim()} can now sign in as an admin.`, 'success', [
        { text: 'Done', onPress: () => navigation.goBack() },
      ]);
    } catch (e) {
      showAlert('Verification failed', adminCreateError(e), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const resend = async () => {
    setResending(true);
    try {
      await resendAdminOtps(requestId);
      showAlert('Codes resent', 'New verification codes have been emailed to both addresses.', 'success');
    } catch (e) {
      showAlert('Could not resend', adminCreateError(e), 'error');
    } finally {
      setResending(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Header */}
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border, flexDirection: 'row', alignItems: 'center' }}>
        <TouchableOpacity
          onPress={() => (step === 'otp' ? setStep('form') : navigation.goBack())}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="arrow-back" size={24} color={C.textPrimary} />
        </TouchableOpacity>
        <Text style={{ color: C.textPrimary, fontSize: 19, fontWeight: '700', marginLeft: 12 }}>Create Admin</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        {/* Step indicator */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
          <StepDot active label="1" C={C} />
          <View style={{ flex: 1, height: 2, backgroundColor: step === 'otp' ? C.primary : C.border, marginHorizontal: 6 }} />
          <StepDot active={step === 'otp'} label="2" C={C} />
        </View>
        <Text style={{ color: C.textSecondary, fontSize: 12, marginBottom: 4 }}>
          {step === 'form' ? 'Step 1 of 2 · Admin details' : 'Step 2 of 2 · Verify both OTPs'}
        </Text>

        {step === 'form' ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.primary + '12', borderRadius: 12, padding: 12, marginTop: 12 }}>
              <Ionicons name="shield-checkmark-outline" size={20} color={C.primary} />
              <Text style={{ color: C.textSecondary, fontSize: 12, marginLeft: 10, flex: 1 }}>
                Creating an admin requires OTP verification on both your email and the new admin’s email.
              </Text>
            </View>

            <Text style={labelStyle}>Full Name <Text style={{ color: '#F44336' }}>*</Text></Text>
            <TextInput style={inputStyle} value={name} onChangeText={setName} placeholder="e.g. Priya Sharma" placeholderTextColor={C.placeholder} />

            <Text style={labelStyle}>Email <Text style={{ color: '#F44336' }}>*</Text></Text>
            <TextInput
              style={inputStyle} value={email} onChangeText={setEmail}
              placeholder="new.admin@example.com" placeholderTextColor={C.placeholder}
              keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
            />

            <Text style={labelStyle}>Password <Text style={{ color: '#F44336' }}>*</Text></Text>
            <View style={{ position: 'relative', justifyContent: 'center' }}>
              <TextInput
                style={[inputStyle, { paddingRight: 46 }]} value={password} onChangeText={setPassword}
                placeholder="At least 6 characters" placeholderTextColor={C.placeholder}
                secureTextEntry={!showPass} autoCapitalize="none"
              />
              <TouchableOpacity style={{ position: 'absolute', right: 12 }} onPress={() => setShowPass((s) => !s)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name={showPass ? 'eye-off-outline' : 'eye-outline'} size={20} color={C.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text style={labelStyle}>Confirm Password <Text style={{ color: '#F44336' }}>*</Text></Text>
            <TextInput
              style={inputStyle} value={confirm} onChangeText={setConfirm}
              placeholder="Re-enter password" placeholderTextColor={C.placeholder}
              secureTextEntry={!showPass} autoCapitalize="none"
            />

            <TouchableOpacity
              style={{ backgroundColor: C.primary, borderRadius: 12, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 28, opacity: submitting ? 0.6 : 1 }}
              onPress={sendCodes} disabled={submitting}
            >
              {submitting ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Ionicons name="mail-outline" size={18} color="#fff" />
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15, marginLeft: 8 }}>Send Verification Codes</Text>
                </>
              )}
            </TouchableOpacity>
          </>
        ) : (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.primary + '12', borderRadius: 12, padding: 12, marginTop: 12 }}>
              <Ionicons name="lock-closed-outline" size={20} color={C.primary} />
              <Text style={{ color: C.textSecondary, fontSize: 12, marginLeft: 10, flex: 1 }}>
                Two codes were sent. Enter both to create the admin. Codes expire in 10 minutes.
              </Text>
            </View>

            <Text style={labelStyle}>Your OTP</Text>
            <Text style={{ color: C.textSecondary, fontSize: 11, marginBottom: 6 }}>Sent to {requesterMask}</Text>
            <TextInput
              style={[inputStyle, { letterSpacing: 8, textAlign: 'center', fontSize: 20, fontWeight: '700' }]}
              value={requesterOtp} onChangeText={(t) => setRequesterOtp(t.replace(/\D/g, '').slice(0, 6))}
              placeholder="______" placeholderTextColor={C.placeholder} keyboardType="number-pad" maxLength={6}
            />

            <Text style={labelStyle}>New Admin’s OTP</Text>
            <Text style={{ color: C.textSecondary, fontSize: 11, marginBottom: 6 }}>Sent to {newAdminMask}</Text>
            <TextInput
              style={[inputStyle, { letterSpacing: 8, textAlign: 'center', fontSize: 20, fontWeight: '700' }]}
              value={newAdminOtp} onChangeText={(t) => setNewAdminOtp(t.replace(/\D/g, '').slice(0, 6))}
              placeholder="______" placeholderTextColor={C.placeholder} keyboardType="number-pad" maxLength={6}
            />

            <TouchableOpacity
              style={{ backgroundColor: C.primary, borderRadius: 12, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 28, opacity: submitting ? 0.6 : 1 }}
              onPress={verifyAndCreate} disabled={submitting}
            >
              {submitting ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15, marginLeft: 8 }}>Verify & Create Admin</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={{ alignItems: 'center', paddingVertical: 16 }} onPress={resend} disabled={resending}>
              <Text style={{ color: C.primary, fontWeight: '600' }}>
                {resending ? 'Resending…' : 'Didn’t get the codes? Resend'}
              </Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function StepDot({ active, label, C }) {
  return (
    <View style={{ width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? C.primary : C.surface, borderWidth: 1, borderColor: active ? C.primary : C.border }}>
      <Text style={{ color: active ? '#fff' : C.textSecondary, fontWeight: '800', fontSize: 12 }}>{label}</Text>
    </View>
  );
}
