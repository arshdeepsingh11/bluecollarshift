import { router } from 'expo-router';
import { Text } from 'react-native';
import { useSession } from '../src/state/session';
import { LANGUAGES, t } from '../src/i18n';
import { Card, Row, Screen } from '../src/ui';
import { theme } from '../src/lib/config';

export default function Language() {
  const { locale, changeLocale } = useSession();
  return (
    <Screen>
      <Card>
        {LANGUAGES.map((l) => (
          <Row key={l.code} title={l.name} right={locale === l.code ? <Text style={{ color: theme.primary, fontSize: 18 }} accessibilityLabel={t('saved')}>✓</Text> : undefined}
            onPress={() => void changeLocale(l.code).then(() => router.back())} />
        ))}
      </Card>
    </Screen>
  );
}
