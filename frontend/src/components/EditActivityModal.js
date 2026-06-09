import React, { useState, useEffect, useContext } from 'react';
import { View, Text, StyleSheet, Modal, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { ThemeContext } from '../context/ThemeContext';
import api from '../services/api';
import UserMultiSelectModal from './UserMultiSelectModal';
import GlobalLoader from './GlobalLoader';

export default function EditActivityModal({ visible, activity, onClose, onSuccess, onError }) {
  const { theme } = useContext(ThemeContext);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [activityDate, setActivityDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedOrganizers, setSelectedOrganizers] = useState([]);
  const [showOrganizerModal, setShowOrganizerModal] = useState(false);
  
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (visible && activity) {
      setName(activity.name || '');
      setDescription(activity.description || '');
      setActivityDate(activity.activityDate ? new Date(activity.activityDate) : new Date());
      setSelectedOrganizers(activity.organizers || []);
    }
  }, [visible, activity]);

  const handleSubmit = async () => {
    if (!name || !description) {
      return onError('Name and description are required.');
    }

    setUploading(true);
    try {
      const activityPayload = {
        name,
        description,
        activityDate: activityDate.toISOString(),
        organizers: selectedOrganizers.map(o => o._id)
      };

      await api.put(`/activities/${activity._id}`, activityPayload);
      onSuccess();
    } catch (error) {
      console.log('Error updating activity', error);
      onError('Failed to update activity.');
    } finally {
      setUploading(false);
    }
  };

  if (!visible || !activity) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent={true} onRequestClose={onClose}>
      <GlobalLoader visible={uploading} />
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { backgroundColor: theme.colors.background, borderColor: theme.colors.border }]}>
          
          <View style={[styles.header, { borderBottomColor: theme.colors.border }]}>
            <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>Edit Activity</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={theme.colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16 }}>
            <Text style={[styles.label, { color: theme.colors.textSecondary }]}>Activity Name</Text>
            <TextInput
              style={[styles.input, { borderColor: theme.colors.border, color: theme.colors.textPrimary }]}
              value={name}
              onChangeText={setName}
            />

            <Text style={[styles.label, { color: theme.colors.textSecondary }]}>Description</Text>
            <TextInput
              style={[styles.input, { borderColor: theme.colors.border, color: theme.colors.textPrimary, height: 80, textAlignVertical: 'top' }]}
              value={description}
              onChangeText={setDescription}
              multiline
            />

            <Text style={[styles.label, { color: theme.colors.textSecondary }]}>Activity Date</Text>
            <TouchableOpacity 
              style={[styles.input, { borderColor: theme.colors.border, justifyContent: 'center' }]} 
              onPress={() => setShowDatePicker(true)}
            >
              <Text style={{ color: theme.colors.textPrimary }}>
                {activityDate.toLocaleDateString()}
              </Text>
            </TouchableOpacity>
            
            {showDatePicker && (
              <DateTimePicker
                value={activityDate}
                mode="date"
                display="default"
                onChange={(evt, selectedDate) => {
                  if (Platform.OS !== 'ios') setShowDatePicker(false);
                  if (selectedDate) setActivityDate(selectedDate);
                }}
              />
            )}

            <Text style={[styles.label, { color: theme.colors.textSecondary }]}>Tag Organizers</Text>
            <TouchableOpacity 
              style={[styles.input, { borderColor: theme.colors.border, minHeight: 48, justifyContent: 'center', paddingVertical: 8 }]} 
              onPress={() => setShowOrganizerModal(true)}
            >
              {selectedOrganizers.length > 0 ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {selectedOrganizers.map(org => (
                    <View key={org._id} style={[styles.eventPill, { backgroundColor: theme.colors.primary + '20', borderColor: theme.colors.primary }]}>
                      <Text style={{ color: theme.colors.primary, fontSize: 13, fontWeight: '600' }}>{org.name}</Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={{ color: theme.colors.placeholder }}>
                  Tag Organizers (Trainers/TLs)
                </Text>
              )}
            </TouchableOpacity>

            <View style={[styles.infoBox, { backgroundColor: theme.colors.surface }]}>
              <Ionicons name="information-circle" size={20} color={theme.colors.textSecondary} style={{ marginRight: 8 }} />
              <Text style={{ color: theme.colors.textSecondary, fontSize: 13, flex: 1 }}>
                To edit images or videos, please delete this activity and create a new one.
              </Text>
            </View>

          </ScrollView>

          <View style={[styles.footer, { borderTopColor: theme.colors.border }]}>
            <TouchableOpacity style={[styles.btn, { backgroundColor: theme.colors.surface }]} onPress={onClose}>
              <Text style={{ color: theme.colors.textPrimary, fontWeight: 'bold' }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, { backgroundColor: theme.colors.primary }]} onPress={handleSubmit} disabled={uploading}>
              {uploading ? <ActivityIndicator color="#FFF" /> : <Text style={{ color: '#FFF', fontWeight: 'bold' }}>Save Changes</Text>}
            </TouchableOpacity>
          </View>
          
        </View>

        <UserMultiSelectModal 
          visible={showOrganizerModal} 
          selectedIds={selectedOrganizers} 
          onSelect={setSelectedOrganizers} 
          onClose={() => setShowOrganizerModal(false)} 
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { borderTopLeftRadius: 20, borderTopRightRadius: 20, height: '80%', borderWidth: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1 },
  headerTitle: { fontSize: 18, fontWeight: 'bold' },
  label: { fontSize: 12, marginBottom: 8, marginTop: 12, fontWeight: '600' },
  input: { padding: 12, borderRadius: 8, borderWidth: 1, marginBottom: 8 },
  eventPill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  infoBox: { flexDirection: 'row', padding: 12, borderRadius: 12, marginTop: 12 },
  footer: { flexDirection: 'row', padding: 16, borderTopWidth: 1, justifyContent: 'space-between' },
  btn: { flex: 1, padding: 14, borderRadius: 12, alignItems: 'center', marginHorizontal: 8 }
});
