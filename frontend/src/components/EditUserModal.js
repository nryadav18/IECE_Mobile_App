import React, { useContext, useEffect, useState } from 'react';
import { 
  Modal, View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform, Dimensions
} from 'react-native';
import { ThemeContext } from '../context/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import api from '../services/api';
import CustomDropdown from './CustomDropdown';

const INDIAN_STATES = [
  { _id: 'Andhra Pradesh', name: 'Andhra Pradesh' },
  { _id: 'Arunachal Pradesh', name: 'Arunachal Pradesh' },
  { _id: 'Assam', name: 'Assam' },
  { _id: 'Bihar', name: 'Bihar' },
  { _id: 'Chhattisgarh', name: 'Chhattisgarh' },
  { _id: 'Goa', name: 'Goa' },
  { _id: 'Gujarat', name: 'Gujarat' },
  { _id: 'Haryana', name: 'Haryana' },
  { _id: 'Himachal Pradesh', name: 'Himachal Pradesh' },
  { _id: 'Jharkhand', name: 'Jharkhand' },
  { _id: 'Karnataka', name: 'Karnataka' },
  { _id: 'Kerala', name: 'Kerala' },
  { _id: 'Madhya Pradesh', name: 'Madhya Pradesh' },
  { _id: 'Maharashtra', name: 'Maharashtra' },
  { _id: 'Manipur', name: 'Manipur' },
  { _id: 'Meghalaya', name: 'Meghalaya' },
  { _id: 'Mizoram', name: 'Mizoram' },
  { _id: 'Nagaland', name: 'Nagaland' },
  { _id: 'Odisha', name: 'Odisha' },
  { _id: 'Punjab', name: 'Punjab' },
  { _id: 'Rajasthan', name: 'Rajasthan' },
  { _id: 'Sikkim', name: 'Sikkim' },
  { _id: 'Tamil Nadu', name: 'Tamil Nadu' },
  { _id: 'Telangana', name: 'Telangana' },
  { _id: 'Tripura', name: 'Tripura' },
  { _id: 'Uttar Pradesh', name: 'Uttar Pradesh' },
  { _id: 'Uttarakhand', name: 'Uttarakhand' },
  { _id: 'West Bengal', name: 'West Bengal' },
  { _id: 'Andaman and Nicobar Islands', name: 'Andaman and Nicobar Islands' },
  { _id: 'Chandigarh', name: 'Chandigarh' },
  { _id: 'Dadra and Nagar Haveli and Daman and Diu', name: 'Dadra and Nagar Haveli and Daman and Diu' },
  { _id: 'Delhi', name: 'Delhi' },
  { _id: 'Jammu and Kashmir', name: 'Jammu and Kashmir' },
  { _id: 'Ladakh', name: 'Ladakh' },
  { _id: 'Lakshadweep', name: 'Lakshadweep' },
  { _id: 'Puducherry', name: 'Puducherry' },
];

const { height } = Dimensions.get('window');

