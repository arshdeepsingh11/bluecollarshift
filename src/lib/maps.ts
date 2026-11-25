/**
 * Google Maps Platform integration — kept small and swappable.
 * Cost control:
 *  - The script loads only on screens that show a map (never on the public site).
 *  - Geocoding runs only when the user clicks "Find address" (billed per request).
 *  - Navigation uses a free Google Maps URL instead of the Routes API.
 *  - The API key MUST be restricted to the app's HTTP referrers and to the Maps JavaScript +
 *    Geocoding APIs, with a daily quota and budget alert (see Infrastructure.md).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    google?: any;
    __bcMapsInit?: () => void;
  }
}

const KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
let loading: Promise<any | null> | null = null;

export const mapsConfigured = () => !!KEY;

export function loadGoogleMaps(): Promise<any | null> {
  if (!KEY) return Promise.resolve(null);
  if (window.google?.maps) return Promise.resolve(window.google);
  if (loading) return loading;
  loading = new Promise((resolve) => {
    window.__bcMapsInit = () => resolve(window.google ?? null);
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(KEY)}&callback=__bcMapsInit&loading=async&v=weekly`;
    s.async = true;
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
  return loading;
}

export function directionsUrl(lat: number, lng: number) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

export async function geocode(address: string): Promise<{ lat: number; lng: number; formatted: string } | null> {
  const g = await loadGoogleMaps();
  if (!g) return null;
  const geocoder = new g.maps.Geocoder();
  try {
    const { results } = await geocoder.geocode({ address, region: 'ca' });
    const r = results?.[0];
    if (!r) return null;
    return { lat: r.geometry.location.lat(), lng: r.geometry.location.lng(), formatted: r.formatted_address };
  } catch {
    return null;
  }
}
