import { test, expect } from "@playwright/test";
import { GL_ARGS } from "./hook";
test.use({ viewport: { width: 1200, height: 800 }, launchOptions: { args: GL_ARGS } });

test("main-thread frame cost stays small while zooming and panning (software GL)", async ({ page }) => {
  await page.goto("/?g=0"); await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30000 });
  await page.waitForFunction(() => window.__map?.stats().terrain !== null, null, { timeout: 30000 }); await page.waitForTimeout(700);
  const box = (await page.locator("canvas").first().boundingBox())!; const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy); for (let i = 0; i < 25; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(40); }
  await page.mouse.down(); for (let i = 0; i < 25; i++) { await page.mouse.move(cx + i * 12, cy + i * 6); await page.waitForTimeout(30); } await page.mouse.up();
  for (let i = 0; i < 15; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(40); }
  const frames = await page.evaluate(() => window.__map.stats().frameMs); const sorted = frames.slice().sort((a, b) => a - b); const med = sorted[Math.floor(sorted.length / 2)], p95 = sorted[Math.floor(sorted.length * 0.95)];
  console.log(`frames ${frames.length} median ${med.toFixed(2)} ms p95 ${p95.toFixed(2)} ms max ${sorted[sorted.length - 1].toFixed(2)} ms`);
  expect(frames.length).toBeGreaterThan(20); expect(med).toBeLessThan(8); expect(p95).toBeLessThan(25);
});
