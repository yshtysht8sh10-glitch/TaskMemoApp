import type { ReactNode } from 'react';
import { Animated, PanResponder, Platform, StyleSheet, View } from 'react-native';
import { useAppTheme } from '@/theme/theme';
import { sheetDismissRelease } from '@/utils/sheetDismissGesture';

// Keep this surface outside ScrollView: text selection and content scrolling
// must never enter the sheet's responder, even when the content is at the top.
export function SheetDismissHeader({ children, nativeID, translateY, viewportHeight, onDismiss }: {
  children: ReactNode;
  nativeID?: string;
  translateY: Animated.Value;
  viewportHeight: number;
  onDismiss: () => void;
}) {
  const { colors } = useAppTheme();
  const restore = () => Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
  const responder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderMove: (_event, gesture) => translateY.setValue(Math.max(0, gesture.dy)),
    onPanResponderRelease: (_event, gesture) => {
      if (gesture.dy > Math.abs(gesture.dx) && sheetDismissRelease({ distance: Math.max(0, gesture.dy), velocity: gesture.vy, viewportHeight }) === 'commit-close') {
        onDismiss();
        translateY.setValue(0);
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
