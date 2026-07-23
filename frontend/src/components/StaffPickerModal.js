import React, { useContext } from 'react';
import { View, Text, TouchableOpacity, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemeContext } from '../context/ThemeContext';
import StaffSearchList from './StaffSearchList';

/**
 * Bottom-sheet modal that wraps StaffSearchList — used by CEO/Admin to pick a
 * substitute from the candidate pool.
 *
 * Props: visible, title, fetcher, selectedId, onSelect(user), onClose()
 */
export default function StaffPickerModal({ visible, title = 'Select a person', fetcher, selectedId, onSelect, onClose }) {
  const { theme } = useContext(ThemeContext);
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
        <View
          style={{
            height: '88%',
            backgroundColor: theme.colors.background,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            paddingHorizontal: 16,
            paddingTop: 8,
            paddingBottom: insets.bottom,
          }}
        >
          {/* Grabber */}
          <View style={{ alignItems: 'center', paddingVertical: 8 }}>
            <View style={{ width: 42, height: 5, borderRadius: 3, backgroundColor: theme.colors.border }} />
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <Text style={{ color: theme.colors.textPrimary, fontSize: 18, fontWeight: '700' }}>{title}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={24} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {visible && (
            <StaffSearchList
              fetcher={fetcher}
              selectedId={selectedId}
              onSelect={(u) => {
                onSelect(u);
                onClose();
              }}
              placeholder="Search staff…"
              emptyText="No candidates found."
            />
          )}
        </View>
      </View>
    </Modal>
  );
}
