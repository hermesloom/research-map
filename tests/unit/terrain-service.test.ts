import { describe, it, expect, vi } from "vitest";
import { TerrainService, terrainKey, type WorkerLike } from "@/app/canvas/gl/terrainService";
import type { TerrainInput, TerrainMesh } from "@/app/canvas/terrain/types";
import { emptyMesh } from "@/app/canvas/terrain/mesh";

const input = (n: number): TerrainInput => ({ x: new Float32Array(n), y: new Float32Array(n), cat: new Uint16Array(n), catRGB: [] });
const mesh = (tag: number): TerrainMesh => ({ ...emptyMesh({ categories: tag, ms: 0, sigmaUnits: 1 }) });
class FakeWorker implements WorkerLike {
  posted: { id: number; input: TerrainInput }[] = []; onmessage: ((e: MessageEvent) => void) | null = null; terminated = false;
  postMessage(m: { id: number; input: TerrainInput }) { this.posted.push(m); }
  resolve(i: number, tag: number) { this.onmessage?.({ data: { id: this.posted[i].id, mesh: mesh(tag) } } as MessageEvent); }
  terminate() { this.terminated = true; }
}

describe("terrainKey", () => {
  it("depends on lens and on the row set, not on array identity", () => {
    expect(terrainKey("terrain", [1, 2, 3])).toBe(terrainKey("terrain", Int32Array.from([1, 2, 3]))); expect(terrainKey("terrain", [1, 2, 3])).not.toBe(terrainKey("time", [1, 2, 3])); expect(terrainKey("terrain", [1, 2, 3])).not.toBe(terrainKey("terrain", [1, 2, 4]));
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
    svc.request("A", input(1), a); svc.request("B", input(2), b); w.resolve(0, 1); w.resolve(1, 2);
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
