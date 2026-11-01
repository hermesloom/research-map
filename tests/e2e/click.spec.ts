import { test, expect } from "@playwright/test";
import { fitCamera, project } from "../../app/canvas/render/camera";
test.use({ viewport: { width: 1200, height: 800 } });
test("clicking a point opens the inspector", async ({ page }) => {
  await page.goto("/?g=0"); await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30000 }); await page.waitForTimeout(2500);
  const m = await (await page.request.get("/dev/manifest.json")).json(); const pts = await (await page.request.get(m.pointsUrl)).json();
  const xs = Float32Array.from(pts.x as number[]), ys = Float32Array.from(pts.y as number[]);
  const box = (await page.locator("canvas").first().boundingBox())!; const vp = { w: box.width, h: box.height };
  const cam = fitCamera(xs, ys, vp, 0.85); const p = project(cam, vp, xs[0], ys[0]);
  await page.mouse.click(box.x + p.x, box.y + p.y);
  await expect(page.locator("aside.inspector")).toBeVisible({ timeout: 5000 });
  await expect(page.locator("aside.inspector h2")).toBeVisible();
  expect(page.url()).toMatch(/sel=\d+/);
});
