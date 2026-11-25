import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../hooks/useAuth';
import { RequireAuth, RequireMembership } from '../components/ProtectedRoute';
import { Loading } from '../components/ui';
import '../styles/auth.css';
import '../styles/dashboard.css';

const Login = lazy(() => import('../pages/auth/Login'));
const EmployerSignup = lazy(() => import('../pages/auth/EmployerSignup'));
const AcceptInvite = lazy(() => import('../pages/auth/EmployeeSignup'));
const ForgotPassword = lazy(() => import('../pages/auth/ForgotPassword'));
const ResetPassword = lazy(() => import('../pages/auth/ResetPassword'));
const Onboarding = lazy(() => import('../pages/auth/Onboarding'));
const EmployerApp = lazy(() => import('../pages/employer/Dashboard'));
const EmployeeApp = lazy(() => import('../pages/employee/Dashboard'));

export default function AppSurface() {
  return (
    <AuthProvider>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="login" element={<Login />} />
          <Route path="signup" element={<EmployerSignup />} />
          <Route path="invite" element={<AcceptInvite />} />
          <Route path="forgot-password" element={<ForgotPassword />} />
          <Route path="reset-password" element={<ResetPassword />} />
          <Route path="onboarding" element={<RequireAuth><Onboarding /></RequireAuth>} />
          <Route path="me/*" element={<RequireAuth><RequireMembership employeeOnly><EmployeeApp /></RequireMembership></RequireAuth>} />
          <Route path="*" element={<RequireAuth><RequireMembership><EmployerApp /></RequireMembership></RequireAuth>} />
          <Route path="signup/employer" element={<Navigate to="../signup" replace />} />
        </Routes>
      </Suspense>
    </AuthProvider>
  );
}
