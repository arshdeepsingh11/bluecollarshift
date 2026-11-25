import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { CompanyPermission, Me, MeMembership } from '@bluecollar/shared';
import { supabase } from '../lib/supabaseClient';
import { ApiError, get } from '../lib/api';
import { closeSocket } from '../lib/realtime';
import { setLocale } from '../i18n';

type MeResponse = Me & { needsOnboarding: boolean; mfaLevel: 'aal1' | 'aal2' };

interface AuthState {
  session: Session | null;
  me: MeResponse | null;
  loading: boolean;
  error: string | null;
  membership: MeMembership | null;
  selectCompany: (companyId: string) => void;
  can: (p: CompanyPermission) => boolean;
  reload: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);
const KEY = 'bc.company';

function readStored() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(readStored());

  const load = useCallback(async (s: Session | null) => {
    if (!s) {
      setMe(null);
      setLoading(false);
      return;
    }
    try {
      const m = await get<MeResponse>('/me');
      setMe(m);
      setLocale(m.locale);
      setError(null);
    } catch (e) {
      setMe(null);
      setError(e instanceof ApiError && e.status === 401 ? null : e instanceof Error ? e.message : 'error');
      if (e instanceof ApiError && e.status === 401) await supabase.auth.signOut();
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      void load(data.session);
    });
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'MFA_CHALLENGE_VERIFIED' || event === 'USER_UPDATED') {
        setLoading(true);
        void load(s);
      }
    });
    return () => data.subscription.unsubscribe();
  }, [load]);

  const membership = useMemo(() => {
    if (!me?.memberships.length) return null;
    return me.memberships.find((m) => m.companyId === companyId) ?? me.memberships[0] ?? null;
  }, [me, companyId]);

  const value: AuthState = {
    session,
    me,
    loading,
    error,
    membership,
    selectCompany: (id) => {
      setCompanyId(id);
      try {
        localStorage.setItem(KEY, id);
      } catch {
        /* storage unavailable — selection lasts for this tab only */
      }
    },
    can: (p) => !!membership?.permissions.includes(p),
    reload: () => load(session),
    signOut: async () => {
      closeSocket();
      await supabase.auth.signOut();
      setMe(null);
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}

/** The selected company membership; only use inside routes guarded by RequireMembership. */
export function useMembership(): MeMembership {
  const { membership } = useAuth();
  if (!membership) throw new Error('No membership');
  return membership;
}
