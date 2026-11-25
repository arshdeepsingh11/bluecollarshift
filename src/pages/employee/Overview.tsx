import { useEffect, useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { useMembership } from '../../hooks/useAuth';
import { errorMessage, post } from '../../lib/api';
import { directionsUrl } from '../../lib/maps';
import { fmtDateTime, fmtMinutes, fmtTime } from '../../lib/format';
import { t } from '../../i18n';
import { Alert, Card, Empty, Loading, Page } from '../../components/ui';

interface MyStatus {
  openSession: { id: string; startedAt: string; onBreakSince: string | null; shiftId: string | null } | null;
  lastEvent: { type: string; at: string } | null;
  shifts: { id: string; startsAt: string; endsAt: string; instructions: string | null; site: { name: string; address: string | null; lat: number | null; lng: number | null } }[];
  minutesToday: number;
  minutesLast7Days: number;
}

function position(): Promise<{ lat: number; lng: number; accuracyM: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
  });
}

function deviceId() {
  try {
    let id = localStorage.getItem('bc.device');
    if (!id) {
      id = `web-${crypto.randomUUID()}`;
      localStorage.setItem('bc.device', id);
    }
    return id;
  } catch {
    return 'web-unknown';
  }
}

export default function Today() {
  const m = useMembership();
  const base = `/companies/${m.companyId}`;
  const { data, error, loading, reload } = useApi<MyStatus>(`${base}/attendance/me`, [m.companyId]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'error' | 'warning' | 'success'; text: string } | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(i);
  }, []);

  async function record(type: 'clock_in' | 'clock_out' | 'break_start' | 'break_end') {
    setBusy(true);
    setMsg(null);
    const pos = await position();
    if (!pos) setMsg({ kind: 'warning', text: t('emp.location_denied') });
    const shift = data?.shifts.find((s) => Date.parse(s.startsAt) - 2 * 3600_000 < Date.now() && Date.parse(s.endsAt) > Date.now());
    try {
      const r = await post<{ result: string; flags: string[] }>(`${base}/attendance/events`, {
        id: crypto.randomUUID(), type, deviceTime: new Date().toISOString(), offline: false, deviceId: deviceId(),
        shiftId: type === 'clock_in' ? (shift?.id ?? null) : null, ...(pos ? pos : {}),
      });
      if (r.result === 'rejected') setMsg({ kind: 'error', text: t('common.error') });
      await reload();
    } catch (e) {
      setMsg({ kind: 'error', text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  const open = data?.openSession;
  const next = data?.shifts[0];
  return (
    <Page title={t('emp.today')} subtitle={m.companyName}>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {error && <Alert kind="error">{error}</Alert>}
      {loading && !data ? <Loading /> : data && (
        <div className="bc-grid cols-2">
          <Card>
            <div className="bc-clock">
              <p>{open ? t('emp.working_since', { time: fmtTime(open.startedAt) }) : t('emp.not_working')}</p>
              {open && <div className="bc-clock-time">{fmtMinutes(Math.round((now - Date.parse(open.startedAt)) / 60000))}</div>}
              <div className="bc-actions" style={{ justifyContent: 'center', marginTop: 16 }}>
                {!open && <button className="bc-btn" disabled={busy} onClick={() => void record('clock_in')}>{t('emp.clock_in')}</button>}
                {open && !open.onBreakSince && <button className="bc-btn secondary" disabled={busy} onClick={() => void record('break_start')}>{t('emp.start_break')}</button>}
                {open && open.onBreakSince && <button className="bc-btn secondary" disabled={busy} onClick={() => void record('break_end')}>{t('emp.end_break')}</button>}
                {open && <button className="bc-btn danger" disabled={busy} onClick={() => void record('clock_out')}>{t('emp.clock_out')}</button>}
              </div>
              <p className="bc-muted" style={{ marginTop: 16 }}>{t('emp.use_app')}</p>
            </div>
          </Card>
          <Card title={t('emp.next_shift')}>
            {!next ? <Empty title={t('emp.no_shift')} /> : (
              <>
                <p><strong>{next.site.name}</strong><br />{fmtDateTime(next.startsAt)} – {fmtTime(next.endsAt)}</p>
                {next.site.address && <p className="bc-muted">{next.site.address}</p>}
                {next.instructions && <Alert kind="info">{next.instructions}</Alert>}
                {next.site.lat !== null && next.site.lng !== null && <a className="bc-btn secondary" href={directionsUrl(next.site.lat, next.site.lng)} target="_blank" rel="noopener noreferrer">{t('sites.navigate')}</a>}
              </>
            )}
            <div className="bc-grid cols-2" style={{ marginTop: 16 }}>
              <div className="bc-stat"><span>{t('emp.hours_today')}</span><strong>{fmtMinutes(data.minutesToday)}</strong></div>
              <div className="bc-stat"><span>{t('emp.hours_week')}</span><strong>{fmtMinutes(data.minutesLast7Days)}</strong></div>
            </div>
          </Card>
        </div>
      )}
    </Page>
  );
}
