# Critical-Path Test Coverage (Rollout Phase 1) Implementation Plan

## Overview

Bootstrap the project's (currently nonexistent) automated test suite and land regression
coverage for the two access-control risks the test plan ranks first:

- **Risk #1** — a user can retrieve, modify, or delete another user's flashcards (IDOR).
- **Risk #4** — auth/session gating regresses on a protected route or API endpoint.

Both behaviors are correct in the code today but have **zero** automated protection. This
plan installs Vitest (Astro-native config, Node environment), adds a middleware unit test
for the page-gating mechanism, and adds integration tests that exercise the real access
controls (app-level `user_id` filter **and** Postgres RLS) against a local Supabase
instance with two distinct authenticated users, invoking the route handlers directly.

## Current State Analysis

- **No test infrastructure at all.** `package.json` `scripts` has only `dev`, `build`,
  `preview`, `astro`, `lint`, `lint:fix`, `format`. No `vitest`/`jest`/`playwright`
  dependency, no `*.test.*`/`*.spec.*` files anywhere under `src/` or the repo root.
- **Risk #1 is enforced twice on every flashcard route that reads or mutates an existing
  row:** an app-level `.eq("user_id", user.id)` filter *and* a matching per-operation RLS
  policy (`user_id = auth.uid()`). The Supabase client is always session-scoped (anon key +
  request cookies via `@supabase/ssr`), never service-role, so RLS genuinely evaluates as
  the requesting user. A cross-user PATCH/DELETE/review returns **404, not 403** — both the
  app filter (`.eq(...)` then `!result.data`) and RLS (non-owned row is invisible) produce
  "not found".
- **Risk #4 is two structurally different mechanisms:**
  - *Pages* — `src/middleware.ts` `onRequest` does `PROTECTED_ROUTES.some(r => pathname.startsWith(r))`
    (`["/dashboard", "/generate", "/flashcards"]`); if matched and no `locals.user`, it
    returns `context.redirect("/auth/signin")` (302).
  - *API routes* — `/api/**` never matches `PROTECTED_ROUTES`, so middleware provides zero
    enforcement there. Each flashcard API handler independently repeats
    `const { data: { user } } = await supabase.auth.getUser(); if (!user) return jsonError("Unauthorized", 401);`
    (a local, per-file `jsonError`). Observable outcome: `401` JSON body `{"error":"Unauthorized"}`, no redirect.
  - A test exercising one mechanism says nothing about the other.
- **`astro:env/server` blocks a naive Vitest run.** `src/lib/supabase.ts` imports
  `SUPABASE_URL`/`SUPABASE_KEY` from `astro:env/server`, a virtual module that only resolves
  inside Astro's toolchain. `getViteConfig()` from `astro/config` (Astro's documented Vitest
  helper) loads the Astro config so `astro:*` modules resolve; Astro v6 additionally requires
  `test.environment: "node"`.
