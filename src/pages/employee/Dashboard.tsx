import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { DashboardLayout } from '../../components/DashboardLayout';
import { Loading } from '../../components/ui';
import { APP } from '../../lib/surface';
import { t } from '../../i18n';

const Today = lazy(() => import('./Overview'));
const Shifts = lazy(() => import('./Shifts'));
const Hours = lazy(() => import('./Hours'));
const Pay = lazy(() => import('./Pay'));
const Messages = lazy(() => import('../../components/MessagesPanel'));
const Notifications = lazy(() => import('../../components/NotificationsPage'));

export default function EmployeeDashboard() {
  const nav = [
    { label: t('nav.today'), to: `${APP}/me`, end: true },
    { label: t('nav.my_shifts'), to: `${APP}/me/shifts` },
    { label: t('nav.my_hours'), to: `${APP}/me/hours` },
    { label: t('nav.my_pay'), to: `${APP}/me/pay` },
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
          <Route path="*" element={<Navigate to={`${APP}/me`} replace />} />
        </Routes>
      </Suspense>
    </DashboardLayout>
  );
}
