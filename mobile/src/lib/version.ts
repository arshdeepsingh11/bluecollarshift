/** "1.2.10" < "1.10.0" — numeric compare per part. */
export function isOlder(current: string, min: string) {
  const a = current.split('.').map(Number);
  const b = min.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}
