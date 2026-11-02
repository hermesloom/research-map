import { test, expect } from "@playwright/test";
import { GL_ARGS } from "./hook";
test.use({ viewport: { width: 1200, height: 800 }, launchOptions: { args: GL_ARGS } });

/** Sample the brightest pixel on a circle of radius `r` CSS px around a projected point (the ring is 2 px wide, so one of 24 angles lands on it). */
const ringSample = (page: import("@playwright/test").Page, x: number, y: number, r: number) => page.evaluate(([x, y, r]) => {
  const c = window.__map.project(x, y); let best = [0, 0, 0, 0];
  for (let a = 0; a < 24; a++) { const px = window.__map.readPixel(c.x + r * Math.cos((a / 24) * 2 * Math.PI), c.y + r * Math.sin((a / 24) * 2 * Math.PI)); if (px[0] + px[1] > best[0] + best[1]) best = px; }
  return best;
}, [x, y, r] as const);

test("highlight recent: amber ring on the newest post, faint on the 20th, none when off", async ({ page }) => {
  await page.goto("/?g=0&recent=1"); await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30000 });
  await page.waitForFunction(() => !!window.__map && window.__map.stats().points > 0, null, { timeout: 30000 });
  await expect(page.getByLabel("Highlight recent posts")).toBeChecked();
  const hl = await page.evaluate(() => window.__map.highlights()); expect(hl).toHaveLength(20); expect(hl[0].alpha).toBe(1); expect(hl[19].alpha).toBeCloseTo(0.05, 9);
  // zoom in on the newest post so the ring (radius r + 5) is clear of neighbouring discs
  const newest = await page.evaluate((row) => window.__map.pointAt(row), hl[0].row); const twentieth = await page.evaluate((row) => window.__map.pointAt(row), hl[19].row);
  const radiusAt = async (p: { x: number; y: number }) => { await page.evaluate(([x, y]) => { const c = window.__map.camera(); window.__map.setCamera({ x, y, scale: c.scale * 40 }); }, [p.x, p.y] as const); await page.waitForTimeout(200); return 7 + 5; };   // point radius caps at 7 px when zoomed in
  const r1 = await radiusAt(newest!); const bright = await ringSample(page, newest!.x, newest!.y, r1);
  expect(bright[0]).toBeGreaterThan(180); expect(bright[1]).toBeGreaterThan(140); expect(bright[0]).toBeGreaterThan(bright[2] + 60);   // amber: strong red/green, little blue
  const r2 = await radiusAt(twentieth!); const faint = await ringSample(page, twentieth!.x, twentieth!.y, r2);
  expect(faint[0]).toBeLessThan(bright[0] * 0.4);   // 0.05 opacity over the dark background stays near background
  await page.getByLabel("Highlight recent posts").uncheck(); await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__map.highlights())).toEqual([]); expect(page.url()).not.toContain("recent=1");
  const off = await ringSample(page, twentieth!.x, twentieth!.y, r2); expect(off[0]).toBeLessThan(60);
});
