import { Children, useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, type ViewStyle } from 'react-native';

/**
 * KAREN motion: one easing curve everywhere (fast start, soft settle), transform/opacity only,
 * native driver only (runs on the UI thread, so JS work can't make it stutter). Everything is
 * skipped when the user has "reduce motion" on.
 */
export const EASE = Easing.bezier(0.32, 0.72, 0, 1);
export const DURATION = { press: 160, reveal: 480, stagger: 70 } as const;

/** True when the OS "reduce motion" setting is on. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (alive) setReduced(v);
      })
      .catch(() => {
        // Unknown → keep motion on; it is decorative and never carries meaning.
      });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

/** Fades + rises its child into place, `index` steps after the screen opens. */
export function Reveal({
  index = 0,
  children,
  style,
}: {
  index?: number;
  children: ReactNode;
  style?: ViewStyle;
}) {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) {
      progress.setValue(1);
      return;
    }
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: DURATION.reveal,
      delay: 60 + index * DURATION.stagger,
      easing: EASE,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [index, progress, reduced]);
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * Staggers each direct child in with <Reveal>. `gap` is re-applied INSIDE each wrapper:
 * a child component that renders a fragment of several fields (e.g. a form inside
 * <QueryView>) would otherwise lose the parent's spacing and its fields would touch.
 */
export function Stagger({
  children,
  start = 0,
  gap,
}: {
  children: ReactNode;
  start?: number;
  gap?: number;
}) {
  let i = start;
  return (
    <>
      {Children.map(children, (child) =>
        child === null || child === undefined || child === false ? null : (
          <Reveal index={i++} {...(gap === undefined ? {} : { style: { gap } })}>
            {child}
          </Reveal>
        ),
      )}
    </>
  );
}

/** Springy press feedback: returns an animated scale and the press handlers that drive it. */
export function usePressScale(to = 0.97) {
  const scale = useRef(new Animated.Value(1)).current;
  const spring = (toValue: number) =>
    Animated.spring(scale, {
      toValue,
      useNativeDriver: true,
      speed: 40,
      bounciness: toValue === 1 ? 6 : 0,
    }).start();
  return {
    scale,
    onPressIn: () => spring(to),
    onPressOut: () => spring(1),
  };
}

/** A slow "alive" breathing pulse (KAREN's ember core). Decorative. */
export function usePulse(): Animated.Value {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 1400, easing: EASE, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 1400, easing: EASE, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduced, v]);
  return v;
}
