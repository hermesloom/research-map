import { describe, it, expect } from "vitest";
import { visibleRows, newestRows, cardHtml } from "@/app/canvas/overlayLogic";
describe("overlay logic", () => {
  it("visibleRows keeps in-viewport rows nearest centre first, capped", () => {
    const xs = new Float32Array([0, 1, 50, 2]), ys = new Float32Array([0, 1, 50, 2]); const proj = (x: number, y: number) => ({ x: x * 10, y: y * 10 });
    expect(visibleRows(xs, ys, proj, 100, 100, 2)).toEqual([3, 1]);   // row 2 is off-screen (500,500); nearest to centre (50,50) first: row 3 (20,20), row 1 (10,10); cap 2 drops row 0
  });
  it("newestRows picks most recent createdAt among idx", () => { const p: any = { createdAt: [1, 5, 3, 9] }; expect(newestRows(p, [0, 1, 2, 3], 2)).toEqual([3, 1]); });
  it("cardHtml escapes and includes the X display minimum", () => {
    const meta: any = { title: ["<b>T</b>"], gist: ["g"], domain: ["ex.org"], url: ["https://ex.org"], role: ["evidence"] };
    const h = cardHtml(meta, 0, { grade: 3, provisional: true, url: "https://x.com/sigalor/status/1" });
    expect(h).toContain("&lt;b&gt;T&lt;/b&gt;"); expect(h).toContain("@sigalor"); expect(h).toContain('href="https://x.com/sigalor/status/1"'); expect(h).toContain("provisional");
  });
});

import { affineFromProxy, nearestRowAt } from "@/app/canvas/overlayLogic";
describe("click-to-select helpers", () => {
  const proxy = { location: (x: number, y: number) => ({ x: 100 + x * 20, y: 300 - y * 20 }), width: 800, height: 600 };
  it("affineFromProxy inverts the proxy's data→pixel mapping", () => {
    const a = affineFromProxy(proxy); const d = a.toData(100 + 3 * 20, 300 - 4 * 20);
    expect(d.x).toBeCloseTo(3, 6); expect(d.y).toBeCloseTo(4, 6); expect(a.pxPerUnit).toBeCloseTo(20, 6);
  });
  it("nearestRowAt returns the closest row within the pixel radius, else -1", () => {
    const xs = new Float32Array([0, 3, 10]), ys = new Float32Array([0, 4, 10]);
    expect(nearestRowAt(xs, ys, proxy, 100 + 3 * 20 + 5, 300 - 4 * 20 - 5, 12)).toBe(1);   // 7px away from row 1
    expect(nearestRowAt(xs, ys, proxy, 500, 50, 12)).toBe(-1);                               // nothing near
  });
});
