# Repository Guidelines

10xCards is an Astro 6 SSR web app (React 19 islands, Tailwind 4, Supabase auth, shadcn/ui) deployed to Cloudflare Workers. `@CLAUDE.md` holds the full architecture and auth-flow detail; this file is the quick agent contract.

## Hard rules

- API routes under `src/pages/api/` must export `const prerender = false` — the app is full SSR (`output: "server"` in `@astro.config.mjs`); pages default to server-rendered.
- API handlers export uppercase `GET`/`POST` and validate input with zod. No `"use client"` or other Next.js directives — this is Astro, not Next.
- Read `SUPABASE_URL`/`SUPABASE_KEY` only via `astro:env/server` (server-only secrets); never expose them to client code. Local secrets live in `.dev.vars` (gitignored), not `.env` committed.
- Enable RLS on every new Supabase table with granular per-operation, per-role policies. Migrations go in `supabase/migrations/` named `YYYYMMDDHHmmss_short_description.sql`.

## Project structure

- `src/pages/` routes (`api/` endpoints, `auth/` sign-in/up pages); `src/components/` (`ui/` shadcn, `auth/`); `src/layouts/`; `src/lib/` services/helpers; `src/middleware.ts` resolves the user and guards `PROTECTED_ROUTES`. Path alias `@/*` → `./src/*` (see `@tsconfig.json`).
- Shared entity/DTO types go in `src/types.ts`; React hooks in `src/components/hooks/`; extracted business logic in `src/lib/services/`.

## Commands

- `npm run dev` — dev server (Cloudflare workerd). `npm run build` — SSR production build. `npm run preview` — preview build.
- `npm run lint` / `npm run lint:fix` — ESLint (type-checked). `npm run format` — Prettier. Full script list: `@package.json`.
- Local Supabase: `npx supabase start` (needs Docker). Deploy: `npx wrangler deploy`.

## Coding style

- Node 22.14.0 (`.nvmrc`); TypeScript strict (`astro/tsconfigs/strict`). Astro components for static/layout, React only where interactivity is needed.
- Merge Tailwind classes with `cn()` from `@/lib/utils` (clsx + tailwind-merge) — do not concatenate class strings. Add shadcn/ui components via `npx shadcn@latest add <name>` (new-york variant).
- husky + lint-staged run `eslint --fix` on `*.{ts,tsx,astro}` and `prettier --write` on `*.{json,css,md}` pre-commit.

## E2E testing (Playwright)

- `tests/e2e/` (`playwright.config.ts`, `npm run test:e2e`, or `npx playwright test <file>` for a single spec). Auto-starts `npm run dev` as `webServer`; needs local Supabase running (`npx supabase start`).
- One test per browser-level risk from `context/foundation/test-plan.md` — e2e is expensive/flake-prone, reserved for journeys that cross auth + routing + API + DB, or exist only in the rendered UI. Not a coverage sweep.
- Locators: `getByRole`/`getByLabel`/`getByText` only — never CSS selectors, XPath, or test-ids (none exist in this codebase).
- No `page.waitForTimeout()` — wait on `expect(...).toBeVisible()`/`toHaveURL()`.
- Each test is independently runnable: unique test data via `createTestUser()` (`tests/integration/helpers/users.ts`), cleanup in `afterEach` (`deleteTestUser` — cascades any seeded rows via FK `on delete cascade`, no separate DB cleanup needed for flashcards).
- **Auth, per test (no shared `storageState`):** every test creates its own disposable user via `createTestUser()`. Default to `signInViaCookie(context, user, baseURL)` (`tests/e2e/helpers/auth.ts`) to skip the login UI; drive the real `/auth/signin` form instead only when the login/session flow itself is the risk under test (`seed.spec.ts`). Full rationale: `context/foundation/test-plan.md` §6.3.
- Mock only expensive/non-deterministic **external** boundaries, at the network layer (`page.route`) — internal boundaries (auth, routing, DB) stay real. Known limitation: `page.route` only intercepts requests made _from the browser_; an API route's own server-side outbound call (e.g. the OpenRouter fetch inside `generate.ts`) is invisible to it — don't force a mock past that boundary.
- Name the test after the risk it protects, not `test('test 1', ...)`. The assertion must fail if that risk materializes — if it wouldn't, it's decorative.

## Testing, commits & CI

- Vitest is configured with three projects: `unit` (`src/**/*.test.ts`, `npm test`), `components` (`src/**/*.test.tsx`, happy-dom, `npm run test:components`), and `integration` (`tests/integration/**`, needs `npx supabase start`, `npm run test:integration`). CI runs all three — keep them green before merge.
- CI (`@.github/workflows/ci.yml`) on push/PR to `master`: a `ci` job (`npm ci` → `astro sync` → lint → build; needs `SUPABASE_URL`/`SUPABASE_KEY` repo secrets), a `test` job (unit + components; no secrets), and a `test-integration` job (boots a local Supabase via `npx supabase start`; uses the well-known static local keys, no repo secrets). `deploy` needs all three.
- Commits follow Conventional Commits (`feat` / `fix` / `chore` / `refactor` / `docs`, scope in parens). husky + lint-staged run `eslint --fix` / `prettier --write` pre-commit — never `--no-verify`.
