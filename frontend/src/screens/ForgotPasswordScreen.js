import React, { useState, useContext } from 'react';
import { 
  View, 
  Text, 
  TextInput, 
  TouchableOpacity, 
  StyleSheet, 
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard
} from 'react-native';
import CustomAlert from '../components/CustomAlert';
import { ThemeContext } from '../context/ThemeContext';
import { MotiView, AnimatePresence } from 'moti';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import api from '../services/api';

export default function ForgotPasswordScreen({ navigation }) {
  const { theme } = useContext(ThemeContext);
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState(1); // 1: Email, 2: OTP, 3: New Password
  
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [secureTextEntry, setSecureTextEntry] = useState(true);
  
  const [alertConfig, setAlertConfig] = useState({ visible: false, title: '', message: '', type: 'info', buttons: [] });

  const showAlert = (title, message, type = 'info', buttons = []) => {
    setAlertConfig({ visible: true, title, message, type, buttons });
  };

  const handleSendOtp = async () => {
    if (!email) {
      setError('Please enter your email address');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api.post('/auth/forgotpassword', { email });
      setStep(2);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send OTP. Ensure email is correct.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otp) {
      setError('Please enter the OTP');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api.post('/auth/verifyotp', { email, otp });
      setStep(3);
    } catch (err) {
      setError(err.response?.data?.error || 'Invalid or expired OTP');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api.put('/auth/resetpassword', { email, otp, password });
      showAlert('Success', 'Password has been reset successfully!', 'success', [
        { text: 'Login', type: 'primary', onPress: () => navigation.navigate('Login') }
      ]);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView 
      style={[styles.container, { backgroundColor: theme.colors.background }]} 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={[styles.inner, { paddingTop: insets.top, paddingBottom: insets.bottom + 40 }]}>
          
          <TouchableOpacity 
            style={styles.backBtn}
            onPress={() => {
              if (step > 1) setStep(step - 1);
              else navigation.goBack();
            }}
          >
            <Ionicons name="arrow-back-outline" size={24} color={theme.colors.textPrimary} />
            <Text style={[styles.backText, { color: theme.colors.textPrimary }]}>Back</Text>
          </TouchableOpacity>

          <MotiView
            from={{ opacity: 0, translateY: -20 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 500 }}
            style={styles.headerContainer}
          >
            <Ionicons name="shield-checkmark" size={60} color={theme.colors.primary} style={{ marginBottom: 10 }} />
            <Text style={[styles.title, { color: theme.colors.textPrimary }]}>Password Reset</Text>
            <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
              {step === 1 ? 'Enter your email' : step === 2 ? 'Verify OTP' : 'Set New Password'}
            </Text>
          </MotiView>

          <View style={[styles.formCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            {error ? (
              <View style={[styles.errorContainer, { borderColor: theme.colors.primary + '30', backgroundColor: theme.colors.primary + '10' }]}>
                <Text style={[styles.errorText, { color: theme.colors.primary }]}>{error}</Text>
              </View>
            ) : null}

            <AnimatePresence exitBeforeEnter>
              {/* Step 1: Email */}
              {step === 1 && (
                <MotiView key="step1" from={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                  <Text style={[styles.inputLabel, { color: theme.colors.textSecondary }]}>Account Email</Text>
                  <TextInput
                    style={[styles.input, { borderColor: theme.colors.border, backgroundColor: theme.colors.background, color: theme.colors.textPrimary }]}
                    placeholder="Enter your email"
                    placeholderTextColor={theme.colors.placeholder}
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                  />
                  <TouchableOpacity style={[styles.submitButton, { backgroundColor: theme.colors.primary }]} onPress={handleSendOtp} disabled={loading}>
                    {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.submitButtonText}>Send OTP</Text>}
                  </TouchableOpacity>
                </MotiView>
              )}

              {/* Step 2: OTP */}
              {step === 2 && (
                <MotiView key="step2" from={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                  <Text style={[styles.inputLabel, { color: theme.colors.textSecondary }]}>Enter 6-digit OTP</Text>
                  <TextInput
                    style={[styles.input, { borderColor: theme.colors.border, backgroundColor: theme.colors.background, color: theme.colors.textPrimary, fontSize: 24, letterSpacing: 8, textAlign: 'center' }]}
                    placeholder="------"
                    placeholderTextColor={theme.colors.placeholder}
                    value={otp}
                    onChangeText={setOtp}
                    keyboardType="number-pad"
                    maxLength={6}
                  />
                  <TouchableOpacity style={[styles.submitButton, { backgroundColor: theme.colors.primary }]} onPress={handleVerifyOtp} disabled={loading}>
                    {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.submitButtonText}>Verify OTP</Text>}
                  </TouchableOpacity>
                </MotiView>
              )}

              {/* Step 3: Password */}
              {step === 3 && (
                <MotiView key="step3" from={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                  <Text style={[styles.inputLabel, { color: theme.colors.textSecondary }]}>New Password</Text>
                  <View style={[styles.passwordInputWrapper, { borderColor: theme.colors.border, backgroundColor: theme.colors.background }]}>
                    <TextInput
                      style={[styles.passwordInput, { color: theme.colors.textPrimary }]}
                      placeholder="Enter new password"
                      placeholderTextColor={theme.colors.placeholder}
                      value={password}
                      onChangeText={setPassword}
                      secureTextEntry={secureTextEntry}
                    />
                    <TouchableOpacity onPress={() => setSecureTextEntry(!secureTextEntry)} style={styles.eyeIconContainer}>
                      <Ionicons name={secureTextEntry ? 'eye-off-outline' : 'eye-outline'} size={20} color={theme.colors.textSecondary} />
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity style={[styles.submitButton, { backgroundColor: theme.colors.primary }]} onPress={handleResetPassword} disabled={loading}>
                    {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.submitButtonText}>Reset Password</Text>}
                  </TouchableOpacity>
                </MotiView>
              )}
            </AnimatePresence>

          </View>
        </View>
      </TouchableWithoutFeedback>
      <CustomAlert 
        visible={alertConfig.visible}
        title={alertConfig.title}
        message={alertConfig.message}
        type={alertConfig.type}
        buttons={alertConfig.buttons}
        onDismiss={() => setAlertConfig({ ...alertConfig, visible: false })}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { flex: 1, paddingHorizontal: 24, justifyContent: 'center' },
  backBtn: { position: 'absolute', top: 50, left: 20, flexDirection: 'row', alignItems: 'center' },
  backText: { fontSize: 14, fontWeight: '600', marginLeft: 8 },
  headerContainer: { alignItems: 'center', marginBottom: 40 },
  title: { fontSize: 28, fontWeight: '800', letterSpacing: 1 },
  subtitle: { fontSize: 14, marginTop: 4, textTransform: 'uppercase', letterSpacing: 2 },
  formCard: { borderRadius: 16, padding: 24, borderWidth: 1, minHeight: 250 },
  inputLabel: { fontSize: 13, marginBottom: 8, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 },
  input: { borderWidth: 1, borderRadius: 8, padding: 16, fontSize: 16, marginBottom: 20 },
  passwordInputWrapper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 8, paddingRight: 14, marginBottom: 20 },
  passwordInput: { flex: 1, padding: 16, fontSize: 16 },
  eyeIconContainer: { padding: 4 },
  submitButton: { padding: 16, borderRadius: 8, alignItems: 'center', marginTop: 10 },
  submitButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  errorContainer: { borderWidth: 1, padding: 12, borderRadius: 8, marginBottom: 20 },
  errorText: { textAlign: 'center', fontSize: 13, fontWeight: '600' }
});
