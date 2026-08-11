import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, ActivityIndicator, RefreshControl, Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemeContext } from '../context/ThemeContext';
import { AuthContext } from '../context/AuthContext';
import { useAlert } from '../context/AlertContext';
import { roleLabel } from '../utils/roles';
import { monthOptions, periodLabel, istToday } from '../utils/reportPeriods';
import StaffPickerModal from './StaffPickerModal';
import { SkeletonList } from './Skeleton';
import {
  getReportSubjects, requestReport, getReportRuns, reportError,
} from '../services/monthlyReport';

/**
 * MONTHLY PERFORMANCE REPORT — the Admin's on-demand generator.
 *
 * Every staff member is emailed their own performance report automatically at
 * 06:00 IST on the 1st. This screen is for the times that is not enough: a
 * review conversation this afternoon, a question about last quarter, a check on
 * how a team is tracking halfway through the month.
 *
 * Three rules shape it, and they are all enforced on the server rather than
 * here, so the UI cannot be the only thing holding them:
 *
 *  1. THE REPORT COMES TO YOU. The recipient is the signed-in admin, read from
 *     the auth token — never a field on this form. An admin checking on someone
 *     can never accidentally email that person their own report, and a
 *     confidential report cannot leave the organisation through a typo.
 *
 *  2. IT NEVER CONSUMES THE REAL MONTHLY SEND. Pulling August's report on the
 *     3rd does not stop the genuine August report reaching that person on
 *     1 September. Request the same report as often as you like.
 *
 *  3. THE CURRENT MONTH IS ALLOWED, AND HONEST ABOUT IT. Asking for a month
 *     still in progress gives an interim report covering it up to today: days
 *     that have not happened yet are excluded from every figure instead of
 *     being counted as absences, and the PDF says so on the page.
 */

const MONTHS_OFFERED = 12;

/** One selectable chip — month, mode, or team. Memoised: there are many. */
const Chip = React.memo(function Chip({ label, sub, active, onPress, theme, icon }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={{
        paddingHorizontal: 14,
        paddingVertical: 9,
        borderRadius: 999,
        borderWidth: 1.5,
        marginRight: 8,
        marginBottom: 8,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: active ? theme.colors.primary : theme.colors.surface,
        borderColor: active ? theme.colors.primary : theme.colors.border,
      }}
    >
      {!!icon && (
        <Ionicons
          name={icon}
          size={14}
          color={active ? '#fff' : theme.colors.textSecondary}
          style={{ marginRight: 6 }}
        />
      )}
      <Text style={{ color: active ? '#fff' : theme.colors.textPrimary, fontSize: 13, fontWeight: active ? '700' : '500' }}>
        {label}
      </Text>
      {!!sub && (
        <Text style={{ color: active ? 'rgba(255,255,255,0.85)' : theme.colors.textSecondary, fontSize: 11, marginLeft: 6 }}>
          {sub}
        </Text>
      )}
    </TouchableOpacity>
  );
});

/** One row in the recent-sends list. */
const RunRow = React.memo(function RunRow({ run, theme, isLast }) {
  const ok = run.status === 'sent';
  const failed = run.status === 'failed';
  const color = ok ? '#16A34A' : failed ? '#DC2626' : theme.colors.textSecondary;
  const icon = ok ? 'checkmark-circle' : failed ? 'close-circle' : 'ellipse-outline';

  const when = run.sentAt
    ? new Date(run.sentAt).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    })
    : '—';

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 11,
        borderBottomWidth: isLast ? 0 : 1,
        borderBottomColor: theme.colors.border,
      }}
    >
      <Ionicons name={icon} size={17} color={color} style={{ marginRight: 10 }} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.colors.textPrimary, fontSize: 13.5, fontWeight: '600' }} numberOfLines={1}>
          {run.name || run.email}
        </Text>
        <Text style={{ color: theme.colors.textSecondary, fontSize: 11.5, marginTop: 2 }} numberOfLines={1}>
          {when}
          {run.sizeKb ? ` · ${run.sizeKb} KB` : ''}
          {run.subjectCount > 1 ? ` · ${run.subjectCount} people` : ''}
          {run.isTest ? ' · on demand' : ' · automatic'}
        </Text>
        {!!run.error && (
          <Text style={{ color: '#DC2626', fontSize: 11.5, marginTop: 2 }} numberOfLines={2}>
            {run.error}
          </Text>
        )}
      </View>
    </View>
  );
});

