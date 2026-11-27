import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import type { Me, MeMembership } from '@bluecollar/shared';
import { supabase } from '../lib/supabase';
import { api, ApiError } from '../lib/api';
import { cacheGet, cacheSet, clearCache } from '../lib/db';
import { engine, registerBackgroundSync, startSyncTriggers } from '../lib/attendance';
import { appVersion, registerPush, unregisterPush } from '../lib/device';
import { isOlder } from '../lib/version';
import { closeSocket } from '../lib/realtime';
import { flushOutbox } from '../lib/outbox';
import { flushCrewQueue } from '../lib/crew';
import { hasSavedLocale, loadSavedLocale, normalizeLocale, saveLocale, setLocaleNow, type LocaleCode } from '../i18n';

interface Ctx {
  session: Session | null;
  me: Me | null;
  membership: MeMembership | null;
  loading: boolean;
  offlineProfile: boolean;
  updateRequired: boolean;
  maintenance: boolean;
  setCompany: (id: string) => void;
  refresh: () => Promise<void>;
  locale: LocaleCode;
  changeLocale: (l: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionCtx = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [offlineProfile, setOfflineProfile] = useState(false);
  const [server, setServer] = useState({ updateRequired: false, maintenance: false });
  const [locale, setLocaleState] = useState<LocaleCode>('en');

  const applyLocale = useCallback(async (l: string) => {
    await saveLocale(l);
    setLocaleState(normalizeLocale(l));
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const c = await api<{ maintenanceMode: boolean; minMobileVersion: string }>('/config');
      setServer({ maintenance: c.maintenanceMode, updateRequired: isOlder(appVersion, c.minMobileVersion) });
    } catch {
      /* offline: keep last known */
    }
  }, []);

  const loadMe = useCallback(async () => {
    try {
      const m = await api<Me>('/me');
      // Profile language wins, unless the user picked one on this phone before signing in.
      const profile = normalizeLocale(m.locale);
      if (await hasSavedLocale()) {
        const saved = await loadSavedLocale();
        if (saved !== profile && profile === 'en') void api('/me', { method: 'PATCH', body: { locale: saved } }).catch(() => undefined);
        else if (saved !== profile) await applyLocale(profile);
      } else {
        await applyLocale(profile);
      }
      setMe(m);
      setOfflineProfile(false);
      await cacheSet('me', m);
      engine.authBlocked = false;
      void engine.sync();
      void flushOutbox();
      void flushCrewQueue();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setMe(null);
      } else {
        // Offline: use the last known profile so the employee can still clock in.
        const cached = await cacheGet<Me>('me');
        if (cached) {
          setMe(cached.value);
          setOfflineProfile(true);
        }
      }
    }
  }, [applyLocale]);

  useEffect(() => {
    void loadSavedLocale().then((l) => {
      setLocaleNow(l);
      setLocaleState(l);
    });
    const stopTriggers = startSyncTriggers();
    void loadConfig();
    void registerBackgroundSync();
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session) await loadMe();
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange(async (event, s) => {
      setSession(s);
      if (event === 'SIGNED_IN') {
        await loadMe();
        void registerPush().catch(() => undefined);
      }
      if (event === 'SIGNED_OUT') setMe(null);
    });
    // Supabase recommends pausing token refresh in the background on mobile.
    const appSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void supabase.auth.startAutoRefresh();
        void engine.sync();
        void flushOutbox();
        void flushCrewQueue();
        void loadConfig();
      } else void supabase.auth.stopAutoRefresh();
    });
    return () => {
      stopTriggers();
      sub.subscription.unsubscribe();
      appSub.remove();
    };
  }, [loadMe, loadConfig]);

  const memberships = me?.memberships.filter((m) => m.role === 'employee') ?? [];
  const membership = memberships.find((m) => m.companyId === companyId) ?? memberships[0] ?? null;

  return (
    <SessionCtx.Provider
      value={{
        session, me, membership, loading, offlineProfile, ...server,
        setCompany: setCompanyId,
        refresh: loadMe,
        locale,
        changeLocale: async (l: string) => {
          await applyLocale(l);
          if (me) await api('/me', { method: 'PATCH', body: { locale: normalizeLocale(l) } }).catch(() => undefined);
        },
        signOut: async () => {
          await unregisterPush();
          closeSocket();
          await clearCache();
          await supabase.auth.signOut();
        },
      }}
    >
      {children}
    </SessionCtx.Provider>
  );
}

export function useSession() {
  const c = useContext(SessionCtx);
  if (!c) throw new Error('useSession outside provider');
  return c;
}

