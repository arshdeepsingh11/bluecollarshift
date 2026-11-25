import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import type { PayrollRecord } from '@bluecollar/shared';
import { useSession } from '../src/state/session';
import { api } from '../src/lib/api';
import { cacheGet, cacheSet } from '../src/lib/db';
import { t } from '../src/i18n';
import { Badge, Banner, Card, Loading, Muted, Screen, fmtMinutes } from '../src/ui';

type PayItem = PayrollRecord & { startsOn: string; endsOn: string; payDate: string };
const money = (c: number) => (c / 100).toLocaleString('en-CA', { style: 'currency', currency: 'CAD' });

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
      {!items.length && <Muted>No approved pay periods yet.</Muted>}
      {items.map((r) => (
        <Card key={r.id}>
          <Text style={{ fontWeight: '700' }}>{r.startsOn} → {r.endsOn}</Text>
          <Muted>Pay date {r.payDate}</Muted>
          <Text>Regular {fmtMinutes(r.regularMinutes)} · Overtime {fmtMinutes(r.overtimeMinutes)}</Text>
          <Text style={{ fontSize: 20, fontWeight: '800' }}>{money(r.grossTotalCents)}</Text>
          <Badge tone={r.status === 'paid' ? 'success' : 'info'} text={r.status} />
        </Card>
      ))}
    </Screen>
  );
}
