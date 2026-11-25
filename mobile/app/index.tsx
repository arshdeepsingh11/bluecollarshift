import { Redirect } from 'expo-router';
import { useSession } from '../src/state/session';
import { Loading, Screen } from '../src/ui';

export default function Index() {
  const { session, me, loading } = useSession();
  if (loading) return <Screen><Loading /></Screen>;
  if (!session || !me) return <Redirect href="/login" />;
  return <Redirect href="/(tabs)" />;
}
