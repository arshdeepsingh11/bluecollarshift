import { Redirect, Tabs } from 'expo-router';
import { Text, type ColorValue } from 'react-native';
import { useSession } from '../../src/state/session';
import { theme } from '../../src/lib/config';
import { t } from '../../src/i18n';
import { Banner, Screen } from '../../src/ui';

const icon = (glyph: string) => ({ color }: { color: ColorValue }) => <Text style={{ fontSize: 20, color }}>{glyph}</Text>;

export default function TabsLayout() {
  const { session, me, membership, signOut, updateRequired, locale } = useSession();
  if (!session || !me) return <Redirect href="/login" />;
  if (updateRequired)
    return (
      <Screen>
        <Banner tone="warning" text={t('update_required')} />
      </Screen>
    );
  if (!membership)
    return (
      <Screen>
        <Banner tone="warning" text={t('not_employee')} onPress={() => void signOut()} />
      </Screen>
    );
  return (
    <Tabs key={locale} screenOptions={{ tabBarActiveTintColor: theme.primary, headerShown: false, tabBarLabelStyle: { fontSize: 12, fontWeight: '600' } }}>
      <Tabs.Screen name="index" options={{ title: t('today'), tabBarIcon: icon('⏱') }} />
      <Tabs.Screen name="schedule" options={{ title: t('schedule'), tabBarIcon: icon('📅') }} />
      <Tabs.Screen name="hours" options={{ title: t('hours'), tabBarIcon: icon('🧾') }} />
      <Tabs.Screen name="messages" options={{ title: t('messages'), tabBarIcon: icon('💬') }} />
      <Tabs.Screen name="more" options={{ title: t('more'), tabBarIcon: icon('☰') }} />
    </Tabs>
  );
}