- **`dashboard.astro`** (CLAUDE.md's "protected page example") relies solely on middleware —
  `const { user } = Astro.locals;` then `{user?.email}`, no page-level fallback check.
  `flashcards.astro` has a code comment hinting the opposite pattern but also depends on
  middleware in practice.

## Desired End State

- `npm test` runs a green Vitest suite with no external dependencies (unit tests only).
- `npm run test:integration` runs the integration suite against a running local Supabase
  (`npx supabase start`), green.
- The suite fails loudly if any of these regress:
  - an unauthenticated request to a `PROTECTED_ROUTES` page is no longer redirected to `/auth/signin`;
  - middleware starts gating (or stops ignoring) `/api/**`;
  - an unauthenticated flashcard API request is no longer rejected with `401 {"error":"Unauthorized"}`;
  - user B can PATCH, DELETE, or review user A's flashcard, or see it in their list;
  - user A can no longer operate on their own card (regression guard / oracle).

### Key Discoveries:

- Astro Vitest setup: `getViteConfig()` from `astro/config`, `test.environment: "node"`
  (`src/pages/**`, `src/lib/**`, `src/middleware.ts`).
- Route handlers are plain `APIRoute` functions — invoke directly with a constructed
  `APIContext`; no dev server, no `astro build` needed.
- `middleware.ts:6` exports `onRequest` from `defineMiddleware` — call it with a fake
  context (`{ request, url, cookies, locals: {}, redirect }`) plus a `next` spy, mocking
  `@/lib/supabase`'s `createClient`.
- `@supabase/ssr` `createServerClient` persists the session as `sb-<ref>-auth-token`
  cookie(s) (chunked when large). Harvest them from an in-memory cookie jar after
  `signInWithPassword` to build the `Cookie` header for handler calls
  (`src/lib/supabase.ts:12` reads `requestHeaders.get("Cookie")`).
- Local Supabase ships fixed, well-known `anon` and `service_role` JWTs (printed by
  `npx supabase start`). User creation: service-role client +
  `supabase.auth.admin.createUser({ email, password, email_confirm: true })`.
- Seeding: base migration (`supabase/migrations/20260903000000_create_flashcards.sql:17`)
  defaults `status` to `'pending'`; list/due/review all filter `status = 'accepted'`, so
  seeded rows must set `status: 'accepted'` to be visible.
- Cross-user denial asserts **404**, never 403 (research §Architecture Insights).
- Representative Risk #1 route set (chosen for cost×signal — one per distinct enforcement
  shape): `PATCH /api/flashcards/[id]`, `DELETE /api/flashcards/[id]`,
  `POST /api/flashcards/[id]/review`, `GET /api/flashcards`. `due.ts` and `generate.ts`
  set `user_id` server-side with no existing-row read, so they carry lower IDOR risk and
  are not given explicit cross-user tests this phase.

## What We're NOT Doing

- **Not** adopting `@cloudflare/vitest-pool-workers` / the workerd runtime this phase.
  Node environment now; revisiting the Workers pool is deferred (test-plan §4 / §3 Phase 4).
- **Not** wiring the suite into CI. That is test-plan §3 Phase 4. Note only: the new
  `test:integration` script needs Docker + `supabase start`, which the current
  `.github/workflows/ci.yml` `ci` job does not provide.
- **Not** refactoring the duplicated per-handler `getUser()` + `jsonError` guard into a
  shared `requireUser()` helper. The duplication does not affect correctness; consolidating
  6 production handlers inside a coverage phase expands blast radius (test-plan §7).
  Tests assert the guard per route instead.
- **Not** adding a page-level fallback auth guard to `dashboard.astro`. This plan
  *recommends* it as a follow-up change (see Open Risks) but does not implement it —
  testing existing behavior does not require changing it.
