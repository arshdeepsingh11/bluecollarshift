import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import type { PayrollRecord } from '@bluecollar/shared';
import { useSession } from '../src/state/session';
import { api } from '../src/lib/api';
import { cacheGet, cacheSet } from '../src/lib/db';
import { t } from '../src/i18n';
import { Badge, Banner, Card, Loading, Muted, Screen, fmtMinutes, fmtMoney } from '../src/ui';

type PayItem = PayrollRecord & { startsOn: string; endsOn: string; payDate: string };

export default function Pay() {
  const { membership } = useSession();
  const companyId = membership!.companyId;
  const [items, setItems] = useState<PayItem[] | null>(null);
  useEffect(() => {
    api<{ items: PayItem[] }>(`/companies/${companyId}/my-pay`)
      .then(async (r) => { setItems(r.items); await cacheSet(`pay:${companyId}`, r.items); })
      .catch(async () => setItems((await cacheGet<PayItem[]>(`pay:${companyId}`))?.value ?? []));
  }, [companyId]);
  if (!items) return <Screen><Loading /></Screen>;
  return (
    <Screen>
      <Banner tone="info" text={t('pay_note')} />
      {!items.length && <Muted>{t('no_pay')}</Muted>}
      {items.map((r) => (
        <Card key={r.id}>
          <Text style={{ fontWeight: '700' }}>{r.startsOn} → {r.endsOn}</Text>
          <Muted>Pay date {r.payDate}</Muted>
          <Text>Regular {fmtMinutes(r.regularMinutes)} · Overtime {fmtMinutes(r.overtimeMinutes)}</Text>
          <Text style={{ fontSize: 20, fontWeight: '800' }}>{fmtMoney(r.grossTotalCents, membership?.currency)}</Text>
          <Badge tone={r.status === 'paid' ? 'success' : 'info'} text={r.status} />
        </Card>
      ))}
    </Screen>
  );
}
