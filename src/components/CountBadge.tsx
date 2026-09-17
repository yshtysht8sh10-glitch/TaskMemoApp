import { useEffect, useRef } from "react";
import { StyleSheet, Text } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { useAppTheme, type ThemeColors } from "@/theme/theme";
import { countBadgeText, shouldAnimateCountChange } from "@/utils/countBadge";

export function CountBadge({ count }: { count: number }) {
  const styles = createStyles(useAppTheme().colors);
  const previousCount = useRef<number | null>(null);
  const scale = useSharedValue(1);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const shouldAnimate = shouldAnimateCountChange(
      previousCount.current,
      count,
      reduceMotion,
    );
    previousCount.current = count;
    if (!shouldAnimate || reduceMotion) {
      scale.value = 1;
      return;
    }
    scale.value = withSequence(
      withTiming(1.25, {
        duration: 90,
        easing: Easing.out(Easing.cubic),
      }),
      withTiming(0.95, { duration: 70, easing: Easing.inOut(Easing.quad) }),
      withTiming(1, { duration: 110, easing: Easing.out(Easing.back(2)) }),
    );
  }, [count, reduceMotion, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const label = countBadgeText(count);
  if (label === null) return null;
  return (
    <Animated.View
      accessible
      accessibilityLabel={`${count}件`}
      style={[styles.badge, animatedStyle]}
    >
      <Text style={styles.text}>{label}</Text>
    </Animated.View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    badge: {
      minWidth: 25,
      height: 20,
      marginHorizontal: 8,
      paddingHorizontal: 7,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 10,
      backgroundColor: colors.surfaceAlt,
    },
    text: {
      color: colors.textSecondary,
      fontSize: 11,
      fontWeight: "700",
      lineHeight: 14,
      textAlign: "center",
    },
  });
