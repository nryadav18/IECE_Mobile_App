import React, { useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

/**
 * A number that counts up to its value instead of appearing.
 *
 * Deliberately driven from JS rather than a shared value: React Native cannot
 * animate a `<Text>`'s children from the UI thread without either a native
 * text-props hack or an extra dependency, and this is a *one-shot* ~900ms
 * animation that runs when data lands — not a loop. One short rAF run costs
 * nothing, and it keeps the component dependency-free and identical on every
 * platform. Everything that runs *continuously* on this screen is on the UI
 * thread; this one thing does not need to be.
 */
export default function AnimatedCounter({
  value = 0,
  duration = 950,
  style,
  suffix = '',
  ...rest
}) {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  const rafRef = useRef(null);

  useEffect(() => {
    const to = Number.isFinite(Number(value)) ? Number(value) : 0;
    // Start from whatever is currently on screen, not from the previous
    // *target* — so a value that changes mid-count (a refresh landing) keeps
    // counting from where the eye left it instead of jumping.
    const from = fromRef.current;

    if (reduced || from === to || duration <= 0) {
      fromRef.current = to;
      setDisplay(to);
      return undefined;
    }

    let start = null;
    const tick = (ts) => {
      if (start === null) start = ts;
      const t = Math.min((ts - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic — fast, then settles
      const next = Math.round(from + (to - from) * eased);
      fromRef.current = next;
      setDisplay(next);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [value, duration, reduced]);

  return (
    <Text style={style} {...rest}>
      {display}
      {suffix}
    </Text>
  );
}