- **Not** covering Risks #2, #3, #5, #6 (later rollout phases).
- **Not** giving `due.ts` / `generate.ts` explicit cross-user tests this phase.
- **Not** testing `generate.ts` auth-gating in Phase 3, even though it carries the same
  duplicated `getUser()` + `jsonError` guard. The no-session `401` half is trivially
  testable, but the valid-session "never blocked" half needs the external AI-provider mock
  that test-plan rollout Phase 2 (Risk #3) introduces. `generate.ts` is covered whole in
  that phase so both halves stay together, rather than half-covered here.
- **Not** standing up an HTTP server, testing Astro page rendering, or writing e2e tests
  (test-plan §6.3 — not justified under cost×signal).
- **Not** asserting the `vitest.config.ts` shape itself (test-plan §7).
- **Not** exercising page gating end-to-end through wired middleware. Risk #4's "page"
  group is a unit test of `middleware.onRequest` (gate logic + redirect target string).
  It does not verify that Astro registers and runs `src/middleware.ts` on SSR pages, nor
  that `/auth/signin` renders — a regression that unregisters middleware would pass. This
  is the cheapest test with real signal for the likely regression (editing
  `PROTECTED_ROUTES` or the redirect); the wiring itself is out of scope this phase.

## Implementation Approach

Three phases, each shipping usable coverage and adding dependencies only when first needed:

1. **Bootstrap + Risk #4 page-gating (unit).** Install Vitest with `getViteConfig()`, Node
   env, a `test` script. First real assertions target `middleware.onRequest` with a mocked
   Supabase client — no Docker, runs anywhere `npm ci` runs.
2. **Integration harness + Risk #1 (integration).** Add `tests/integration/`, a
   `test:integration` script, and the shared harness (service-role user factory,
   cookie-harvest session helper, per-test `flashcards` reset). Cover the #1 risk — the
   highest-ranked — the moment the harness exists, with positive controls as the oracle.
3. **Risk #4 API-route gating (integration).** Reuse the Phase 2 harness to assert the
   *other* auth mechanism: `401 {"error":"Unauthorized"}` (not a redirect) for
   unauthenticated flashcard API calls, and that a valid session is never blocked.

Integration tests invoke route handler functions directly with a crafted `APIContext`
against the real local Supabase DB, so the app-level filter, RLS, and the handler's own
control flow all execute for real. Supabase is never mocked (test-plan §2 anti-pattern).

## Critical Implementation Details

- **`astro:env/server` resolution — verify before building on it.** `vitest.config.ts`
  must be built with `getViteConfig()` from `astro/config` and set
  `test.environment = "node"`. Without the helper, importing any handler (transitively
  `src/lib/supabase.ts`) fails to resolve `astro:env/server`. The assumption that
  `getViteConfig()` makes the `astro:env/server` **secret** vars readable from
  `process.env` under Vitest is **not yet verified** — Phase 1 change #0 is a spike that
  proves it (or triggers the fallback) before any other test code is written.
  **Fallback if the spike fails:** add a `resolve.alias` in `vitest.config.ts` mapping
  `astro:env/server` (and, if needed, `astro:middleware`) to a tiny shim module under
  `tests/shims/` that re-exports the same names from `process.env` / an identity
  `defineMiddleware`. Integration tests set `SUPABASE_URL` / `SUPABASE_KEY` (local anon
  key) via a Vitest setup file or `env` block before handlers import the client, either
  way.

- **Session cookie shape.** Do not hand-craft JWTs. In the session helper, construct a
  second `createServerClient` bound to an in-memory `{ getAll, setAll }` cookie jar, call
  `signInWithPassword({ email, password })`, then serialize the jar's entries into a single
  `Cookie: name=value; name2=value2` header string. Pass that string as the `Cookie`
  header of the `Request` handed to the handler under test. The Supabase project ref in the
  `sb-<ref>-auth-token` cookie name is derived by `@supabase/ssr` from `SUPABASE_URL` — no
  need to compute it manually as long as both clients see the same URL.

- **Test isolation / ordering.** Create the two users once per integration file
  (`beforeAll`) via the service-role admin client; `delete from flashcards` (service-role)
  in `afterEach`. Remove the test users in an `afterAll` / global teardown so repeated
  local runs don't accumulate `auth.users` rows. Integration tests must run sequentially
  within a file (shared DB state) — rely on Vitest's default per-file isolation; do not
  parallelize cases inside a file.

- **404 vs 403.** Every cross-user assertion checks status `404` and (for PATCH/review)
  body `{"error":"Flashcard not found"}`; DELETE-not-found is also `404`
  (`src/pages/api/flashcards/[id].ts:102-104`). A test asserting `403` is wrong for this
  codebase.

## Phase 1: Runner Bootstrap + Risk #4 Page-Gating (Unit)

### Overview

Vitest runs and `npm test` is green with real, meaningful assertions on the page-gating
mechanism — with no Docker or network dependency.

### Changes Required:

#### 0. Spike: confirm `astro:*` virtual modules resolve under Vitest

**File**: `src/_spike.astro-env.test.ts` (new, temporary — deleted at end of Phase 1)

**Intent**: De-risk the whole suite's foundation before writing helpers on top of it.
Prove that `getViteConfig()` lets a test import `astro:env/server` and `astro:middleware`,
with the env values coming from `process.env`.

**Contract**: A throwaway test that sets `process.env.SUPABASE_URL` / `SUPABASE_KEY`, then
imports `{ SUPABASE_URL }` from `astro:env/server` and `{ defineMiddleware }` from
`astro:middleware` and asserts both are defined and `SUPABASE_URL` matches what was set.
If it passes, delete the file and proceed. If it fails, apply the `resolve.alias` shim
fallback described in Critical Implementation Details, re-run, then delete the file. The
outcome (native resolution vs. shim) is noted in the Phase 1 completion summary.

#### 1. Test runner dependency & scripts

**File**: `package.json`

**Intent**: Add Vitest as a dev dependency and expose it through npm scripts so the suite
has a stable entry point for humans and (later) CI.

**Contract**: New `devDependencies` entry for `vitest` (latest 3.x, matching the repo's
`vite ^7` override). New scripts: `"test": "vitest run --project unit"`, `"test:watch":
"vitest --project unit"`. The bare `vitest run` form is deliberately not used — `test` must
run only the `unit` project (see change #2) so it succeeds with zero external services
running, both now and after Phase 2 adds the `integration` project.

#### 2. Vitest configuration

**File**: `vitest.config.ts` (new, repo root)

**Intent**: Configure Vitest through Astro so `astro:*` virtual modules resolve, pin the
Node environment Astro v6 requires, and separate the always-runnable unit tests from the
Docker-dependent integration tests.

**Contract**: Default export is `getViteConfig({ test: { ... } })` from `astro/config`.
`test.environment = "node"`. Both Vitest projects are defined now via `test.projects`:
`unit` matching `src/**/*.test.ts`, `integration` matching `tests/integration/**/*.test.ts`
(the `integration` directory stays empty until Phase 2 — harmless). `npm test`
(`--project unit`) and `test:integration` (Phase 2, `--project integration`) each run
exactly one project; the bare, all-projects `vitest run` is never wired to a script. `@/*`
path alias resolves (inherited from Astro/tsconfig or restated).

#### 3. `astro-env.d.ts` / type wiring for tests

**File**: `tsconfig.json` (verify) and/or `.astro/types.d.ts` (generated)

**Intent**: Ensure `npx astro sync` output and TS strict config cover the new `.test.ts`
files so `npm run lint` type-checks them.

**Contract**: `tsconfig.json` `include` already globs `**/*`; confirm `.test.ts` files are
linted by the existing ESLint type-checked config and add a lint override only if the flat
config rejects test globals. No new tsconfig unless lint fails.

#### 4. Middleware page-gating unit tests

**File**: `src/middleware.test.ts` (new)

**Intent**: Lock in the four observable behaviors of `onRequest` so a regression in
`PROTECTED_ROUTES`, the `startsWith` match, or the redirect is caught immediately.

**Contract**: `vi.mock("@/lib/supabase")` so `createClient` returns a stub whose
`auth.getUser()` resolves `{ data: { user } }` with `user` toggled per test. Call the
exported `onRequest(context, next)` with a minimal context (`url` as a `URL`, `request`,
`cookies` stub, `locals: {}`, `redirect: vi.fn()`) and `next: vi.fn()`. Assert:
- unauthenticated + path starting with each of `/dashboard`, `/generate`, `/flashcards`
  (incl. a sub-path like `/flashcards/review`) → `context.redirect` called with
  `/auth/signin`, `next` not called;
- authenticated + a protected path → `next` called, no redirect;
- unauthenticated + `/`, `/auth/signin`, `/api/flashcards/anything` → `next` called, no
  redirect (documents that middleware does **not** gate `/api/**`);
- `context.locals.user` is set from `getUser()` in all cases.

### Success Criteria:

#### Automated Verification:

- The `astro:*` resolution spike (change #0) passes — natively or via the documented
  `resolve.alias` shim — and the spike file is deleted before Phase 1 completes
- `npm test` exits 0 with the middleware suite reporting > 0 passing tests
- `npm run lint` passes (new config + test file type-check clean)
- `npm run build` still passes
- `npm test` succeeds with no Docker / `supabase` process running

#### Manual Verification:

- Temporarily removing `/generate` from `PROTECTED_ROUTES` makes `npm test` fail
- `npx vitest` watch mode picks up `src/middleware.test.ts`

**Implementation Note**: After Phase 1 automated verification passes, pause for human
confirmation of the manual checks before starting Phase 2.

---

## Phase 2: Integration Harness + Risk #1 Cross-User Isolation

### Overview

A reusable integration harness exists, and user B provably cannot read, modify, or delete
user A's flashcards through any of the representative routes — while user A provably still
can.

### Changes Required:

#### 1. Integration script & prerequisite doc

**File**: `package.json`, `README.md` (or `CLAUDE.md` testing note)

**Intent**: Give integration tests their own entry point and document that they need a
running local Supabase.

**Contract**: New script `"test:integration": "vitest run --project integration"` (name to
match the Phase 1 project split). A short doc line: run `npx supabase start` first;
`test:integration` reads `SUPABASE_URL`/`SUPABASE_KEY` (local) and a local
`SUPABASE_SERVICE_ROLE_KEY` used **only** by the test harness.

#### 2. Local env for tests

**File**: `tests/integration/setup.ts` (new), referenced from `vitest.config.ts`
`test.setupFiles` for the integration project

**Intent**: Populate `process.env` with the local Supabase URL, anon key, and service-role
key before any handler imports `src/lib/supabase.ts`, without leaking service-role into the
app runtime.

**Contract**: Setup file sets `process.env.SUPABASE_URL`, `process.env.SUPABASE_KEY`
(anon), and a harness-only `process.env.SUPABASE_SERVICE_ROLE_KEY`. Source of values, in
order of preference: (1) the well-known **static** local-Supabase anon/service-role JWTs
inlined as constants in `setup.ts` (they are identical across every local install and are
not real secrets), or (2) `.dev.vars`, which is already gitignored. Do **not** introduce a
new `.env.test` file; if a future need forces one, it must be added to `.gitignore` in the
same change. Fails fast with a clear message if the local Supabase health check
(`GET ${SUPABASE_URL}/auth/v1/health`) does not respond.

#### 3. User factory (service-role)

**File**: `tests/integration/helpers/users.ts` (new)

**Intent**: Create and tear down real auth users so tests have two genuinely distinct
identities.

**Contract**: Exports `createTestUser(): Promise<{ id, email, password }>` using a
service-role `supabase-js` client (`auth: { autoRefreshToken: false, persistSession: false }`)
and `auth.admin.createUser({ email, password, email_confirm: true })`, and
`deleteTestUser(id)` / `deleteAllTestUsers()` for teardown. Emails use a unique prefix
(e.g. `test+<uuid>@example.test`) so teardown can target only test rows.

#### 4. Session helper (cookie harvest)

**File**: `tests/integration/helpers/session.ts` (new)

**Intent**: Produce the exact `Cookie` header a signed-in browser would send, so
handler-invocation tests exercise the real `@supabase/ssr` cookie path.

**Contract**: Exports `cookieHeaderFor({ email, password }): Promise<string>`. Builds a
`createServerClient(SUPABASE_URL, SUPABASE_KEY, { cookies })` bound to an in-memory jar,
calls `signInWithPassword`, and returns the jar serialized as a single
`name=value; name2=value2` string. Also exports `apiContext({ cookieHeader?, method, url,
body?, params? })` returning an `APIContext`-shaped object (real `Request` with the `Cookie`
header + JSON body, an `AstroCookies`-compatible `cookies`, parsed `url`, `params`) for
passing to handlers.

#### 5. DB reset helper

**File**: `tests/integration/helpers/db.ts` (new)

**Intent**: Guarantee each test starts from a known-empty `flashcards` table.

**Contract**: Exports `resetFlashcards()` (service-role `delete` on all rows) and
`seedFlashcard(userId, overrides?)` inserting a row with `status: 'accepted'` and valid
FSRS column defaults, returning the created row. Used in `afterEach` / per-test setup.

#### 6. Risk #1 cross-user tests

**File**: `tests/integration/flashcards.cross-user.test.ts` (new)

**Intent**: Prove cross-user access is rejected on every distinct enforcement shape, and
prove the owner is not locked out (oracle against a blanket-deny bug).

**Contract**: `beforeAll` creates users A and B; `afterEach` calls `resetFlashcards()`;
`afterAll` deletes both users. For each case, seed a card owned by A, then act with B's
cookie header:
- `PATCH /api/flashcards/[id]` (import `PATCH` from `src/pages/api/flashcards/[id].ts`) with
  `{ status: "rejected" }` → `404`, body `{"error":"Flashcard not found"}`; A's row unchanged
  when re-read via service-role.
- `DELETE /api/flashcards/[id]` → `404`; A's row still present.
- `POST /api/flashcards/[id]/review` with `{ rating: 3 }` → `404`; A's row's `due`/`reps`
  unchanged.
- `GET /api/flashcards` as B → `200`, `flashcards` array excludes A's card id (seed one card
  for B so the list is non-empty and specifically lacks A's).
- **Positive controls** — same four operations with A's own cookie header → `200`/`204` and
  the expected mutation is visible on re-read.

#### 7. Risk #1 RLS-layer isolation tests

**File**: `tests/integration/flashcards.rls.test.ts` (new)

**Intent**: Give the RLS layer its own regression protection, independent of the route
handlers. The handler tests in change #6 prove the *composite* outcome (cross-user access
denied) but cannot distinguish which layer enforced it — RLS alone returns 404/empty even
if a handler's `.eq("user_id", user.id)` filter is removed. This group pins RLS directly,
so disabling RLS on `flashcards` (or a future switch to a service-role client) fails a test
even while the app-level filter still stands.

**Contract**: Reuse the Phase 2 user factory and `resetFlashcards`. Build two
**session-scoped** `supabase-js` clients — one signed in as user A, one as user B (plain
`createClient(SUPABASE_URL, SUPABASE_KEY, ...)` + `signInWithPassword`, anon key, no
service role). Seed a card owned by A via service-role. Then, calling the DB directly
(no route handler):
- `supabaseB.from("flashcards").select("*").eq("id", aCardId)` → empty array, no error.
- `supabaseB.from("flashcards").update({ front: "x" }).eq("id", aCardId).select()` → affects
  0 rows; A's row unchanged on service-role re-read.
- `supabaseB.from("flashcards").delete().eq("id", aCardId).select()` → affects 0 rows; A's
  row still present.
- `supabaseB.from("flashcards").insert({ user_id: aUserId, front, back, status: "accepted" })`
  → rejected by `flashcards_insert_own` WITH CHECK (error, no row).
- **Positive control**: `supabaseA` performs each of the above on its own card → succeeds.

This does not independently cover app-level-filter removal (RLS masks it); that filter is
accepted as belt-and-braces — see the Open Risks note and manual check below.

### Success Criteria:

#### Automated Verification:

- `npx supabase start` then `npm run test:integration` exits 0 with the cross-user suite
  reporting all cases passing
- The RLS-layer suite (`flashcards.rls.test.ts`) passes: user B's session-scoped client
  sees/mutates zero of user A's rows; user A's client succeeds
- Positive-control cases pass (owner can operate on own card)
- `npm test` (unit) still exits 0 and still needs no Docker
- `npm run lint` passes over `tests/**`

#### Manual Verification:

- `alter table flashcards disable row level security` (locally) makes the RLS-layer suite
  fail (B's client suddenly sees A's row); re-enabling it makes the suite pass again
- Removing `.eq("user_id", user.id)` from the PATCH handler does **not** fail any test —
  RLS masks it — and that is the accepted limitation recorded in Open Risks / test-plan
  §6.6, not a bug in the suite
- Running `test:integration` twice in a row leaves no leftover `test+*` users in
  `auth.users`
- Stopping Supabase and running `test:integration` fails fast with the health-check message

**Implementation Note**: After Phase 2 automated verification passes, pause for human
confirmation of the manual checks before starting Phase 3.

---

## Phase 3: Risk #4 API-Route Gating (Integration)

### Overview

The second, independent auth mechanism is covered: unauthenticated flashcard API requests
are rejected with `401 {"error":"Unauthorized"}` (never a redirect), and a valid session is
never blocked.

### Changes Required:

#### 1. API-route auth-gating tests

**File**: `tests/integration/flashcards.auth-gating.test.ts` (new)

**Intent**: Assert the per-handler `getUser()` guard on each representative flashcard API
route, in both directions (no session rejected, valid session allowed), so a regression in
any single handler's guard is caught.

**Contract**: Reuse the Phase 2 harness (`apiContext`, `cookieHeaderFor`, user factory, DB
reset). For each of `GET /api/flashcards`, `POST /api/flashcards`,
`PATCH /api/flashcards/[id]`, `DELETE /api/flashcards/[id]`,
`POST /api/flashcards/[id]/review`, `GET /api/flashcards/due`:
- **No `Cookie` header** → response status `401`, `Content-Type` JSON, body exactly
  `{"error":"Unauthorized"}`, and the response is **not** a redirect (`status` not in
  300–399, no `Location` header).
- **Valid session** (user from the factory; seed a card where the route needs an existing
  row) → status is **not** `401` (expect `200`/`201`/`204` as appropriate). This is the
  "authenticated user is never blocked" half of the risk.
- One explicit assertion that an unauthenticated `GET /api/flashcards` returns `401` and
  **not** a `302` to `/auth/signin` — encoding the "API gating ≠ page gating" distinction
  from research.

### Success Criteria:

#### Automated Verification:

- `npm run test:integration` exits 0 with both integration suites (cross-user + auth-gating)
  passing
- Each of the six routes has both a no-session (`401`) and a valid-session (non-`401`) case
- The "not a redirect" assertion passes (guards against someone wiring `/api/**` into
  `PROTECTED_ROUTES`)
- `npm test`, `npm run lint`, `npm run build` all still pass

#### Manual Verification:

- Temporarily deleting the `if (!user) return jsonError("Unauthorized", 401)` block from
  `due.ts` makes exactly that route's no-session test fail
- Full sequence from a clean checkout: `npm ci` → `npx astro sync` → `npx supabase start` →
  `npm test` → `npm run test:integration`, all green
- `git grep -n "vitest" package.json` shows the scripts; a new contributor can run the
  suite from the README instructions alone

**Implementation Note**: After Phase 3 automated verification passes, pause for human
confirmation before the change is considered complete and handed to `/10x-archive`.

---

## Testing Strategy

### Unit Tests:

- `src/middleware.test.ts` — page-gating logic: redirect vs. pass-through across protected
  prefixes, protected sub-paths, unprotected paths, and `/api/**`; `locals.user` population.
  Supabase client mocked; no DB.

### Integration Tests:

- `tests/integration/flashcards.cross-user.test.ts` — Risk #1: user B vs. user A's card on
  PATCH / DELETE / review (all `404`) and list (excluded); positive controls for user A.
- `tests/integration/flashcards.auth-gating.test.ts` — Risk #4 API mechanism: no-session
  `401 {"error":"Unauthorized"}` and valid-session non-`401` across the six flashcard API
  routes; explicit "not a redirect" assertion.
- Real local Supabase (`npx supabase start`); handlers invoked directly with a crafted
  `APIContext`; users via service-role admin API; sessions via `@supabase/ssr`
  cookie-harvest; `flashcards` reset per test.

### Manual Testing Steps:

1. Clean checkout → `npm ci` → `npx astro sync` → `npm test` (green, no Docker).
2. `npx supabase start` → `npm run test:integration` (green).
3. Break one control at a time (drop a `PROTECTED_ROUTES` entry; drop a handler's
   `user_id` filter; drop a handler's `401` guard) and confirm the matching test fails.
4. Run `test:integration` twice; confirm no `test+*` residue in `auth.users`.
5. Stop Supabase; confirm `test:integration` fails fast with a clear message.

## Performance Considerations

- Unit suite must stay dependency-free and sub-second so it can gate `lint`/`build` locally
  without friction.
- Integration suite is expected to be slower (real DB round-trips, one sign-in per session
  helper call). Cache the `cookieHeaderFor` result per user within a file to avoid a
  sign-in per test. Keep the representative route set small (test-plan cost×signal).

## Migration Notes

- No production code changes and no schema changes. `supabase/migrations/` is untouched, so
  the `lessons.md` "push migrations to cloud" rule does not apply to this change.
- New dev dependency (`vitest`) and new root file `vitest.config.ts`; `tests/` directory is
  new. The harness's local-only `SUPABASE_SERVICE_ROLE_KEY` is the static local-Supabase
  value (inlined in `tests/integration/setup.ts`) or read from the already-gitignored
  `.dev.vars` — no new `.env.test` file, and it must never be added to Workers secrets or
  the app runtime.

## Open Risks & Assumptions

- **`astro:*` virtual modules resolving under Vitest is assumed, not proven.** Phase 1
  change #0 spikes it first; if `getViteConfig()` does not surface the `astro:env/server`
  secret vars from `process.env`, the `resolve.alias` shim fallback applies. Either way the
  outcome is recorded in the Phase 1 completion summary.
- **The app-level `.eq("user_id", user.id)` filter has no independent regression test.**
  RLS masks its removal in both the handler tests (change #6) and the RLS-layer tests
  (change #7). It is accepted as belt-and-braces; the RLS layer — the control research
  calls "a live defense, not documentation" — is what change #7 protects. This limitation
  is to be recorded in `test-plan.md` §6.6 when the cookbook section is filled in.
- **`dashboard.astro` has no page-level fallback auth guard** — it depends entirely on
  middleware. Recommended as a follow-up change; explicitly not fixed here (testing
  existing behavior does not require changing it).
- **CI does not run the integration suite.** `test:integration` needs Docker + a running
  local Supabase, which `.github/workflows/ci.yml` does not provide. Wiring it in is
  test-plan §3 Phase 4, out of scope here.

## References

- Related research: `context/changes/testing-critical-path-coverage/research.md`
- Test plan (strategy, risk map, response guidance): `context/foundation/test-plan.md` §1–§6
- Change brief: `context/changes/testing-critical-path-coverage/change.md`
- Ownership enforcement: `src/pages/api/flashcards/[id].ts:25-30,50-61,66-68,91-97`,
  `src/lib/services/reviews.ts:61-102`, `src/lib/services/flashcards.ts:7-9`
- RLS policies: `supabase/migrations/20260903000000_create_flashcards.sql:22-49`
- Page gating: `src/middleware.ts:4,18-22`
- Session-scoped client: `src/lib/supabase.ts:5-24`
- Astro Vitest helper: `getViteConfig()` — https://docs.astro.build/en/guides/testing/

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.
> Do not rename step titles. See `.github/skills/10x-plan/references/progress-format.md`.

### Phase 1: Runner Bootstrap + Risk #4 Page-Gating (Unit)

#### Automated

- [x] 1.1 The `astro:*` resolution spike (change #0) passes — natively or via the documented `resolve.alias` shim — and the spike file is deleted before Phase 1 completes — e589e87
- [x] 1.2 `npm test` exits 0 with the middleware suite reporting > 0 passing tests — e589e87
- [x] 1.3 `npm run lint` passes (new config + test file type-check clean) — e589e87
- [x] 1.4 `npm run build` still passes — e589e87
- [x] 1.5 `npm test` succeeds with no Docker / `supabase` process running — e589e87

#### Manual

- [x] 1.6 Removing `/generate` from `PROTECTED_ROUTES` makes `npm test` fail — e589e87
- [x] 1.7 `npx vitest` watch mode picks up `src/middleware.test.ts` — e589e87

### Phase 2: Integration Harness + Risk #1 Cross-User Isolation

#### Automated

- [x] 2.1 `npx supabase start` then `npm run test:integration` exits 0 with the cross-user suite all passing — 44eba5a
- [x] 2.2 The RLS-layer suite (`flashcards.rls.test.ts`) passes: user B's session-scoped client sees/mutates zero of user A's rows; user A's client succeeds — 44eba5a
- [x] 2.3 Positive-control cases pass (owner can operate on own card) — 44eba5a
- [x] 2.4 `npm test` (unit) still exits 0 and still needs no Docker — 44eba5a
- [x] 2.5 `npm run lint` passes over `tests/**` — 44eba5a

#### Manual

- [x] 2.6 `alter table flashcards disable row level security` makes the RLS-layer suite fail; re-enabling it makes the suite pass again — 44eba5a
- [x] 2.7 Removing `.eq("user_id", user.id)` from the PATCH handler fails no test — RLS masks it — and that is the accepted limitation recorded in Open Risks / test-plan §6.6 — 44eba5a
- [x] 2.8 Running `test:integration` twice leaves no leftover `test+*` users in `auth.users` — 44eba5a
- [x] 2.9 Stopping Supabase makes `test:integration` fail fast with the health-check message — 44eba5a

### Phase 3: Risk #4 API-Route Gating (Integration)

#### Automated

- [x] 3.1 `npm run test:integration` exits 0 with both integration suites passing
- [x] 3.2 Each of the six routes has both a no-session (`401`) and a valid-session (non-`401`) case
- [x] 3.3 The "not a redirect" assertion passes
- [x] 3.4 `npm test`, `npm run lint`, `npm run build` all still pass

#### Manual

- [x] 3.5 Deleting the `401` guard from `due.ts` makes exactly that route's no-session test fail
- [x] 3.6 Clean-checkout sequence (`npm ci` → `astro sync` → `supabase start` → `npm test` → `npm run test:integration`) is all green
- [x] 3.7 A new contributor can run the suite from the README instructions alone
