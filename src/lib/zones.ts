/** Time zones, currencies and countries offered (Canada, United States, Mexico). */
export const COUNTRY_OPTIONS = [
  { code: 'CA', currency: 'CAD' },
  { code: 'US', currency: 'USD' },
  { code: 'MX', currency: 'MXN' },
] as const;
export type CountryCode = (typeof COUNTRY_OPTIONS)[number]['code'];

export const ZONES: Record<CountryCode, { id: string; label: string }[]> = {
  CA: [
    { id: 'America/St_Johns', label: 'Newfoundland (St. John’s)' },
    { id: 'America/Halifax', label: 'Atlantic (Halifax)' },
    { id: 'America/Toronto', label: 'Eastern (Toronto, Ottawa, Montréal)' },
    { id: 'America/Winnipeg', label: 'Central (Winnipeg)' },
    { id: 'America/Regina', label: 'Saskatchewan (Regina)' },
    { id: 'America/Edmonton', label: 'Mountain (Edmonton, Calgary)' },
    { id: 'America/Vancouver', label: 'Pacific (Vancouver)' },
    { id: 'America/Whitehorse', label: 'Yukon (Whitehorse)' },
  ],
  US: [
    { id: 'America/New_York', label: 'Eastern (New York)' },
    { id: 'America/Chicago', label: 'Central (Chicago, Dallas)' },
    { id: 'America/Denver', label: 'Mountain (Denver)' },
    { id: 'America/Phoenix', label: 'Arizona (Phoenix)' },
    { id: 'America/Los_Angeles', label: 'Pacific (Los Angeles, Seattle)' },
    { id: 'America/Anchorage', label: 'Alaska (Anchorage)' },
    { id: 'Pacific/Honolulu', label: 'Hawaii (Honolulu)' },
  ],
  MX: [
    { id: 'America/Mexico_City', label: 'Centro (Ciudad de México, Guadalajara, Monterrey)' },
    { id: 'America/Cancun', label: 'Sureste (Cancún)' },
    { id: 'America/Chihuahua', label: 'Pacífico (Chihuahua)' },
    { id: 'America/Mazatlan', label: 'Pacífico (Mazatlán)' },
    { id: 'America/Hermosillo', label: 'Sonora (Hermosillo)' },
    { id: 'America/Tijuana', label: 'Noroeste (Tijuana)' },
  ],
};

export function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'America/Toronto';
  }
}

/** Best starting country/zone from the browser's time zone. */
export function guessCountryZone(): { country: CountryCode; zone: string } {
  const tz = browserZone();
  for (const c of COUNTRY_OPTIONS) if (ZONES[c.code].some((z) => z.id === tz)) return { country: c.code, zone: tz };
  return { country: 'CA', zone: 'America/Toronto' };
}
