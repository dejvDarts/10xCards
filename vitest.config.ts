/// <reference types="vitest/config" />
import { getViteConfig } from "astro/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Built through Astro so `astro:*` virtual modules (`astro:env/server`,
// `astro:middleware`, ...) resolve inside the test runtime. Astro v6 requires
// the `node` environment for anything that touches Astro internals.
//
// Three projects, each run in isolation via `--project`:
//   - `unit`        — src/**/*.test.ts, no external dependencies (`npm test`)
//   - `integration` — tests/integration/**/*.test.ts, needs a local Supabase
//                     (`npm run test:integration`)
//   - `components`  — src/**/*.test.tsx, React hook tests in a DOM env
//                     (`npm run test:components`, no Docker)
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
          globalSetup: ["tests/integration/global.ts"],
          // Integration tests share a single local DB — run files serially.
          // @ts-expect-error — valid at runtime in vitest 3.2 project config; the
          // ProjectConfig type omits `fileParallelism` (fixed in vitest 4).
          fileParallelism: false,
        },
      },
      {
        // NOT `extends: true` — `getViteConfig()` wires React for Astro's SSR
        // island pipeline, which leaves `renderHook` with a null dispatcher
        // ("invalid hook call") in a plain client test. This project is a
        // standalone client-React setup; the hook files only need the `@/` alias
        // (they never import `astro:*`).
        plugins: [react()],
        resolve: {
          alias: { "@": path.resolve(import.meta.dirname, "src") },
          dedupe: ["react", "react-dom"],
        },
        test: {
          name: "components",
          environment: "happy-dom",
          include: ["src/**/*.test.tsx"],
        },
      },
    ],
  },
});
