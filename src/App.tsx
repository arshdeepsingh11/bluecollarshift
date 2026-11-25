import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { currentSurface } from './lib/surface';
import { Loading } from './components/ui';

// Each experience is a separate chunk: the public website never downloads app or auth code.
const PublicSite = lazy(() => import('./surfaces/PublicSite'));
const AppSurface = lazy(() => import('./surfaces/AppSurface'));
const AdminSurface = lazy(() => import('./surfaces/AdminSurface'));

export default function App() {
  const surface = currentSurface();
  return (
    <BrowserRouter>
      <Suspense fallback={<Loading />}>
        {surface === 'app' && <AppSurface />}
        {surface === 'admin' && <AdminSurface />}
        {surface === 'public' && <PublicSite />}
        {surface === 'dev' && (
          <Routes>
            <Route path="/app/*" element={<AppSurface />} />
            <Route path="/admin/*" element={<AdminSurface />} />
            <Route path="/*" element={<PublicSite />} />
          </Routes>
        )}
      </Suspense>
    </BrowserRouter>
  );
}
