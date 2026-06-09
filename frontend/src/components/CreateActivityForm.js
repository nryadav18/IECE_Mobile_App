import React, { useState, useContext } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Image, Modal, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import DateTimePicker from '@react-native-community/datetimepicker';
import { ThemeContext } from '../context/ThemeContext';
import { AuthContext } from '../context/AuthContext';
import api from '../services/api';
import CustomAlert from './CustomAlert';
import UserMultiSelectModal from './UserMultiSelectModal';
import GlobalLoader from './GlobalLoader';

export default function CreateActivityForm({ onActivityCreated }) {
  const { theme } = useContext(ThemeContext);
  const { user } = useContext(AuthContext);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [activityDate, setActivityDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedOrganizers, setSelectedOrganizers] = useState([]);
  const [showOrganizerModal, setShowOrganizerModal] = useState(false);
  
  const [mediaFiles, setMediaFiles] = useState([]);
  const [uploading, setUploading] = useState(false);

  const [alertConfig, setAlertConfig] = useState({ visible: false, title: '', message: '', type: 'info' });

  const showAlert = (title, message, type = 'info') => {
    setAlertConfig({ visible: true, title, message, type });
  };

  const pickMedia = async () => {
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.8,
      videoMaxDuration: 60,
    });

    if (!result.canceled) {
      const validFiles = result.assets.filter(asset => {
        if (asset.fileSize && asset.fileSize > 20 * 1024 * 1024) {
          showAlert('Warning', `${asset.fileName || 'A file'} exceeds 20MB and was skipped.`, 'warning');
          return false;
        }
        return true;
      });
      setMediaFiles([...mediaFiles, ...validFiles]);
    }
  };

  const removeMedia = (index) => {
    const updated = [...mediaFiles];
    updated.splice(index, 1);
    setMediaFiles(updated);
  };

  const handleSubmit = async () => {
    if (!name || !description || !user.schoolId) {
      return showAlert('Error', 'Name, description, and an assigned school are required.', 'error');
    }
    if (mediaFiles.length === 0) {
      return showAlert('Error', 'Please upload at least one image or video for the thumbnail.', 'error');
    }

    setUploading(true);
    try {
      // 1. Upload media array
      const formData = new FormData();
      mediaFiles.forEach((file, index) => {
        formData.append('files', {
          uri: file.uri,
          type: file.mimeType || (file.type === 'video' ? 'video/mp4' : 'image/jpeg'),
          name: file.fileName || `media_${index}`
        });
      });

      const uploadRes = await api.post('/upload/multiple', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      const mediaUrls = uploadRes.data.urls;

      // 2. Create Activity
      const activityPayload = {
        name,
        description,
        schoolId: user.schoolId,
        activityDate: activityDate.toISOString(),
        mediaUrls,
        organizers: selectedOrganizers.map(o => o._id)
      };

      await api.post('/activities', activityPayload);
      showAlert('Success', 'Activity published successfully!', 'success');
      
      // Reset form
      setName('');
      setDescription('');
      setActivityDate(new Date());
      setSelectedOrganizers([]);
      setMediaFiles([]);
      if (onActivityCreated) onActivityCreated();

    } catch (error) {
      console.log('Error creating activity', error);
      showAlert('Error', 'Failed to publish activity.', 'error');
    } finally {
      setUploading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
      <GlobalLoader visible={uploading} />
      <Text style={[styles.title, { color: theme.colors.textPrimary }]}>Publish New Activity</Text>
      
      <TextInput
        style={[styles.input, { borderColor: theme.colors.border, color: theme.colors.textPrimary }]}
        placeholder="Activity Name"
        placeholderTextColor={theme.colors.placeholder}
        value={name}
        onChangeText={setName}
      />

      <TextInput
        style={[styles.input, { borderColor: theme.colors.border, color: theme.colors.textPrimary, height: 80, textAlignVertical: 'top' }]}
        placeholder="Description"
        placeholderTextColor={theme.colors.placeholder}
        value={description}
        onChangeText={setDescription}
        multiline
      />

      {/* Date Picker */}
      <TouchableOpacity 
        style={[styles.input, { borderColor: theme.colors.border, justifyContent: 'center' }]} 
        onPress={() => setShowDatePicker(true)}
      >
        <Text style={{ color: theme.colors.textPrimary }}>
          Date: {activityDate.toLocaleDateString()}
        </Text>
      </TouchableOpacity>
      {showDatePicker && (
        <DateTimePicker
          value={activityDate}
          mode="date"
          display="default"
          onChange={(event, selectedDate) => {
            if (Platform.OS !== 'ios') {
              setShowDatePicker(false);
            }
            if (selectedDate) setActivityDate(selectedDate);
          }}
        />
      )}

      {/* Organizers Multi-Select */}
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

      {/* Media Picker */}
      <TouchableOpacity style={[styles.uploadBtn, { borderColor: theme.colors.primary }]} onPress={pickMedia}>
        <Ionicons name="images-outline" size={24} color={theme.colors.primary} />
        <Text style={[styles.uploadBtnText, { color: theme.colors.primary }]}>Add Photos / Videos (Max 20MB)</Text>
      </TouchableOpacity>

      {/* Media Previews */}
      {mediaFiles.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.previewContainer}>
          {mediaFiles.map((file, index) => (
            <View key={index.toString()} style={styles.previewItem}>
              <Image source={{ uri: file.uri }} style={styles.previewImage} />
              {file.type === 'video' && (
                <View style={styles.videoOverlay}>
                  <Ionicons name="play-circle-outline" size={24} color="#FFF" />
                </View>
              )}
              <TouchableOpacity style={styles.removeBtn} onPress={() => removeMedia(index)}>
                <Ionicons name="close-circle" size={24} color="#FF4444" />
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}

      {/* Submit Button */}
      <TouchableOpacity 
        style={[styles.submitBtn, { backgroundColor: theme.colors.primary, opacity: uploading ? 0.7 : 1 }]} 
        onPress={handleSubmit}
        disabled={uploading}
      >
        {uploading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.submitBtnText}>Publish Activity</Text>}
      </TouchableOpacity>

      <UserMultiSelectModal 
        visible={showOrganizerModal} 
        selectedIds={selectedOrganizers} 
        onSelect={setSelectedOrganizers} 
        onClose={() => setShowOrganizerModal(false)} 
      />

      <CustomAlert 
        visible={alertConfig.visible}
        title={alertConfig.title}
        message={alertConfig.message}
        type={alertConfig.type}
        onDismiss={() => setAlertConfig({ ...alertConfig, visible: false })}
      />

      {/* Uploading Overlay Modal */}
      {uploading && (
        <Modal transparent={true} visible={uploading} animationType="fade">
          <View style={styles.loadingOverlay}>
            <View style={[styles.loadingBox, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
              <ActivityIndicator size="large" color={theme.colors.primary} style={{ marginBottom: 16 }} />
              <Text style={{ color: theme.colors.textPrimary, fontWeight: 'bold', fontSize: 16, marginBottom: 4 }}>
                Uploading Media...
              </Text>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 13, textAlign: 'center' }}>
                Please wait while your media is being processed. This may take a moment for videos.
              </Text>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, borderRadius: 16, borderWidth: 1, marginBottom: 20 },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 16 },
  input: { padding: 12, borderRadius: 8, borderWidth: 1, marginBottom: 12 },
  uploadBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 12, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', marginBottom: 12 },
  uploadBtnText: { marginLeft: 8, fontWeight: '600' },
  previewContainer: { flexDirection: 'row', marginBottom: 16 },
  previewItem: { width: 160, height: 90, marginRight: 12, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: '#ccc' },
  previewImage: { width: '100%', height: '100%', resizeMode: 'cover' },
  videoOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', alignItems: 'center' },
  removeBtn: { position: 'absolute', top: 4, right: 4 },
  submitBtn: { padding: 14, borderRadius: 8, alignItems: 'center' },
  submitBtnText: { color: '#FFF', fontWeight: 'bold', fontSize: 16 },
  eventPill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  loadingOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  loadingBox: { width: '80%', padding: 24, borderRadius: 16, borderWidth: 1, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 10, elevation: 5 }
});
