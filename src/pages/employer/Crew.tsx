import { useState } from 'react';
import type { CrewMember } from '@bluecollar/shared';
import { useApi } from '../../hooks/useApi';
import { useMembership } from '../../hooks/useAuth';
import { errorMessage, post } from '../../lib/api';
import { fmtTime } from '../../lib/format';
import { t } from '../../i18n';
import { Alert, Badge, Card, Empty, Loading, Page } from '../../components/ui';

type EventType = 'clock_in' | 'clock_out' | 'break_start' | 'break_end';
const DEVICE_KEY = 'bc.device';
function deviceId() {
  try {
    let v = localStorage.getItem(DEVICE_KEY);
    if (!v) { v = `web-${crypto.randomUUID()}`; localStorage.setItem(DEVICE_KEY, v); }
    return v;
  } catch {
    return 'web-browser';
  }
}

async function position(): Promise<{ lat: number; lng: number; accuracyM: number } | null> {
  if (!('geolocation' in navigator)) return null;
  return new Promise((resolve) => navigator.geolocation.getCurrentPosition(
    (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: Math.round(p.coords.accuracy) }),
    () => resolve(null), { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
  ));
}

/** Crew clock-in: a foreman or supervisor clocks several people in or out at once. */
export default function Crew() {
  const m = useMembership();
  const base = `/companies/${m.companyId}`;
  const crew = useApi<{ items: CrewMember[] }>(`${base}/crew`, [m.companyId]);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const items = crew.data?.items ?? [];

  async function send(type: EventType) {
    setBusy(true);
    setMsg(null);
    try {
      const pos = await position();
      const r = await post<{ results: { membershipId: string; result: string; reason?: string }[] }>(`${base}/crew/events`, {
        type, deviceTime: new Date().toISOString(), offline: false, deviceId: deviceId(), ...(pos ?? {}),
        entries: selected.map((membershipId) => ({ id: crypto.randomUUID(), membershipId })),
      });
      const bad = r.results.filter((x) => x.result === 'rejected');
      const review = r.results.filter((x) => x.result === 'needs_review');
      setMsg(bad.length
        ? { kind: 'error', text: bad.map((b) => `${items.find((i) => i.membershipId === b.membershipId)?.fullName}: ${b.reason}`).join(' · ') }
        : review.length ? { kind: 'warning', text: t('crew.done_review', { n: r.results.length - bad.length }) }
        : { kind: 'success', text: t('crew.done', { n: r.results.length }) });
      setSelected([]);
      void crew.reload();
    } catch (e) {
      setMsg({ kind: 'error', text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  const all = selected.length === items.length && items.length > 0;
  return (
    <Page title={t('crew.title')} subtitle={t('crew.subtitle')}>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <Card actions={items.length > 0 && <button className="bc-btn ghost small" onClick={() => setSelected(all ? [] : items.map((i) => i.membershipId))}>{all ? t('crew.select_none') : t('crew.select_all')}</button>}>
        {crew.error ? <Alert kind="error">{crew.error}</Alert> : crew.loading && !crew.data ? <Loading /> : !items.length ? <Empty title={t('crew.empty')}>{t('crew.empty_hint')}</Empty> : (
          <>
            {items.map((c) => (
              <label key={c.membershipId} className="bc-check" style={{ justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--bc-border)' }}>
                <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <input type="checkbox" checked={selected.includes(c.membershipId)} onChange={(e) => setSelected(e.target.checked ? [...selected, c.membershipId] : selected.filter((x) => x !== c.membershipId))} />
                  {c.fullName}
                </span>
                <Badge kind={c.state === 'working' ? 'success' : c.state === 'on_break' ? 'warning' : undefined}>
                  {t(`crew.state_${c.state}`)}{c.since ? ` · ${fmtTime(c.since)}` : ''}
                </Badge>
              </label>
            ))}
            <div className="bc-actions" style={{ marginTop: 16, justifyContent: 'flex-start' }}>
              <button className="bc-btn" disabled={busy || !selected.length} onClick={() => void send('clock_in')}>{t('crew.clock_in', { n: selected.length })}</button>
              <button className="bc-btn secondary" disabled={busy || !selected.length} onClick={() => void send('break_start')}>{t('crew.break_start')}</button>
              <button className="bc-btn secondary" disabled={busy || !selected.length} onClick={() => void send('break_end')}>{t('crew.break_end')}</button>
              <button className="bc-btn danger" disabled={busy || !selected.length} onClick={() => void send('clock_out')}>{t('crew.clock_out', { n: selected.length })}</button>
            </div>
          </>
        )}
      </Card>
    </Page>
  );
}
