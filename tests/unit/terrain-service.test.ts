import { describe, it, expect, vi } from "vitest";
import { TerrainService, terrainKey, type WorkerLike } from "@/app/canvas/gl/terrainService";
import type { TerrainInput, TerrainMesh } from "@/app/canvas/terrain/types";
import { emptyMesh } from "@/app/canvas/terrain/mesh";

const input = (n: number): TerrainInput => ({ x: new Float32Array(n), y: new Float32Array(n), cat: new Uint16Array(n), catRGB: [] });
const mesh = (tag: number): TerrainMesh => ({ ...emptyMesh({ categories: tag, ms: 0, sigmaUnits: 1 }) });
class FakeWorker implements WorkerLike {
  posted: { id: number; input: TerrainInput }[] = []; onmessage: ((e: MessageEvent) => void) | null = null; onerror: ((e: unknown) => void) | null = null; terminated = false;
  postMessage(m: { id: number; input: TerrainInput }) { this.posted.push(m); }
  resolve(i: number, tag: number) { this.onmessage?.({ data: { id: this.posted[i].id, mesh: mesh(tag) } } as MessageEvent); }
  terminate() { this.terminated = true; }
}

describe("terrainKey", () => {
  it("depends on lens, row set and positions, not on array identity", () => {
    const x = Float32Array.from([0, 1, 2]), y = Float32Array.from([0, 0, 1]);
    expect(terrainKey("terrain", [1, 2, 3], x, y)).toBe(terrainKey("terrain", Int32Array.from([1, 2, 3]), Float32Array.from(x), Float32Array.from(y)));
    expect(terrainKey("terrain", [1, 2, 3], x, y)).not.toBe(terrainKey("time", [1, 2, 3], x, y)); expect(terrainKey("terrain", [1, 2, 3], x, y)).not.toBe(terrainKey("terrain", [1, 2, 4], x, y));
    expect(terrainKey("time", [1, 2, 3], x, y)).not.toBe(terrainKey("time", [1, 2, 3], x, Float32Array.from([0, 0, 2])));   // same rows, moved points (e.g. metadata arrived) → new terrain
  });
});
describe("TerrainService", () => {
  it("builds once per key, joins concurrent requests, and answers cache hits synchronously", () => {
    const w = new FakeWorker(); const svc = new TerrainService({ workerFactory: () => w }); const a = vi.fn(), b = vi.fn(), c = vi.fn();
    svc.request("k1", input(3), a); svc.request("k1", input(3), b); expect(w.posted.length).toBe(1);
    w.resolve(0, 7); expect(a).toHaveBeenCalledTimes(1); expect(b).toHaveBeenCalledTimes(1); expect(a.mock.calls[0][1].stats.categories).toBe(7);
    svc.request("k1", input(3), c); expect(c).toHaveBeenCalledTimes(1); expect(w.posted.length).toBe(1);
  });
  it("supersedes: a newer request for another key drops the older callback, but the older result is still cached", () => {
    const w = new FakeWorker(); const svc = new TerrainService({ workerFactory: () => w }); const a = vi.fn(), b = vi.fn(), later = vi.fn();
    svc.request("A", input(1), a); svc.request("B", input(2), b); w.resolve(0, 1); expect(w.posted.length).toBe(2); w.resolve(1, 2);
    expect(a).not.toHaveBeenCalled(); expect(b).toHaveBeenCalledTimes(1);
    svc.request("A", input(1), later); expect(later).toHaveBeenCalledTimes(1); expect(w.posted.length).toBe(2);
  });
  it("evicts least-recently-used meshes beyond maxCached", () => {
    const w = new FakeWorker(); const svc = new TerrainService({ workerFactory: () => w, maxCached: 2 });
    svc.request("A", input(1), () => {}); w.resolve(0, 1); svc.request("B", input(1), () => {}); w.resolve(1, 2); svc.request("C", input(1), () => {}); w.resolve(2, 3);
    const again = vi.fn(); svc.request("A", input(1), again); expect(again).not.toHaveBeenCalled(); expect(w.posted.length).toBe(4);
  });
  it("falls back to an inline build (asynchronously) when no worker is available", async () => {
    const svc = new TerrainService({ workerFactory: () => null, buildInline: () => mesh(42) }); const cb = vi.fn();
    svc.request("k", input(1), cb); expect(cb).not.toHaveBeenCalled(); await new Promise((r) => setTimeout(r, 5)); expect(cb).toHaveBeenCalledTimes(1); expect(cb.mock.calls[0][1].stats.categories).toBe(42);
  });
  it("copies input buffers before posting so the caller's arrays stay usable", () => {
    const w = new FakeWorker(); const svc = new TerrainService({ workerFactory: () => w }); const i = input(4); svc.request("k", i, () => {});
    expect(w.posted[0].input.x).not.toBe(i.x); expect(i.x.length).toBe(4);
  });
  it("dispose terminates the worker", () => { const w = new FakeWorker(); const svc = new TerrainService({ workerFactory: () => w }); svc.dispose(); expect(w.terminated).toBe(true); });
});

describe("TerrainService queueing and failure", () => {
  it("keeps one build in flight: later requests replace the queued one and are posted only when the worker reports back", () => {
    const w = new FakeWorker(); const svc = new TerrainService({ workerFactory: () => w }); const a = vi.fn(), b = vi.fn(), c = vi.fn();
    svc.request("A", input(1), a); svc.request("B", input(1), b); svc.request("C", input(1), c);
    expect(w.posted.length).toBe(1);                       // A in flight, C queued (B dropped)
    w.resolve(0, 1); expect(w.posted.length).toBe(2); expect(w.posted[1].input.x.length).toBe(1); expect(a).not.toHaveBeenCalled();
    w.resolve(1, 3); expect(b).not.toHaveBeenCalled(); expect(c).toHaveBeenCalledTimes(1); expect(c.mock.calls[0][0]).toBe("C");
  });
  it("falls back to the inline builder when the worker errors, and the pending request still resolves", async () => {
    const w = new FakeWorker(); const svc = new TerrainService({ workerFactory: () => w, buildInline: () => mesh(5) }); const cb = vi.fn();
    svc.request("K", input(1), cb); (w as unknown as { onerror?: (e: unknown) => void }).onerror?.({ message: "boom" });
    expect(w.terminated).toBe(true); await new Promise((r) => setTimeout(r, 5)); expect(cb).toHaveBeenCalledTimes(1); expect(cb.mock.calls[0][1].stats.categories).toBe(5);
  });
  it("has() reports cached keys", () => { const w = new FakeWorker(); const svc = new TerrainService({ workerFactory: () => w }); expect(svc.has("A")).toBe(false); svc.request("A", input(1), () => {}); w.resolve(0, 1); expect(svc.has("A")).toBe(true); });
});
