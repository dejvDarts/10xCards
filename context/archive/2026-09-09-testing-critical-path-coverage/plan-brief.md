# Critical-Path Test Coverage (Rollout Phase 1) — Plan Brief

> Full plan: `context/changes/testing-critical-path-coverage/plan.md`
> Research: `context/changes/testing-critical-path-coverage/research.md`

## What & Why

The project has no automated tests at all — no runner, no `test` script, no test files.
Two access-control behaviors are correct in the code today but have zero regression
protection: **Risk #1** (a user reaching another user's flashcards) and **Risk #4**
(auth/session gating on a protected route or API endpoint). This is rollout Phase 1 of
`context/foundation/test-plan.md`: bootstrap the runner and defend those two risks first.

## Starting Point

Every flashcard route that reads or mutates an existing row enforces ownership twice — an
app-level `.eq("user_id", user.id)` filter *and* a per-operation RLS policy — and the
Supabase client is always session-scoped, so RLS is live. Cross-user access surfaces as
**404, not 403**. Page auth is a central `middleware.ts` prefix-match → 302 redirect;
API auth is each handler's own `getUser()` check → `401 {"error":"Unauthorized"}`.
`/api/**` is not covered by middleware at all. Nothing tests any of this.

## Desired End State

`npm test` runs a fast, dependency-free unit suite (green). `npm run test:integration` runs
against a local Supabase (`npx supabase start`) and fails loudly if user B can touch user
A's cards, if an unauthenticated API call isn't `401`, if a protected page isn't redirected,
or if an authenticated user *is* blocked. Coverage exists for both auth mechanisms
independently.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Test runner / env | Plain Vitest, Node env, via `getViteConfig()`; defer Workers pool | Fastest path to a green suite; auth/ownership logic isn't runtime-specific | Plan |
| `astro:*` resolution under Vitest | Spike it as Phase 1's first step; `resolve.alias` shim as fallback | `getViteConfig()` surfacing secret env vars in tests is unverified — de-risk before building helpers on it | Plan (review) |
| Risk #1 layer coverage | Handler tests for the composite outcome **plus** a dedicated RLS-layer group | Handler tests can't tell which layer enforced; the RLS-layer group pins the control research calls "a live defense" | Plan (review) |
| What integration tests run against | Real local Supabase (Docker) + invoke route handlers directly | Only way to actually exercise RLS + app filter + handler flow; mocking Supabase is a named anti-pattern | Plan |
| Authenticated sessions in tests | Service-role admin client in test setup (local only) creates users; sessions via `@supabase/ssr` cookie-harvest | Fast, deterministic, no dependency on the sign-in endpoint | Plan |
| Risk #1 route coverage | Representative subset: PATCH, DELETE, review POST, GET list | One test per distinct enforcement shape at ~4x fixture cost, not 7x (cost×signal) | Plan |
| Duplicated per-handler auth guard | Leave it; test per-route | Consolidating 6 production handlers inside a coverage phase expands blast radius; duplication doesn't affect correctness | Plan |
| `dashboard.astro` missing fallback guard | Recommend as follow-up; don't implement | Testing existing behavior doesn't require changing it; auth hardening belongs in its own change | Plan |

## Scope

**In scope:**
- Vitest install + `vitest.config.ts` (`getViteConfig()`, Node env) + `test` / `test:integration` scripts
- Unit tests for `middleware.onRequest` page-gating
- Integration harness: service-role user factory, cookie-harvest session helper, per-test DB reset
- Risk #1 integration: cross-user PATCH/DELETE/review → 404, list exclusion, positive controls
- Risk #4 integration: no-session `401 {"error":"Unauthorized"}` (not a redirect) + valid-session non-401 across 6 flashcard API routes

**Out of scope:**
- `@cloudflare/vitest-pool-workers` / workerd runtime (deferred)
- Wiring the suite into CI (test-plan §3 Phase 4)
- Refactoring the duplicated auth guard into a shared helper
- Adding a page-level fallback guard to `dashboard.astro`
- Risks #2, #3, #5, #6; explicit `due.ts` / `generate.ts` cross-user tests
- HTTP-server / page-render / e2e tests; asserting the Vitest config shape

## Architecture / Approach

`vitest.config.ts` (via `getViteConfig()`) defines two projects: `unit` (`src/**/*.test.ts`,
no deps) and `integration` (`tests/integration/**`, needs `supabase start`). Unit tests mock
`@/lib/supabase` and call `onRequest` directly. Integration tests set local env in a setup
file, create two users via the service-role admin API, mint each user's `Cookie` header by
signing in through a throwaway `createServerClient` bound to an in-memory cookie jar, then
call the route handler functions (`PATCH`, `DELETE`, `GET`, …) with a crafted `APIContext`
carrying that header against the real local DB. `flashcards` is cleared after each test;
test users are removed in teardown.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Runner bootstrap + Risk #4 page-gating (unit) | Spike proves `astro:*` resolves under Vitest (shim fallback if not); Vitest runs; `npm test` green; middleware redirect/pass-through locked in | `astro:env/server` secret-var resolution under Vitest — spiked first, `resolve.alias` shim as fallback |
| 2. Integration harness + Risk #1 | Cross-user 404s + list exclusion proven against real Supabase; a dedicated RLS-layer group pins RLS directly; owner positive controls | Session cookie shape / `@supabase/ssr` chunked cookies; DB isolation between tests |
| 3. Risk #4 API-route gating (integration) | `401` (not redirect) for unauthenticated flashcard API calls; valid session never blocked | Keeping the representative route set small while covering each handler's own guard |

**Prerequisites:** Docker + `npx supabase start` for Phases 2–3; local anon + service-role
keys available to the harness (local-only, never a Workers secret).
**Estimated effort:** ~2–3 sessions across 3 phases.

## Open Risks & Assumptions

- **`astro:*` virtual modules under Vitest** — assumed, not proven; Phase 1 change #0
  spikes it before anything is built on top, with a `resolve.alias` shim as fallback.
- **App-level `user_id` filter has no independent regression test** — RLS masks its removal
  in every handler and RLS-layer test. Accepted as belt-and-braces; the RLS layer itself is
  now pinned by the Phase 2 RLS-layer group. Limitation to be recorded in test-plan §6.6.
- **Recommended follow-up (not in this change):** add a page-level fallback auth guard to
  `dashboard.astro` — it currently depends entirely on middleware, with no second layer.
- **Page gating is not exercised end-to-end** — the Risk #4 "page" group unit-tests
  `middleware.onRequest`; it won't catch middleware being unregistered from Astro.
- The harness's local service-role key is the **static** local-Supabase value (not a real
  secret), inlined in `setup.ts` or read from the already-gitignored `.dev.vars` — no new
  `.env.test`, never a Workers secret.
- CI integration (`test:integration` needs Docker) is explicitly deferred to test-plan
  §3 Phase 4; the current `ci.yml` job cannot run it as-is.

## Success Criteria (Summary)

- `npm test` is green with no external services; `npm run test:integration` is green with
  local Supabase running.
- Breaking any one control (a `PROTECTED_ROUTES` entry, RLS on `flashcards`, a handler's
  `401` guard) turns exactly one test red. (Removing a handler's app-level `user_id` filter
  is a known blind spot — RLS masks it.)
- Both auth mechanisms — page redirect and API `401` — have their own coverage, and an
  authenticated user is verified never to be blocked.
