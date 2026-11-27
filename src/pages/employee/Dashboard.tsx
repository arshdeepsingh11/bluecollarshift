import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { DashboardLayout } from '../../components/DashboardLayout';
import { Loading } from '../../components/ui';
import { APP } from '../../lib/surface';
import { useMembership } from '../../hooks/useAuth';
import { t } from '../../i18n';

const Today = lazy(() => import('./Overview'));
const Shifts = lazy(() => import('./Shifts'));
const Hours = lazy(() => import('./Hours'));
const Pay = lazy(() => import('./Pay'));
const Messages = lazy(() => import('../../components/MessagesPanel'));
const Notifications = lazy(() => import('../../components/NotificationsPage'));
const Requests = lazy(() => import('./Requests'));
const Safety = lazy(() => import('../employer/Safety'));
const Crew = lazy(() => import('../employer/Crew'));

export default function EmployeeDashboard() {
  const m = useMembership();
  const nav = [
    { label: t('nav.today'), to: `${APP}/me`, end: true },
    { label: t('nav.my_shifts'), to: `${APP}/me/shifts` },
    { label: t('nav.my_hours'), to: `${APP}/me/hours` },
    { label: t('nav.my_pay'), to: `${APP}/me/pay` },
    { label: t('nav.my_requests'), to: `${APP}/me/requests` },
    ...(m.crewLead ? [{ label: t('nav.crew'), to: `${APP}/me/crew` }] : []),
    { label: t('nav.safety'), to: `${APP}/me/safety` },
    { label: t('nav.messages'), to: `${APP}/me/messages` },
    { label: t('nav.notifications'), to: `${APP}/me/notifications` },
  ];
  return (
    <DashboardLayout subtitle={t('role.employee')} navItems={nav}>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route index element={<Today />} />
          <Route path="shifts" element={<Shifts />} />
          <Route path="hours" element={<Hours />} />
          <Route path="pay" element={<Pay />} />
          <Route path="messages" element={<Messages />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="requests" element={<Requests />} />
          <Route path="safety" element={<Safety />} />
          <Route path="crew" element={<Crew />} />
          <Route path="*" element={<Navigate to={`${APP}/me`} replace />} />
        </Routes>
      </Suspense>
    </DashboardLayout>
  );
}
