import { router } from 'expo-router';
import { Text } from 'react-native';
import { useSession } from '../../src/state/session';
import { appVersion } from '../../src/lib/device';
import { t } from '../../src/i18n';
import { Button, Card, H1, Muted, Row, Screen } from '../../src/ui';

export default function More() {
  const { me, membership, signOut, setCompany } = useSession();
  const others = me?.memberships.filter((m) => m.role === 'employee' && m.companyId !== membership?.companyId) ?? [];
  return (
    <Screen>
      <H1>{t('more')}</H1>
      <Card>
        <Text style={{ fontSize: 18, fontWeight: '700' }}>{me?.fullName}</Text>
        <Muted>{me?.email}</Muted>
        <Muted>{membership?.companyName}</Muted>
      </Card>
      <Card>
        <Row title={t('pay')} onPress={() => router.push('/pay')} />
        <Row title={t('notifications')} onPress={() => router.push('/notifications')} />
        <Row title={t('sync_status')} onPress={() => router.push('/sync')} />
      </Card>
      {others.length > 0 && (
        <Card>
          <Muted>Switch company</Muted>
          {others.map((m) => <Row key={m.companyId} title={m.companyName} onPress={() => setCompany(m.companyId)} />)}
        </Card>
      )}
      <Muted>{t('privacy')}</Muted>
      <Button kind="secondary" title={t('sign_out')} onPress={() => void signOut().then(() => router.replace('/login'))} />
      <Muted style={{ textAlign: 'center' }}>{t('version', { v: appVersion })}</Muted>
    </Screen>
  );
}
