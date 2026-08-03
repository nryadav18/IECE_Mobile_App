import React, { useCallback } from 'react';
import { Pressable } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { SPRING } from './motion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * A pressable that physically responds to the finger.
 *
 * `activeOpacity` fading is what most RN apps do; it reads as flat. A spring
 * on scale reads as a real surface being pushed — and because the spring runs
 * on the UI thread it stays responsive even while the JS thread is busy
 * handling the navigation that the press just triggered.
 */
export default function PressableScale({
  children,
  style,
  scaleTo = 0.96,
  disabled,
  ...rest
}) {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);

  const onPressIn = useCallback(() => {
    if (!reduced && !disabled) scale.value = withSpring(scaleTo, SPRING.press);
  }, [reduced, disabled, scaleTo, scale]);

  const onPressOut = useCallback(() => {
    if (!reduced) scale.value = withSpring(1, SPRING.settle);
  }, [reduced, scale]);

  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={disabled}
      style={[style, animated]}
      {...rest}
    >
      {children}
    </AnimatedPressable>
  );
}
