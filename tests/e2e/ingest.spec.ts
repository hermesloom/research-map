import { test, expect } from "@playwright/test";
import { GL_ARGS } from "./hook";
test.use({ launchOptions: { args: GL_ARGS } });

/** Fixture mode has no CRON_SECRET, so the route answers 401 to any key: the chord, the prompt and the alert are exercised without a database. */
test("Shift+I twice prompts for the cron secret; a wrong key alerts and does not reload", async ({ page }) => {
  await page.goto("/"); await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30000 });
  const dialogs: { type: string; message: string }[] = [];
  page.on("dialog", async (d) => { dialogs.push({ type: d.type(), message: d.message() }); if (d.type() === "prompt") await d.accept("nope"); else await d.dismiss(); });
  await page.keyboard.press("Shift+I"); await page.waitForTimeout(100); expect(dialogs).toHaveLength(0);   // one press is not enough
  const loads: string[] = []; page.on("load", () => loads.push("load"));
  await page.keyboard.press("Shift+I");
  await expect.poll(() => dialogs.length, { timeout: 10000 }).toBe(2);
  expect(dialogs[0].type).toBe("prompt"); expect(dialogs[1]).toEqual({ type: "alert", message: "Wrong key." });
  await page.waitForTimeout(300); expect(loads).toHaveLength(0);
});
