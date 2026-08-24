import React, { useContext, useMemo } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemeContext } from '../context/ThemeContext';

/**
 * The page control that sits under a list.
 *
 * WHY IT EXISTS
 *
 * The activity lists used to render every activity at once — Home as a
 * sideways strip, the portals as an endless column. Both meant the phone pulled
 * a cover image for every activity in the organisation to draw the two or three
 * a person could actually see. Paging is first a bandwidth decision and only
 * second a layout one.
 *
 * WHY NUMBERED BUTTONS RATHER THAN INFINITE SCROLL
 *
 * Infinite scroll has no idea when to stop, so it keeps fetching — and keeps
 * downloading covers — for as long as a thumb keeps moving. Explicit pages
 * download exactly one page and nothing else, and they also answer "how much is
 * there?" and "where am I?", which a scrolling list never does.
 *
 * THE WINDOW
 *
 * Only a few numbers are shown at once, always including the first page, the
 * last page and the current one, with ellipses standing in for the rest. A row
 * of forty page buttons is not a control, it is a wall — and on a phone it
 * would be the horizontal scroller this whole change exists to remove.
 */

/**
 * Which page numbers to render, given where we are and how many there are.
 *
 * Always yields first and last so the two ends are one tap away, and keeps the
 * run of numbers a CONSTANT width so the bar does not jitter as pages change —
 * a control that resizes under the finger is one people mis-tap.
 *
 * Returns numbers and the string '…' for gaps.
 */
export function pageWindow(current, pages, span = 1) {
  if (pages <= 1) return [1];

  // first + last + current + `span` either side + up to two ellipses.
  const slots = span * 2 + 5;
  if (pages <= slots) return Array.from({ length: pages }, (_, i) => i + 1);

  const out = [1];
  // Shift the window when we are near an end rather than letting it collapse.
  //
  // Near page 1 there is nothing to the left to show, so the extra slot is
  // spent on the right — and vice versa near the last page. The `+ 2` / `- 1`
  // are what make the run of buttons exactly as wide at page 1, page 10 and
  // page 20: one ellipsis is replaced by one number, never simply dropped. A
  // bar that changes width as you page through it is one people mis-tap,
  // because Next moves out from under the finger that is repeating it.
  let from = Math.max(2, current - span);
  let to = Math.min(pages - 1, current + span);
  const room = span * 2 + 1;
  if (current - span <= 2) to = Math.min(pages - 1, room + 2);
  if (current + span >= pages - 1) from = Math.max(2, pages - room - 1);

  if (from > 2) out.push('…');
  for (let p = from; p <= to; p += 1) out.push(p);
  if (to < pages - 1) out.push('…');
  out.push(pages);
  return out;
}

export default function Paginator({
  page,
  pages,
  total,
  onChange,
  loading = false,
  // What the counted things are called, for the "13 activities" line.
  label = 'items',
  style,
}) {
  const { theme } = useContext(ThemeContext);
  const numbers = useMemo(() => pageWindow(page, pages), [page, pages]);

  // Nothing to page through — say how many there are and stop. Rendering a
  // dead Prev/Next pair under a three-item list is noise pretending to be a
  // control.
  if (pages <= 1) {
    if (!total) return null;
    return (
      <View style={[styles.bar, { justifyContent: 'center' }, style]}>
        <Text style={[styles.count, { color: theme.colors.textSecondary }]}>
          {total} {total === 1 ? label.replace(/s$/, '') : label}
        </Text>
      </View>
    );
  }

  const go = (p) => {
    if (loading || p === page || p < 1 || p > pages) return;
    onChange(p);
  };

  const Arrow = ({ dir }) => {
    const back = dir === 'back';
    const target = back ? page - 1 : page + 1;
    const disabled = loading || (back ? page <= 1 : page >= pages);
    return (
      <TouchableOpacity
        onPress={() => go(target)}
        disabled={disabled}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={back ? 'Previous page' : 'Next page'}
        accessibilityState={{ disabled }}
        style={[
          styles.arrow,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
            opacity: disabled ? 0.4 : 1,
          },
        ]}
      >
        <Ionicons
          name={back ? 'chevron-back' : 'chevron-forward'}
          size={16}
          color={theme.colors.textPrimary}
        />
        <Text style={[styles.arrowText, { color: theme.colors.textPrimary }]}>
          {back ? 'Prev' : 'Next'}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[{ marginTop: 14 }, style]}>
      <View style={styles.bar}>
        <Arrow dir="back" />

        <View style={styles.numbers}>
          {numbers.map((n, i) =>
            n === '…' ? (
              <View key={`gap-${i}`} style={styles.gap}>
                <Text style={{ color: theme.colors.textSecondary, fontWeight: '700' }}>…</Text>
              </View>
            ) : (
              <TouchableOpacity
                key={n}
                onPress={() => go(n)}
                disabled={loading}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`Page ${n}`}
                accessibilityState={{ selected: n === page }}
                style={[
                  styles.num,
                  n === page
                    ? { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary }
                    : { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
                ]}
              >
                <Text
                  style={[
                    styles.numText,
                    { color: n === page ? '#FFFFFF' : theme.colors.textPrimary },
                  ]}
                >
                  {n}
                </Text>
              </TouchableOpacity>
            )
          )}
        </View>

        <Arrow dir="fwd" />
      </View>

      <View style={styles.footer}>
        {loading ? (
          <ActivityIndicator size="small" color={theme.colors.primary} />
        ) : (
          <Text style={[styles.count, { color: theme.colors.textSecondary }]}>
            Page {page} of {pages} · {total} {total === 1 ? label.replace(/s$/, '') : label}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    // Wraps rather than scrolls: on the narrowest phones the numbers drop to
    // their own line instead of running off the edge. A control that has to be
    // scrolled sideways to reach is the thing this replaced.
    flexWrap: 'wrap',
    rowGap: 8,
  },
  numbers: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, justifyContent: 'center' },
  num: {
    minWidth: 34,
    height: 34,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  numText: { fontSize: 13, fontWeight: '700' },
  gap: { minWidth: 20, height: 34, alignItems: 'center', justifyContent: 'center' },
  arrow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 34,
    borderRadius: 9,
    borderWidth: 1,
    paddingHorizontal: 10,
    gap: 3,
  },
  arrowText: { fontSize: 12.5, fontWeight: '700' },
  footer: { alignItems: 'center', marginTop: 9, minHeight: 18 },
  count: { fontSize: 11.5, fontWeight: '600' },
});
