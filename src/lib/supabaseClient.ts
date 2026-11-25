import { createClient } from '@supabase/supabase-js';

/**
 * Supabase is used ONLY for authentication (sign-in, sign-up, email verification, password
 * reset, MFA). All business data goes through the Blue Collar API — the browser has no direct
 * table access (tables live in a private schema). The publishable key is safe to ship.
 */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error('Missing Supabase environment variables. Copy .env.example to .env.');
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
});
