import { useState } from 'react';
import type { FeedbackItem } from '@bluecollar/shared';
import { useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { errorMessage, get, patch } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { t, type MessageKey } from '../../i18n';
import { Alert, Badge, Card, Drawer, Empty, Field, Loading, Page } from '../../components/ui';

const STATUSES = ['new', 'planned', 'done', 'closed'] as const;

/** Platform staff: product feedback from users (improvements, complaints, bugs). */
export default function FeedbackInbox() {
  const { me } = useAuth();
  const canManage = !!me?.platform?.permissions.includes('platform.feedback.manage');
  const [status, setStatus] = useState<string>('new');
  const [kind, setKind] = useState<string>('all');
  const list = useApi<{ items: FeedbackItem[]; counts: Record<string, number> }>(`/admin/feedback?status=${status}&kind=${kind}`, [status, kind]);
  const [open, setOpen] = useState<FeedbackItem | null>(null);

  return (
    <Page title={t('fbadmin.title')} subtitle={t('fbadmin.subtitle')}>
      <div className="bc-chips">
        {(['all', ...STATUSES] as const).map((s) => (
          <button key={s} className="bc-chip" aria-pressed={status === s} onClick={() => setStatus(s)}>
            {t(`fbadmin.status_${s}` as MessageKey)}{s !== 'all' && list.data?.counts[s] ? ` (${list.data.counts[s]})` : ''}
          </button>
        ))}
        <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ width: 'auto' }} aria-label={t('feedback.type')}>
          <option value="all">{t('common.all')}</option>
          {(['improvement', 'complaint', 'bug'] as const).map((k) => <option key={k} value={k}>{t(`feedback.kind_${k}`)}</option>)}
        </select>
      </div>
      {list.error && <Alert kind="error">{list.error}</Alert>}
      <Card>
        {list.loading && !list.data ? <Loading /> : !list.data?.items.length ? <Empty title={t('fbadmin.empty')} /> : (
          <div className="bc-table-wrap"><table className="bc-table">
            <thead><tr><th>{t('common.date')}</th><th>{t('feedback.type')}</th><th>{t('fbadmin.from')}</th><th>{t('feedback.message')}</th><th>{t('fbadmin.files')}</th><th>{t('common.status')}</th></tr></thead>
            <tbody>{list.data.items.map((f) => (
              <tr key={f.id} role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => setOpen(f)} onKeyDown={(e) => e.key === 'Enter' && setOpen(f)}>
                <td>{fmtDateTime(f.createdAt)}</td>
                <td><Badge kind={f.kind === 'complaint' ? 'error' : f.kind === 'bug' ? 'warning' : 'info'}>{t(`feedback.kind_${f.kind}`)}</Badge></td>
                <td>{f.userName}<div className="bc-muted">{f.companyName ?? f.userEmail}</div></td>
                <td style={{ maxWidth: 380 }}>{f.message ? (f.message.length > 140 ? `${f.message.slice(0, 140)}…` : f.message) : <em>{t('fbadmin.voice_only')}</em>}</td>
                <td>{f.hasAudio && '🎤 '}{f.hasScreenshot && '🖼️'}</td>
                <td>{t(`fbadmin.status_${f.status}`)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {open && <FeedbackDrawer item={open} canManage={canManage} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); void list.reload(); }} />}
    </Page>
  );
}

function FeedbackDrawer({ item, canManage, onClose, onSaved }: { item: FeedbackItem; canManage: boolean; onClose: () => void; onSaved: () => void }) {
  const files = useApi<{ audio: string | null; screenshot: string | null }>(item.hasAudio || item.hasScreenshot ? `/admin/feedback/${item.id}/files` : null, [item.id]);
  const [status, setStatus] = useState(item.status);
  const [note, setNote] = useState(item.adminNote ?? '');
  const [error, setError] = useState<string | null>(null);
  return (
    <Drawer title={`${t(`feedback.kind_${item.kind}`)} · ${item.userName}`} onClose={onClose}>
      {error && <Alert kind="error">{error}</Alert>}
      <p className="bc-muted">{item.userEmail}{item.companyName && ` · ${item.companyName}`} · {item.platform}{item.appVersion && ` ${item.appVersion}`} · {item.locale} · {fmtDateTime(item.createdAt)}</p>
      {item.message && <p style={{ whiteSpace: 'pre-wrap' }}>{item.message}</p>}
      {files.loading && <Loading />}
      {files.data?.audio && <audio controls src={files.data.audio} style={{ width: '100%' }} />}
      {item.hasAudio && files.data && !files.data.audio && <Alert kind="warning">{t('fbadmin.file_missing')}</Alert>}
      {files.data?.screenshot && <a href={files.data.screenshot} target="_blank" rel="noopener noreferrer"><img src={files.data.screenshot} alt={t('feedback.screenshot')} style={{ maxWidth: '100%', borderRadius: 8, marginTop: 8 }} /></a>}
      <Field label={t('common.status')} htmlFor="fst">
        <select id="fst" disabled={!canManage} value={status} onChange={(e) => setStatus(e.target.value as FeedbackItem['status'])}>
          {STATUSES.map((s) => <option key={s} value={s}>{t(`fbadmin.status_${s}`)}</option>)}
        </select>
      </Field>
      <Field label={t('fbadmin.reply')} htmlFor="fnote" hint={t('fbadmin.reply_hint')}><textarea id="fnote" disabled={!canManage} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      {canManage && <div className="bc-actions"><button className="bc-btn" onClick={async () => {
        try { await patch(`/admin/feedback/${item.id}`, { status, adminNote: note.trim() || null }); onSaved(); } catch (e) { setError(errorMessage(e)); }
      }}>{t('common.save')}</button></div>}
    </Drawer>
  );
}
void get;
