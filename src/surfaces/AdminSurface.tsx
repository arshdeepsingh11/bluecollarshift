import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../hooks/useAuth';
import { RequireAuth, RequirePlatform } from '../components/ProtectedRoute';
import { Loading } from '../components/ui';
import { ADMIN } from '../lib/surface';
import '../styles/auth.css';
import '../styles/dashboard.css';

const Login = lazy(() => import('../pages/auth/Login'));
const ForgotPassword = lazy(() => import('../pages/auth/ForgotPassword'));
const ResetPassword = lazy(() => import('../pages/auth/ResetPassword'));
const Mfa = lazy(() => import('../pages/auth/Mfa'));
const AdminApp = lazy(() => import('../pages/admin/Dashboard'));

export default function AdminSurface() {
  return (
    <AuthProvider>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="login" element={<Login admin />} />
          <Route path="forgot-password" element={<ForgotPassword admin />} />
          <Route path="reset-password" element={<ResetPassword admin />} />
          <Route path="mfa" element={<RequireAuth loginPath={`${ADMIN}/login`}><Mfa /></RequireAuth>} />
          <Route path="*" element={<RequireAuth loginPath={`${ADMIN}/login`}><RequirePlatform><AdminApp /></RequirePlatform></RequireAuth>} />
        </Routes>
      </Suspense>
    </AuthProvider>
  );
}
