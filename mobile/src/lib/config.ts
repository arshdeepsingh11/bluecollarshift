export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/$/, '');
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';

export const theme = {
  primary: '#016B93',
  primaryHover: '#015A7C',
  primaryDark: '#014A66',
  light: '#E6F2F7',
  navy: '#0B2A3A',
  bg: '#F5F8FA',
  surface: '#FFFFFF',
  surface2: '#F0F4F7',
  border: '#DBE3EA',
  text: '#14212B',
  text2: '#45566A',
  text3: '#6B7B8D',
  success: '#1F7A4D',
  successBg: '#E5F4EC',
  warning: '#8A5A00',
  warningBg: '#FFF4DC',
  error: '#B42318',
  errorBg: '#FDE9E7',
  radius: 14,
} as const;
