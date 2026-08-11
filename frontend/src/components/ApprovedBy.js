import React, { useContext } from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemeContext } from '../context/ThemeContext';
import { AuthContext } from '../context/AuthContext';
import { decisionSummary } from '../utils/approvals';

/**
 * "**Approved by** Ravi Kumar (Admin) · 11 Aug 2026, 4:30 PM"
 *
 * The single component that renders who decided something, used on every card,
 * every detail screen and every report in the app so the line reads identically
 * everywhere. Drop it next to a status badge and it does the rest:
 *
 *   <ApprovedBy record={req} />
 *
 * It renders NOTHING unless all of these hold:
 *   - the signed-in user is the Admin or the CEO (several admins share the job
 *     and one CEO oversees them; nobody else needs to know which one acted), and
 *   - the item has actually been decided (a pending item has no approver).
 *
 * The verb follows what was actually done — "Approved by", "Rejected by",
 * "Cancelled by", "Granted by" for an emergency leave, "Dates set by" for an
 * admin revision — because "approved" on a rejection would be worse than
 * saying nothing.
 *
 * Records decided before this feature existed say "Not recorded" rather than
 * disappearing: a blank line reads as "nobody approved this", which is a
 * different and untrue claim.
 *
 * Props
 *   record   the approvable item (must carry `status` and, once decided, `decidedBy`)
 *   compact  one dense line for list cards; default is two lines with the timestamp
 *   style    extra container style
 *   align    'left' (default) | 'right'
 */
export default function ApprovedBy({ record, compact = false, style, align = 'left' }) {
  const { theme } = useContext(ThemeContext);
  const { user } = useContext(AuthContext);

  const summary = decisionSummary(record, user);
  if (!summary) return null;

  const { verb, name, moment, color, icon, recorded } = summary;
  const tint = recorded ? color : theme.colors.textSecondary;

  if (compact) {
    return (
      <View
        style={[
          {
            flexDirection: 'row',
            alignItems: 'center',
            alignSelf: align === 'right' ? 'flex-end' : 'flex-start',
            backgroundColor: tint + '14',
            borderRadius: 8,
            paddingHorizontal: 8,
            paddingVertical: 4,
          },
          style,
        ]}
      >
        <Ionicons name={icon} size={12} color={tint} />
        <Text style={{ fontSize: 11.5, marginLeft: 5, flexShrink: 1 }} numberOfLines={1}>
          <Text style={{ color: tint, fontWeight: '800' }}>{verb} </Text>
          <Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>
            {recorded ? name : 'Not recorded'}
          </Text>
        </Text>
      </View>
    );
  }

  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'flex-start',
          alignSelf: align === 'right' ? 'flex-end' : 'stretch',
          backgroundColor: tint + '12',
          borderRadius: 10,
          borderLeftWidth: 3,
          borderLeftColor: tint,
          paddingHorizontal: 10,
          paddingVertical: 8,
        },
        style,
      ]}
    >
      <Ionicons name={icon} size={15} color={tint} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, marginLeft: 8 }}>
        <Text style={{ fontSize: 13 }}>
          <Text style={{ color: tint, fontWeight: '800' }}>{verb} </Text>
          <Text style={{ color: theme.colors.textPrimary, fontWeight: '700' }}>
            {recorded ? name : 'Not recorded'}
          </Text>
        </Text>
        {recorded && !!moment && (
          <Text style={{ color: theme.colors.textSecondary, fontSize: 11.5, marginTop: 2 }}>{moment}</Text>
        )}
        {!recorded && (
          <Text style={{ color: theme.colors.textSecondary, fontSize: 11.5, marginTop: 2 }}>
            Decided before approver tracking was added
          </Text>
        )}
      </View>
    </View>
  );
}
