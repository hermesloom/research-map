import type { TerrainInput, TerrainMesh } from "../terrain/types";

export type WorkerLike = { postMessage(msg: unknown, transfer?: Transferable[]): void; onmessage: ((e: MessageEvent) => void) | null; terminate(): void };
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
  try { return new Worker(new URL("../terrain/worker.ts", import.meta.url), { type: "module" }); } catch { return null; }
};

/** Builds terrain meshes off the main thread, caches them by key (LRU), joins concurrent requests, and lets the newest request supersede older pending ones (their results are cached but not delivered). */
export class TerrainService {
  private worker: WorkerLike | null | undefined; private cache = new Map<TerrainKey, TerrainMesh>(); private pending = new Map<number, { key: TerrainKey; cbs: Cb[] }>();
  private byKey = new Map<TerrainKey, number>(); private nextId = 1; private latestKey: TerrainKey | null = null;
  private readonly maxCached: number; private readonly workerFactory: () => WorkerLike | null; private readonly buildInline?: (i: TerrainInput) => TerrainMesh;
  constructor(opts: { workerFactory?: () => WorkerLike | null; buildInline?: (i: TerrainInput) => TerrainMesh; maxCached?: number } = {}) {
    this.workerFactory = opts.workerFactory ?? defaultWorkerFactory; this.buildInline = opts.buildInline; this.maxCached = opts.maxCached ?? 6; this.ensureWorker();
  }
  request(key: TerrainKey, input: TerrainInput, cb: Cb): void {
    this.latestKey = key;
    const hit = this.cache.get(key); if (hit) { this.touch(key, hit); cb(key, hit); return; }
    for (const [id, p] of this.pending) if (p.key !== key) this.pending.set(id, { key: p.key, cbs: [] });   // superseded: keep the build (it will be cached) but drop its callbacks
    const existing = this.byKey.get(key); if (existing !== undefined && this.pending.has(existing)) { this.pending.get(existing)!.cbs.push(cb); return; }
    const id = this.nextId++; this.pending.set(id, { key, cbs: [cb] }); this.byKey.set(key, id);
    const copy: TerrainInput = { ...input, x: Float32Array.from(input.x), y: Float32Array.from(input.y), cat: Uint16Array.from(input.cat), catRGB: input.catRGB.map((c) => [...c] as [number, number, number]) };
    const w = this.ensureWorker();
    if (w) w.postMessage({ id, input: copy }, [copy.x.buffer, copy.y.buffer, copy.cat.buffer]);
    else setTimeout(() => { try { const build = this.buildInline; if (!build) throw new Error("no terrain builder"); this.deliver(id, build(copy)); } catch (e) { console.warn("terrain build failed", e); this.pending.delete(id); } }, 0);
  }
  private ensureWorker(): WorkerLike | null {
    if (this.worker !== undefined) return this.worker;
    this.worker = this.workerFactory();
    if (this.worker) this.worker.onmessage = (e: MessageEvent) => { const d = e.data as { id: number; mesh?: TerrainMesh; error?: string }; if (d.error) { console.warn("terrain worker:", d.error); this.pending.delete(d.id); return; } if (d.mesh) this.deliver(d.id, d.mesh); };
    return this.worker;
  }
  private deliver(id: number, mesh: TerrainMesh) {
    const p = this.pending.get(id); if (!p) return; this.pending.delete(id); this.byKey.delete(p.key); this.touch(p.key, mesh);
    for (const cb of p.cbs) cb(p.key, mesh);
  }
  private touch(key: TerrainKey, mesh: TerrainMesh) {
    this.cache.delete(key); this.cache.set(key, mesh);
    while (this.cache.size > this.maxCached) { const oldest = this.cache.keys().next().value as TerrainKey; this.cache.delete(oldest); }
  }
  get latest(): TerrainKey | null { return this.latestKey; }
  cancelAll() { for (const [id, p] of this.pending) this.pending.set(id, { key: p.key, cbs: [] }); }
  dispose() { this.cancelAll(); this.worker?.terminate(); this.worker = null; this.cache.clear(); }
}
