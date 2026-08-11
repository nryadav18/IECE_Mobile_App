import React, { useRef } from 'react';
import { View } from 'react-native';

/**
 * A tab panel that is not built until the tab is first opened, and is kept
 * alive once it has been.
 *
 * WHY THIS EXISTS
 *
 * The portal screens each hold many tabs and used to render every one of them
 * at all times, hiding the inactive ones with `display: 'none'`:
 *
 *     <View style={{ display: activeTab === 'Teams' ? 'flex' : 'none' }}>…</View>
 *
 * That keeps a tab's state and scroll position when you switch away, which is
 * the behaviour we want — but it also means opening the Admin portal mounted
 * twelve tabs at once, ran all of their effects, and then re-rendered all
 * twelve on every one of the screen's ~50 pieces of state. Typing a single
 * character into a search box reconciled the entire portal, including eleven
 * tabs nobody was looking at. That is what made the app feel stuck.
 *
 * WHAT THIS CHANGES — AND WHAT IT DELIBERATELY DOES NOT
 *
 * A tab renders nothing until the first time it becomes active. From then on it
 * stays mounted for the life of the screen and is hidden with `display: 'none'`
 * exactly as before, so:
 *
 *   - switching away and back keeps state, scroll position and fetched data,
 *     identical to the old behaviour;
 *   - a tab you never open costs nothing at all — no mount, no effects, no
 *     fetch, no reconciliation.
 *
 * Nothing is unmounted and no feature is removed. The only thing that changes
 * is WHEN a tab is first built: on demand, instead of all of them up front.
 *
 * `display: 'none'` is kept rather than skipping the render, because a tab that
 * stopped rendering while hidden would lose its scroll offset and any
 * half-completed form the moment you glanced at another tab.
 *
 * A side benefit worth knowing about: entrance animations inside a tab now play
 * when the tab is actually first shown. Previously every tab mounted at startup
 * and ran its entrance animation immediately — invisibly, behind
 * `display: 'none'` — so by the time you opened it the animation was long over
 * and the content simply appeared.
 */
export default function LazyTab({ active, children, style }) {
  // Sticky: flips to true on first activation and never goes back.
  const mounted = useRef(false);
  if (active) mounted.current = true;

  if (!mounted.current) return null;

  return (
    <View style={[{ display: active ? 'flex' : 'none' }, style]}>
      {children}
    </View>
  );
}
