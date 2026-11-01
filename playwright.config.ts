import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e", timeout: 60_000, retries: 0,
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", viewport: { width: 1200, height: 800 } },
  projects: [{ name: "chromium", use: { browserName: "chromium", launchOptions: {} } }],
  webServer: process.env.E2E_BASE_URL ? undefined : { command: "pnpm tsx scripts/fixture-snapshot.ts && NEXT_PUBLIC_DEV_MANIFEST=/dev/manifest.json MONGODB_URI=mongodb://unused OPENAI_API_KEY=unused pnpm dev", url: "http://localhost:3000/dev/manifest.json", reuseExistingServer: true, timeout: 120_000 },
});
