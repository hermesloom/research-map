import { describe, it, expect } from "vitest";
import { placeFromNeighbors, medianNNSpacing } from "@/lib/place";
const nb = (xId: string, score: number, x: number, y: number, clusterId: number) => ({ xId, score, x, y, clusterId });

describe("placeFromNeighbors", () => {
  it("snaps to the top neighbour, never the average", () => {
    const p = placeFromNeighbors("new", [nb("a", 0.9, 0, 0, 1), nb("b", 0.8, 100, 100, 2), nb("c", 0.7, 100, 100, 2)], { medianSpacing: 1 });
    expect(Math.hypot(p.x - 0, p.y - 0)).toBeLessThanOrEqual(0.3 * Math.SQRT2 + 1e-9);
    expect(p.provisional).toBe(true);
  });
  it("leaf by majority vote ignoring noise", () => {
    const p = placeFromNeighbors("new", [nb("a", 0.9, 0, 0, -1), nb("b", 0.8, 0, 0, 2), nb("c", 0.7, 0, 0, 2), nb("d", 0.6, 0, 0, 3)], { medianSpacing: 1 });
    expect(p.clusterId).toBe(2);
  });
  it("tie broken by cluster name vector cosine", () => {
    const p = placeFromNeighbors("new", [nb("a", 0.9, 0, 0, 2), nb("b", 0.8, 0, 0, 3)], { medianSpacing: 1, itemVector: [0, 1], clusterNameVectors: new Map([[2, [1, 0]], [3, [0, 1]]]) });
    expect(p.clusterId).toBe(3);
  });
  it("all-noise neighbours → -1", () => { expect(placeFromNeighbors("n", [nb("a", 0.9, 0, 0, -1)], { medianSpacing: 1 }).clusterId).toBe(-1); });
  it("jitter is deterministic per id", () => {
    const a = placeFromNeighbors("same", [nb("a", 0.9, 5, 5, 1)], { medianSpacing: 2 }); const b = placeFromNeighbors("same", [nb("a", 0.9, 5, 5, 1)], { medianSpacing: 2 });
    expect(a).toEqual(b);
  });
  it("medianNNSpacing of a unit grid is 1", () => {
    const pts = []; for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) pts.push({ xId: `${i}-${j}`, x: i, y: j, clusterId: 0, provisional: false });
    expect(medianNNSpacing(pts)).toBeCloseTo(1, 5);
  });
});
