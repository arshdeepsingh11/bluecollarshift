import { useEffect, useState } from 'react';
import { getLocale, LANGUAGES, onLocaleChange, setLocale, t } from '../i18n';
import { patch } from '../lib/api';

/** Language menu. Signed-in users: also saved to their profile (emails and phone app follow it). */
export function LanguagePicker({ signedIn = false, className = 'bc-lang-select' }: { signedIn?: boolean; className?: string }) {
  const [value, setValue] = useState(getLocale());
  useEffect(() => onLocaleChange(setValue) as unknown as () => void, []);
  return (
    <select
      className={className}
      aria-label={t('lang.label')}
      value={value}
      onChange={async (e) => {
        const code = e.target.value;
        if (signedIn) await patch('/me', { locale: code }).catch(() => undefined);
        await setLocale(code, true);
      }}
    >
      {LANGUAGES.map((l) => (
        <option key={l.code} value={l.code} lang={l.code}>
          {l.name}
        </option>
      ))}
    </select>
  );
}
