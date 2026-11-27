import { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../src/lib/supabase';
import { useSession } from '../src/state/session';
import { theme } from '../src/lib/config';
import { LANGUAGES, t } from '../src/i18n';
import { Captcha, captchaEnabled } from '../src/Captcha';
import { Banner, Button, Screen, s } from '../src/ui';

export default function Login() {
  const { refresh, locale, changeLocale } = useSession();
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password, options: { captchaToken: captcha ?? undefined } });
    setCaptchaReset((n) => n + 1);
    if (err) {
      setBusy(false);
      const m = err.message.toLowerCase();
      return setError(m.includes('invalid') ? t('invalid_login') : m.includes('captcha') ? t('captcha_failed') : err.message);
    }
    await refresh();
    setBusy(false);
    router.replace('/(tabs)');
  }

  async function forgot() {
    setError(null);
    if (!email) return setError(t('enter_email_first'));
    await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: 'https://app.bluecollarshift.com/reset-password', captchaToken: captcha ?? undefined });
    setCaptchaReset((n) => n + 1);
    setInfo(t('reset_sent'));
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ alignItems: 'center', marginTop: 32, marginBottom: 24 }}>
          <Image source={require('../assets/logo.png')} style={{ width: 120, height: 118 }} accessibilityLabel="Blue Collar" />
          <Text style={[s.h1, { marginTop: 16 }]}>{t('sign_in')}</Text>
        </View>
        {error && <Banner tone="error" text={error} />}
        {info && <Banner tone="success" text={info} />}
        <View style={{ gap: 12, marginTop: 12 }}>
          <View>
            <Text style={s.label}>{t('email')}</Text>
            <TextInput style={s.input} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="username" value={email} onChangeText={setEmail} accessibilityLabel={t('email')} />
          </View>
          <View>
            <Text style={s.label}>{t('password')}</Text>
            <TextInput style={s.input} secureTextEntry autoComplete="password" textContentType="password" value={password} onChangeText={setPassword} accessibilityLabel={t('password')} />
          </View>
          <Captcha onToken={setCaptcha} resetKey={captchaReset} />
          <Button title={t('sign_in')} onPress={() => void signIn()} loading={busy} disabled={!email || !password || (captchaEnabled && !captcha)} />
          <Text onPress={() => void forgot()} style={{ color: theme.primary, textAlign: 'center', fontWeight: '600', padding: 8 }} accessibilityRole="link">{t('forgot')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginTop: 8 }} accessibilityLabel={t('language')}>
            {LANGUAGES.map((l) => (
              <Text key={l.code} onPress={() => void changeLocale(l.code)} accessibilityRole="button" accessibilityState={{ selected: locale === l.code }}
                style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: theme.border, color: locale === l.code ? '#fff' : theme.text, backgroundColor: locale === l.code ? theme.primary : theme.surface, overflow: 'hidden' }}>
                {l.name}
              </Text>
            ))}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
