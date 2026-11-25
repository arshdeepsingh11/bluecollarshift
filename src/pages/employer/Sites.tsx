import { useState, type FormEvent } from 'react';
import type { JobSite } from '@bluecollar/shared';
import { useApi } from '../../hooks/useApi';
import { useAuth, useMembership } from '../../hooks/useAuth';
import { errorMessage, patch, post } from '../../lib/api';
import { directionsUrl, geocode, mapsConfigured } from '../../lib/maps';
import { t } from '../../i18n';
import { Alert, Badge, Card, Drawer, Empty, Field, Loading, Page } from '../../components/ui';
import { SiteMap } from '../../components/SiteMap';

const blank = { name: '', address: '', lat: '', lng: '', geofenceRadiusM: '200', notes: '', startsOn: '', endsOn: '' };

export default function Sites() {
  const m = useMembership();
  const { can } = useAuth();
  const base = `/companies/${m.companyId}/sites`;
  const [status, setStatus] = useState<'active' | 'archived'>('active');
  const { data, error, loading, reload } = useApi<{ items: JobSite[] }>(`${base}?status=${status}`, [m.companyId, status]);
  const [editing, setEditing] = useState<JobSite | 'new' | null>(null);

  return (
    <Page title={t('sites.title')} actions={
      <>
        <select className="bc-input" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value as 'active' | 'archived')}>
          <option value="active">{t('people.status_active')}</option>
          <option value="archived">{t('sites.archived')}</option>
        </select>
        {can('sites.manage') && <button className="bc-btn" onClick={() => setEditing('new')}>{t('sites.add')}</button>}
      </>
    }>
      {error && <Alert kind="error">{error}</Alert>}
      <Card><SiteMap sites={data?.items ?? []} /></Card>
      <Card>
        {loading && !data ? <Loading /> : !data?.items.length ? <Empty title={t('sites.none')} /> : (
          <table className="bc-table">
            <thead><tr><th>{t('common.name')}</th><th>{t('common.address')}</th><th>{t('sites.geofence')}</th><th /></tr></thead>
            <tbody>
              {data.items.map((s) => (
                <tr key={s.id}>
                  <td><strong>{s.name}</strong>{s.status === 'archived' && <> <Badge>{t('sites.archived')}</Badge></>}</td>
                  <td>{s.address ?? '—'}</td>
                  <td>{s.geofenceRadiusM ? `${s.geofenceRadiusM} m` : '—'}</td>
                  <td className="num">
                    {s.lat !== null && s.lng !== null && <a className="bc-btn ghost small" href={directionsUrl(s.lat, s.lng)} target="_blank" rel="noopener noreferrer">{t('sites.navigate')}</a>}
                    {can('sites.manage') && <button className="bc-btn secondary small" onClick={() => setEditing(s)}>{t('common.edit')}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {editing && <SiteDrawer base={base} site={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />}
    </Page>
  );
}

function SiteDrawer({ base, site, onClose, onSaved }: { base: string; site: JobSite | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState(site ? {
    name: site.name, address: site.address ?? '', lat: site.lat?.toString() ?? '', lng: site.lng?.toString() ?? '',
    geofenceRadiusM: site.geofenceRadiusM?.toString() ?? '', notes: site.notes ?? '', startsOn: site.startsOn ?? '', endsOn: site.endsOn ?? '',
  } : blank);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const picked = f.lat && f.lng ? { lat: Number(f.lat), lng: Number(f.lng) } : null;

  async function find() {
    setError(null);
    const r = await geocode(f.address);
    if (!r) return setError(t('common.not_found'));
    setF({ ...f, lat: r.lat.toFixed(6), lng: r.lng.toFixed(6), address: r.formatted });
  }

  async function submit(e: FormEvent, extra: Record<string, unknown> = {}) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      name: f.name, address: f.address || null, lat: f.lat ? Number(f.lat) : null, lng: f.lng ? Number(f.lng) : null,
      geofenceRadiusM: f.geofenceRadiusM ? Number(f.geofenceRadiusM) : null, notes: f.notes || null, startsOn: f.startsOn || null, endsOn: f.endsOn || null, ...extra,
    };
    try {
      if (site) await patch(`${base}/${site.id}`, body);
      else await post(base, body);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer title={site ? site.name : t('sites.add')} onClose={onClose}>
      {error && <Alert kind="error">{error}</Alert>}
      <form onSubmit={submit}>
        <Field label={t('common.name')} htmlFor="sname"><input id="sname" required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="bc-row">
          <Field label={t('common.address')} htmlFor="saddr"><input id="saddr" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
          {mapsConfigured() && <button type="button" className="bc-btn secondary" style={{ marginBottom: 16 }} disabled={!f.address} onClick={() => void find()}>{t('sites.find_address')}</button>}
        </div>
        <p className="bc-muted">{t('sites.pick_on_map')}</p>
        <SiteMap sites={[]} picked={picked} radius={f.geofenceRadiusM ? Number(f.geofenceRadiusM) : null} onPick={(lat, lng) => setF((v) => ({ ...v, lat: lat.toFixed(6), lng: lng.toFixed(6) }))} />
        <div className="bc-row" style={{ marginTop: 12 }}>
          <Field label={t('sites.lat')} htmlFor="slat"><input id="slat" type="number" step="any" min={-90} max={90} value={f.lat} onChange={(e) => setF({ ...f, lat: e.target.value })} /></Field>
          <Field label={t('sites.lng')} htmlFor="slng"><input id="slng" type="number" step="any" min={-180} max={180} value={f.lng} onChange={(e) => setF({ ...f, lng: e.target.value })} /></Field>
        </div>
        <Field label={t('sites.geofence')} hint={t('sites.geofence_hint')} htmlFor="srad"><input id="srad" type="number" min={25} max={5000} value={f.geofenceRadiusM} onChange={(e) => setF({ ...f, geofenceRadiusM: e.target.value })} /></Field>
        <div className="bc-row">
          <Field label={t('common.from')} htmlFor="sfrom"><input id="sfrom" type="date" value={f.startsOn} onChange={(e) => setF({ ...f, startsOn: e.target.value })} /></Field>
          <Field label={t('common.to')} htmlFor="sto"><input id="sto" type="date" value={f.endsOn} onChange={(e) => setF({ ...f, endsOn: e.target.value })} /></Field>
        </div>
        <Field label={t('common.notes')} htmlFor="snotes"><textarea id="snotes" maxLength={2000} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <div className="bc-actions">
          {site && site.status === 'active' && <button type="button" className="bc-btn ghost" onClick={(e) => void submit(e as unknown as FormEvent, { status: 'archived' })}>{t('common.archive')}</button>}
          {site && site.status === 'archived' && <button type="button" className="bc-btn ghost" onClick={(e) => void submit(e as unknown as FormEvent, { status: 'active' })}>{t('common.restore')}</button>}
          <button className="bc-btn" disabled={busy}>{busy ? t('common.saving') : t('common.save')}</button>
        </div>
      </form>
    </Drawer>
  );
}
