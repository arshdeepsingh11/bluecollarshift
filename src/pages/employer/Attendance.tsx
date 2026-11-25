import { useEffect } from 'react';
import { useApi } from '../../hooks/useApi';
import { useMembership } from '../../hooks/useAuth';
import { getSocket } from '../../lib/realtime';
import { fmtTime } from '../../lib/format';
import { t } from '../../i18n';
import { Alert, Badge, Card, Empty, Flags, Loading, Page } from '../../components/ui';

interface Live {
  working: { sessionId: string; fullName: string; since: string; onBreak: boolean; siteName: string | null; flags: string[]; clockInLocation: { distanceM: number | null } | null }[];
  late: { shiftId: string; membershipId: string; fullName: string; startsAt: string; siteName: string }[];
}

export default function Attendance() {
  const m = useMembership();
  const { data, error, loading, reload } = useApi<Live>(`/companies/${m.companyId}/attendance/live`, [m.companyId]);
  useEffect(() => {
    const s = getSocket();
    const r = () => void reload();
    s.on('attendance:update', r);
    s.on('connect', r);
    const timer = setInterval(r, 60_000); // late list changes with time
    return () => {
      s.off('attendance:update', r);
      s.off('connect', r);
      clearInterval(timer);
    };
  }, [reload]);

  return (
    <Page title={t('live.title')}>
      {error && <Alert kind="error">{error}</Alert>}
      {loading && !data ? <Loading /> : data && (
        <div className="bc-grid cols-2">
          <Card title={`${t('live.working')} (${data.working.length})`}>
            {data.working.length === 0 ? <Empty title={t('live.none_working')} /> : (
              <table className="bc-table">
                <tbody>
                  {data.working.map((w) => (
                    <tr key={w.sessionId}>
                      <td><strong>{w.fullName}</strong><div className="bc-muted">{w.siteName ?? '—'}</div></td>
                      <td>{t('live.since', { time: fmtTime(w.since) })}{w.clockInLocation?.distanceM != null && <div className="bc-muted">{t('ts.distance', { m: w.clockInLocation.distanceM })}</div>}</td>
                      <td>{w.onBreak && <Badge kind="info">{t('live.on_break')}</Badge>} <Flags flags={w.flags} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <Card title={`${t('live.late')} (${data.late.length})`}>
            {data.late.length === 0 ? <Empty title={t('live.none_late')} /> : (
              <table className="bc-table">
                <tbody>
                  {data.late.map((l) => (
                    <tr key={`${l.shiftId}-${l.membershipId}`}>
                      <td><strong>{l.fullName}</strong><div className="bc-muted">{l.siteName}</div></td>
                      <td><Badge kind="error">{fmtTime(l.startsAt)}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      )}
    </Page>
  );
}
