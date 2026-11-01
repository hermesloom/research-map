import type { TerrainInput, TerrainMesh } from "../terrain/types";

export type WorkerLike = { postMessage(msg: unknown, transfer?: Transferable[]): void; onmessage: ((e: MessageEvent) => void) | null; onerror?: ((e: unknown) => void) | null; terminate(): void };
export type TerrainKey = string;
type Cb = (key: TerrainKey, mesh: TerrainMesh) => void;

/** FNV-1a over the lens id, the visible row indices and the positions: identical inputs always get the same terrain, and moved points (e.g. time rows after metadata loads) get a new one. */
export function terrainKey(lens: string, rows: ArrayLike<number>, x: Float32Array, y: Float32Array): TerrainKey {
  let h = 2166136261; const mix = (v: number) => { h ^= v & 0xffff; h = Math.imul(h, 16777619); h ^= v >>> 16; h = Math.imul(h, 16777619); };
  for (let i = 0; i < lens.length; i++) mix(lens.charCodeAt(i)); for (let i = 0; i < rows.length; i++) mix(rows[i]);
  const xi = new Uint32Array(x.buffer, x.byteOffset, x.length), yi = new Uint32Array(y.buffer, y.byteOffset, y.length); for (let i = 0; i < xi.length; i++) { mix(xi[i]); mix(yi[i]); }
  return `${lens}:${rows.length}:${(h >>> 0).toString(16)}`;
}

const defaultWorkerFactory = (): WorkerLike | null => {
  if (typeof Worker === "undefined") return null;
  try { return new Worker(new URL("../terrain/worker.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike; } catch { return null; }
};

/** Builds terrain meshes off the main thread with one build in flight and one queued slot (newer requests replace the queued one), caches by key (LRU), joins concurrent requests for the same key, and falls back to an inline build when the worker fails. */
export class TerrainService {
  private worker: WorkerLike | null | undefined; private cache = new Map<TerrainKey, TerrainMesh>();
  private inFlight: { id: number; key: TerrainKey; input: TerrainInput; cbs: Cb[] } | null = null; private queued: { key: TerrainKey; input: TerrainInput; cbs: Cb[] } | null = null;
  private nextId = 1; private latestKey: TerrainKey | null = null;
  private readonly maxCached: number; private readonly workerFactory: () => WorkerLike | null; private readonly buildInline?: (i: TerrainInput) => TerrainMesh;
  constructor(opts: { workerFactory?: () => WorkerLike | null; buildInline?: (i: TerrainInput) => TerrainMesh; maxCached?: number } = {}) {
    this.workerFactory = opts.workerFactory ?? defaultWorkerFactory; this.buildInline = opts.buildInline; this.maxCached = opts.maxCached ?? 6; this.ensureWorker();
  }
  has(key: TerrainKey) { return this.cache.has(key); }
  request(key: TerrainKey, input: TerrainInput, cb: Cb): void {
    this.latestKey = key;
    const hit = this.cache.get(key);
    if (hit) { if (this.inFlight && this.inFlight.key !== key) this.inFlight.cbs = []; this.queued = null; this.touch(key, hit); cb(key, hit); return; }
    if (this.inFlight && this.inFlight.key === key) { this.inFlight.cbs.push(cb); this.queued = null; return; }
    if (this.queued && this.queued.key === key) { this.queued.cbs.push(cb); return; }
    const copy: TerrainInput = { ...input, x: Float32Array.from(input.x), y: Float32Array.from(input.y), cat: Uint16Array.from(input.cat), catRGB: input.catRGB.map((c) => [...c] as [number, number, number]) };
    if (this.inFlight) { this.inFlight.cbs = []; this.queued = { key, input: copy, cbs: [cb] }; return; }   // superseded: the running build is kept (it will be cached) but nobody waits for it
    this.start(key, copy, [cb]);
  }
  private start(key: TerrainKey, input: TerrainInput, cbs: Cb[]) {
    const id = this.nextId++; this.inFlight = { id, key, input, cbs };
    const w = this.ensureWorker();
    if (w) w.postMessage({ id, input });
    else this.runInline(id);
  }
  private runInline(id: number) {
    setTimeout(() => { const f = this.inFlight; if (!f || f.id !== id) return; try { const build = this.buildInline; if (!build) throw new Error("no terrain builder"); this.deliver(id, build(f.input)); } catch (e) { console.warn("terrain build failed", e); this.inFlight = null; this.next(); } }, 0);
  }
  private ensureWorker(): WorkerLike | null {
    if (this.worker !== undefined) return this.worker;
    this.worker = this.workerFactory();
    if (this.worker) {
      this.worker.onmessage = (e: MessageEvent) => { const d = e.data as { id: number; mesh?: TerrainMesh; error?: string }; if (d.error) { console.warn("terrain worker:", d.error); if (this.inFlight?.id === d.id) { this.inFlight = null; this.next(); } return; } if (d.mesh) this.deliver(d.id, d.mesh); };
      this.worker.onerror = (e: unknown) => { console.warn("terrain worker failed, building inline", e); this.worker?.terminate(); this.worker = null; if (this.inFlight) this.runInline(this.inFlight.id); };
    }
    return this.worker;
  }
  private deliver(id: number, mesh: TerrainMesh) {
    const f = this.inFlight; if (!f || f.id !== id) return; this.inFlight = null; this.touch(f.key, mesh);
    for (const cb of f.cbs) cb(f.key, mesh);
    this.next();
  }
  private next() { const q = this.queued; if (!q) return; this.queued = null; this.start(q.key, q.input, q.cbs); }
  private touch(key: TerrainKey, mesh: TerrainMesh) {
    this.cache.delete(key); this.cache.set(key, mesh);
    while (this.cache.size > this.maxCached) { const oldest = this.cache.keys().next().value as TerrainKey; this.cache.delete(oldest); }
  }
  get latest(): TerrainKey | null { return this.latestKey; }
  cancelAll() { if (this.inFlight) this.inFlight.cbs = []; this.queued = null; }
  dispose() { this.cancelAll(); this.worker?.terminate(); this.worker = null; this.cache.clear(); }
}
