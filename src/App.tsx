import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { currentSurface } from './lib/surface';
import { Loading } from './components/ui';
import { getLocale, initialLocale, onLocaleChange, setLocale } from './i18n';

// Each experience is a separate chunk: the public website never downloads app or auth code.
const PublicSite = lazy(() => import('./surfaces/PublicSite'));
const AppSurface = lazy(() => import('./surfaces/AppSurface'));
const AdminSurface = lazy(() => import('./surfaces/AdminSurface'));

/** Re-render everything when the language changes. */
function useLocaleKey() {
  const [locale, setL] = useState(getLocale());
  useEffect(() => {
    const off = onLocaleChange(setL);
    void setLocale(initialLocale());
    return () => void off();
  }, []);
  return locale;
}

export default function App() {
  const surface = currentSurface();
  const locale = useLocaleKey();
  return (
    <BrowserRouter>
      <Suspense key={locale} fallback={<Loading />}>
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
