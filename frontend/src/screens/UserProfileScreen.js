import React, { useState, useEffect, useContext } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl, TouchableOpacity, Dimensions } from 'react-native';
import { ThemeContext } from '../context/ThemeContext';
import { AuthContext } from '../context/AuthContext';
import api from '../services/api';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Calendar } from 'react-native-calendars';
import { buildCalendarMarks, CALENDAR_COLORS, CALENDAR_LEGEND } from '../utils/calendarColors';
import { buildSchoolVisitMarks } from '../utils/schoolVisitMarks';
import CalendarLegend from '../components/CalendarLegend';
import ApprovedBy from '../components/ApprovedBy';
import { countApprovedHolidays } from '../utils/holiday';
import VisitReportDetail from '../components/VisitReportDetail';
import StaffLocationTrail from '../components/StaffLocationTrail';
import { ADMIN_ROLES } from '../utils/roles';
import { Skeleton, SkeletonProfile, SkeletonCard, SkeletonText, SkeletonStatCards, ShineSweep } from '../components/Skeleton';

const { width } = Dimensions.get('window');

export default function UserProfileScreen({ route, navigation }) {
  const { userId } = route.params || { userId: 'me' };
  const { theme } = useContext(ThemeContext);
  const { user: currentUser } = useContext(AuthContext);
  const insets = useSafeAreaInsets();
  
  const [loading, setLoading] = useState(true);
  const [profileData, setProfileData] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [reportToView, setReportToView] = useState(null);
  const [activeTab, setActiveTab] = useState('Overview');

  useEffect(() => {
    fetchProfile();
  }, [userId]);

  const fetchProfile = async () => {
    try {
      const res = await api.get(`/profile/${userId}`);
      setProfileData(res.data.data);
    } catch (error) {
      console.log('Failed to fetch profile', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    fetchProfile();
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <SkeletonProfile style={{ margin: 16, marginTop: insets.top + 16 }} />
        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 12, overflow: 'hidden' }}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} plain height={34} radius={17} style={{ flex: 1 }} />
          ))}
          <ShineSweep />
        </View>
        <View style={{ paddingHorizontal: 16 }}>
          <SkeletonCard style={{ marginBottom: 12 }}>
            <SkeletonText plain lines={3} />
          </SkeletonCard>
          <SkeletonStatCards count={2} />
        </View>
      </View>
    );
  }

  if (!profileData) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <Text style={{ color: theme.colors.textSecondary }}>Failed to load profile.</Text>
      </View>
    );
  }

  const {
    profile, attendance, visitReports, activities,
    // Every school this person has worked at — the ones they hold now first,
    // then the ones they have left. Built by the API.
    schoolHistory = [],
    leaveDays = [],
    // Days this person was replaced by someone else (shown as On Leave) vs.
    // days they are covering for someone else (shown as On Substitution).
    substitutionLeaves = [],
    substitutionDuties = [],
    // Approved school visits — on-duty days spent inspecting another school.
    visitDays = [],
    // School holidays for every school this person is assigned to. Days the
    // school was shut are not days they failed to turn up, and this calendar
    // used to show no difference between the two.
    holidays = [],
  } = profileData;

  const currentSchools = schoolHistory.filter(s => s.isCurrent);
  const pastSchools = schoolHistory.filter(s => !s.isCurrent);

  const formatDate = (d) =>
    d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : null;

  const getAttendanceSummary = () => {
    const present = attendance.filter(a => a.status === 'Present').length;
    const partiallyPresent = attendance.filter(a => a.status === 'Partially Present').length;
    const absent = attendance.filter(a => a.status === 'Absent').length;
    // School visits produce no attendance record (check-in is paused), so the
    // day count comes from the approved windows. Counting the built marks reuses
    // the same day-expansion — and the same runaway-range guard — as the calendar.
    const schoolVisit = Object.keys(buildSchoolVisitMarks(visitDays)).length;
    // Approved holidays only — a day that was merely REQUESTED off is not a day
    // the school was shut, so it is never counted here even though it is still
    // drawn on the calendar in the weaker pending style.
    const holiday = countApprovedHolidays(holidays);
    let totalMinutes = 0;
    attendance.forEach(a => {
        if(a.totalTimeSpent) totalMinutes += a.totalTimeSpent;
    });
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return { present, partiallyPresent, absent, schoolVisit, holiday, totalTime: `${hours}h ${mins}m` };
  };

  const attSummary = getAttendanceSummary();

  // Uses the SAME canonical builders/colours as the portals, so an authority
  // viewing this profile sees identical marks to what the person sees themselves.
  const getMarkedDates = () => buildCalendarMarks({
    attendance,
    holidays,
    leaveDays,
    substitutionLeaves,
    substitutionDuties,
    visitDays,
  });

  // Raw check-in / check-out coordinates are shown for anonymous-location staff
  // only — they are the ones with no school geofence standing behind their
  // attendance — and only to the Admin and the CEO, the same two roles trusted
  // with "Approved by" everywhere else in the app.
  const canSeeLocations =
    !!profile?.anonymousLocation && ADMIN_ROLES.includes(currentUser?.role);

  const renderTabs = () => {
    const tabs = ['Overview', 'Attendance', 'Activities', 'Reports'];
    if (canSeeLocations) tabs.push('Locations');
    // Four tabs share the width evenly, as they always have. A fifth would
    // squeeze the labels to nothing, so past four the row scrolls instead.
    const scrolls = tabs.length > 4;

    const renderTab = (tab) => {
      const isActive = activeTab === tab;
      return (
        <TouchableOpacity
          key={tab}
          style={[styles.tabBtn, scrolls && styles.tabBtnCompact, {
            backgroundColor: isActive ? theme.colors.primary : 'transparent',
            borderColor: isActive ? theme.colors.primary : theme.colors.border
          }]}
          onPress={() => setActiveTab(tab)}
        >
          <Text style={{
            color: isActive ? '#fff' : theme.colors.textSecondary,
            fontWeight: isActive ? 'bold' : 'normal',
            fontSize: 13
          }}>
            {tab}
          </Text>
        </TouchableOpacity>
      );
    };

    if (!scrolls) {
      return <View style={styles.tabsContainer}>{tabs.map(renderTab)}</View>;
    }

    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={styles.tabsScrollContent}
      >
        {tabs.map(renderTab)}
      </ScrollView>
    );
  };

  const renderOverview = () => (
    <View style={{ gap: 16 }}>
      {/* School / Leader details */}
      <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
          <Ionicons name="business-outline" size={20} color={theme.colors.primary} style={{ marginRight: 8 }} />
          <Text style={[styles.title, { color: theme.colors.textPrimary, marginBottom: 0 }]}>Assignment Details</Text>
        </View>
        
        {/* Current school(s) sit on top — where this person works right now.
            An anonymous-location head has none BY DESIGN, so saying "no school
            assigned" would read as something missing rather than as the setting
            it is. */}
        {profile?.anonymousLocation ? (
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', backgroundColor: theme.colors.primary + '12', borderRadius: 10, padding: 10 }}>
            <Ionicons name="navigate-circle" size={18} color={theme.colors.primary} style={{ marginRight: 8, marginTop: 1 }} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.colors.textPrimary, fontWeight: '700' }}>Anonymous Location</Text>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 }}>
                Not tied to a school — checks in and out from anywhere.
              </Text>
            </View>
          </View>
        ) : currentSchools.length === 0 ? (
          <Text style={{ color: theme.colors.textSecondary }}>No school assigned.</Text>
        ) : (
          currentSchools.map((s, i) => (
            <View
              key={s._id || s.schoolId}
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                backgroundColor: theme.colors.primary + '12',
                borderRadius: 10,
                padding: 10,
                marginBottom: i === currentSchools.length - 1 ? 0 : 8,
              }}
            >
              <Ionicons name="school" size={18} color={theme.colors.primary} style={{ marginRight: 8, marginTop: 1 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.textPrimary, fontWeight: '700' }}>
                  {s.name}{s.state ? ` — ${s.state}` : ''}
                </Text>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 }}>
                  {s.assignedAt ? `Working here since ${formatDate(s.assignedAt)}` : 'Currently working here'}
                </Text>
              </View>
              <View style={{ backgroundColor: '#10B981' + '25', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ color: '#10B981', fontSize: 11, fontWeight: '700' }}>CURRENT</Text>
              </View>
            </View>
          ))
        )}

        {profile.teamId?.name && (
          <View style={[styles.detailRow, { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: theme.colors.border }]}>
            <Text style={{ color: theme.colors.textSecondary, width: 80 }}>Team:</Text>
            <Text style={{ color: theme.colors.textPrimary, flex: 1, fontWeight: '500' }}>{profile.teamId.name}</Text>
          </View>
        )}

        {profile.teamLeaderId && (
          <View style={[styles.detailRow, { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: theme.colors.border }]}>
            <Text style={{ color: theme.colors.textSecondary, width: 80 }}>Leader:</Text>
            <Text style={{ color: theme.colors.textPrimary, flex: 1, fontWeight: '500' }}>{profile.teamLeaderId.name}</Text>
          </View>
        )}
      </View>

      {/* Schools Worked — the full track. A school detached by the admin, or
          closed along with its login, still shows here with its dates. */}
      <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
          <Ionicons name="git-branch-outline" size={20} color={theme.colors.primary} style={{ marginRight: 8 }} />
          <Text style={[styles.title, { color: theme.colors.textPrimary, marginBottom: 0 }]}>
            Schools Worked ({schoolHistory.length})
          </Text>
        </View>
        <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginBottom: 12 }}>
          Every school this person has been assigned to, newest first.
        </Text>

        {schoolHistory.length === 0 ? (
          <Text style={{ color: theme.colors.textSecondary }}>No school assignments recorded yet.</Text>
        ) : (
          schoolHistory.map((s, i) => (
            <View
              key={s._id || s.schoolId}
              style={{
                flexDirection: 'row',
                paddingVertical: 10,
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: theme.colors.border,
              }}
            >
              {/* Timeline rail: filled dot = current, hollow = a past stint */}
              <View style={{ width: 22, alignItems: 'center', paddingTop: 4 }}>
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    borderWidth: 2,
                    borderColor: s.isCurrent ? '#10B981' : theme.colors.textSecondary,
                    backgroundColor: s.isCurrent ? '#10B981' : 'transparent',
                  }}
                />
                {i < schoolHistory.length - 1 && (
                  <View style={{ flex: 1, width: 2, backgroundColor: theme.colors.border, marginTop: 4 }} />
                )}
              </View>

              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                  <Text
                    style={{
                      color: s.isCurrent ? theme.colors.textPrimary : theme.colors.textSecondary,
                      fontWeight: s.isCurrent ? '700' : '600',
                      marginRight: 6,
                    }}
                  >
                    {s.name}
                  </Text>
                  {s.isCurrent && (
                    <View style={{ backgroundColor: '#10B981' + '25', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                      <Text style={{ color: '#10B981', fontSize: 10, fontWeight: '700' }}>CURRENT</Text>
                    </View>
                  )}
                  {s.isArchived && (
                    <View style={{ backgroundColor: theme.colors.textSecondary + '20', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginLeft: 4 }}>
                      <Text style={{ color: theme.colors.textSecondary, fontSize: 10, fontWeight: '700' }}>SCHOOL CLOSED</Text>
                    </View>
                  )}
                </View>

                {s.state ? (
                  <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 }}>{s.state}</Text>
                ) : null}

                <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 3 }}>
                  {s.assignedAt ? formatDate(s.assignedAt) : 'Start date unknown'}
                  {' → '}
                  {s.isCurrent ? 'Present' : (s.removedAt ? formatDate(s.removedAt) : 'Unknown')}
                </Text>

                {!s.isCurrent && s.removedReason === 'school_deleted' && (
                  <Text style={{ color: theme.colors.textSecondary, fontSize: 11, marginTop: 2, fontStyle: 'italic' }}>
                    Ended because the school was removed — their work here is kept.
                  </Text>
                )}
              </View>
            </View>
          ))
        )}
      </View>

      {/* Quick Stats Overview */}
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={[styles.statBox, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>Attendance</Text>
          <Text style={{ color: '#10B981', fontSize: 24, fontWeight: 'bold', marginVertical: 4 }}>{attSummary.present}</Text>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 11 }}>Days Present</Text>
        </View>
        <View style={[styles.statBox, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>Activities</Text>
          <Text style={{ color: theme.colors.primary, fontSize: 24, fontWeight: 'bold', marginVertical: 4 }}>{activities.length}</Text>
          {/* Counts uploads AND activities they were tagged in as an organiser
              — which is what the list below shows, so the label says so. */}
          <Text style={{ color: theme.colors.textSecondary, fontSize: 11 }}>Uploaded & Tagged</Text>
        </View>
      </View>
    </View>
  );

  const renderAttendance = () => (
    <View style={{ gap: 16 }}>
      {/* Working-days summary. School visits are ON-DUTY days spent inspecting
          another school, so they sit alongside Present rather than with the
          absences — they just never produce a check-in record. Holidays are the
          opposite kind of day again: nobody was expected in, so a blank on the
          calendar there means the school was shut, not that anyone was missing.
          Four tiles wrap two-by-two rather than being squeezed into one row. */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {[
          { label: 'Present', value: attSummary.present, color: CALENDAR_COLORS.present },
          { label: 'Partial', value: attSummary.partiallyPresent, color: CALENDAR_COLORS.partial },
          { label: 'School Visit', value: attSummary.schoolVisit, color: CALENDAR_COLORS.schoolVisit },
          { label: 'Holiday', value: attSummary.holiday, color: CALENDAR_COLORS.holiday },
        ].map((s) => (
          <View
            key={s.label}
            style={[
              styles.statBox,
              // flexBasis just under half leaves room for the gap, so exactly
              // two tiles sit per row at any width.
              { flexBasis: '47%', backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
            ]}
          >
            <Text style={{ color: s.color, fontSize: 22, fontWeight: 'bold' }}>{s.value}</Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 11, marginTop: 2 }} numberOfLines={1}>{s.label}</Text>
          </View>
        ))}
      </View>

      {/* Calendar */}
      <View style={[styles.card, { padding: 0, overflow: 'hidden', backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
        <Calendar
          theme={{
            backgroundColor: theme.colors.surface,
            calendarBackground: theme.colors.surface,
            textSectionTitleColor: theme.colors.textSecondary,
            selectedDayBackgroundColor: theme.colors.primary,
            selectedDayTextColor: '#ffffff',
            todayTextColor: theme.colors.primary,
            dayTextColor: theme.colors.textPrimary,
            textDisabledColor: theme.colors.border,
            monthTextColor: theme.colors.textPrimary,
            arrowColor: theme.colors.primary,
          }}
          markingType={'custom'}
          markedDates={getMarkedDates()}
        />
        {/* The full legend now — this profile draws school holidays too, so
            filtering that key out would leave a colour on the calendar with
            nothing explaining it. */}
        <CalendarLegend />
      </View>

      <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
        <Text style={[styles.title, { color: theme.colors.textPrimary }]}>Recent History</Text>
        {attendance.slice(0, 5).map(att => (
          <View key={att._id} style={{ borderBottomWidth: 1, borderBottomColor: theme.colors.border, paddingVertical: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>
                {new Date(att.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
              </Text>
              <Text style={{ 
                color: att.status === 'Present' ? '#10B981' : att.status === 'Partially Present' ? '#F59E0B' : '#EF4444',
                fontWeight: '600', fontSize: 12 
              }}>
                {att.status}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', marginTop: 6, gap: 16 }}>
              {att.checkInTime && (
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
                  <Ionicons name="log-in-outline" size={12} /> {new Date(att.checkInTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                </Text>
              )}
              {att.checkOutTime && (
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
                  <Ionicons name="log-out-outline" size={12} /> {new Date(att.checkOutTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                </Text>
              )}
            </View>
            {/* Where the day happened. Named explicitly when it started at one
                school and finished at another, so a split day is never read as
                a single-school day. */}
            {att.schoolId?.name && (
              <Text style={{ color: theme.colors.textSecondary, fontSize: 11, marginTop: 4 }}>
                <Ionicons name="business-outline" size={11} />{' '}
                {att.checkOutSchoolId?.name && att.checkOutSchoolId.name !== att.schoolId.name
                  ? `${att.schoolId.name} → ${att.checkOutSchoolId.name}`
                  : att.schoolId.name}
              </Text>
            )}
          </View>
        ))}
        {attendance.length === 0 && <Text style={{ color: theme.colors.textSecondary }}>No attendance records found.</Text>}
      </View>
    </View>
  );

  const renderActivities = () => {
    const approved = activities.filter(a => a.status === 'approved').length;
    const pending = activities.filter(a => a.status === 'pending').length;
    const rejected = activities.filter(a => a.status === 'rejected').length;

    return (
      <View style={{ gap: 16 }}>
        <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
          <Text style={[styles.title, { color: theme.colors.textPrimary }]}>Activity Performance</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: '#10B981', fontSize: 22, fontWeight: 'bold' }}>{approved}</Text>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>Approved</Text>
            </View>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: '#F59E0B', fontSize: 22, fontWeight: 'bold' }}>{pending}</Text>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>Pending</Text>
            </View>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: '#EF4444', fontSize: 22, fontWeight: 'bold' }}>{rejected}</Text>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>Rejected</Text>
            </View>
          </View>
          
          {/* Simple progress bar representing approval rate */}
          {activities.length > 0 && (
            <View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>Approval Rate</Text>
                <Text style={{ color: theme.colors.primary, fontSize: 12, fontWeight: 'bold' }}>
                  {Math.round((approved / activities.length) * 100)}%
                </Text>
              </View>
              <View style={{ height: 8, backgroundColor: theme.colors.border, borderRadius: 4, overflow: 'hidden', flexDirection: 'row' }}>
                <View style={{ width: `${(approved / activities.length) * 100}%`, backgroundColor: '#10B981' }} />
                <View style={{ width: `${(pending / activities.length) * 100}%`, backgroundColor: '#F59E0B' }} />
                <View style={{ width: `${(rejected / activities.length) * 100}%`, backgroundColor: '#EF4444' }} />
              </View>
            </View>
          )}
        </View>

        <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
          <Text style={[styles.title, { color: theme.colors.textPrimary }]}>Recent Activities</Text>
          {/* Each row is the activity itself: its NAME (this read `act.title`,
              a field the Activity model does not have, so every row showed a
              blank line where the name belonged), and a tap that opens the same
              full detail screen everyone else sees — photos, description,
              school, organisers. Anyone who got far enough to open this profile
              has already passed the permission check. */}
          {activities.slice(0, 5).map(act => (
            <TouchableOpacity
              key={act._id}
              activeOpacity={0.7}
              onPress={() => navigation.navigate('ActivityDetails', { activityId: act._id })}
              style={{ borderBottomWidth: 1, borderBottomColor: theme.colors.border, paddingVertical: 10 }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ color: theme.colors.textPrimary, fontWeight: '600', flex: 1 }} numberOfLines={1}>
                  {act.name || 'Untitled activity'}
                </Text>
                {/* This list mixes what they uploaded with what they were tagged
                    in as an organiser — worth telling apart. */}
                {String(act.uploaderId?._id || act.uploaderId) !== String(profile?._id) && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#0D948818', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, marginLeft: 8 }}>
                    <Ionicons name="pricetag" size={10} color="#0D9488" />
                    <Text style={{ color: '#0D9488', fontSize: 10, fontWeight: '800', marginLeft: 3 }}>TAGGED</Text>
                  </View>
                )}
                <Ionicons name="chevron-forward" size={16} color={theme.colors.textSecondary} style={{ marginLeft: 6 }} />
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
                  {new Date(act.activityDate || act.createdAt).toLocaleDateString()}
                </Text>
                <Text style={{ 
                  color: act.status === 'approved' ? '#10B981' : act.status === 'pending' ? '#F59E0B' : '#EF4444',
                  fontSize: 12, fontWeight: '600'
                }}>
                  {act.status.toUpperCase()}
                </Text>
              </View>
              {/* A profile is where the Admin/CEO go to understand one person's
                  record, so who signed each activity off belongs here. */}
              <ApprovedBy record={act} compact style={{ marginTop: 6 }} />
            </TouchableOpacity>
          ))}
          {activities.length === 0 && <Text style={{ color: theme.colors.textSecondary }}>No activities uploaded yet.</Text>}
        </View>
      </View>
    );
  };

  const renderReports = () => (
    <View style={{ gap: 16 }}>
      {/* Visit Reports Timeline */}
      <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
        <Text style={[styles.title, { color: theme.colors.textPrimary }]}>Inspection Visit Reports</Text>
        {visitReports.length === 0 ? (
          <Text style={{ color: theme.colors.textSecondary }}>No reports submitted.</Text>
        ) : (
          visitReports.map((rep, idx) => (
            <View key={rep._id} style={{ flexDirection: 'row', marginTop: 12 }}>
              <View style={{ alignItems: 'center', marginRight: 12 }}>
                <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: theme.colors.primary, marginTop: 4 }} />
                {idx !== visitReports.length - 1 && (
                  <View style={{ width: 2, flex: 1, backgroundColor: theme.colors.border, marginVertical: 4 }} />
                )}
              </View>
              <View style={{ flex: 1, paddingBottom: 16 }}>
                <Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>{new Date(rep.dateOfInspection).toLocaleDateString()}</Text>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginBottom: 4 }}>Met with: {rep.personMet}</Text>
                <View style={{ backgroundColor: theme.colors.background, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border }}>
                  <Text style={{ color: theme.colors.textPrimary, fontSize: 13 }}>{rep.discussionContext}</Text>
                </View>
                {rep.form && (
                  <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }} onPress={() => setReportToView(rep)}>
                    <Ionicons name="reader-outline" size={15} color={theme.colors.primary} style={{ marginRight: 4 }} />
                    <Text style={{ color: theme.colors.primary, fontSize: 13, fontWeight: '600' }}>View Full Report</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ))
        )}
      </View>
      
      {/* Why an activity was turned down. This read `adminRemarks` and `title`,
          neither of which exists on an Activity — the reason lives in
          `rejectionRemark` and the name in `name` — so the section rendered
          "No feedbacks available" no matter how many rejections there were. */}
      <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
        <Text style={[styles.title, { color: theme.colors.textPrimary }]}>Admin Feedbacks</Text>
        {activities.filter(a => a.rejectionRemark).length === 0 ? (
          <Text style={{ color: theme.colors.textSecondary }}>No feedbacks available.</Text>
        ) : (
          activities.filter(a => a.rejectionRemark).map(act => (
            <TouchableOpacity
              key={act._id}
              activeOpacity={0.7}
              onPress={() => navigation.navigate('ActivityDetails', { activityId: act._id })}
              style={{ borderBottomWidth: 1, borderBottomColor: theme.colors.border, paddingVertical: 10 }}
            >
              <Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>Activity: {act.name}</Text>
              <Text style={{ color: '#EF4444', fontSize: 13, marginTop: 4 }}>" {act.rejectionRemark} "</Text>
            </TouchableOpacity>
          ))
        )}
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background, paddingTop: insets.top }]}>
      {/* Custom Header with Profile Info */}
      <View style={[styles.header, { backgroundColor: theme.colors.primary }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 8 }}>
            <Ionicons name="arrow-back" size={24} color="#ffffff" />
          </TouchableOpacity>
        </View>
        <View style={{ alignItems: 'center', marginTop: 10, paddingBottom: 20 }}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{profile.name?.charAt(0).toUpperCase()}</Text>
          </View>
          <Text style={styles.nameText}>{profile.name}</Text>
          <Text style={styles.roleText}>{profile.role.replace('_', ' ').toUpperCase()}</Text>
          <Text style={styles.emailText}>{profile.email}</Text>
        </View>
      </View>

      {/* Tabs */}
      {renderTabs()}

      {/* Scrollable Content */}
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />}
      >
        {activeTab === 'Overview' && renderOverview()}
        {activeTab === 'Attendance' && renderAttendance()}
        {activeTab === 'Activities' && renderActivities()}
        {activeTab === 'Reports' && renderReports()}
        {/* Mounted only while the tab is open: a map that nobody is looking at
            has no business holding a WebView / MapView alive. */}
        {activeTab === 'Locations' && canSeeLocations && (
          <StaffLocationTrail attendance={attendance} />
        )}
      </ScrollView>

      <VisitReportDetail
        visible={!!reportToView}
        report={reportToView}
        onClose={() => setReportToView(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { 
    paddingHorizontal: 16,
    paddingTop: 8,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  avatar: {
    width: 70, height: 70, borderRadius: 35,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 12,
    borderWidth: 2, borderColor: '#ffffff'
  },
  avatarText: { fontSize: 28, fontWeight: 'bold', color: '#ffffff' },
  nameText: { fontSize: 22, fontWeight: 'bold', color: '#ffffff', marginBottom: 4 },
  roleText: { fontSize: 12, color: 'rgba(255,255,255,0.8)', fontWeight: '600', letterSpacing: 1, marginBottom: 4 },
  emailText: { fontSize: 14, color: 'rgba(255,255,255,0.9)' },
  tabsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 8,
  },
  tabsScrollContent: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 8,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
  },
  // In the scrolling row a tab is as wide as its label, not a share of nothing.
  tabBtnCompact: { flex: 0, paddingHorizontal: 18 },
  scrollContent: { flexGrow: 1, padding: 16, paddingBottom: 40 },
  card: { 
    padding: 16, 
    borderRadius: 16, 
    borderWidth: 1, 
  },
  title: { fontSize: 16, fontWeight: 'bold', marginBottom: 12 },
  detailRow: { flexDirection: 'row', marginBottom: 8 },
  statBox: {
    flex: 1,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  legendDot: { width: 8, height: 8, borderRadius: 4, marginRight: 4 }
});
