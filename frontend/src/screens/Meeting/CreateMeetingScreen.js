import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Platform, KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemeContext } from '../../context/ThemeContext';
import { useAlert } from '../../context/AlertContext';
import { roleLabel } from '../../utils/roles';
import Avatar from '../../components/Avatar';
import MeetingPlatformBadge from '../../components/MeetingPlatformBadge';
import { SkeletonList } from '../../components/Skeleton';
import { detectPlatform, isValidMeetingLink } from '../../utils/meetingPlatform';
import { getMeetingRecipients, createMeeting, meetingError } from '../../services/meeting';

export default function CreateMeetingScreen({ navigation }) {
  const { theme } = useContext(ThemeContext);
  const { showAlert } = useAlert();
  const insets = useSafeAreaInsets();

  const [link, setLink] = useState('');
  const [agenda, setAgenda] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [loadingRecipients, setLoadingRecipients] = useState(true);
  const [selected, setSelected] = useState({}); // { [id]: true }
  const [search, setSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const platform = useMemo(() => detectPlatform(link), [link]);
  const myTeamIds = useMemo(() => candidates.filter((c) => c.isMyTeam).map((c) => String(c._id)), [candidates]);
  const selectedCount = useMemo(() => Object.values(selected).filter(Boolean).length, [selected]);

  const loadRecipients = useCallback(async () => {
    setLoadingRecipients(true);
    try {
      const res = await getMeetingRecipients();
      setCandidates(res?.data || []);
    } catch (e) {
      showAlert('Error', meetingError(e), 'error');
    } finally {
      setLoadingRecipients(false);
    }
  }, []);

  useEffect(() => {
    loadRecipients();
  }, [loadRecipients]);

  const toggle = (id) => setSelected((prev) => ({ ...prev, [id]: !prev[String(id)] }));

  const selectAll = () => {
    const all = {};
    candidates.forEach((c) => { all[String(c._id)] = true; });
    setSelected(all);
  };
  const selectMyTeam = () => {
    setSelected((prev) => {
      const next = { ...prev };
      myTeamIds.forEach((id) => { next[id] = true; });
      return next;
    });
  };
  const clearAll = () => setSelected({});

  const allSelected = candidates.length > 0 && selectedCount === candidates.length;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((c) => (c.name || '').toLowerCase().includes(q));
  }, [candidates, search]);

  const submit = async () => {
    if (!link.trim() || !isValidMeetingLink(link)) {
      showAlert('Invalid link', 'Please paste a valid meeting link.', 'warning');
      return;
    }
    if (!agenda.trim()) {
      showAlert('Agenda required', 'Please enter the meeting agenda.', 'warning');
      return;
    }
    const recipientIds = Object.keys(selected).filter((id) => selected[id]);
    if (recipientIds.length === 0) {
      showAlert('Select recipients', 'Please choose at least one person to share this meeting with.', 'warning');
      return;
    }
    setSubmitting(true);
    try {
      await createMeeting({ link: link.trim(), agenda: agenda.trim(), recipientIds });
      showAlert('Meeting Shared', 'Your meeting link has been posted and the selected people have been notified.', 'success', [
        { text: 'Done', onPress: () => navigation.goBack() },
      ]);
    } catch (e) {
      showAlert('Could not share', meetingError(e), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const Chip = ({ label, icon, active, onPress }) => (
    <TouchableOpacity
      onPress={onPress}
      style={{
        flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
        backgroundColor: active ? theme.colors.primary : theme.colors.surface,
        borderWidth: 1, borderColor: active ? theme.colors.primary : theme.colors.border, marginRight: 8,
      }}
    >
      <Ionicons name={icon} size={14} color={active ? '#fff' : theme.colors.textSecondary} />
      <Text style={{ color: active ? '#fff' : theme.colors.textPrimary, fontWeight: '600', fontSize: 12.5, marginLeft: 5 }}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      {/* Header */}
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.border, flexDirection: 'row', alignItems: 'center' }}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={{ color: theme.colors.textPrimary, fontSize: 19, fontWeight: '700', marginLeft: 12 }}>Post Meeting Link</Text>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={insets.top + 60}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 30 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {/* Link */}
          <Text style={styles.label(theme)}>Meeting link <Text style={{ color: '#F44336' }}>*</Text></Text>
          <TextInput
            style={styles.input(theme)}
            value={link}
            onChangeText={setLink}
            placeholder="Paste your Google Meet / Zoom / Teams link"
            placeholderTextColor={theme.colors.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          {/* Live platform preview */}
          {!!link.trim() && (
            <View style={{ marginTop: 12, marginBottom: 4, flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginRight: 10 }}>Detected:</Text>
              <MeetingPlatformBadge platform={platform} size="sm" />
            </View>
          )}

          {/* Agenda */}
          <Text style={[styles.label(theme), { marginTop: 20 }]}>Meeting agenda <Text style={{ color: '#F44336' }}>*</Text></Text>
          <TextInput
            style={[styles.input(theme), { minHeight: 90, textAlignVertical: 'top' }]}
            value={agenda}
            onChangeText={setAgenda}
            placeholder="What is this meeting about? (required)"
            placeholderTextColor={theme.colors.placeholder}
            multiline
          />

          {/* Recipients */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 22, marginBottom: 10 }}>
            <Text style={styles.label(theme)}>Share with <Text style={{ color: '#F44336' }}>*</Text></Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>{selectedCount} selected</Text>
          </View>

          {/* Quick selects */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12 }}>
            <Chip label={allSelected ? 'All selected' : 'All'} icon="people" active={allSelected} onPress={selectAll} />
            {myTeamIds.length > 0 && <Chip label="My Team" icon="git-network-outline" active={false} onPress={selectMyTeam} />}
            {selectedCount > 0 && <Chip label="Clear" icon="close" active={false} onPress={clearAll} />}
          </View>

          {/* Search */}
          {!loadingRecipients && candidates.length > 6 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, paddingHorizontal: 12, marginBottom: 12 }}>
              <Ionicons name="search" size={16} color={theme.colors.textSecondary} />
              <TextInput
                style={{ flex: 1, paddingVertical: 10, paddingHorizontal: 8, color: theme.colors.textPrimary }}
                value={search}
                onChangeText={setSearch}
                placeholder="Search people…"
                placeholderTextColor={theme.colors.placeholder}
              />
            </View>
          )}

          {/* Candidate list */}
          {loadingRecipients ? (
            <SkeletonList count={5} avatar lines={1} />
          ) : (
            filtered.map((c) => {
              const on = !!selected[String(c._id)];
              return (
                <TouchableOpacity
                  key={c._id}
                  activeOpacity={0.7}
                  onPress={() => toggle(String(c._id))}
                  style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, marginBottom: 8, backgroundColor: on ? theme.colors.primary + '10' : theme.colors.surface, borderColor: on ? theme.colors.primary : theme.colors.border }}
                >
                  <Avatar name={c.name} size={38} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={{ color: theme.colors.textPrimary, fontWeight: '600', fontSize: 14 }} numberOfLines={1}>{c.name}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 1 }}>
                      <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>{roleLabel(c.role)}</Text>
                      {c.isMyTeam && (
                        <View style={{ marginLeft: 8, backgroundColor: theme.colors.primary + '18', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 }}>
                          <Text style={{ color: theme.colors.primary, fontSize: 10, fontWeight: '700' }}>MY TEAM</Text>
                        </View>
                      )}
                    </View>
                  </View>
                  <Ionicons
                    name={on ? 'checkmark-circle' : 'ellipse-outline'}
                    size={22}
                    color={on ? theme.colors.primary : theme.colors.border}
                  />
                </TouchableOpacity>
              );
            })
          )}
          {!loadingRecipients && filtered.length === 0 && (
            <Text style={{ color: theme.colors.textSecondary, fontSize: 13, textAlign: 'center', marginTop: 12 }}>No people found.</Text>
          )}
        </ScrollView>

        {/* Post bar */}
        <View style={{ padding: 16, paddingBottom: insets.bottom + 12, backgroundColor: theme.colors.surface, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
          <TouchableOpacity
            style={{ backgroundColor: theme.colors.primary, borderRadius: 12, paddingVertical: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', opacity: submitting ? 0.6 : 1 }}
            onPress={submit}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="send" size={18} color="#fff" />
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15, marginLeft: 8 }}>
                  Share Meeting{selectedCount > 0 ? ` (${selectedCount})` : ''}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = {
  label: (theme) => ({ color: theme.colors.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 6 }),
  input: (theme) => ({ borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 14, color: theme.colors.textPrimary, backgroundColor: theme.colors.surface, fontSize: 14 }),
};
