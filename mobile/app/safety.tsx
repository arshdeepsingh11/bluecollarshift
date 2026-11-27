import { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, Switch, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import type { SafetyReport, ToolboxTalk, UploadTarget } from '@bluecollar/shared';
import { useSession } from '../src/state/session';
import { api } from '../src/lib/api';
import { fileSize, uploadFile } from '../src/lib/upload';
import { t, type Key } from '../src/i18n';
import { theme } from '../src/lib/config';
import { Badge, Banner, Button, Card, H1, Muted, Row, Screen, fmtDateTime, s } from '../src/ui';

const KINDS = ['incident', 'near_miss', 'hazard'] as const;

/** Report incidents, near misses and hazards (with a photo); sign toolbox talks. */
export default function Safety() {
  const { membership } = useSession();
  const base = membership ? `/companies/${membership.companyId}` : '';
  const [reports, setReports] = useState<SafetyReport[]>([]);
  const [talks, setTalks] = useState<ToolboxTalk[]>([]);
  const [kind, setKind] = useState<(typeof KINDS)[number]>('incident');
  const [what, setWhat] = useState('');
  const [hurt, setHurt] = useState(false);
  const [injury, setInjury] = useState('');
  const [action, setAction] = useState('');
  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error' | 'warning'; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!membership) return;
    const [r, tk] = await Promise.all([
      api<{ items: SafetyReport[] }>(`${base}/safety/reports`).catch(() => ({ items: [] })),
      api<{ items: ToolboxTalk[] }>(`${base}/safety/talks`).catch(() => ({ items: [] })),
    ]);
    setReports(r.items);
    setTalks(tk.items);
  }, [membership, base]);
  useEffect(() => void load(), [load]);

  async function pick(camera: boolean) {
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = await (camera ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync)({ mediaTypes: ['images'], quality: 0.5, exif: false });
    if (!res.canceled && res.assets[0]) setPhoto(res.assets[0]);
  }

  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      const size = photo ? await fileSize(photo.uri) : 0;
      const contentType = photo?.mimeType === 'image/png' ? 'image/png' : 'image/jpeg';
      const r = await api<SafetyReport & { photoUpload: UploadTarget | null }>(`${base}/safety/reports`, {
        method: 'POST', body: {
          kind, occurredAt: new Date().toISOString(), description: what.trim(), injured: kind === 'incident' && hurt,
          injuryDetails: hurt ? injury.trim() || null : null, actionTaken: action.trim() || null,
          photo: photo && size > 0 && size <= 5_242_880 ? { contentType, size } : null,
        },
      });
      const ok = photo && r.photoUpload ? await uploadFile(r.photoUpload, photo.uri) : true;
      setMsg(ok ? { tone: 'success', text: t('report_sent') } : { tone: 'warning', text: t('fb_upload_failed') });
      setWhat(''); setHurt(false); setInjury(''); setAction(''); setPhoto(null);
      await load();
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof Error ? e.message : t('error_generic') });
    } finally {
      setBusy(false);
    }
  }

  const toSign = talks.filter((x) => x.attendees.some((a) => a.membershipId === membership?.membershipId && !a.signedAt));
  return (
    <Screen onRefresh={() => void load()}>
      {msg && <Banner tone={msg.tone} text={msg.text} />}
      {toSign.length > 0 && (
        <Card>
          <Text style={s.rowTitle}>{t('to_sign')}</Text>
          {toSign.map((x) => (
            <Row key={x.id} title={x.topic} subtitle={`${x.ledBy} · ${fmtDateTime(x.heldAt)}`}
              right={<Pressable accessibilityRole="button" onPress={async () => {
                try { await api(`${base}/safety/talks/${x.id}/sign`, { method: 'POST', body: {} }); setMsg({ tone: 'success', text: t('signed') }); await load(); }
                catch (e) { setMsg({ tone: 'error', text: e instanceof Error ? e.message : t('error_generic') }); }
              }}><Text style={{ color: theme.primary, fontWeight: '700' }}>{t('i_attended')}</Text></Pressable>} />
          ))}
        </Card>
      )}
      <H1>{t('report_problem')}</H1>
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        {KINDS.map((k) => (
          <Pressable key={k} onPress={() => setKind(k)} accessibilityRole="radio" accessibilityState={{ selected: kind === k }}
            style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: theme.border, backgroundColor: kind === k ? theme.primary : theme.surface }}>
            <Text style={{ color: kind === k ? '#fff' : theme.text, fontWeight: '600' }}>{t(k)}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={s.label}>{t('what_happened')}</Text>
      <TextInput style={[s.input, { minHeight: 100 }]} multiline maxLength={4000} value={what} onChangeText={setWhat} />
      {kind === 'incident' && (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={s.rowTitle}>{t('someone_hurt')}</Text>
          <Switch value={hurt} onValueChange={setHurt} accessibilityLabel={t('someone_hurt')} />
        </View>
      )}
      {hurt && <><Text style={s.label}>{t('injury_details')}</Text><TextInput style={[s.input, { minHeight: 70 }]} multiline maxLength={2000} value={injury} onChangeText={setInjury} /></>}
      <Text style={s.label}>{t('action_taken')}</Text>
      <TextInput style={[s.input, { minHeight: 70 }]} multiline maxLength={2000} value={action} onChangeText={setAction} />
      {photo ? (
        <Card>
          <Image source={{ uri: photo.uri }} style={{ width: '100%', height: 200, borderRadius: 8 }} resizeMode="cover" accessibilityLabel={t('add_photo')} />
          <Button kind="secondary" title={t('fb_remove')} onPress={() => setPhoto(null)} />
        </Card>
      ) : (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}><Button kind="secondary" title={`📷 ${t('take_photo')}`} onPress={() => void pick(true)} /></View>
          <View style={{ flex: 1 }}><Button kind="secondary" title={`🖼 ${t('add_photo')}`} onPress={() => void pick(false)} /></View>
        </View>
      )}
      <Button title={t('send_report')} disabled={what.trim().length < 5} loading={busy} onPress={() => void submit()} />

      <H1>{t('my_reports')}</H1>
      {!reports.length ? <Muted>{t('no_reports')}</Muted> : (
        <Card>{reports.map((r) => (
          <Row key={r.id} title={`${t(r.kind as Key)}${r.injured ? ' · ⚠️' : ''}`} subtitle={`${fmtDateTime(r.occurredAt)} · ${r.description.slice(0, 60)}`}
            right={<Badge tone={r.status === 'open' ? 'warning' : 'success'} text={t(r.status === 'open' ? 'status_open' : 'status_closed')} />} />
        ))}</Card>
      )}
    </Screen>
  );
}
