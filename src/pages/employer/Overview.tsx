import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../../hooks/useApi';
import { useAuth, useMembership } from '../../hooks/useAuth';
import { getSocket } from '../../lib/realtime';
import { APP } from '../../lib/surface';
import { t, type MessageKey } from '../../i18n';
import { Alert, Card, Empty, Loading, Page } from '../../components/ui';

interface DashboardData {
  employees: number; workingNow: number; scheduledToday: number; notClockedIn: number; clockedOutToday: number;
  activeSites: number; upcomingShifts: number; pendingTimesheets: number; needsReview: number; openDisputes: number;
  recentAdjustments: number; unreadMessages: number;
}

const STATS: { key: keyof DashboardData; label: MessageKey; to: string; tone?: 'warn' | 'bad' }[] = [
  { key: 'workingNow', label: 'dash.working_now', to: '/live' },
  { key: 'notClockedIn', label: 'dash.not_clocked_in', to: '/live', tone: 'bad' },
  { key: 'scheduledToday', label: 'dash.scheduled_today', to: '/schedule' },
  { key: 'clockedOutToday', label: 'dash.clocked_out_today', to: '/timesheets' },
  { key: 'pendingTimesheets', label: 'dash.pending_timesheets', to: '/timesheets', tone: 'warn' },
  { key: 'needsReview', label: 'dash.needs_review', to: '/timesheets', tone: 'warn' },
  { key: 'openDisputes', label: 'dash.open_disputes', to: '/disputes', tone: 'warn' },
  { key: 'unreadMessages', label: 'dash.unread_messages', to: '/messages' },
  { key: 'employees', label: 'dash.employees', to: '/people' },
  { key: 'activeSites', label: 'dash.active_sites', to: '/sites' },
  { key: 'upcomingShifts', label: 'dash.upcoming_shifts', to: '/schedule' },
  { key: 'recentAdjustments', label: 'dash.recent_adjustments', to: '/reports' },
];

export default function Overview() {
  const m = useMembership();
  const { can } = useAuth();
  const { data, error, loading, reload } = useApi<DashboardData>(can('attendance.view') ? `/companies/${m.companyId}/dashboard` : null, [m.companyId]);

  useEffect(() => {
    const s = getSocket();
    const r = () => void reload();
    s.on('attendance:update', r);
    return () => void s.off('attendance:update', r);
  }, [reload]);

  return (
    <Page title={m.companyName} subtitle={t('dash.subtitle')}>
      {error && <Alert kind="error">{error}</Alert>}
      {!can('attendance.view') ? (
        <Card><Empty title={t('nav.dashboard')}>{t(`role.${m.role}`)}</Empty></Card>
      ) : loading && !data ? (
        <Loading />
      ) : data ? (
        <div className="bc-grid cols-4">
          {STATS.map((s) => (
            <Link key={s.key} to={`${APP}${s.to}`} className={`bc-stat ${data[s.key] > 0 && s.tone ? s.tone : ''}`}>
              <span>{t(s.label)}</span>
              <strong>{data[s.key]}</strong>
            </Link>
          ))}
        </div>
      ) : null}
    </Page>
  );
}
