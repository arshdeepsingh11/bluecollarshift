import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider } from '../src/state/session';
import { theme } from '../src/lib/config';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerTintColor: theme.primary, headerTitleStyle: { color: theme.text }, contentStyle: { backgroundColor: theme.bg } }}>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="timesheet/[id]" options={{ title: 'Timesheet' }} />
          <Stack.Screen name="chat/[id]" options={{ title: 'Messages' }} />
          <Stack.Screen name="pay" options={{ title: 'Pay history' }} />
          <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
          <Stack.Screen name="sync" options={{ title: 'Attendance sync' }} />
        </Stack>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
