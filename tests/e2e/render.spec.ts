import { test, expect } from "@playwright/test";
import { GL_ARGS } from "./hook";
test.use({ viewport: { width: 1200, height: 800 }, launchOptions: { args: GL_ARGS } });

test("renders with WebGL2, no console errors, terrain in ≤ 7 draw calls, background outside and colour inside a cluster", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto("/?g=0"); await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30000 });
  await page.waitForFunction(() => window.__map?.stats().terrain !== null, null, { timeout: 30000 });
  const st = await page.evaluate(() => window.__map.stats()); expect(st.mode).toBe("webgl2"); expect(st.terrain!.categories).toBeGreaterThan(0);
  const m = await (await page.request.get("/dev/manifest.json")).json(); const pts = await (await page.request.get(m.pointsUrl)).json();
  // densest spot: the point with the most neighbours within 0.3 units
  const xs = pts.x as number[], ys = pts.y as number[]; let best = 0, bestN = -1;
  for (let i = 0; i < xs.length; i += 3) { let n = 0; for (let j = 0; j < xs.length; j++) if ((xs[i] - xs[j]) ** 2 + (ys[i] - ys[j]) ** 2 < 0.09) n++; if (n > bestN) { bestN = n; best = i; } }
  const inside = await page.evaluate(([x, y]) => { const p = window.__map.project(x, y); const px = window.__map.readPixel(p.x, p.y); return { px, calls: window.__map.stats().drawCalls }; }, [xs[best], ys[best]]);
  expect(inside.calls).toBeLessThanOrEqual(7); expect(inside.calls).toBeGreaterThanOrEqual(3);
  expect(Math.max(...inside.px.slice(0, 3))).toBeGreaterThan(30);                          // coloured
  const outside = await page.evaluate(() => window.__map.readPixel(3, 795)); expect(outside.slice(0, 3)).toEqual([11, 13, 16]);   // background
  expect(errors).toEqual([]);
});
