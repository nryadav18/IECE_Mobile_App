import React, { useCallback, useContext, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Calendar } from 'react-native-calendars';
import { ThemeContext } from '../context/ThemeContext';
import api from '../services/api';
import CalendarLegend from './CalendarLegend';
import { isOffToday, HOLIDAY_APPROVED_COLOR, HOLIDAY_PENDING_COLOR } from '../utils/holiday';
import { buildCalendarMarks } from '../utils/calendarColors';
import { deriveAttendanceActions, findTodayAttendance } from '../utils/attendanceActions';
import { findActiveVisit } from '../utils/schoolVisitMarks';

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
  // Anonymous-location staff (heads attached to no school) — see the branch in
  // the render below. They have no school to pick and no geofence to stand in.
  const [anonymous, setAnonymous] = useState(false);
  const [selectedSchoolId, setSelectedSchoolId] = useState(null);
  const [attendanceRecords, setAttendanceRecords] = useState([]);
  const [substitutionLeaves, setSubstitutionLeaves] = useState([]);
  const [substitutionDuties, setSubstitutionDuties] = useState([]);
  const [leaveDays, setLeaveDays] = useState([]);
  const [visitDays, setVisitDays] = useState([]);
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
      setAnonymous(!!d.anonymousLocation);

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
      setVisitDays(res.data.visitDays || []);
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

  // Asked about the SELECTED school only. The calendar below shows the holidays
  // of every school this person covers, but only the one they are checking in
  // at can close their day — the server decides per school, and greying the
  // buttons out for a school that is open would refuse attendance the API would
  // have accepted.
  const isHolidayToday = isOffToday(holidays, selectedSchoolId);
  const todayAtt = findTodayAttendance(attendanceRecords);

  const selSchool = mySchools.find((s) => String(s._id) === String(selectedSchoolId));
  const schoolName = selSchool?.name || 'this school';
  // An anonymous person has exactly ONE registration and it belongs to no
  // school, so it is found by the absence of a schoolId rather than by matching
  // one — String(null) would otherwise happily match the string 'null'.
  const reg = anonymous
    ? faceRegs.find((r) => !r.schoolId)
    : faceRegs.find((r) => r.schoolId && String(r.schoolId?._id || r.schoolId) === String(selectedSchoolId));
  const regStatus = reg?.status || 'none';

  // An approved school visit covering today suspends check-in/check-out.
  const activeVisit = findActiveVisit(visitDays);

  const act = deriveAttendanceActions({
    todayAttendance: todayAtt,
    // Anonymous staff have no school to select, but they are always "here", so
    // the action rules need a stand-in for the school they are at.
    selectedSchoolId: anonymous ? 'anonymous' : selectedSchoolId,
    regStatus,
    // No school means no school holiday can close their day.
    isHolidayToday: anonymous ? false : isHolidayToday,
    activeVisit,
    anonymous,
  });

  const markedDates = buildCalendarMarks({
    attendance: attendanceRecords,
    holidays,
    leaveDays,
    substitutionLeaves,
    substitutionDuties,
    visitDays,
    todayMark: {
      customStyles: {
        container: { backgroundColor: '#E0E0E0', borderRadius: 8, borderWidth: 2, borderColor: theme.colors.primary },
        text: { color: theme.colors.textPrimary, fontWeight: 'bold' },
      },
    },
  });

  return (
    <View>
      {/* Anonymous location — this person belongs to no school, so there is
          nothing to pick and nowhere they have to be. Said plainly once, at the
          top, so the missing school picker reads as the rule it is rather than
          as something that failed to load. */}
      {anonymous && (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', backgroundColor: theme.colors.primary + '12', borderColor: theme.colors.primary + '33', borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 14 }}>
          <Ionicons name="navigate-circle-outline" size={18} color={theme.colors.primary} style={{ marginRight: 8, marginTop: 1 }} />
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12.5, flex: 1, lineHeight: 18 }}>
            <Text style={{ fontWeight: '700', color: theme.colors.textPrimary }}>Anonymous location.</Text> You are not tied to a school — register your face once, then check in and out from wherever you are working.
          </Text>
        </View>
      )}

      {/* School picker — only worth showing when there is a choice to make. */}
      {!anonymous && mySchools.length > 1 && (
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

      {/* Actions for the selected school — or, for anonymous staff, for
          wherever they are. */}
      {!anonymous && !selectedSchoolId ? (
        <View style={{ backgroundColor: theme.colors.surface, borderRadius: 10, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: theme.colors.border }}>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 13, fontWeight: '600' }}>
            {loaded
              ? 'No school assigned yet. Once the admin assigns you a school, attendance appears here.'
              : 'Loading your schools…'}
          </Text>
        </View>
      ) : (
        <View style={{ marginBottom: 12 }}>
          {/* A rejection is a "try again", not a dead end. The reason is shown
              here — a push notification is easy to miss — and the button comes
              straight back, so the person can re-record on the spot instead of
              waiting for someone to reset anything. */}
          {regStatus === 'rejected' && (
            <View style={{ backgroundColor: '#FEE2E2', borderColor: '#EF4444', borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="close-circle-outline" size={16} color="#B91C1C" style={{ marginRight: 6 }} />
                <Text style={{ color: '#B91C1C', fontSize: 12.5, fontWeight: '800', flex: 1 }}>
                  {anonymous ? 'Registration rejected' : `Registration rejected — ${schoolName}`}
                </Text>
              </View>
              {!!reg?.rejectionReason && (
                <Text style={{ color: '#7F1D1D', fontSize: 12, marginTop: 6, lineHeight: 17 }}>
                  {reg.rejectionReason}
                </Text>
              )}
              <Text style={{ color: '#7F1D1D', fontSize: 12, marginTop: 6, lineHeight: 17 }}>
                Please register again — your new recording goes back to the admin for approval.
              </Text>
            </View>
          )}

          {(regStatus === 'none' || regStatus === 'rejected') && (
            <TouchableOpacity
              style={[styles.actionBtn, { borderColor: theme.colors.primary, backgroundColor: theme.colors.primary + '10' }]}
              onPress={() => navigation.navigate('FaceRegistration', anonymous
                ? { anonymous: true }
                : { schoolId: selectedSchoolId, schoolName })}
            >
              <Ionicons name="scan-outline" size={20} color={theme.colors.primary} />
              <Text style={{ color: theme.colors.primary, fontSize: 13, marginLeft: 6, fontWeight: '600' }}>
                {anonymous
                  ? (regStatus === 'rejected' ? 'Register Face Again' : 'Register Your Face')
                  : (regStatus === 'rejected' ? `Register Face Again for ${schoolName}` : `Register Face for ${schoolName}`)}
              </Text>
            </TouchableOpacity>
          )}

          {regStatus === 'pending' && (
            <View style={[styles.actionBtn, { borderColor: '#F59E0B', backgroundColor: '#FEF3C7' }]}>
              <Ionicons name="hourglass-outline" size={20} color="#D97706" />
              <Text style={{ color: '#D97706', fontSize: 13, marginLeft: 6, fontWeight: '700' }}>
                {anonymous ? 'Pending Approval' : `Pending Approval — ${schoolName}`}
              </Text>
            </View>
          )}

          {regStatus === 'approved' && (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                style={[styles.actionBtn, { flex: 1, borderColor: '#4CAF50', backgroundColor: '#4CAF5010', opacity: act.canCheckIn ? 1 : 0.5 }]}
                onPress={() => navigation.navigate('Attendance', anonymous
                  ? { intent: 'login', anonymous: true }
                  : { intent: 'login', schoolId: selectedSchoolId, schoolName })}
                disabled={!act.canCheckIn}
              >
                <Ionicons name={act.checkedInHere ? 'checkmark-done-outline' : 'log-in-outline'} size={20} color="#4CAF50" />
                <Text style={{ color: '#4CAF50', fontSize: 13, marginLeft: 6, fontWeight: '600' }}>{act.checkInLabel}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionBtn, { flex: 1, borderColor: '#F44336', backgroundColor: '#F4433610', opacity: act.canCheckOut ? 1 : 0.5 }]}
                onPress={() => navigation.navigate('Attendance', anonymous
                  ? { intent: 'logout', anonymous: true }
                  : { intent: 'logout', schoolId: selectedSchoolId, schoolName })}
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

      {/* Holiday banner — Sundays are workable, only approved holidays close a
          school, and a school holiday cannot close a day for someone who
          belongs to no school. Takes its colour from the holiday constants, so
          this banner and the holiday cell on the calendar below can never
          disagree. */}
      {!anonymous && isHolidayToday && (
        <View style={{ backgroundColor: HOLIDAY_PENDING_COLOR, borderRadius: 10, padding: 12, marginBottom: 16, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: HOLIDAY_APPROVED_COLOR }}>
          <Ionicons name="sunny-outline" size={16} color={HOLIDAY_APPROVED_COLOR} style={{ marginRight: 8 }} />
          <Text style={{ color: HOLIDAY_APPROVED_COLOR, fontSize: 12, fontWeight: '600', flex: 1 }}>
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
