import { test, expect } from "@playwright/test";
import { GL_ARGS } from "./hook";
test.use({ viewport: { width: 1200, height: 800 }, launchOptions: { args: GL_ARGS } });

for (const lens of ["terrain", "question", "time"]) {
  test(`${lens} lens: terrain is built and post titles appear once each visible point has 100 px of room`, async ({ page }) => {
    await page.goto(`/?g=0&lens=${lens}`); await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30000 });
    await page.waitForFunction(() => !!window.__map && window.__map.stats().terrain !== null && window.__map.stats().terrain!.categories > 0, null, { timeout: 30000 });
    // at the fitted view there is no room for titles (room < 100 px)
    await page.waitForTimeout(600); const fit = await page.evaluate(() => ({ spacing: window.__map.stats().spacingPx, titles: window.__map.labels().filter((l) => l.level === 2).length }));
    expect(fit.spacing).toBeLessThan(100); expect(fit.titles).toBe(0);
    // zoom onto a post step by step; the first step at which the room reaches 100 px must show titles, and none before
    for (let z = 2; z <= 64; z *= 2) {
      await page.evaluate(() => { const c = window.__map.camera(); const p = window.__map.pointAt(5)!; window.__map.setCamera({ x: p.x, y: p.y, scale: c.scale * 2 }); });
      await page.waitForTimeout(450); const s = await page.evaluate(() => ({ spacing: window.__map.stats().spacingPx, titles: window.__map.labels().filter((l) => l.level === 2).length }));
      if (s.spacing >= 100) { expect(s.titles).toBeGreaterThan(0); return; } expect(s.titles).toBe(0);
    }
    throw new Error("never reached 100 px of room per point");
  });
}
test("changing the relevance filter in the running page removes the titles of hidden posts (no ghosts)", async ({ page }) => {
  await page.goto("/?g=0"); await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30000 }); await page.waitForTimeout(1500);
  await page.evaluate(() => { const c = window.__map.camera(); const p = window.__map.pointAt(5)!; window.__map.setCamera({ x: p.x, y: p.y, scale: c.scale * 8 }); });
  await page.waitForFunction(() => window.__map.labels().some((l) => l.level === 2), null, { timeout: 5000 });
  const before = await page.evaluate(() => window.__map.stats().points);
  await page.locator('input[type="range"]').first().fill("3"); await page.waitForTimeout(700);
  const after = await page.evaluate(() => ({ points: window.__map.stats().points, labels: window.__map.labels() }));
  expect(after.points).toBeLessThan(before);
  for (const l of after.labels) { expect(l.opacity).toBe(1); if (l.level === 2) expect(l.row!).toBeLessThan(after.points); }   // fades finished and drawn; every title belongs to a visible row
});
