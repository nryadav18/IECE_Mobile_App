import React, { useState, useContext, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Modal, Keyboard, Platform, Dimensions, TextInput } from 'react-native';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { ThemeContext } from '../context/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { height } = Dimensions.get('window');

export default function CustomDropdown({ label, data, selectedValue, onSelect, placeholder = "Select an option", keyExtractor = (item) => item._id, labelExtractor = (item) => item.name }) {
  const { theme } = useContext(ThemeContext);
  const insets = useSafeAreaInsets();
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvt, (e) => setKeyboardHeight(e.endCoordinates?.height || 0));
    const hideSub = Keyboard.addListener(hideEvt, () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const toggleDropdown = () => {
    setIsOpen(!isOpen);
    setSearchQuery('');
  };

  const handleSelect = (item) => {
    onSelect(item);
    setIsOpen(false);
  };

  const selectedItem = data.find(item => keyExtractor(item) === selectedValue);

  return (
    <View style={styles.container}>
      {label && <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{label}</Text>}
      
      <TouchableOpacity 
        style={[styles.dropdownHeader, { borderColor: theme.colors.border, backgroundColor: theme.colors.background }]} 
        onPress={toggleDropdown}
        activeOpacity={0.7}
      >
        <Text style={[styles.selectedText, { color: selectedItem ? theme.colors.textPrimary : theme.colors.placeholder }]}>
          {selectedItem ? labelExtractor(selectedItem) : placeholder}
        </Text>
        <MotiView
          animate={{ rotate: isOpen ? '180deg' : '0deg' }}
          transition={{ type: 'timing', duration: 300 }}
        >
          <Ionicons name="chevron-down" size={20} color={theme.colors.textSecondary} />
        </MotiView>
      </TouchableOpacity>

      <Modal visible={isOpen} transparent animationType="slide" onRequestClose={() => setIsOpen(false)}>
        {/* Overlay padded by the keyboard height so the sheet always rests
            directly above the keyboard. The sheet itself is a fixed-height box
            with the search pinned at top and the list scrolling inside it. */}
        <View style={[styles.modalOverlay, { paddingBottom: keyboardHeight }]}>
          <View
            style={[
              styles.modalContainer,
              {
                backgroundColor: theme.colors.background,
                height: Math.min(height * 0.6, height - keyboardHeight - insets.top - 20),
              },
            ]}
          >
            <View style={[styles.modalHeader, { borderBottomColor: theme.colors.border }]}>
              <Text style={[styles.modalTitle, { color: theme.colors.textPrimary }]}>{label || 'Select Option'}</Text>
              <TouchableOpacity onPress={() => setIsOpen(false)} style={styles.closeBtn}>
                <Ionicons name="close" size={24} color={theme.colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <View style={styles.searchContainer}>
              <View style={[styles.searchInputWrapper, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                <Ionicons name="search" size={18} color={theme.colors.textSecondary} style={styles.searchIcon} />
                <TextInput
                  style={[styles.searchInput, { color: theme.colors.textPrimary }]}
                  placeholder="Search..."
                  placeholderTextColor={theme.colors.placeholder}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  autoCapitalize="none"
                />
              </View>
            </View>

            <ScrollView
              style={styles.list}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={true}
              bounces={false}
            >
              {(() => {
                const filteredData = data.filter(item => labelExtractor(item).toLowerCase().includes(searchQuery.toLowerCase()));
                if (filteredData.length === 0) {
                  return (
                    <View style={styles.emptyContainer}>
                      <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>No options available</Text>
                    </View>
                  );
                }
                return filteredData.map((item, index) => {
                  const isSelected = keyExtractor(item) === selectedValue;
                  return (
                    <TouchableOpacity
                      key={keyExtractor(item)}
                      style={[
                        styles.dropdownItem, 
                        { borderBottomColor: theme.colors.border },
                        isSelected && { backgroundColor: theme.colors.primary + '15', borderColor: theme.colors.primary, borderWidth: 1 }
                      ]}
                      onPress={() => handleSelect(item)}
                    >
                      <Text style={[styles.itemText, { color: isSelected ? theme.colors.primary : theme.colors.textPrimary, fontWeight: isSelected ? '700' : '500' }]}>
                        {labelExtractor(item)}
                      </Text>
                      {isSelected && <Ionicons name="checkmark-circle" size={22} color={theme.colors.primary} />}
                    </TouchableOpacity>
                  );
                });
              })()}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    marginBottom: 8,
    fontWeight: '600',
  },
  dropdownHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
  },
  selectedText: {
    fontSize: 14,
  },
  modalOverlay: { 
    flex: 1, 
    backgroundColor: 'rgba(0,0,0,0.5)', 
    justifyContent: 'flex-end' 
  },
  modalContainer: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden'
  },
  list: {
    flex: 1,
  },
  modalHeader: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    padding: 20, 
    borderBottomWidth: 1 
  },
  modalTitle: { 
    fontSize: 18, 
    fontWeight: 'bold', 
    textTransform: 'capitalize' 
  },
  closeBtn: { 
    padding: 4 
  },
  searchContainer: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  searchInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },
  dropdownItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'transparent',
    borderBottomColor: '#eee', // fallback, overridden in inline style
    marginBottom: 8,
  },
  itemText: {
    fontSize: 15,
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 15,
    fontWeight: '500',
  }
});
