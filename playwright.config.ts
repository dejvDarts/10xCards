import { defineConfig, devices } from "@playwright/test";

// Minimal e2e runner, seeded per test-plan.md §6.3 (reconsider e2e only when a
// risk needs the full deployed shape: browser + cookie + middleware + handler).
// `tests/e2e/seed.spec.ts` is the first and, for now, only spec — a reference
// pattern for future e2e tests, not a rollout phase.
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:4321",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:4321",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
