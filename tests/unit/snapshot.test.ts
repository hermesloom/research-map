import { describe, it, expect } from "vitest";
import { buildSnapshot } from "@/lib/snapshot"; import { applyOverrides } from "@/lib/overrides";
const now = new Date("2026-11-02T00:00:00Z");
const item = (xId: string, extra: any = {}) => ({ xId, text: "t " + xId, createdAt: now, kind: "text", urls: [], media: [], isResearchQuestion: false, stage: "graded", fetchedAt: now, ...extra });
const layout: any = { version: 3, createdAt: now, method: "umap", status: "published", procrustesResidual: 0.02,
  points: [{ xId: "1", x: 0, y: 0, clusterId: 0, provisional: false }, { xId: "2", x: 1, y: 1, clusterId: 0, provisional: true }, { xId: "gone", x: 9, y: 9, clusterId: 1, provisional: false }],
  labels: [{ level: 1, text: "Leaf A", x: 0.5, y: 0.5, priority: 2, clusterId: 0 }], themes: [{ id: 0, label: "Theme", clusterIds: [0, 1] }],
  clusters: [{ id: 0, label: "Leaf A", themeId: 0, size: 2, x: 0.5, y: 0.5 }, { id: 1, label: "Leaf B", themeId: 0, size: 1, x: 9, y: 9 }], hulls: [] };
const enrichment = new Map([["1", { xId: "1", normalized: { title: "One", gist: "g1", tagsEn: ["a"], language: "en" } } as any]]);
const relations = new Map([["1", [{ xId: "1", questionId: "core", role: "evidence", grade: 3, rationale: "r", cosine: 0.4 }, { xId: "1", questionId: "seed-1", role: "evidence", grade: 3, rationale: "r", cosine: 0.3 }]]]) as any;
const questions: any = [{ _id: "core", text: "Q", parentId: null }, { _id: "seed-1", text: "S", parentId: "core" }];

describe("buildSnapshot", () => {
  it("snapshot drops tombstoned items and aligns arrays", () => {
    const s = buildSnapshot({ layout, items: [item("1"), item("2"), item("gone", { deletedAt: now })], enrichment, relations, questions, overrides: [], generatedAt: now });
    expect(s.points.ids).toEqual(["1", "2"]); expect(s.points.x.length).toBe(2); expect(s.meta.title).toEqual(["One", "t 2"]);
    expect(s.points.grade).toEqual([3, -1]); expect(s.meta.role[1]).toBe("ungraded"); expect(s.points.provisional).toEqual([0, 1]);
    expect(s.meta.subQuestions[0]).toEqual(["seed-1"]); expect(s.labels.questions.length).toBe(2);
  });
  it("emits theme, leaf and item labels with levels 0/1/2", () => {
    const s = buildSnapshot({ layout, items: [item("1"), item("2")], enrichment, relations, questions, overrides: [], generatedAt: now });
    const levels = new Set(s.labels.labels.map((l) => l.level)); expect(levels).toEqual(new Set([0, 1, 2]));
  });
  it("applyOverrides pins, renames, moves", () => {
    const l2 = applyOverrides(layout, [{ type: "pin", xId: "2", payload: { x: 5, y: 6 }, createdAt: now }, { type: "renameLabel", clusterId: 0, payload: { label: "Renamed" }, createdAt: now }, { type: "moveLeaf", xId: "1", payload: { clusterId: 1 }, createdAt: now }] as any);
    expect(l2.points.find((p) => p.xId === "2")).toMatchObject({ x: 5, y: 6 }); expect(l2.clusters[0].label).toBe("Renamed"); expect(l2.labels[0].text).toBe("Renamed"); expect(l2.points[0].clusterId).toBe(1);
    expect(layout.clusters[0].label).toBe("Leaf A"); // input not mutated
  });
});

describe("ungraded items", () => {
  it("ship as grade -1 / role 'ungraded', never as a fabricated grade 1", () => {
    const s = buildSnapshot({ layout, items: [item("1"), item("2")], enrichment, relations, questions, overrides: [], generatedAt: now });
    expect(s.points.grade[1]).toBe(-1); expect(s.meta.role[1]).toBe("ungraded");
  });
});

describe("display language", () => {
  it("meta.gist is the English summary when available (everything shown is English)", () => {
    const en = new Map([["1", { xId: "1", normalized: { title: "One", summaryEn: "An English summary.", gist: "Eine deutsche Zusammenfassung.", tagsEn: [], language: "de" } } as any]]);
    const s = buildSnapshot({ layout, items: [item("1"), item("2")], enrichment: en, relations, questions, overrides: [], generatedAt: now });
    expect(s.meta.gist[0]).toBe("An English summary.");
  });
});
