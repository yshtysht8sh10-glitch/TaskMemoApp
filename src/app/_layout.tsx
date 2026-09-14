import { Stack } from 'expo-router';
import { initialWindowMetrics, SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ThemeProvider } from '@/theme/theme';
import { PwaRegistration } from '@/components/PwaRegistration';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}><ThemeProvider><PwaRegistration /><Stack screenOptions={{ headerShown: false }} /></ThemeProvider></SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
