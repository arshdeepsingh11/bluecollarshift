/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps, mapsConfigured } from '../lib/maps';
import { t } from '../i18n';
import { Alert } from './ui';

export interface MapSite {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  geofenceRadiusM: number | null;
}

/** Shows job sites; when `onPick` is set, clicking the map places a pin. */
export function SiteMap({ sites, onPick, picked, radius }: { sites: MapSite[]; onPick?: (lat: number, lng: number) => void; picked?: { lat: number; lng: number } | null; radius?: number | null }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const overlays = useRef<any[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadGoogleMaps().then((g) => {
      if (cancelled) return;
      if (!g || !el.current) return setFailed(true);
      map.current = new g.maps.Map(el.current, { center: { lat: 51.0447, lng: -114.0719 }, zoom: 9, mapTypeControl: false, streetViewControl: false, fullscreenControl: false });
      if (onPick) map.current.addListener('click', (e: any) => onPick(e.latLng.lat(), e.latLng.lng()));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const g = window.google;
    if (!g || !map.current) return;
    overlays.current.forEach((o) => o.setMap(null));
    overlays.current = [];
    const bounds = new g.maps.LatLngBounds();
    const add = (lat: number, lng: number, title: string, r: number | null) => {
      overlays.current.push(new g.maps.Marker({ position: { lat, lng }, map: map.current, title }));
      if (r) overlays.current.push(new g.maps.Circle({ center: { lat, lng }, radius: r, map: map.current, strokeColor: '#016B93', fillColor: '#016B93', fillOpacity: 0.12, strokeWeight: 1 }));
      bounds.extend({ lat, lng });
    };
    sites.forEach((s) => s.lat !== null && s.lng !== null && add(s.lat, s.lng, s.name, s.geofenceRadiusM));
    if (picked) add(picked.lat, picked.lng, 'New', radius ?? null);
    if (!bounds.isEmpty()) {
      map.current.fitBounds(bounds);
      if (overlays.current.length <= 2) map.current.setZoom(15);
    }
  }, [sites, picked, radius]);

  if (!mapsConfigured() || failed) return <Alert kind="info">{t('sites.map_unavailable')}</Alert>;
  return <div ref={el} className="bc-map" role="application" aria-label="Job site map" />;
}