export default function EditUserModal({ visible, user, role, schools, teamLeaders, onClose, onSuccess, onError }) {
  const { theme } = useContext(ThemeContext);
  
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({});
  const [secureTextEntry, setSecureTextEntry] = useState(true);

  useEffect(() => {
    if (user && visible) {
      setFormData({
        name: user.name || '',
        email: user.email || '',
        password: '', // Leave blank unless they want to change it
        schoolId: user.schoolId ? user.schoolId._id : '',
        teamLeaderId: user.teamLeaderId ? user.teamLeaderId._id : '',
        schoolName: user.schoolId ? user.schoolId.name : '',
        associationYear: user.schoolId ? user.schoolId.associationYear : '',
        classCoverage: user.schoolId ? user.schoolId.classCoverage : '',
        state: user.schoolId ? user.schoolId.state : '',
      });
    }
  }, [user, visible]);

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const payload = {
        name: formData.name,
        email: formData.email,
      };
      
      if (formData.password) {
        payload.password = formData.password;
      }

      if (role === 'trainer') {
        payload.schoolId = formData.schoolId;
        payload.teamLeaderId = formData.teamLeaderId;
      } else if (role === 'chairman') {
        payload.schoolName = formData.schoolName;
        payload.associationYear = formData.associationYear;
        payload.classCoverage = formData.classCoverage;
        payload.state = formData.state;
      }

      await api.put(`/admin/user/${user._id}`, payload);
      onSuccess();
    } catch (error) {
      onError(error.response?.data?.error || 'Failed to update user');
    } finally {
      setLoading(false);
    }
  };

  if (!visible || !user) return null;

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView 
        style={styles.overlay} 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.modalContainer, { backgroundColor: theme.colors.background }]}>
          <View style={[styles.header, { borderBottomColor: theme.colors.border }]}>
            <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>Edit {role}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color={theme.colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <ScrollView 
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={[styles.label, { color: theme.colors.textSecondary }]}>Name</Text>
            <TextInput
              style={[styles.input, { borderColor: theme.colors.border, color: theme.colors.textPrimary }]}
              value={formData.name}
              onChangeText={(val) => setFormData({ ...formData, name: val })}
            />

            <Text style={[styles.label, { color: theme.colors.textSecondary }]}>Email</Text>
            <TextInput
              style={[styles.input, { borderColor: theme.colors.border, color: theme.colors.textPrimary }]}
              value={formData.email}
              onChangeText={(val) => setFormData({ ...formData, email: val })}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <Text style={[styles.label, { color: theme.colors.textSecondary }]}>New Password (Optional)</Text>
            <View style={[styles.passwordInputWrapper, { borderColor: theme.colors.border, backgroundColor: theme.colors.background }]}>
              <TextInput
                style={[styles.passwordInput, { color: theme.colors.textPrimary }]}
                value={formData.password}
                onChangeText={(val) => setFormData({ ...formData, password: val })}
                secureTextEntry={secureTextEntry}
                placeholder="Leave blank to keep unchanged"
                placeholderTextColor={theme.colors.placeholder}
              />
              <TouchableOpacity onPress={() => setSecureTextEntry(!secureTextEntry)} style={styles.eyeIconContainer}>
                <Ionicons name={secureTextEntry ? 'eye-off-outline' : 'eye-outline'} size={20} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {role === 'chairman' && (
              <>
                <Text style={[styles.sectionTitle, { color: theme.colors.primary }]}>School Details</Text>
                
                <Text style={[styles.label, { color: theme.colors.textSecondary }]}>School Name</Text>
                <TextInput
                  style={[styles.input, { borderColor: theme.colors.border, color: theme.colors.textPrimary }]}
                  value={formData.schoolName}
                  onChangeText={(val) => setFormData({ ...formData, schoolName: val })}
                />

                <Text style={[styles.label, { color: theme.colors.textSecondary }]}>Association Year</Text>
                <TextInput
                  style={[styles.input, { borderColor: theme.colors.border, color: theme.colors.textPrimary }]}
                  value={formData.associationYear}
                  onChangeText={(val) => setFormData({ ...formData, associationYear: val })}
                />

                <Text style={[styles.label, { color: theme.colors.textSecondary }]}>Class Coverage</Text>
                <TextInput
                  style={[styles.input, { borderColor: theme.colors.border, color: theme.colors.textPrimary }]}
                  value={formData.classCoverage}
                  onChangeText={(val) => setFormData({ ...formData, classCoverage: val })}
                />

                <CustomDropdown
                  label="Select State"
                  data={INDIAN_STATES}
                  selectedValue={formData.state}
                  onSelect={(item) => setFormData({ ...formData, state: item.name })}
                  placeholder="Select an Indian State"
                />
              </>
            )}

            {role === 'trainer' && (
              <>
                <CustomDropdown
                  label="Assign School (Optional)"
                  data={schools}
                  selectedValue={formData.schoolId}
                  onSelect={(item) => setFormData({ ...formData, schoolId: formData.schoolId === item._id ? '' : item._id })}
                  placeholder="Select a school"
                />

                <CustomDropdown
                  label="Assign Team Leader (Optional)"
                  data={teamLeaders}
                  selectedValue={formData.teamLeaderId}
                  onSelect={(item) => setFormData({ ...formData, teamLeaderId: formData.teamLeaderId === item._id ? '' : item._id })}
                  placeholder="Select a team leader"
                />
              </>
            )}
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: theme.colors.border }]}>
            <TouchableOpacity style={[styles.submitBtn, { backgroundColor: theme.colors.primary }]} onPress={handleSubmit} disabled={loading}>
              {loading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.submitBtnText}>Save Changes</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContainer: { height: height * 0.85, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1 },
  headerTitle: { fontSize: 18, fontWeight: 'bold', textTransform: 'capitalize' },
  closeBtn: { padding: 4 },
  scrollContent: { padding: 20, paddingBottom: 40 },
  label: { fontSize: 13, marginBottom: 8, fontWeight: '600' },
  input: { padding: 14, borderRadius: 8, borderWidth: 1, marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', marginTop: 10, marginBottom: 16 },
  selectBtn: { padding: 12, borderRadius: 8, borderWidth: 1, marginBottom: 8 },
  footer: { padding: 20, borderTopWidth: 1 },
  submitBtn: { padding: 16, borderRadius: 8, alignItems: 'center' },
  submitBtnText: { color: '#FFF', fontWeight: 'bold', fontSize: 16 },
  passwordInputWrapper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 8, paddingRight: 14, marginBottom: 16 },
  passwordInput: { flex: 1, padding: 14, fontSize: 14 },
  eyeIconContainer: { padding: 4 },
});
