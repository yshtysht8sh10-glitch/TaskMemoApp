import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import Animated, { Easing, interpolate, LinearTransition, ReduceMotion, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';

export function CompletionMotion({ completing, onFinished, children }: { completing: boolean; onFinished: () => void; children: ReactNode }) {
  const progress = useSharedValue(0); const reduceMotion = useReducedMotion();
  const finishedRef = useRef(onFinished);
  useEffect(() => { finishedRef.current = onFinished; }, [onFinished]);
  const finishOnJS = useCallback(() => finishedRef.current(), []);
  useEffect(() => {
    if (!completing) { progress.value = withTiming(0, { duration: reduceMotion ? 0 : 140 }); return; }
    progress.value = withSequence(withTiming(0.24, { duration: reduceMotion ? 0 : 105, easing: Easing.out(Easing.back(2.4)) }), withTiming(1, { duration: reduceMotion ? 0 : 300, easing: Easing.in(Easing.cubic) }, (finished) => { if (finished) runOnJS(finishOnJS)(); }));
  }, [completing, finishOnJS, progress, reduceMotion]);
  const animatedStyle = useAnimatedStyle(() => ({ opacity: interpolate(progress.value, [0, 0.24, 0.58, 1], [1, 1, 0.88, 0]), transform: [{ translateX: interpolate(progress.value, [0, 0.24, 1], [0, -5, 54]) }, { translateY: interpolate(progress.value, [0, 0.24, 1], [0, 0, -18]) }, { rotateZ: `${interpolate(progress.value, [0, 0.24, 1], [0, -1.5, 7])}deg` }, { scale: interpolate(progress.value, [0, 0.24, 0.58, 1], [1, 1.11, 1.02, 0.72]) }] }));
  return <Animated.View layout={LinearTransition.duration(reduceMotion ? 0 : 300).reduceMotion(ReduceMotion.System)} style={animatedStyle}>{children}</Animated.View>;
}
