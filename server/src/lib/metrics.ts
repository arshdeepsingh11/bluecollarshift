/**
 * Lightweight in-process metrics (no paid APM). Exposed to platform operations at
 * GET /api/v1/ops/metrics. Tracks request counts, error rates and latency percentiles per route.
 */
interface RouteStats {
  count: number;
  errors: number;
  samples: number[]; // ring buffer of recent latencies (ms)
  idx: number;
}

const SAMPLE = 512;

export class Metrics {
  private routes = new Map<string, RouteStats>();
  private started = Date.now();
  readonly counters = new Map<string, number>();

  record(route: string, method: string, status: number, ms: number) {
    const key = `${method} ${route}`;
    let r = this.routes.get(key);
    if (!r) {
      r = { count: 0, errors: 0, samples: [], idx: 0 };
      this.routes.set(key, r);
    }
    r.count++;
    if (status >= 500) r.errors++;
    if (r.samples.length < SAMPLE) r.samples.push(ms);
    else {
      r.samples[r.idx] = ms;
      r.idx = (r.idx + 1) % SAMPLE;
    }
  }

  inc(name: string, by = 1) {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  snapshot() {
    const pct = (arr: number[], p: number) => {
      if (arr.length === 0) return 0;
      const s = [...arr].sort((a, b) => a - b);
      return Math.round((s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0) * 10) / 10;
    };
    return {
      uptimeSeconds: Math.round((Date.now() - this.started) / 1000),
      memoryMb: Math.round(process.memoryUsage().rss / 1048576),
      counters: Object.fromEntries(this.counters),
      routes: [...this.routes.entries()]
        .map(([route, r]) => ({ route, count: r.count, errors: r.errors, p50: pct(r.samples, 50), p95: pct(r.samples, 95), p99: pct(r.samples, 99) }))
        .sort((a, b) => b.count - a.count),
    };
  }
}
