import { test, expect } from "@playwright/test";
import { initialViewState } from "../../app/canvas/fallbackView";
test.use({ viewport: { width: 1200, height: 800 } });
test("clicking a point opens the inspector", async ({ page }) => {
  await page.goto("/?g=0"); await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30000 }); await page.waitForTimeout(2500);
  // Compute where the fallback renderer draws the first point: same fit as the app (initialViewState), y up, origin at the viewport centre.
  const manifestUrl = "/dev/manifest.json";
  const m = await (await page.request.get(manifestUrl)).json(); const pts = await (await page.request.get(m.pointsUrl)).json();
  const xs = Float32Array.from(pts.x as number[]), ys = Float32Array.from(pts.y as number[]);
  const v = initialViewState(xs, ys, 600); const scale = Math.pow(2, v.zoom);
  const box = (await page.locator("canvas").first().boundingBox())!;
  const px = box.x + box.width / 2 + (xs[0] - v.target[0]) * scale, py = box.y + box.height / 2 - (ys[0] - v.target[1]) * scale;
  await page.mouse.click(px, py);
  await expect(page.locator("aside.inspector")).toBeVisible({ timeout: 5000 });
  await expect(page.locator("aside.inspector h2")).toBeVisible();
  expect(page.url()).toMatch(/sel=\d+/);
});
