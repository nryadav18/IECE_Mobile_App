import React, { useRef, useState, useImperativeHandle, forwardRef, useContext } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TouchableWithoutFeedback, ScrollView, Animated, Modal, Dimensions, Easing
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemeContext } from '../context/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const SCREEN_WIDTH = Dimensions.get('window').width;
const SIDEBAR_WIDTH = Math.min(320, Math.round(SCREEN_WIDTH * 0.82));

/**
 * Reusable slide-in sidebar drawer.
 *
 * Imperative API (via ref): open(), close().
 *
 * Props:
 *  - title, subtitle: drawer header text
 *  - tabs: [{ key, label, icon }]  (optional) rendered under "MENU"
 *  - activeTab, onSelectTab(key): current selection + handler
 *  - actions: [{ label, icon, onPress, danger }] (optional) rendered under "QUICK ACTIONS"
 */
const SidebarMenu = forwardRef(function SidebarMenu(
  { title = 'Menu', subtitle, tabs = [], activeTab, onSelectTab, actions = [] },
  ref
) {
  const { theme } = useContext(ThemeContext);
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);
  const slideAnim = useRef(new Animated.Value(-SIDEBAR_WIDTH)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

  const open = () => {
    // Reset to the closed position before the Modal mounts so the slide
    // animation can play once it is actually on screen (see onShow below).
    slideAnim.setValue(-SIDEBAR_WIDTH);
    backdropAnim.setValue(0);
    setVisible(true);
  };

  const runOpenAnimation = () => {
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(backdropAnim, { toValue: 1, duration: 280, useNativeDriver: true }),
    ]).start();
  };

  const close = (cb) => {
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: -SIDEBAR_WIDTH, duration: 240, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(backdropAnim, { toValue: 0, duration: 240, useNativeDriver: true }),
    ]).start(() => {
      setVisible(false);
      if (typeof cb === 'function') cb();
    });
  };

  useImperativeHandle(ref, () => ({ open, close: () => close() }));

  return (
    <Modal visible={visible} transparent animationType="none" onShow={runOpenAnimation} onRequestClose={() => close()}>
      <View style={styles.root}>
        {/* Dim layer (visual only) */}
        <Animated.View style={[styles.backdrop, { opacity: backdropAnim }]} pointerEvents="none" />

        {/* Full-screen touch catcher: any tap outside the drawer closes it.
            The drawer is rendered AFTER this, so taps on the drawer never
            reach here. */}
        <TouchableWithoutFeedback onPress={() => close()} accessibilityLabel="Close menu">
          <View style={StyleSheet.absoluteFill} />
        </TouchableWithoutFeedback>

        <Animated.View
          style={[
            styles.drawer,
            {
              width: SIDEBAR_WIDTH,
              backgroundColor: theme.colors.surface,
              borderRightColor: theme.colors.border,
              paddingTop: insets.top + 16,
              transform: [{ translateX: slideAnim }],
            },
          ]}
        >
          {/* Drawer header */}
          <View style={[styles.header, { borderBottomColor: theme.colors.border }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
              <Ionicons name="shield-checkmark" size={26} color={theme.colors.primary} />
              <View style={{ marginLeft: 10, flex: 1 }}>
                <Text style={[styles.title, { color: theme.colors.textPrimary }]} numberOfLines={1}>{title}</Text>
                {subtitle ? <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]} numberOfLines={1}>{subtitle}</Text> : null}
              </View>
            </View>
            <TouchableOpacity onPress={() => close()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={24} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 12 }}>
            {tabs.length > 0 && <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>MENU</Text>}
            {tabs.map((tab) => {
              const isActive = activeTab === tab.key;
              return (
                <TouchableOpacity
                  key={tab.key}
                  activeOpacity={0.7}
                  style={[styles.item, isActive && { backgroundColor: theme.colors.primary + '15' }]}
                  onPress={() => close(() => onSelectTab && onSelectTab(tab.key))}
                >
                  <View style={[styles.itemIcon, { backgroundColor: isActive ? theme.colors.primary : theme.colors.background }]}>
                    <Ionicons
                      name={isActive ? tab.icon.replace('-outline', '') || tab.icon : tab.icon}
                      size={18}
                      color={isActive ? '#FFFFFF' : theme.colors.textSecondary}
                    />
                  </View>
                  <Text style={[styles.itemText, { color: isActive ? theme.colors.primary : theme.colors.textPrimary, fontWeight: isActive ? '700' : '500' }]}>
                    {tab.label}
                  </Text>
                  {isActive && <Ionicons name="chevron-forward" size={18} color={theme.colors.primary} style={{ marginLeft: 'auto' }} />}
                </TouchableOpacity>
              );
            })}

            {actions.length > 0 && (
              <>
                {tabs.length > 0 && <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />}
                <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>QUICK ACTIONS</Text>
                {actions.map((action, idx) => {
                  const danger = !!action.danger;
                  const errColor = theme.colors.error || '#FF4444';
                  return (
                    <TouchableOpacity
                      key={`${action.label}-${idx}`}
                      activeOpacity={0.7}
                      style={styles.item}
                      onPress={() => close(() => action.onPress && action.onPress())}
                    >
                      <View style={[styles.itemIcon, { backgroundColor: danger ? errColor + '15' : theme.colors.background }]}>
                        <Ionicons name={action.icon} size={18} color={danger ? errColor : theme.colors.textSecondary} />
                      </View>
                      <Text style={[styles.itemText, { color: danger ? errColor : theme.colors.textPrimary, fontWeight: danger ? '600' : '500' }]}>
                        {action.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </>
            )}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
});

export default SidebarMenu;

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  drawer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    borderRightWidth: 1,
    paddingHorizontal: 12,
    paddingBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 16,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
  },
  title: { fontSize: 18, fontWeight: 'bold' },
  subtitle: { fontSize: 12, marginTop: 1 },
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1, marginHorizontal: 8, marginTop: 12, marginBottom: 6 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 12,
    marginBottom: 2,
  },
  itemIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  itemText: { fontSize: 15 },
  divider: { height: 1, marginVertical: 12, marginHorizontal: 8 },
});

export const SIDEBAR_MENU_WIDTH = SIDEBAR_WIDTH;