export default function MonthlyReportSection() {
  const { theme } = useContext(ThemeContext);
  const { user } = useContext(AuthContext);
  const { showAlert } = useAlert();

  const months = useMemo(() => monthOptions(MONTHS_OFFERED), []);
  // Default to the month that just ended — the same one the cron reports on,
  // and the one an admin almost always wants.
  const [period, setPeriod] = useState(() => months[1]?.period || months[0].period);

  const [mode, setMode] = useState('user');          // 'user' | 'team'
  const [staff, setStaff] = useState(null);
  const [team, setTeam] = useState(null);
  const [includeTeam, setIncludeTeam] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);

  const [teams, setTeams] = useState([]);
  const [loadingTeams, setLoadingTeams] = useState(true);
  const [sending, setSending] = useState(false);

  const [runs, setRuns] = useState([]);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const selectedMonth = months.find((m) => m.period === period);
  const isCurrentMonth = !!selectedMonth?.inProgress;

  // The staff picker fetches through the same endpoint that supplies the teams,
  // so both halves of the form always agree on who exists.
  const staffFetcher = useCallback(async (search) => {
    const res = await getReportSubjects(search);
    return { data: res?.data || [] };
  }, []);

  const loadTeams = useCallback(async () => {
    try {
      const res = await getReportSubjects('');
      setTeams(res?.teams || []);
    } catch (e) {
      // Non-fatal: the person mode still works without the team list.
    } finally {
      setLoadingTeams(false);
    }
  }, []);

  const loadRuns = useCallback(async (p, isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoadingRuns(true);
    try {
      const res = await getReportRuns(p);
      setRuns(res?.runs || []);
    } catch (e) {
      setRuns([]);
    } finally {
      setLoadingRuns(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadTeams(); }, [loadTeams]);
  useEffect(() => { loadRuns(period); }, [period, loadRuns]);

  const subject = mode === 'team' ? team : staff;
  const canSend = !!subject && !sending;

  const send = async () => {
    if (!subject) {
      showAlert(
        mode === 'team' ? 'Team required' : 'Person required',
        `Please choose a ${mode === 'team' ? 'team' : 'staff member'} to generate the report for.`,
        'warning'
      );
      return;
    }

    setSending(true);
    try {
      const res = await requestReport({
        period,
        subjectType: mode,
        subjectId: subject._id,
        includeTeam: mode === 'user' ? includeTeam : true,
      });

      await loadRuns(period);

      const s = res?.summary;
      const detail = s
        ? `\n\nAttendance ${s.attendanceRate}%  ·  ${s.present}/${s.workingDays} days present`
          + `\nActivities ${s.activities}  ·  School visits ${s.schoolVisits}`
          + `\nOverall score ${s.score}/100 (${s.grade})`
        : res?.subject?.memberCount
          ? `\n\nCovering all ${res.subject.memberCount} member(s) of the team.`
          : '';

      showAlert(
        'Report sent',
        `The ${periodLabel(period)} report for ${res?.subject?.name || subject.name} `
        + `has been emailed to you at ${res?.sentTo || user?.email}.`
        + (res?.partialMonth ? `\n\nThis month is still in progress, so the report covers 1 ${periodLabel(period).split(' ')[0]} up to ${istToday()}.` : '')
        + detail,
        'success'
      );
    } catch (e) {
      showAlert('Could not send the report', reportError(e), 'error');
    } finally {
      setSending(false);
    }
  };

  const label = { color: theme.colors.textSecondary, fontSize: 13, fontWeight: '700', marginBottom: 10 };
  const card = {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  };

  return (
    <ScrollView
      contentContainerStyle={{ paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { loadTeams(); loadRuns(period, true); }}
          tintColor={theme.colors.primary}
          colors={[theme.colors.primary]}
          progressBackgroundColor={theme.colors.surface}
        />
      }
    >
      {/* ---- What this does, and where it lands ---- */}
      <View
        style={{
          flexDirection: 'row',
          backgroundColor: `${theme.colors.primary}14`,
          borderRadius: 12,
          padding: 14,
          marginBottom: 16,
        }}
      >
        <Ionicons name="mail-outline" size={19} color={theme.colors.primary} style={{ marginRight: 10, marginTop: 1 }} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.colors.textPrimary, fontSize: 13.5, fontWeight: '700' }}>
            The report is emailed to you
          </Text>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12.5, marginTop: 3, lineHeight: 18 }}>
            A PDF is sent to{' '}
            <Text style={{ color: theme.colors.primary, fontWeight: '700' }}>{user?.email}</Text>
            . The staff member is not emailed a copy, and this never replaces the automatic report
            they receive on the 1st.
          </Text>
        </View>
      </View>

      {/* ---- Month ---- */}
      <View style={card}>
        <Text style={label}>MONTH</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {months.map((m) => (
            <Chip
              key={m.period}
              label={m.short}
              sub={m.inProgress ? 'so far' : null}
              active={m.period === period}
              onPress={() => setPeriod(m.period)}
              theme={theme}
            />
          ))}
        </View>
        {isCurrentMonth && (
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginTop: 4 }}>
            <Ionicons name="information-circle-outline" size={15} color="#D97706" style={{ marginRight: 6, marginTop: 1 }} />
            <Text style={{ color: '#D97706', fontSize: 12, flex: 1, lineHeight: 17 }}>
              {periodLabel(period)} is still in progress. The report will cover the month up to{' '}
              {istToday()} — days that have not happened yet are left out, not counted as absences.
            </Text>
          </View>
        )}
      </View>

      {/* ---- Who ---- */}
      <View style={card}>
        <Text style={label}>REPORT FOR</Text>
        <View style={{ flexDirection: 'row', marginBottom: 14 }}>
          <Chip label="A person" icon="person-outline" active={mode === 'user'} onPress={() => setMode('user')} theme={theme} />
          <Chip label="A team" icon="people-outline" active={mode === 'team'} onPress={() => setMode('team')} theme={theme} />
        </View>

        {mode === 'user' ? (
          <>
            <TouchableOpacity
              onPress={() => setPickerOpen(true)}
              activeOpacity={0.8}
              style={{
                borderWidth: 1,
                borderColor: staff ? theme.colors.primary : theme.colors.border,
                borderRadius: 12,
                padding: 14,
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: theme.colors.background,
              }}
            >
              <Ionicons
                name={staff ? 'person-circle' : 'search-outline'}
                size={20}
                color={staff ? theme.colors.primary : theme.colors.textSecondary}
                style={{ marginRight: 10 }}
              />
              <View style={{ flex: 1 }}>
                <Text style={{ color: staff ? theme.colors.textPrimary : theme.colors.textSecondary, fontSize: 14, fontWeight: staff ? '700' : '400' }}>
                  {staff ? staff.name : 'Search trainers, team leaders and heads…'}
                </Text>
                {!!staff && (
                  <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 }}>
                    {roleLabel(staff.role)}{staff.teamName ? ` · ${staff.teamName}` : ''}
                  </Text>
                )}
              </View>
              {!!staff && (
                <TouchableOpacity onPress={() => setStaff(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Ionicons name="close-circle" size={19} color={theme.colors.textSecondary} />
                </TouchableOpacity>
              )}
            </TouchableOpacity>

            {/* Only meaningful for someone who has people under them. */}
            {!!staff?.isManager && (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  marginTop: 14,
                  paddingTop: 14,
                  borderTopWidth: 1,
                  borderTopColor: theme.colors.border,
                }}
              >
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={{ color: theme.colors.textPrimary, fontSize: 13.5, fontWeight: '600' }}>
                    Include their team
                  </Text>
                  <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 3, lineHeight: 17 }}>
                    {includeTeam
                      ? `Adds a page for everyone reporting to ${staff.name.split(' ')[0]} — exactly what they receive on the 1st.`
                      : `Only ${staff.name.split(' ')[0]}'s own performance.`}
                  </Text>
                </View>
                <Switch
                  value={includeTeam}
                  onValueChange={setIncludeTeam}
                  trackColor={{ false: theme.colors.border, true: `${theme.colors.primary}80` }}
                  thumbColor={includeTeam ? theme.colors.primary : '#f4f3f4'}
                />
              </View>
            )}
          </>
        ) : loadingTeams ? (
          <ActivityIndicator color={theme.colors.primary} />
        ) : teams.length === 0 ? (
          <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>
            No teams have been created yet.
          </Text>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {teams.map((t) => (
              <Chip
                key={t._id}
                label={t.name}
                sub={`${t.memberCount}`}
                active={team?._id === t._id}
                onPress={() => setTeam(t)}
                theme={theme}
                icon="people-outline"
              />
            ))}
          </View>
        )}
      </View>

      {/* ---- Send ---- */}
      <TouchableOpacity
        onPress={send}
        disabled={!canSend}
        activeOpacity={0.85}
        style={{
          backgroundColor: canSend ? theme.colors.primary : theme.colors.border,
          borderRadius: 14,
          paddingVertical: 16,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 24,
        }}
      >
        {sending ? (
          <>
            <ActivityIndicator color="#fff" size="small" />
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700', marginLeft: 10 }}>
              Generating and sending…
            </Text>
          </>
        ) : (
          <>
            <Ionicons name="send" size={17} color={canSend ? '#fff' : theme.colors.textSecondary} style={{ marginRight: 9 }} />
            <Text style={{ color: canSend ? '#fff' : theme.colors.textSecondary, fontSize: 15, fontWeight: '700' }}>
              {subject
                ? `Email me ${subject.name}'s ${selectedMonth?.short} report`
                : 'Choose who to report on'}
            </Text>
          </>
        )}
      </TouchableOpacity>

      {/* ---- What has been sent ---- */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
        <Text style={{ color: theme.colors.textPrimary, fontSize: 15, fontWeight: '700', flex: 1 }}>
          Reports sent · {selectedMonth?.short}
        </Text>
        <TouchableOpacity onPress={() => loadRuns(period, true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="refresh" size={17} color={theme.colors.primary} />
        </TouchableOpacity>
      </View>
      <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginBottom: 10, lineHeight: 17 }}>
        Everything delivered for this month — the automatic 1st-of-month run and anything requested here.
      </Text>

      {loadingRuns ? (
        <SkeletonList count={4} />
      ) : runs.length === 0 ? (
        <View style={{ ...card, alignItems: 'center', paddingVertical: 26 }}>
          <Ionicons name="mail-open-outline" size={30} color={theme.colors.textSecondary} />
          <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginTop: 8, textAlign: 'center' }}>
            Nothing sent for {periodLabel(period)} yet.
            {'\n'}The automatic run goes out at 6 AM on the 1st of the following month.
          </Text>
        </View>
      ) : (
        <View style={{ ...card, paddingVertical: 4 }}>
          {runs.map((r, i) => (
            <RunRow key={r.id} run={r} theme={theme} isLast={i === runs.length - 1} />
          ))}
        </View>
      )}

      <StaffPickerModal
        visible={pickerOpen}
        title="Select a staff member"
        fetcher={staffFetcher}
        selectedId={staff?._id}
        onSelect={(u) => { setStaff(u); setIncludeTeam(true); }}
        onClose={() => setPickerOpen(false)}
      />
    </ScrollView>
  );
}
