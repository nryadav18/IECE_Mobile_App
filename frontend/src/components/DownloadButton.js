import React, { useContext, useState } from 'react';
import { TouchableOpacity, Text, ActivityIndicator, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemeContext } from '../context/ThemeContext';
import { AuthContext } from '../context/AuthContext';
import { useAlert } from '../context/AlertContext';
import { downloadFile, isMedia } from '../utils/download';

/**
 * Save-to-device button for any file the app displays.
 *
 * Renders NOTHING for anyone but the Admin and the CEO — the capability is
 * theirs alone, so gating it here means a screen can drop this in wherever a
 * file appears without repeating the role check (and without a half-second
 * flash of a button other users must not press).
 *
 * Props:
 *  - url        the remote file (image, video, PDF, document — anything)
 *  - filename   optional preferred name; derived from the URL otherwise
 *  - variant    'button' (default) | 'icon'  — icon suits media overlays
 *  - label      override the button text
 *  - style      extra style for the touchable
 */
export default function DownloadButton({ url, filename, variant = 'button', label, style }) {
  const { theme } = useContext(ThemeContext);
  const { user } = useContext(AuthContext);
  const { showAlert } = useAlert();
  const [busy, setBusy] = useState(false);

  const allowed = user?.role === 'creator_admin' || user?.role === 'ceo';
  if (!allowed || !url) return null;

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await downloadFile(url, { filename });
      showAlert(res.ok ? 'Saved' : 'Could not save', res.message, res.ok ? 'success' : 'error');
    } finally {
      setBusy(false);
    }
  };

  if (variant === 'icon') {
    return (
      <TouchableOpacity
        onPress={run}
        disabled={busy}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        style={[
          {
            width: 40, height: 40, borderRadius: 20,
            alignItems: 'center', justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.55)',
          },
          style,
        ]}
      >
        {busy
          ? <ActivityIndicator size="small" color="#fff" />
          : <Ionicons name="download-outline" size={20} color="#fff" />}
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      onPress={run}
      disabled={busy}
      activeOpacity={0.8}
      style={[
        {
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
          borderWidth: 1, borderColor: theme.colors.primary,
          backgroundColor: theme.colors.primary + '12',
          borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16,
          opacity: busy ? 0.6 : 1,
        },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={theme.colors.primary} />
      ) : (
        <Ionicons name="download-outline" size={17} color={theme.colors.primary} />
      )}
      <Text style={{ color: theme.colors.primary, fontWeight: '700', fontSize: 14, marginLeft: 8 }}>
        {busy ? 'Saving…' : (label || (isMedia(url) ? 'Save to Gallery' : 'Download File'))}
      </Text>
    </TouchableOpacity>
  );
}

/** Small row wrapper when several files can be downloaded together. */
export function DownloadRow({ children, style }) {
  return (
    <View style={[{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, style]}>{children}</View>
  );
}
