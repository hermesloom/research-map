import { describe, it, expect } from "vitest";
import { lensLabels, questionGeometry, questionXY, timeXY } from "@/app/canvas/lenses";
const p: any = { ids: ["q", "a", "b", "c"], x: [0, 1, -1, 0], y: [0, 0, 0, 2], grade: [3, 3, 1, 0], createdAt: [1700000000, 1702600000, 1705200000, 1705200000], leaf: [0, 0, 1, -1], count: 4 };
const questions = [{ id: "core", text: "The core question", parentId: null }, { id: "s1", text: "Sub one", parentId: "core" }, { id: "s2", text: "Sub two", parentId: "core" }];
describe("lensLabels", () => {
  it("question lens: core label sits at the centre, ring labels along one spoke, nothing at the origin by accident", () => {
    const g = questionGeometry(p); const xy = questionXY(p, "q");
    const ls = lensLabels("question", p, xy, { questions, subOrder: ["s1", "s2"], terrainLabels: [] });
    const core = ls.find((l) => l.content === "The core question")!; expect(core.x).toBeCloseTo(g.cx, 5); expect(core.y).toBeCloseTo(g.cy, 5); expect(core.level).toBe(0);
    const rings = ls.filter((l) => /^relevance/.test(String(l.content))); expect(rings.length).toBe(4);
    expect(rings.every((l) => Math.abs(l.x - g.cx) < 1e-6 && l.y > g.cy)).toBe(true);     // stacked upward on the vertical spoke
  });
  it("time lens: one row label per sub-question plus 'unassigned', placed left of the data", () => {
    const xy = timeXY(p, [null, "s1", "s2", null], ["s1", "s2"]);
    const ls = lensLabels("time", p, xy, { questions, subOrder: ["s1", "s2"], terrainLabels: [] });
    expect(ls.map((l) => l.content)).toEqual(["Sub one", "Sub two", "unassigned"]);
    const minX = Math.min(...Array.from(xy.x)); expect(ls.every((l) => l.x < minX)).toBe(true);
  });
  it("terrain lens: passes the snapshot labels through", () => {
    const t = [{ x: 1, y: 1, content: "T", level: 0, priority: 1 }];
    expect(lensLabels("terrain", p, { x: new Float32Array(4), y: new Float32Array(4) }, { questions, subOrder: [], terrainLabels: t })).toBe(t);
  });
});

import { primarySeed } from "@/app/canvas/lenses";
describe("primarySeed", () => {
  const qs = [{ id: "core", text: "c", parentId: null }, { id: "seed-1", text: "s", parentId: "core" }, { id: "ind-x", text: "i", parentId: "seed-1" }];
  it("maps an induced child question to its seed ancestor, keeps seeds, nulls unknowns", () => {
    expect(primarySeed("ind-x", qs)).toBe("seed-1"); expect(primarySeed("seed-1", qs)).toBe("seed-1"); expect(primarySeed("nope", qs)).toBeNull(); expect(primarySeed(null, qs)).toBeNull();
  });
});

describe("item titles in every lens", () => {
  const terrainLabels = [
    { x: 1, y: 0, content: "Title of a", level: 2, priority: 3 },
    { x: -1, y: 0, content: "Title of b", level: 2, priority: 1 },
    { x: 0, y: 0.5, content: "Some leaf", level: 1, priority: 100 },
  ];
  it("question lens carries the per-post titles, moved to the post's lens position", () => {
    const xy = questionXY(p, "q"); const ls = lensLabels("question", p, xy, { questions, subOrder: ["s1", "s2"], terrainLabels });
    const a = ls.find((l) => l.content === "Title of a")!; expect(a).toBeTruthy(); expect(a.level).toBe(2); expect(a.x).toBeCloseTo(xy.x[1], 6); expect(a.y).toBeCloseTo(xy.y[1], 6);
    expect(ls.some((l) => l.content === "Some leaf")).toBe(false);   // terrain cluster labels do not travel
  });
  it("time lens carries the per-post titles too", () => {
    const xy = timeXY(p, [null, "s1", "s2", null], ["s1", "s2"]); const ls = lensLabels("time", p, xy, { questions, subOrder: ["s1", "s2"], terrainLabels });
    const b = ls.find((l) => l.content === "Title of b")!; expect(b.x).toBeCloseTo(xy.x[2], 6); expect(b.y).toBeCloseTo(xy.y[2], 6);
  });
});
