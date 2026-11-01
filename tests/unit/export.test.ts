import { describe, it, expect } from "vitest";
import { toJsonCanvas } from "@/app/canvas/export";
describe("toJsonCanvas", () => {
  it("emits groups per theme and link/text nodes with integer coordinates", () => {
    const points: any = { count: 2, ids: ["1", "2"], x: [0.26, 1.5], y: [0.1, -0.7], theme: [0, 0], leaf: [0, 0], kind: [1, 0], themes: [{ id: 0, label: "Theme A" }] };
    const meta: any = { title: ["T1", "T2"], gist: ["g1", "g2"], url: ["https://a.org", null] };
    const c = toJsonCanvas(points, meta, 100);
    const group = c.nodes.find((n) => n.type === "group")!; expect(group.label).toBe("Theme A");
    const link = c.nodes.find((n) => n.id === "1")!; expect(link.type).toBe("link"); expect(link.url).toBe("https://a.org"); expect(Number.isInteger(link.x)).toBe(true);
    expect(c.nodes.find((n) => n.id === "2")!.type).toBe("text");
  });
});
