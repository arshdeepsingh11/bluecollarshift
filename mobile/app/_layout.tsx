import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider, useSession } from '../src/state/session';
import { t } from '../src/i18n';
import { theme } from '../src/lib/config';

function Screens() {
  // Re-render every screen title when the language changes.
  const { locale } = useSession();
  return (
    <Stack key={locale} screenOptions={{ headerTintColor: theme.primary, headerTitleStyle: { color: theme.text }, contentStyle: { backgroundColor: theme.bg }, headerBackTitle: t('close') }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="timesheet/[id]" options={{ title: t('timesheet') }} />
      <Stack.Screen name="chat/[id]" options={{ title: t('messages') }} />
      <Stack.Screen name="pay" options={{ title: t('pay') }} />
      <Stack.Screen name="notifications" options={{ title: t('notifications') }} />
      <Stack.Screen name="sync" options={{ title: t('sync_status') }} />
      <Stack.Screen name="crew" options={{ title: t('crew') }} />
      <Stack.Screen name="requests" options={{ title: t('requests') }} />
      <Stack.Screen name="safety" options={{ title: t('safety') }} />
      <Stack.Screen name="feedback" options={{ title: t('feedback') }} />
      <Stack.Screen name="language" options={{ title: t('language') }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="dark" />
        <Screens />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
