import { useEffect, useRef, useState } from 'react';
import type { UploadTarget } from '@bluecollar/shared';
import { Alert, Drawer, Field } from './ui';
import { errorMessage, post } from '../lib/api';
import { compressImage, uploadTo } from '../lib/upload';
import { t } from '../i18n';

const MAX_SECONDS = 120;
type Kind = 'improvement' | 'complaint' | 'bug';

function pickMime(): string {
  const options = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  return options.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) ?? '';
}

/** Share an improvement, complaint or bug: type it, record a voice note, attach a screenshot. */
export function FeedbackDialog({ companyId, onClose }: { companyId?: string | null; onClose: () => void }) {
  const [kind, setKind] = useState<Kind>('improvement');
  const [message, setMessage] = useState('');
  const [audio, setAudio] = useState<{ blob: Blob; url: string; seconds: number } | null>(null);
  const [shot, setShot] = useState<Blob | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const rec = useRef<MediaRecorder | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current) window.clearInterval(timer.current);
    rec.current?.stream.getTracks().forEach((tr) => tr.stop());
    if (audio) URL.revokeObjectURL(audio.url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickMime();
      const r = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
      const chunks: Blob[] = [];
      const started = Date.now();
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop());
        const type = (r.mimeType || 'audio/webm').split(';')[0]!;
        const blob = new Blob(chunks, { type });
        setAudio({ blob, url: URL.createObjectURL(blob), seconds: Math.min(MAX_SECONDS, Math.round((Date.now() - started) / 1000)) });
        setRecording(false);
        if (timer.current) window.clearInterval(timer.current);
      };
      rec.current = r;
      r.start();
      setRecording(true);
      setElapsed(0);
      timer.current = window.setInterval(() => {
        const s = Math.round((Date.now() - started) / 1000);
        setElapsed(s);
        if (s >= MAX_SECONDS) r.stop();
      }, 500);
    } catch {
      setError(t('feedback.mic_denied'));
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await post<{ id: string; uploads: { audio: UploadTarget | null; screenshot: UploadTarget | null } }>('/feedback', {
        kind, message: message.trim() || null, companyId: companyId ?? null, platform: 'web', appVersion: (import.meta.env.VITE_APP_VERSION as string) || null,
        audio: audio ? { contentType: audio.blob.type || 'audio/webm', size: audio.blob.size, seconds: audio.seconds } : null,
        screenshot: shot ? { contentType: shot.type || 'image/jpeg', size: shot.size } : null,
      });
      const ok = await Promise.all([
        audio && res.uploads.audio ? uploadTo(res.uploads.audio, audio.blob) : true,
        shot && res.uploads.screenshot ? uploadTo(res.uploads.screenshot, shot) : true,
      ]);
      if (ok.includes(false)) setError(t('feedback.upload_failed'));
      setDone(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const canSend = !busy && !recording && (message.trim().length >= 3 || !!audio);
  return (
    <Drawer title={t('feedback.title')} onClose={onClose} center>
      {done ? (
        <>
          <Alert kind="success">{t('feedback.thanks')}</Alert>
          {error && <Alert kind="warning">{error}</Alert>}
          <div className="bc-actions"><button className="bc-btn" onClick={onClose}>{t('common.close')}</button></div>
        </>
      ) : (
        <>
          <p className="bc-muted">{t('feedback.intro')}</p>
          <div className="bc-chips" role="group" aria-label={t('feedback.type')}>
            {(['improvement', 'complaint', 'bug'] as Kind[]).map((k) => (
              <button key={k} type="button" className="bc-chip" aria-pressed={kind === k} onClick={() => setKind(k)}>{t(`feedback.kind_${k}`)}</button>
            ))}
          </div>
          <Field label={t('feedback.message')} htmlFor="fb-msg">
            <textarea id="fb-msg" rows={5} maxLength={4000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t('feedback.placeholder')} />
          </Field>
          <div className="bc-recorder">
            {recording ? (
              <>
                <span className="bc-recording-dot" aria-hidden />
                <span>{t('feedback.recording', { s: elapsed, max: MAX_SECONDS })}</span>
                <button type="button" className="bc-btn secondary small" onClick={() => rec.current?.stop()}>{t('feedback.stop')}</button>
              </>
            ) : audio ? (
              <>
                <audio controls src={audio.url} />
                <button type="button" className="bc-btn ghost small" onClick={() => { URL.revokeObjectURL(audio.url); setAudio(null); }}>{t('common.delete')}</button>
              </>
            ) : (
              typeof MediaRecorder !== 'undefined' && <button type="button" className="bc-btn secondary small" onClick={() => void start()}>🎤 {t('feedback.record')}</button>
            )}
          </div>
          <Field label={t('feedback.screenshot')} htmlFor="fb-shot" hint={t('feedback.screenshot_hint')}>
            <input id="fb-shot" type="file" accept="image/png,image/jpeg,image/webp" onChange={async (e) => {
              const f = e.target.files?.[0];
              setShot(f ? await compressImage(f) : null);
            }} />
          </Field>
          {error && <Alert kind="error">{error}</Alert>}
          <div className="bc-actions">
            <button className="bc-btn ghost" onClick={onClose}>{t('common.cancel')}</button>
            <button className="bc-btn" disabled={!canSend} onClick={() => void submit()}>{busy ? t('common.saving') : t('feedback.send')}</button>
          </div>
        </>
      )}
    </Drawer>
  );
}
