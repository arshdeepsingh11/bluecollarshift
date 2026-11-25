import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from './lib/config';

export function Screen({ children, refreshing, onRefresh, scroll = true }: { children: ReactNode; refreshing?: boolean; onRefresh?: () => void; scroll?: boolean }) {
  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      {scroll ? (
        <ScrollView contentContainerStyle={s.content} refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={theme.primary} /> : undefined}>
          {children}
        </ScrollView>
      ) : (
        <View style={[s.content, { flex: 1 }]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function H1({ children }: { children: ReactNode }) {
  return <Text style={s.h1} accessibilityRole="header">{children}</Text>;
}

export function Muted({ children, style }: { children: ReactNode; style?: object }) {
  return <Text style={[s.muted, style]}>{children}</Text>;
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Button({ title, onPress, kind = 'primary', disabled, big, loading }: { title: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger'; disabled?: boolean; big?: boolean; loading?: boolean }) {
  const bg = kind === 'primary' ? theme.primary : kind === 'danger' ? theme.error : theme.surface;
  const fg = kind === 'secondary' ? theme.primary : '#fff';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [s.btn, big && s.btnBig, { backgroundColor: bg, borderColor: kind === 'secondary' ? theme.border : bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[s.btnText, big && { fontSize: 20 }, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Badge({ text, tone }: { text: string; tone?: 'success' | 'warning' | 'error' | 'info' }) {
  const map = { success: [theme.successBg, theme.success], warning: [theme.warningBg, theme.warning], error: [theme.errorBg, theme.error], info: [theme.light, theme.primaryDark] } as const;
  const [bg, fg] = tone ? map[tone] : [theme.surface2, theme.text2];
  return <Text style={[s.badge, { backgroundColor: bg, color: fg }]}>{text}</Text>;
}

export function Banner({ text, tone = 'info', onPress }: { text: string; tone?: 'info' | 'warning' | 'error' | 'success'; onPress?: () => void }) {
  const map = { success: [theme.successBg, theme.success], warning: [theme.warningBg, theme.warning], error: [theme.errorBg, theme.error], info: [theme.light, theme.primaryDark] } as const;
  const [bg, fg] = map[tone];
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : 'text'} style={[s.banner, { backgroundColor: bg }]}>
      <Text style={{ color: fg, fontSize: 14, fontWeight: '600' }}>{text}</Text>
    </Pressable>
  );
}

export function Loading() {
  return <View style={{ padding: 32 }}><ActivityIndicator color={theme.primary} /></View>;
}

export function Row({ title, subtitle, right, onPress }: { title: string; subtitle?: string; right?: ReactNode; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [s.row, pressed && { backgroundColor: theme.surface2 }]} accessibilityRole={onPress ? 'button' : undefined}>
      <View style={{ flex: 1 }}>
        <Text style={s.rowTitle}>{title}</Text>
        {subtitle ? <Text style={s.muted}>{subtitle}</Text> : null}
      </View>
      {right}
    </Pressable>
  );
}

export const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 16, gap: 12 },
  h1: { fontSize: 28, fontWeight: '800', color: theme.text, marginBottom: 4 },
  muted: { color: theme.text3, fontSize: 14 },
  card: { backgroundColor: theme.surface, borderRadius: theme.radius, padding: 16, borderWidth: 1, borderColor: theme.border, gap: 8 },
  btn: { minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, borderWidth: 1 },
  btnBig: { minHeight: 76, borderRadius: 40 },
  btnText: { fontSize: 16, fontWeight: '700' },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, fontSize: 12, fontWeight: '700', overflow: 'hidden' },
  banner: { borderRadius: 12, padding: 12 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.border, gap: 8 },
  rowTitle: { fontSize: 16, fontWeight: '600', color: theme.text },
  input: { borderWidth: 1, borderColor: theme.border, borderRadius: 12, padding: 14, fontSize: 16, backgroundColor: theme.surface, color: theme.text },
  label: { fontSize: 13, fontWeight: '600', color: theme.text2, marginBottom: 4 },
});

export const fmtTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' }) : '—');
export const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });
export const fmtDateTime = (iso: string | null | undefined) => (iso ? `${fmtDay(iso)} ${fmtTime(iso)}` : '—');
export const fmtMinutes = (m: number | null | undefined) => (m === null || m === undefined ? '—' : `${Math.floor(m / 60)}h ${String(Math.abs(m % 60)).padStart(2, '0')}m`);
