import { useMemo } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import { getLocale } from './i18n';

/**
 * Cloudflare Turnstile (free) bot check, shown in a small web view.
 * Off until EXPO_PUBLIC_TURNSTILE_SITE_KEY is set (then also turn it on in Supabase).
 */
export const CAPTCHA_SITE_KEY = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY ?? '';
export const captchaEnabled = !!CAPTCHA_SITE_KEY;

export function Captcha({ onToken, resetKey = 0 }: { onToken: (token: string | null) => void; resetKey?: number }) {
  const html = useMemo(
    () => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=go&render=explicit" async defer></script>
<style>html,body{margin:0;background:transparent;display:flex;justify-content:center}</style></head>
<body><div id="c"></div><script>
function send(v){window.ReactNativeWebView.postMessage(JSON.stringify({token:v}))}
function go(){turnstile.render('#c',{sitekey:${JSON.stringify(CAPTCHA_SITE_KEY)},language:${JSON.stringify(getLocale())},
callback:function(t){send(t)},'expired-callback':function(){send(null)},'error-callback':function(){send(null)}})}
</script></body></html>`,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resetKey],
  );
  if (!captchaEnabled) return null;
  return (
    <View style={{ height: 70 }}>
      <WebView
        key={resetKey}
        originWhitelist={['https://*']}
        source={{ html, baseUrl: 'https://app.bluecollarshift.com' }}
        onMessage={(e) => {
          try {
            onToken((JSON.parse(e.nativeEvent.data) as { token: string | null }).token);
          } catch {
            onToken(null);
          }
        }}
        style={{ backgroundColor: 'transparent' }}
        scrollEnabled={false}
        javaScriptEnabled
      />
    </View>
  );
}
