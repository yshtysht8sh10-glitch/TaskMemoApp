import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, PanResponder, Platform, StyleSheet, View } from 'react-native';
import { useAppTheme } from '@/theme/theme';
import { sheetDismissRelease } from '@/utils/sheetDismissGesture';
import { createSheetExitTransition } from '@/utils/sheetExitTransition';

// Keep this surface outside ScrollView: text selection and content scrolling
// must never enter the sheet's responder, even when the content is at the top.
export function SheetDismissHeader({ children, nativeID, translateY, viewportHeight, onDismiss, onExitStart }: {
  children: ReactNode;
  nativeID?: string;
  translateY: Animated.Value;
  viewportHeight: number;
  onDismiss: () => boolean | void | Promise<boolean | void>;
  onExitStart: () => void;
}) {
  const { colors } = useAppTheme();
  const callbacks = useRef({ onDismiss, onExitStart });
  useEffect(() => { callbacks.current = { onDismiss, onExitStart }; });
  const restore = () => Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
  // The adapter stores callbacks; it only invokes them from gesture/animation events.
  // eslint-disable-next-line react-hooks/refs
  const [transition] = useState(() => createSheetExitTransition({
    animate: (toValue, duration, complete) => {
      callbacks.current.onExitStart();
      Animated.timing(translateY, { toValue, duration, easing: Easing.out(Easing.quad), useNativeDriver: true })
        .start(({ finished }) => complete(finished));
    },
    restore,
    stop: () => translateY.stopAnimation(),
  }));
  useEffect(() => () => transition.cancel(), [transition]);
  // PanResponder stores callbacks without reading their refs during render.
  // eslint-disable-next-line react-hooks/refs
  const responder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { if (!transition.busy()) translateY.stopAnimation(); },
    onPanResponderMove: (_event, gesture) => { if (!transition.busy()) translateY.setValue(Math.max(0, gesture.dy)); },
    onPanResponderRelease: (_event, gesture) => {
      if (transition.busy()) return;
      if (gesture.dy > Math.abs(gesture.dx) && sheetDismissRelease({ distance: Math.max(0, gesture.dy), velocity: gesture.vy, viewportHeight }) === 'commit-close') {
        transition.exit({ distance: Math.max(0, gesture.dy), velocity: gesture.vy, viewportHeight }, () => callbacks.current.onDismiss());
      } else restore();
    },
    onPanResponderTerminate: restore,
    onPanResponderTerminationRequest: () => false,
  });
  return <View nativeID={nativeID} style={[styles.header, Platform.OS === 'web' && { touchAction: 'none' }]} {...responder.panHandlers}>
    <View style={[styles.grabber, { backgroundColor: colors.border }]} />
    {children}
  </View>;
}

const styles = StyleSheet.create({
  header: { minHeight: 72, paddingHorizontal: 22, paddingTop: 12, paddingBottom: 12 },
  grabber: { width: 42, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: 12 },
});
