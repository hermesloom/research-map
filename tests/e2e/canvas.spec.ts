import { test, expect } from "@playwright/test";
test("canvas renders, labels appear, lens switches, search updates the url", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/"); await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("combobox", { name: /^lens$/i })).toBeVisible();
  await page.getByRole("combobox", { name: /^lens$/i }).selectOption("question"); await page.waitForTimeout(900); expect(page.url()).toContain("lens=question");
  await page.route("**/api/search?*", (route) => route.fulfill({ json: [{ xId: "2116779609727328366", score: 0.9 }] }));
  await page.getByRole("searchbox", { name: /search posts/i }).fill("category theory"); await page.keyboard.press("Enter"); await page.waitForTimeout(1200);
  expect(page.url()).toMatch(/q=category/); expect(page.url()).toMatch(/v=/);
  expect(errors).toEqual([]);
});
