import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { DashboardLayout, type NavItem } from '../../components/DashboardLayout';
import { Loading } from '../../components/ui';
import { useAuth, useMembership } from '../../hooks/useAuth';
import { useApi } from '../../hooks/useApi';
import { getSocket } from '../../lib/realtime';
import { APP } from '../../lib/surface';
import { t } from '../../i18n';

const Overview = lazy(() => import('./Overview'));
const Attendance = lazy(() => import('./Attendance'));
const Employees = lazy(() => import('./Employees'));
const Sites = lazy(() => import('./Sites'));
const Shifts = lazy(() => import('./Shifts'));
const Timesheets = lazy(() => import('./Timesheets'));
const Disputes = lazy(() => import('./Disputes'));
const Pay = lazy(() => import('./Pay'));
const Reports = lazy(() => import('./Reports'));
const Settings = lazy(() => import('./Settings'));
const Messages = lazy(() => import('../../components/MessagesPanel'));
const Notifications = lazy(() => import('../../components/NotificationsPage'));

export default function EmployerDashboard() {
  const { can } = useAuth();
  const m = useMembership();
  const counts = useApi<{ pendingTimesheets: number; openDisputes: number; unreadMessages: number; needsReview: number }>(
    can('attendance.view') ? `/companies/${m.companyId}/dashboard` : null,
    [m.companyId],
  );
  useEffect(() => {
    const s = getSocket();
    const refresh = () => void counts.reload();
    s.on('attendance:update', refresh);
    s.on('timesheet:changed', refresh);
    s.on('notification:new', refresh);
    return () => {
      s.off('attendance:update', refresh);
      s.off('timesheet:changed', refresh);
      s.off('notification:new', refresh);
    };
  }, [counts]);

  const c = counts.data;
  const nav: (NavItem & { show: boolean })[] = [
    { label: t('nav.dashboard'), to: `${APP}/`, end: true, show: true },
    { label: t('nav.live'), to: `${APP}/live`, show: can('attendance.view') },
    { label: t('nav.schedule'), to: `${APP}/schedule`, show: can('shifts.view') },
    { label: t('nav.timesheets'), to: `${APP}/timesheets`, show: can('attendance.view'), count: (c?.pendingTimesheets ?? 0) + (c?.needsReview ?? 0) },
    { label: t('nav.disputes'), to: `${APP}/disputes`, show: can('disputes.resolve'), count: c?.openDisputes },
    { label: t('nav.payroll'), to: `${APP}/payroll`, show: can('payroll.view') },
    { label: t('nav.employees'), to: `${APP}/people`, show: can('members.view') },
    { label: t('nav.sites'), to: `${APP}/sites`, show: can('sites.view') },
    { label: t('nav.messages'), to: `${APP}/messages`, show: can('messages.send'), count: c?.unreadMessages },
    { label: t('nav.reports'), to: `${APP}/reports`, show: can('reports.view') },
    { label: t('nav.notifications'), to: `${APP}/notifications`, show: true },
    { label: t('nav.settings'), to: `${APP}/settings`, show: true },
  ];

  return (
    <DashboardLayout subtitle={t(`role.${m.role}`)} navItems={nav.filter((n) => n.show)}>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route index element={<Overview />} />
          <Route path="live" element={<Attendance />} />
          <Route path="people" element={<Employees />} />
          <Route path="sites" element={<Sites />} />
          <Route path="schedule" element={<Shifts />} />
          <Route path="timesheets" element={<Timesheets />} />
          <Route path="disputes" element={<Disputes />} />
          <Route path="payroll" element={<Pay />} />
          <Route path="messages" element={<Messages />} />
          <Route path="reports" element={<Reports />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to={`${APP}/`} replace />} />
        </Routes>
      </Suspense>
    </DashboardLayout>
  );
}
