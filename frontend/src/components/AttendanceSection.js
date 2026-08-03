import React, { useCallback, useContext, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Calendar } from 'react-native-calendars';
import { ThemeContext } from '../context/ThemeContext';
import api from '../services/api';
import CalendarLegend from './CalendarLegend';
import { isOffToday } from '../utils/holiday';
import { buildCalendarMarks } from '../utils/calendarColors';
import { deriveAttendanceActions, findTodayAttendance } from '../utils/attendanceActions';

/**
 * The complete facial-attendance experience for one person: pick a school,
 * register your face there, check in / check out, and see your month.
 *
 * EVERYONE who works under IECE gets exactly this — trainers, (trainee) team
 * leaders, and zonal / cluster / regional heads. Only the Admin, the CEO and the
 * school (chairman) login are outside it, because they do not mark attendance.
 *
 * It owns its own data so a portal only has to drop it into a tab. All the
 * decisions it renders come from shared helpers (`deriveAttendanceActions` for
 * the buttons, `buildCalendarMarks` for the colours), so every portal showing
 * this behaves identically by construction rather than by careful copying.
 */
export default function AttendanceSection({ navigation }) {
  const { theme } = useContext(ThemeContext);

  const [mySchools, setMySchools] = useState([]);        // schools assigned to me
  const [faceRegs, setFaceRegs] = useState([]);          // per-school face registrations
  const [selectedSchoolId, setSelectedSchoolId] = useState(null);
  const [attendanceRecords, setAttendanceRecords] = useState([]);
  const [substitutionLeaves, setSubstitutionLeaves] = useState([]);
  const [substitutionDuties, setSubstitutionDuties] = useState([]);
  const [leaveDays, setLeaveDays] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const loadSchoolsAndFaces = async () => {
    try {
      const res = await api.get('/auth/me');
      const d = res.data.data || {};

      // Multi-school is the source of truth; fall back to the legacy single
      // school for anyone not migrated yet.
      const schools = Array.isArray(d.schoolIds) && d.schoolIds.length
        ? d.schoolIds.filter(Boolean)
        : (d.schoolId && typeof d.schoolId === 'object' ? [d.schoolId] : []);
      setMySchools(schools);
      setFaceRegs(Array.isArray(d.faceRegistrations) ? d.faceRegistrations : []);

      // Keep the current pick if it is still valid, otherwise default to the
      // first assigned school so attendance is usable the moment one is given.
      setSelectedSchoolId((prev) => {
        const stillValid = prev && schools.some((s) => String(s._id) === String(prev));
        return stillValid ? prev : (schools[0]?._id || null);
      });
    } catch (e) {
      console.log('AttendanceSection: could not load schools/face status', e?.response?.status);
    }
  };

  const loadAttendance = async () => {
    try {
      const res = await api.get('/attendance/my-attendance');
      setAttendanceRecords(res.data.data || []);
      setSubstitutionLeaves(res.data.substitutionLeaves || []);
      setSubstitutionDuties(res.data.substitutionDuties || []);
      setLeaveDays(res.data.leaveDays || []);
    } catch (e) {
      console.log('AttendanceSection: could not load attendance', e?.response?.status);
    }
  };

  const loadHolidays = async () => {
    try {
      const res = await api.get('/holidays');
      setHolidays(res.data.data || []);
    } catch (e) {
      console.log('AttendanceSection: could not load holidays', e?.response?.status);
    }
  };

  // Refresh on focus so returning from the camera shows the new state at once.
  useFocusEffect(
    useCallback(() => {
      Promise.all([loadSchoolsAndFaces(), loadAttendance(), loadHolidays()])
        .finally(() => setLoaded(true));
    }, [])
  );

  const isHolidayToday = isOffToday(holidays);
  const todayAtt = findTodayAttendance(attendanceRecords);

  const selSchool = mySchools.find((s) => String(s._id) === String(selectedSchoolId));
  const schoolName = selSchool?.name || 'this school';
  const reg = faceRegs.find((r) => String(r.schoolId?._id || r.schoolId) === String(selectedSchoolId));
  const regStatus = reg?.status || 'none';

  const act = deriveAttendanceActions({
    todayAttendance: todayAtt,
    selectedSchoolId,
    regStatus,
    isHolidayToday,
  });

  const markedDates = buildCalendarMarks({
    attendance: attendanceRecords,
    holidays,
    leaveDays,
    substitutionLeaves,
    substitutionDuties,
    todayMark: {
      customStyles: {
        container: { backgroundColor: '#E0E0E0', borderRadius: 8, borderWidth: 2, borderColor: theme.colors.primary },
        text: { color: theme.colors.textPrimary, fontWeight: 'bold' },
      },
    },
  });

  return (
    <View>
      {/* School picker — only worth showing when there is a choice to make. */}
      {mySchools.length > 1 && (
        <View style={{ marginBottom: 14 }}>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 8 }}>
            Select School for Attendance
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {mySchools.map((s) => {
              const sel = String(s._id) === String(selectedSchoolId);
              return (
                <TouchableOpacity
                  key={s._id}
                  onPress={() => setSelectedSchoolId(s._id)}
                  style={{
                    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, marginRight: 8,
                    backgroundColor: sel ? theme.colors.primary : theme.colors.surface,
                    borderColor: sel ? theme.colors.primary : theme.colors.border,
                  }}
                >
                  <Text style={{ color: sel ? '#fff' : theme.colors.textPrimary, fontWeight: '600', fontSize: 13 }}>
                    {s.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Actions for the selected school */}
      {!selectedSchoolId ? (
        <View style={{ backgroundColor: theme.colors.surface, borderRadius: 10, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: theme.colors.border }}>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 13, fontWeight: '600' }}>
            {loaded
              ? 'No school assigned yet. Once the admin assigns you a school, attendance appears here.'
              : 'Loading your schools…'}
          </Text>
        </View>
      ) : (
        <View style={{ marginBottom: 12 }}>
          {regStatus === 'none' && (
            <TouchableOpacity
              style={[styles.actionBtn, { borderColor: theme.colors.primary, backgroundColor: theme.colors.primary + '10' }]}
              onPress={() => navigation.navigate('FaceRegistration', { schoolId: selectedSchoolId, schoolName })}
            >
              <Ionicons name="scan-outline" size={20} color={theme.colors.primary} />
              <Text style={{ color: theme.colors.primary, fontSize: 13, marginLeft: 6, fontWeight: '600' }}>
                Register Face for {schoolName}
              </Text>
            </TouchableOpacity>
          )}

          {regStatus === 'pending' && (
            <View style={[styles.actionBtn, { borderColor: '#F59E0B', backgroundColor: '#FEF3C7' }]}>
              <Ionicons name="hourglass-outline" size={20} color="#D97706" />
              <Text style={{ color: '#D97706', fontSize: 13, marginLeft: 6, fontWeight: '700' }}>
                Pending Approval — {schoolName}
              </Text>
            </View>
          )}

          {regStatus === 'approved' && (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                style={[styles.actionBtn, { flex: 1, borderColor: '#4CAF50', backgroundColor: '#4CAF5010', opacity: act.canCheckIn ? 1 : 0.5 }]}
                onPress={() => navigation.navigate('Attendance', { intent: 'login', schoolId: selectedSchoolId, schoolName })}
                disabled={!act.canCheckIn}
              >
                <Ionicons name={act.checkedInHere ? 'checkmark-done-outline' : 'log-in-outline'} size={20} color="#4CAF50" />
                <Text style={{ color: '#4CAF50', fontSize: 13, marginLeft: 6, fontWeight: '600' }}>{act.checkInLabel}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionBtn, { flex: 1, borderColor: '#F44336', backgroundColor: '#F4433610', opacity: act.canCheckOut ? 1 : 0.5 }]}
                onPress={() => navigation.navigate('Attendance', { intent: 'logout', schoolId: selectedSchoolId, schoolName })}
                disabled={!act.canCheckOut}
              >
                <Ionicons name={act.checkedOutToday ? 'checkmark-done-outline' : 'log-out-outline'} size={20} color="#F44336" />
                <Text style={{ color: '#F44336', fontSize: 13, marginLeft: 6, fontWeight: '600' }}>{act.checkOutLabel}</Text>
              </TouchableOpacity>
            </View>
          )}

          {act.notice && (
            <View style={{
              backgroundColor: act.notice.tone === 'warn' ? '#FEF3C7' : '#E1F5FE',
              borderColor: act.notice.tone === 'warn' ? '#F59E0B' : '#87CEEB',
              borderRadius: 10, padding: 12, marginTop: 12,
              flexDirection: 'row', alignItems: 'center', borderWidth: 1,
            }}>
              <Ionicons
                name={act.notice.tone === 'warn' ? 'alert-circle-outline' : 'information-circle-outline'}
                size={16}
                color={act.notice.tone === 'warn' ? '#D97706' : '#0277BD'}
                style={{ marginRight: 8 }}
              />
              <Text style={{ color: act.notice.tone === 'warn' ? '#92400E' : '#01579B', fontSize: 12, fontWeight: '600', flex: 1 }}>
                {act.notice.text}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Holiday banner — Sundays are workable, only approved holidays close a school. */}
      {isHolidayToday && (
        <View style={{ backgroundColor: '#E1F5FE', borderRadius: 10, padding: 12, marginBottom: 16, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#87CEEB' }}>
          <Ionicons name="sunny-outline" size={16} color="#0277BD" style={{ marginRight: 8 }} />
          <Text style={{ color: '#01579B', fontSize: 12, fontWeight: '600', flex: 1 }}>
            Today is a holiday. Check-in and check-out are disabled.
          </Text>
        </View>
      )}

      <View style={{ backgroundColor: theme.colors.surface, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: theme.colors.border }}>
        <Calendar
          current={new Date().toISOString().split('T')[0]}
          markedDates={markedDates}
          markingType={'custom'}
          theme={{
            calendarBackground: theme.colors.surface,
            textSectionTitleColor: theme.colors.textSecondary,
            dayTextColor: theme.colors.textPrimary,
            monthTextColor: theme.colors.primary,
            arrowColor: theme.colors.primary,
            todayTextColor: theme.colors.primary,
          }}
        />
        <CalendarLegend />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 13, borderRadius: 12, borderWidth: 1,
  },
});
