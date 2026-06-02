import React, { useState, useContext, useEffect } from 'react';
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
import { MotiView, AnimatePresence } from 'moti';
import GlobalLoader from '../components/GlobalLoader';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

const { width } = Dimensions.get('window');

const ROLES = [
  { id: 'trainer', title: 'Trainer Login', icon: 'school-outline' },
  { id: 'school', title: 'School / Chairman', icon: 'business-outline' },
  { id: 'team_leader', title: 'Team Leader', icon: 'people-outline' },
  { id: 'creator', title: 'IECE Management', icon: 'shield-checkmark-outline' },
];

export default function LoginScreen({ navigation }) {
  const [selectedRole, setSelectedRole] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [secureTextEntry, setSecureTextEntry] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const { login } = useContext(AuthContext);
  const { theme, isDarkMode, toggleTheme } = useContext(ThemeContext);
  const insets = useSafeAreaInsets();

  // Reset form when changing roles
  useEffect(() => {
    setEmail('');
    setPassword('');
    setError('');
  }, [selectedRole]);

  const handleLogin = async () => {
    if (!email || !password) {
      setError('Please fill all fields');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await login(email, password);
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const activeRoleConfig = ROLES.find(r => r.id === selectedRole);
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
            <AnimatePresence exitBeforeEnter>
              
              {!selectedRole ? (
                <MotiView
                  key="role-selection"
                  from={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ type: 'timing', duration: 250 }}
                  style={styles.rolesContainer}
                >
                  <Text style={[styles.promptText, { color: theme.colors.textPrimary }]}>Select your portal</Text>
                  
                  {ROLES.map((role, index) => (
                    <TouchableOpacity
                      key={role.id}
                      activeOpacity={0.8}
                      onPress={() => {
                        if (role.id === 'creator') {
                          navigation.navigate('CreatorLogin');
                        } else {
                          setSelectedRole(role.id);
                        }
                      }}
                    >
                      <MotiView
                        from={{ opacity: 0, translateY: 15 }}
                        animate={{ opacity: 1, translateY: 0 }}
                        transition={{ type: 'timing', duration: 300, delay: index * 100 }}
                        style={[
                          styles.roleCard, 
                          { 
                            backgroundColor: theme.colors.surface, 
                            borderColor: theme.colors.border 
                          }
                        ]}
                      >
                        <View style={[styles.iconContainer, { backgroundColor: theme.colors.primary + '12' }]}>
                          <Ionicons name={role.icon} size={24} color={theme.colors.primary} />
                        </View>
                        <Text style={[styles.roleText, { color: theme.colors.textPrimary }]}>{role.title}</Text>
                        <Ionicons name="chevron-forward-outline" size={20} color={theme.colors.textSecondary} />
                      </MotiView>
                    </TouchableOpacity>
                  ))}
                </MotiView>
              ) : (
                <MotiView
                  key="login-form"
                  from={{ opacity: 0, translateX: 30 }}
                  animate={{ opacity: 1, translateX: 0 }}
                  exit={{ opacity: 0, translateX: -30 }}
                  transition={{ type: 'timing', duration: 250 }}
                  style={[
                    styles.loginForm, 
                    { 
                      backgroundColor: theme.colors.surface, 
                      borderColor: theme.colors.border 
                    }
                  ]}
                >
                  <TouchableOpacity 
                    style={[styles.backButton, { backgroundColor: theme.colors.background, borderColor: theme.colors.border }]}
                    onPress={() => setSelectedRole(null)}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="chevron-back-outline" size={16} color={theme.colors.textSecondary} style={{ marginRight: 4 }} />
                    <Text style={[styles.backText, { color: theme.colors.textSecondary }]}>Portals</Text>
                  </TouchableOpacity>

                  <View style={styles.formHeader}>
                    <View style={[styles.formIconContainer, { backgroundColor: theme.colors.primary + '12' }]}>
                      <Ionicons name={activeRoleConfig?.icon} size={28} color={theme.colors.primary} />
                    </View>
                    <Text style={[styles.formTitle, { color: theme.colors.textPrimary }]}>{activeRoleConfig?.title}</Text>
                  </View>

                  {error ? (
                    <MotiView from={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
                      <View style={[styles.errorContainer, { borderColor: theme.colors.primary + '30', backgroundColor: theme.colors.primary + '10' }]}>
                        <Text style={[styles.errorText, { color: theme.colors.primary }]}>{error}</Text>
                      </View>
                    </MotiView>
                  ) : null}
                  
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
              )}

            </AnimatePresence>
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
    right: 20,
    zIndex: 10,
  },
  toggleBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
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
    width: width * 0.5,
    height: 120,
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
  rolesContainer: {
    width: '100%',
  },
  promptText: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 20,
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  roleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  roleText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.1,
  },
  loginForm: {
    width: '100%',
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginBottom: 20,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  backText: {
    fontSize: 12,
    fontWeight: '600',
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
  },
  errorContainer: {
    borderWidth: 1,
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
  },
  errorText: {
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '500',
  },
  creatorLinkContainer: {
    marginTop: 40,
    alignItems: 'center',
  },
  creatorLinkText: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
  }
});
