export type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };
/** Map with a concurrency bound; results keep input order; one failure never aborts the others. */
export async function mapConcurrent<A, T>(items: A[], limit: number, fn: (item: A, index: number) => Promise<T>): Promise<Settled<T>[]> {
  const out: Settled<T>[] = new Array(items.length); let next = 0;
  const worker = async () => { for (;;) { const i = next++; if (i >= items.length) return; try { out[i] = { ok: true, value: await fn(items[i], i) }; } catch (error) { out[i] = { ok: false, error }; } } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}
