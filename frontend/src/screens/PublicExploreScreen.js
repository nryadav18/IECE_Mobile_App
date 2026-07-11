import React, { useContext } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Linking,
  Dimensions,
} from 'react-native';
import { ThemeContext } from '../context/ThemeContext';
import { MotiView } from 'moti';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

const { width } = Dimensions.get('window');

// Publicly available information about IECE. This screen is reachable by ANY
// user without an account ("guest access"), so the app offers real, usable
// content to the general public in addition to the member portals behind login.
const PROGRAMS = [
  { icon: 'chatbubbles-outline', title: 'Communication Skills', desc: 'Spoken English, public speaking and confident self-expression.' },
  { icon: 'language-outline', title: 'Language Training', desc: 'Structured language programs for students and professionals.' },
  { icon: 'sparkles-outline', title: 'Soft Skills', desc: 'Interpersonal skills, professional etiquette and workplace readiness.' },
  { icon: 'people-outline', title: 'Team Dynamics', desc: 'Collaboration, teamwork and group problem-solving.' },
  { icon: 'trophy-outline', title: 'Leadership', desc: 'Leadership development and decision-making programs.' },
  { icon: 'heart-outline', title: 'Life Skills', desc: 'Life skills, values and personality development.' },
];

const HIGHLIGHTS = [
  { icon: 'school-outline', value: 'Academic', label: 'Institution programs across India' },
  { icon: 'business-outline', value: 'Corporate', label: 'Customized training for firms' },
  { icon: 'ribbon-outline', value: 'Trainers', label: 'Experienced, certified faculty' },
];

export default function PublicExploreScreen({ navigation }) {
  const { theme, isDarkMode, toggleTheme } = useContext(ThemeContext);
  const insets = useSafeAreaInsets();

  const logoSource = isDarkMode
    ? require('../../assets/IECE_Logo_White.png')
    : require('../../assets/IECE_Logo.png');

  const open = (url) => Linking.openURL(url).catch(() => {});

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity
          onPress={toggleTheme}
          style={[styles.iconBtn, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
          activeOpacity={0.8}
        >
          <Ionicons
            name={isDarkMode ? 'sunny-outline' : 'moon-outline'}
            size={20}
            color={theme.colors.textPrimary}
          />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => navigation.navigate('Login')}
          style={[styles.signInPill, { backgroundColor: theme.colors.primary }]}
          activeOpacity={0.85}
        >
          <Ionicons name="log-in-outline" size={16} color="#FFFFFF" />
          <Text style={styles.signInPillText}>Member Sign In</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 40, paddingHorizontal: 20 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <MotiView
          from={{ opacity: 0, translateY: -12 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 500 }}
          style={styles.hero}
        >
          <Image source={logoSource} style={styles.logo} resizeMode="contain" />
          <Text style={[styles.heroSub, { color: theme.colors.textSecondary }]}>
            Empowering Education Professionals
          </Text>
          <Text style={[styles.heroBody, { color: theme.colors.textPrimary }]}>
            IECE is a premier training organization delivering academic and corporate
            programs for institutions and firms across India — in communication, soft
            skills, leadership and life skills.
          </Text>
        </MotiView>

        {/* Highlights */}
        <View style={styles.highlightRow}>
          {HIGHLIGHTS.map((h) => (
            <View
              key={h.value}
              style={[styles.highlightCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
            >
              <Ionicons name={h.icon} size={22} color={theme.colors.primary} />
              <Text style={[styles.highlightValue, { color: theme.colors.textPrimary }]}>{h.value}</Text>
              <Text style={[styles.highlightLabel, { color: theme.colors.textSecondary }]}>{h.label}</Text>
            </View>
          ))}
        </View>

        {/* Programs */}
        <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}>Our Training Programs</Text>
        {PROGRAMS.map((p, i) => (
          <MotiView
            key={p.title}
            from={{ opacity: 0, translateX: -10 }}
            animate={{ opacity: 1, translateX: 0 }}
            transition={{ type: 'timing', duration: 300, delay: i * 60 }}
            style={[styles.programCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
          >
            <View style={[styles.programIcon, { backgroundColor: theme.colors.primary + '14' }]}>
              <Ionicons name={p.icon} size={22} color={theme.colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.programTitle, { color: theme.colors.textPrimary }]}>{p.title}</Text>
              <Text style={[styles.programDesc, { color: theme.colors.textSecondary }]}>{p.desc}</Text>
            </View>
          </MotiView>
        ))}

        {/* Contact */}
        <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}>Get in Touch</Text>
        <View style={[styles.contactCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
          <TouchableOpacity style={styles.contactRow} onPress={() => open('https://www.iece.org.in')} activeOpacity={0.7}>
            <Ionicons name="globe-outline" size={20} color={theme.colors.primary} />
            <Text style={[styles.contactText, { color: theme.colors.textPrimary }]}>www.iece.org.in</Text>
            <Ionicons name="open-outline" size={16} color={theme.colors.textSecondary} />
          </TouchableOpacity>
          <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
          <TouchableOpacity style={styles.contactRow} onPress={() => open('mailto:admin@iece.org.in')} activeOpacity={0.7}>
            <Ionicons name="mail-outline" size={20} color={theme.colors.primary} />
            <Text style={[styles.contactText, { color: theme.colors.textPrimary }]}>admin@iece.org.in</Text>
            <Ionicons name="open-outline" size={16} color={theme.colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* CTA */}
        <TouchableOpacity
          onPress={() => navigation.navigate('Login')}
          style={[styles.ctaButton, { backgroundColor: theme.colors.primary }]}
          activeOpacity={0.85}
        >
          <Text style={styles.ctaText}>Member Sign In</Text>
          <Ionicons name="arrow-forward-outline" size={18} color="#FFFFFF" style={{ marginLeft: 6 }} />
        </TouchableOpacity>
        <Text style={[styles.footNote, { color: theme.colors.textSecondary }]}>
          Browsing as a guest. Sign in is only required for IECE staff portals.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  signInPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    height: 40,
    borderRadius: 20,
  },
  signInPillText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13, marginLeft: 6 },
  hero: { alignItems: 'center', marginTop: 8, marginBottom: 24 },
  logo: { width: width * 0.5, height: 90, aspectRatio: 2.5 },
  heroSub: { fontSize: 13, marginTop: 8, fontWeight: '500', letterSpacing: 0.3 },
  heroBody: { fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 14 },
  highlightRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  highlightCard: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 16,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  highlightValue: { fontSize: 15, fontWeight: '800', marginTop: 8 },
  highlightLabel: { fontSize: 10.5, textAlign: 'center', marginTop: 4, lineHeight: 14 },
  sectionTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3, marginBottom: 14, marginTop: 4 },
  programCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  programIcon: {
    width: 46,
    height: 46,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  programTitle: { fontSize: 15, fontWeight: '700' },
  programDesc: { fontSize: 12.5, lineHeight: 18, marginTop: 3 },
  contactCard: { borderRadius: 16, borderWidth: 1, paddingHorizontal: 16, marginBottom: 24 },
  contactRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16 },
  contactText: { flex: 1, fontSize: 14, fontWeight: '600', marginLeft: 12 },
  divider: { height: 1, width: '100%' },
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 14,
    marginTop: 4,
  },
  ctaText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700', letterSpacing: 0.2 },
  footNote: { fontSize: 12, textAlign: 'center', marginTop: 14, lineHeight: 17 },
});
