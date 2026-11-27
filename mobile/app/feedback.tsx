import { useEffect, useRef, useState } from 'react';
import { Image, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioPlayer, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import * as ImagePicker from 'expo-image-picker';
import type { FeedbackItem, UploadTarget } from '@bluecollar/shared';
import { useSession } from '../src/state/session';
import { api } from '../src/lib/api';
import { appVersion } from '../src/lib/device';
import { fileSize, uploadFile } from '../src/lib/upload';
import { t, type Key } from '../src/i18n';
import { theme } from '../src/lib/config';
import { Badge, Banner, Button, Card, H1, Muted, Row, Screen, fmtDateTime, s } from '../src/ui';

const MAX_SECONDS = 120;
type Kind = 'improvement' | 'complaint' | 'bug';

/** Send an idea, complaint or bug: type it and/or record a voice note, add a screenshot. */
export default function Feedback() {
  const { membership } = useSession();
  const [kind, setKind] = useState<Kind>('improvement');
  const [message, setMessage] = useState('');
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [shot, setShot] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const [mine, setMine] = useState<FeedbackItem[]>([]);
  const recorder = useAudioRecorder({ ...RecordingPresets.LOW_QUALITY, extension: '.m4a' });
  const state = useAudioRecorderState(recorder, 500);
  const player = useAudioPlayer(audioUri ? { uri: audioUri } : null);
  const stopping = useRef(false);

  useEffect(() => {
    void api<{ items: FeedbackItem[] }>('/feedback/mine').then((r) => setMine(r.items)).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (state.isRecording && state.durationMillis / 1000 >= MAX_SECONDS) void stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.durationMillis]);

  async function start() {
    setMsg(null);
    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (!perm.granted) return setMsg({ tone: 'error', text: t('fb_mic_denied') });
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
  }
  async function stop() {
    if (stopping.current) return;
    stopping.current = true;
    const secs = Math.min(MAX_SECONDS, Math.round(state.durationMillis / 1000));
    await recorder.stop();
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
    setSeconds(secs);
    setAudioUri(recorder.uri);
    stopping.current = false;
  }
  async function pickShot() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.5, exif: false });
    if (!res.canceled && res.assets[0]) setShot(res.assets[0]);
  }

  async function send() {
    setBusy(true);
    setMsg(null);
    try {
      const audioSize = audioUri ? await fileSize(audioUri) : 0;
      const shotSize = shot ? await fileSize(shot.uri) : 0;
      const shotType = shot?.mimeType === 'image/png' ? 'image/png' : 'image/jpeg';
      const res = await api<{ id: string; uploads: { audio: UploadTarget | null; screenshot: UploadTarget | null } }>('/feedback', {
        method: 'POST', body: {
          kind, message: message.trim() || null, companyId: membership?.companyId ?? null, platform: Platform.OS === 'ios' ? 'ios' : 'android', appVersion,
          audio: audioUri && audioSize > 0 ? { contentType: 'audio/mp4', size: audioSize, seconds } : null,
          screenshot: shot && shotSize > 0 && shotSize <= 5_242_880 ? { contentType: shotType, size: shotSize } : null,
        },
      });
      const ok = await Promise.all([
        audioUri && res.uploads.audio ? uploadFile(res.uploads.audio, audioUri) : true,
        shot && res.uploads.screenshot ? uploadFile(res.uploads.screenshot, shot.uri) : true,
      ]);
      setMsg(ok.includes(false) ? { tone: 'warning', text: t('fb_upload_failed') } : { tone: 'success', text: t('fb_thanks') });
      setMessage(''); setAudioUri(null); setShot(null);
      void api<{ items: FeedbackItem[] }>('/feedback/mine').then((r) => setMine(r.items)).catch(() => undefined);
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof Error ? e.message : t('error_generic') });
    } finally {
      setBusy(false);
    }
  }

  const canSend = !busy && !state.isRecording && (message.trim().length >= 3 || !!audioUri);
  return (
    <Screen>
      <Muted>{t('fb_intro')}</Muted>
      {msg && <Banner tone={msg.tone} text={msg.text} />}
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {(['improvement', 'complaint', 'bug'] as Kind[]).map((k) => (
          <Pressable key={k} onPress={() => setKind(k)} accessibilityRole="radio" accessibilityState={{ selected: kind === k }}
            style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: theme.border, backgroundColor: kind === k ? theme.primary : theme.surface }}>
            <Text style={{ color: kind === k ? '#fff' : theme.text, fontWeight: '600' }}>{t(k === 'improvement' ? 'fb_improvement' : k === 'complaint' ? 'fb_complaint' : 'fb_bug')}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput style={[s.input, { minHeight: 120, textAlignVertical: 'top' }]} multiline maxLength={4000} value={message} onChangeText={setMessage} placeholder={t('fb_placeholder')} accessibilityLabel={t('fb_placeholder')} />
      <Card>
        {state.isRecording ? (
          <>
            <Text style={{ color: theme.error, fontWeight: '700' }}>● {t('fb_recording', { s: Math.round(state.durationMillis / 1000), max: MAX_SECONDS })}</Text>
            <Button kind="danger" title={t('fb_stop')} onPress={() => void stop()} />
          </>
        ) : audioUri ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}><Button kind="secondary" title={`▶ ${t('fb_play')} (${seconds}s)`} onPress={() => { player.seekTo(0); player.play(); }} /></View>
            <View style={{ flex: 1 }}><Button kind="secondary" title={t('fb_delete')} onPress={() => setAudioUri(null)} /></View>
          </View>
        ) : (
          <Button kind="secondary" title={`🎤 ${t('fb_record')}`} onPress={() => void start()} />
        )}
      </Card>
      {shot ? (
        <Card>
          <Image source={{ uri: shot.uri }} style={{ width: '100%', height: 220, borderRadius: 8 }} resizeMode="contain" accessibilityLabel={t('fb_screenshot')} />
          <Button kind="secondary" title={t('fb_remove')} onPress={() => setShot(null)} />
        </Card>
      ) : <Button kind="secondary" title={`🖼 ${t('fb_screenshot')}`} onPress={() => void pickShot()} />}
      <Button title={t('fb_send')} disabled={!canSend} loading={busy} onPress={() => void send()} />
      {!canSend && !busy && !state.isRecording && <Muted>{t('fb_need_text')}</Muted>}
      {mine.length > 0 && (
        <>
          <H1>{t('fb_mine')}</H1>
          <Card>{mine.map((f) => (
            <Row key={f.id} title={f.message ? f.message.slice(0, 60) : '🎤'} subtitle={`${fmtDateTime(f.createdAt)}${f.adminNote ? ` · ${f.adminNote}` : ''}`}
              right={<Badge tone={f.status === 'done' ? 'success' : f.status === 'planned' ? 'info' : undefined} text={t(`fb_status_${f.status}` as Key)} />} />
          ))}</Card>
        </>
      )}
    </Screen>
  );
}
