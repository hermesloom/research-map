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
