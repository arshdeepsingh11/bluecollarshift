import { useCallback, useEffect, useState } from 'react';
import { Text, TextInput } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import type { WorkSessionDetail } from '@bluecollar/shared';
import { useSession } from '../../src/state/session';
import { api, ApiError } from '../../src/lib/api';
import { t } from '../../src/i18n';
import { Badge, Banner, Button, Card, Loading, Muted, Screen, fmtDateTime, fmtMinutes, fmtTime, s as st } from '../../src/ui';

export default function TimesheetDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { membership } = useSession();
  const companyId = membership!.companyId;
  const [d, setD] = useState<WorkSessionDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    try {
      setD(await api<WorkSessionDetail>(`/companies/${companyId}/timesheets/${id}`));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error');
    }
  }, [companyId, id]);
  useEffect(() => { void load(); }, [load]);

  async function dispute() {
    setBusy(true);
    try {
      const active = d?.adjustments.find((a) => a.active);
      await api(`/companies/${companyId}/timesheets/${id}/disputes`, { method: 'POST', body: { explanation: text.trim(), adjustmentId: active?.id ?? null } });
      setDone(true);
      setText('');
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  if (err && !d) return <Screen><Banner tone="error" text={err} /></Screen>;
  if (!d) return <Screen><Loading /></Screen>;
  const openDispute = d.disputes.find((x) => x.status === 'open');

  return (
    <Screen>
      <Card>
        <Text style={{ fontSize: 18, fontWeight: '700' }}>{d.siteName ?? 'No site'}</Text>
        <Text>{fmtDateTime(d.effectiveStart)} – {fmtTime(d.effectiveEnd)}</Text>
        <Text>Paid: {fmtMinutes(d.paidMinutes)} · Break {d.effectiveBreakMinutes} min</Text>
        {d.approvalStatus === 'approved' ? <Badge tone="success" text="Approved" /> : <Badge text="Pending approval" />}
      </Card>

      {d.adjusted && (
        <Card>
          <Text style={{ fontWeight: '700' }}>{t('original')}</Text>
          <Muted>{fmtDateTime(d.originalStart)} – {fmtTime(d.originalEnd)} · break {d.originalBreakMinutes} min</Muted>
          {d.adjustments.filter((a) => a.active).map((a) => (
            <Card key={a.id} style={{ backgroundColor: '#FFF9EC' }}>
              <Text style={{ fontWeight: '700' }}>{t('adjusted')}</Text>
              <Text>{fmtDateTime(a.adjustedStart)} – {fmtTime(a.adjustedEnd)} · break {a.adjustedBreakMinutes} min</Text>
              <Text>{t('reason')}: {a.reason}</Text>
              <Muted>{t('by', { name: a.createdBy.fullName })} · {fmtDateTime(a.createdAt)}</Muted>
            </Card>
          ))}
        </Card>
      )}

      <Card>
        <Text style={{ fontWeight: '700' }}>Clock events</Text>
        {d.events.map((e) => (
          <Muted key={e.id}>
            {fmtTime(e.occurredAt)} · {e.type.replace('_', ' ')} · {e.source}
            {e.distanceFromSiteM != null ? ` · ${Math.round(e.distanceFromSiteM)} m from site` : ''}
            {e.flags.length ? ` · ${e.flags.join(', ')}` : ''}
          </Muted>
        ))}
      </Card>

      {d.disputes.map((x) => (
        <Card key={x.id}>
          <Badge tone={x.status === 'open' ? 'warning' : 'success'} text={`Dispute ${x.status}`} />
          <Text>{x.explanation}</Text>
          {x.resolutionNote && <Muted>Manager: {x.resolutionNote}</Muted>}
        </Card>
      ))}

      {err && <Banner tone="error" text={err} />}
      {done && <Banner tone="success" text={t('dispute_sent')} />}
      {!openDispute && d.status !== 'open' && (
        <Card>
          <Text style={{ fontWeight: '700' }}>{t('dispute')}</Text>
          <TextInput style={[st.input, { minHeight: 90, textAlignVertical: 'top' }]} multiline placeholder={t('dispute_hint')} value={text} onChangeText={setText} maxLength={2000} accessibilityLabel={t('dispute_hint')} />
          <Button title={t('dispute')} onPress={() => void dispute()} disabled={text.trim().length < 5} loading={busy} />
        </Card>
      )}
    </Screen>
  );
}
