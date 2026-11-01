export type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown; skipped?: boolean };
/** Map with a concurrency bound; results keep input order; one failure never aborts the others.
 *  With `deadline` (a function returning a ms timestamp), items not yet started after the deadline are marked skipped. */
export async function mapConcurrent<A, T>(items: A[], limit: number, fn: (item: A, index: number) => Promise<T>, opts: { deadline?: () => number } = {}): Promise<Settled<T>[]> {
  const out: Settled<T>[] = new Array(items.length); let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++; if (i >= items.length) return;
      if (opts.deadline && Date.now() > opts.deadline()) { out[i] = { ok: false, error: new Error("deadline"), skipped: true }; continue; }
      try { out[i] = { ok: true, value: await fn(items[i], i) }; } catch (error) { out[i] = { ok: false, error }; }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}
/** A fetch that aborts after `ms`; one hung host must not stall a whole run. */
export function fetchWithTimeout(f: typeof fetch, ms: number): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(new Error(`timeout after ${ms}ms`)), ms);
    const signal = init?.signal; signal?.addEventListener("abort", () => ctrl.abort(signal.reason));
    return f(input, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(t));
  }) as typeof fetch;
}
