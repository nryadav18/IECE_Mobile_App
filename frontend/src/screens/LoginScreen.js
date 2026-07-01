import React, { useState, useContext } from 'react';
import { 
  View, 
  Text, 
  TextInput, 
  TouchableOpacity, 
  StyleSheet, 
  ActivityIndicator,
  Image,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
  ScrollView
} from 'react-native';
import { AuthContext } from '../context/AuthContext';
import { ThemeContext } from '../context/ThemeContext';
import { useAlert } from '../context/AlertContext';
import { MotiView } from 'moti';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

const { width } = Dimensions.get('window');

export default function LoginScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [secureTextEntry, setSecureTextEntry] = useState(true);
  const [loading, setLoading] = useState(false);
  
  const { login } = useContext(AuthContext);
  const { theme, isDarkMode, toggleTheme } = useContext(ThemeContext);
  const { showAlert } = useAlert();
  const insets = useSafeAreaInsets();

  const handleLogin = async () => {
    const trimmedEmail = email.trim();
    const trimmedPassword = password.trim();

    if (!trimmedEmail) {
      showAlert('Required Field', 'Please enter your email address.', 'warning');
      return;
    }
    if (!trimmedPassword) {
      showAlert('Required Field', 'Please enter your password.', 'warning');
      return;
    }

    // Strict email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      showAlert('Invalid Email', 'Please enter a valid email address.', 'warning');
      return;
    }

    setLoading(true);
    try {
      await login(trimmedEmail, trimmedPassword);
    } catch (err) {
      const errMsg = err.response?.data?.error || 'Login failed. Please check your credentials.';
      showAlert('Login Failed', errMsg, 'error');
    } finally {
      setLoading(false);
    }
  };

  const logoSource = isDarkMode ? require('../../assets/IECE_Logo_White.png') : require('../../assets/IECE_Logo.png');

  return (
    <KeyboardAvoidingView 
      style={[styles.container, { backgroundColor: theme.colors.background }]} 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.background} />

      {/* Top Bar for Mode Toggle */}
      <View style={[styles.topBar, { top: insets.top + 10 }]}>
        <TouchableOpacity 
          onPress={toggleTheme} 
          style={[styles.toggleBtn, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]} 
          activeOpacity={0.8}
        >
          <Ionicons 
            name={isDarkMode ? 'sunny-outline' : 'moon-outline'} 
            size={20} 
            color={theme.colors.textPrimary} 
          />
        </TouchableOpacity>
      </View>

      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <ScrollView 
          contentContainerStyle={[
            styles.scrollContent, 
            { 
              paddingTop: insets.top + 60, 
              paddingBottom: insets.bottom + 40 
            }
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          
          {/* Logo Section */}
          <MotiView
            from={{ opacity: 0, translateY: -20 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 500 }}
            style={styles.logoContainer}
          >
            <Image 
              source={logoSource} 
              style={styles.logo}
              resizeMode="contain"
            />
            <Text style={[styles.subtext, { color: theme.colors.textSecondary }]}>Empowering Education Professionals</Text>
          </MotiView>

          <View style={styles.formContainer}>
            <MotiView
              from={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'timing', duration: 300 }}
              style={[
                styles.loginForm, 
                { 
                  backgroundColor: theme.colors.surface, 
                  borderColor: theme.colors.border 
                }
              ]}
            >
              <View style={styles.formHeader}>
                <View style={[styles.formIconContainer, { backgroundColor: theme.colors.primary + '12' }]}>
                  <Ionicons name="lock-closed-outline" size={26} color={theme.colors.primary} />
                </View>
                <Text style={[styles.formTitle, { color: theme.colors.textPrimary }]}>Sign In to Portal</Text>
              </View>

              <View style={styles.inputContainer}>
                <Text style={[styles.inputLabel, { color: theme.colors.textSecondary }]}>Email Address</Text>
                <TextInput
                  style={[
                    styles.input, 
                    { 
                      borderColor: theme.colors.border, 
                      color: theme.colors.textPrimary,
                      backgroundColor: theme.colors.background
                    }
                  ]}
                  placeholder="Enter your email"
                  placeholderTextColor={theme.colors.placeholder}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
              </View>

              <View style={styles.inputContainer}>
                <Text style={[styles.inputLabel, { color: theme.colors.textSecondary }]}>Password</Text>
                <View 
                  style={[
                    styles.passwordInputWrapper, 
                    { 
                      borderColor: theme.colors.border,
                      backgroundColor: theme.colors.background
                    }
                  ]}
                >
                  <TextInput
                    style={[
                      styles.passwordInput, 
                      { 
                        color: theme.colors.textPrimary
                      }
                    ]}
                    placeholder="Enter your password"
                    placeholderTextColor={theme.colors.placeholder}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={secureTextEntry}
                  />
                  <TouchableOpacity 
                    onPress={() => setSecureTextEntry(!secureTextEntry)} 
                    style={styles.eyeIconContainer}
                    activeOpacity={0.7}
                  >
                    <Ionicons 
                      name={secureTextEntry ? 'eye-off-outline' : 'eye-outline'} 
                      size={20} 
                      color={theme.colors.textSecondary} 
                    />
                  </TouchableOpacity>
                </View>
              </View>

              <TouchableOpacity 
                onPress={() => navigation.navigate('ForgotPassword')}
                style={styles.forgotPasswordContainer}
              >
                <Text style={[styles.forgotPasswordText, { color: theme.colors.primary }]}>
                  Forgot Password?
                </Text>
              </TouchableOpacity>

              <TouchableOpacity 
                activeOpacity={0.8}
                style={[styles.submitButton, { backgroundColor: theme.colors.primary }]} 
                onPress={handleLogin}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <View style={styles.submitButtonContent}>
                    <Text style={styles.submitButtonText}>Sign In</Text>
                    <Ionicons name="arrow-forward-outline" size={18} color="#FFFFFF" style={{ marginLeft: 6 }} />
                  </View>
                )}
              </TouchableOpacity>
            </MotiView>
          </View>

        </ScrollView>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  background: {
    ...StyleSheet.absoluteFillObject,
  },
  topBar: {
    position: 'absolute',
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    zIndex: 10,
  },
  toggleBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
    marginBottom: 100,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logo: {
    width: width * 0.55,
    height: 100,
    aspectRatio: 2.5,
  },
  subtext: {
    fontSize: 13,
    marginTop: 8,
    letterSpacing: 0.3,
    fontWeight: '500',
  },
  formContainer: {
    width: '100%',
    minHeight: 380,
  },
  loginForm: {
    width: '100%',
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
  },
  formHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  formIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  formTitle: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  inputContainer: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 13,
    marginBottom: 6,
    fontWeight: '600',
    marginLeft: 2,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
  },
  passwordInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingRight: 14,
  },
  passwordInput: {
    flex: 1,
    padding: 14,
    fontSize: 15,
  },
  eyeIconContainer: {
    padding: 4,
  },
  submitButton: {
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 16,
  },
  forgotPasswordContainer: {
    alignItems: 'flex-end',
    marginTop: 6,
    marginBottom: 8,
  },
  forgotPasswordText: {
    fontSize: 13,
    fontWeight: '600',
  },
  submitButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  }
});
