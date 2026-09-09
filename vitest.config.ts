/// <reference types="vitest/config" />
import { getViteConfig } from "astro/config";

// Built through Astro so `astro:*` virtual modules (`astro:env/server`,
// `astro:middleware`, ...) resolve inside the test runtime. Astro v6 requires
// the `node` environment for anything that touches Astro internals.
//
// Two projects, each run in isolation via `--project`:
//   - `unit`        — src/**/*.test.ts, no external dependencies (`npm test`)
//   - `integration` — tests/integration/**/*.test.ts, needs a local Supabase
//                     (`npm run test:integration`, added in Phase 2)
// The bare, all-projects `vitest run` is never wired to a script.
export default getViteConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          setupFiles: ["tests/integration/setup.ts"],
          // Integration tests share a single local DB — run files serially.
          fileParallelism: false,
        },
      },
    ],
  },
});
