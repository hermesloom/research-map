import { test, expect } from "@playwright/test";
import { GL_ARGS } from "./hook";
test.use({ viewport: { width: 1200, height: 800 }, launchOptions: { args: GL_ARGS } });

test("renders with WebGL2, no console errors, terrain in ≤ 7 draw calls, background outside and colour inside a cluster", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto("/?g=0"); await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30000 });
  await page.waitForFunction(() => !!window.__map && window.__map.stats().terrain !== null, null, { timeout: 30000 });
  const st = await page.evaluate(() => window.__map.stats()); expect(st.mode).toBe("webgl2"); expect(st.terrain!.categories).toBeGreaterThan(0);
  const m = await (await page.request.get("/dev/manifest.json")).json(); const pts = await (await page.request.get(m.pointsUrl)).json();
  // densest spot: the point with the most neighbours within 0.3 units
  const xs = pts.x as number[], ys = pts.y as number[]; let best = 0, bestN = -1;
  for (let i = 0; i < xs.length; i += 3) { let n = 0; for (let j = 0; j < xs.length; j++) if ((xs[i] - xs[j]) ** 2 + (ys[i] - ys[j]) ** 2 < 0.09) n++; if (n > bestN) { bestN = n; best = i; } }
  // sample inside the dense blob but away from every point disc (≥ 10 px), so the colour must come from the terrain fill
  const sample = await page.evaluate(([x, y, pxs, pys]) => {
    const c = window.__map.project(x, y); const pts = (pxs as number[]).map((px, i) => window.__map.project(px, (pys as number[])[i]));
    for (let r = 6; r <= 40; r += 2) for (let a = 0; a < 12; a++) { const X = c.x + r * Math.cos((a / 12) * 2 * Math.PI), Y = c.y + r * Math.sin((a / 12) * 2 * Math.PI); if (pts.every((p) => (p.x - X) ** 2 + (p.y - Y) ** 2 > 100)) return { px: window.__map.readPixel(X, Y), calls: window.__map.stats().drawCalls }; }
    return null;
  }, [xs[best], ys[best], xs, ys] as const);
  expect(sample).not.toBeNull(); const inside = sample!;
  expect(inside.calls).toBeLessThanOrEqual(7); expect(inside.calls).toBeGreaterThanOrEqual(3);
  expect(Math.max(...inside.px.slice(0, 3))).toBeGreaterThan(30);                          // coloured
  const outside = await page.evaluate(() => window.__map.readPixel(3, 795)); expect(outside.slice(0, 3)).toEqual([11, 13, 16]);   // background
  expect(errors).toEqual([]);
});
