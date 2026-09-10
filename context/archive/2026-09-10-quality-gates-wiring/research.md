---
date: 2026-09-10T06:01:10Z
researcher: Claude (Sonnet 5)
git_commit: 1079655afb022940e97a11a045fcc6063d140c97
branch: master
repository: 10xCards
topic: "Wire the Vitest test suite (unit + components + integration) into GitHub Actions CI"
tags: [research, codebase, ci, github-actions, vitest, supabase, quality-gates, test-rollout-phase-4]
status: complete
last_updated: 2026-09-10
last_updated_by: Claude (Sonnet 5)
---

# Research: Wire the Vitest test suite into GitHub Actions CI (test-rollout Phase 4)

**Date**: 2026-09-10T06:01:10Z
**Researcher**: Claude (Sonnet 5)
**Git Commit**: 1079655afb022940e97a11a045fcc6063d140c97
**Branch**: master
**Repository**: 10xCards

## Research Question

Test-rollout Phase 4 ("Quality-gates wiring") calls for adding the test suite to
CI alongside the existing lint + build gates (`context/foundation/test-plan.md`
§3, §5). Ground the plan: what is the current CI shape, what does each of the
three Vitest projects need at runtime, how do you stand up a local Supabase in
GitHub Actions for the `integration` project, and what constraints do Phases 1–3
and the foundation docs impose?

**Scope locked with the user before research:**
- Wire **all three** projects — `unit` + `components` + `integration` — as
  required PR gates (not just the Docker-free two).
- Job shape: a **separate `test` job** running in parallel with the existing
  `ci` (lint+build) job; `deploy` gains a dependency on it
  (`needs: [ci, test]`).

## Summary

The current `.github/workflows/ci.yml` has two jobs: `ci` (lint + build, on every
push/PR to `master`) and `deploy` (migrations push + build + `wrangler deploy`,
push-to-`master` only). No test step, no Docker, no Supabase service.

Wiring the suite in is mostly mechanical for `unit` and `components` — both have
**zero external dependencies** (no network, no Docker, no `process.env`, no child
process, no disk writes). `npm test` and `npm run test:components` can run
straight after `npm ci` + `npx astro sync`.

The `integration` project is the whole cost of this phase. It needs:

1. **Docker + a running local Supabase stack** (`npx supabase start`). The
   harness shells out to `npx supabase status -o json`
   (`tests/integration/helpers/local-env.ts:18`) and health-checks
   `${API_URL}/auth/v1/health` (`tests/integration/setup.ts:27`); every test
   invokes real route handlers that hit the local Postgres + GoTrue. GitHub's
   `ubuntu-latest` ships Docker, and `supabase` is already a devDependency
   (`package.json:63`), so `npx supabase start` works after `npm ci`.
2. **`SUPABASE_KEY` explicitly exported for the route handlers.** This is the
   sharp edge (see Finding 3). `applyLocalEnv()` sets `process.env.SUPABASE_URL`
   but **not** `process.env.SUPABASE_KEY`
   (`tests/integration/helpers/local-env.ts:34-38`), and locally the handlers
   get `SUPABASE_KEY` from the gitignored `.dev.vars`. On a bare CI runner
   `SUPABASE_KEY` is `undefined` → `createClient()` returns `null`
   (`src/lib/supabase.ts:5-8`) → **every** route handler returns
   `500 {"error":"Supabase is not configured"}` → the whole integration suite
   fails. The CI job must export `SUPABASE_URL` **and** `SUPABASE_KEY` (the
   local stack's URL + publishable/anon key, both well-known static local
   values — **not secrets**) before `npm run test:integration`.
3. **A dummy `OPENROUTER_API_KEY`.** 13 provider-mocked tests in two suites are
   gated behind `OPENROUTER_API_KEY ? describe : describe.skip`
   (`flashcards.generate.test.ts:15`, `flashcards.input-validation.test.ts:272`).
   The provider is always intercepted by `mockProvider`
   (`tests/integration/helpers/mock-provider.ts`), so **any non-empty string**
   un-skips all 13 — no real key needed.

Migrations auto-apply: `supabase/config.toml` has `[db.migrations] enabled =
true`, so `supabase start` on a fresh runner volume applies all three
`supabase/migrations/*.sql` in order. No `seed.sql` exists (seeding is a no-op).

Vitest needs **no CI-specific config**: `vitest run` (what all three scripts
already use) is the CI command, Vitest auto-detects CI (disables watch, disables
`allowOnly` so a stray `.only` fails the build), and auto-adds the
`github-actions` reporter when `GITHUB_ACTIONS === 'true'` (inline PR
annotations for failures).

**Key inherited constraints:** the local Supabase service-role/anon keys are the
well-known static local JWTs — keep them in `.dev.vars` / `setup.ts` / a
workflow `env:` block, **never** a GitHub or Workers secret
(`context/archive/2026-09-09-testing-critical-path-coverage/plan.md:310-312`).
Production `SUPABASE_KEY` must always be the anon key, never `service_role`. The
`deploy` job's `supabase db push --project-ref "$REF" --yes` step and its
`SUPABASE_ACCESS_TOKEN` secret must survive any workflow rewrite
(`context/foundation/lessons.md:9-10`).

## Detailed Findings

### 1. Current CI shape and the quality-gate model

**`.github/workflows/ci.yml`** (53 lines) — two jobs:

- **`ci`** (`.github/workflows/ci.yml:9-24`) — `runs-on: ubuntu-latest`,
  triggers `push` + `pull_request` on `master` (`:3-7`). Steps:
  `actions/checkout@v4` → `actions/setup-node@v4` (`node-version: 22`,
  `cache: npm`) → `npm ci` → `npx astro sync` → `npm run lint` → `npm run build`.
  The `build` step gets `SUPABASE_URL` / `SUPABASE_KEY` from repo secrets
  (`:22-24`). **No test step. No `services:` block. No Docker setup.**
- **`deploy`** (`.github/workflows/ci.yml:26-53`) — `needs: ci`,
  `if: github.event_name == 'push' && github.ref == 'refs/heads/master'` (so it
  **never runs on PRs**, incl. fork PRs). Steps: checkout → setup-node → `npm ci`
  → **"Push Supabase migrations"** (`REF=$(echo "$SUPABASE_URL" | sed …)` then
  `npx supabase db push --project-ref "$REF" --yes`, env `SUPABASE_URL` +
  `SUPABASE_ACCESS_TOKEN`, `:37-43`) → `npm run build` → `cloudflare/wrangler-action@v4`
  (`command: deploy`, `:48-52`).

**All `secrets.*` referenced in the repo** (only `ci.yml` uses secrets):
`SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_ACCESS_TOKEN`, `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID`.

**The gate model** — `context/foundation/test-plan.md` §5 (`:124-134`):

| Gate | Where | Required? |
|---|---|---|
| lint + typecheck | local + CI | required (already wired) |
| build | local + CI | required (already wired) |
| unit + integration | local + CI | required **after §3 Phase 1** |
| component tests on client hooks | local + CI | required **after §3 Phase 3** |
| test suite in CI | **CI on PR** | required **after §3 Phase 4** ← this change |

"Required for §3 Phase N" means the gate is enforced once that phase lands
(`test-plan.md:124-126`). Phases 1–3 are complete/archived, so the first three
test gates are "required" in principle but **not actually running in CI** —
Phase 4 is what closes that gap. Note §5's "Where" column: existing gates are
`local + CI`; the new row is specifically `CI on PR`.

**`AGENTS.md:31`** states the mandate directly (and is now stale on the first
clause): *"No test framework is configured yet; if you add one, wire it into CI
before relying on it."* **`CLAUDE.md:52-54`** and **`AGENTS.md:29-32`** both
describe CI as "runs lint + build" — both need a docs touch-up when the test job
lands.

**Local gates already in place:** husky + lint-staged run `eslint --fix` on
`*.{ts,tsx,astro}` and `prettier --write` on `*.{json,css,md}` pre-commit
(`CLAUDE.md:14`) — no test hook locally.

### 2. The three Vitest projects — runtime dependency surface

Root config: `export default getViteConfig({ test: { projects: [...] } })`
(`vitest.config.ts:17-19`). `getViteConfig()` from `astro/config` builds the
full Astro Vite config (loads `astro.config.mjs`, runs integration
`astro:config:*` hooks, wires the `astro:*` virtual modules). **No root-level
`setupFiles` / `globalSetup` / `env`** — only `projects`.

| Project | `vitest.config.ts` | env | include | setup / global | fileParallelism | External deps |
|---|---|---|---|---|---|---|
| `unit` | `:20-27` | `node` | `src/**/*.test.ts` | none | default (parallel) | **none** — all 3 files fully mock `astro:env/server` and/or `globalThis.fetch` |
| `integration` | `:28-39` | `node` | `tests/integration/**/*.test.ts` | `setupFiles: [tests/integration/setup.ts]`, `globalSetup: [tests/integration/global.ts]` | **`false`** ("share a single local DB — run files serially") | **Docker + local Supabase** (see Finding 3) |
| `components` | `:40-56` | `happy-dom` | `src/**/*.test.tsx` | none | default | **none** — all 3 hook-test files mock `globalThis.fetch` |

- `unit` and `integration` use `extends: true` (inherit `getViteConfig()`
  plugins/resolve so `astro:*` resolves). `components` is **standalone** (NOT
  `extends: true`, `vitest.config.ts:41-46`) with its own `plugins: [react()]`
  (`@vitejs/plugin-react`), `@` alias, and `dedupe: ["react","react-dom"]` — a
  Phase-3 deviation because `getViteConfig()`'s Astro-SSR React wiring gave
  `renderHook` a null dispatcher.
- Scripts (`package.json:13-16`): `test` → `vitest run --project unit`;
  `test:integration` → `vitest run --project integration`; `test:components` →
  `vitest run --project components`. No script runs all three; bare `vitest run`
  is intentionally unwired (`vitest.config.ts:16`).
- Test counts today: `unit` 43, `components` 6, `integration` 72 (of which 13 in
  the two `generate` suites skip without `OPENROUTER_API_KEY`).
- **No test anywhere writes to disk.** Only `tests/integration/helpers/local-env.ts`
  spawns a child process (`execSync("npx supabase status -o json")`, `:18`) and
  mutates `process.env` (`:34-38`). No `src/**` test reads `process.env`, spawns
  a process, or makes an unmocked network call.

### 3. The integration job's sharp edge — `SUPABASE_KEY` for the route handlers

**How handlers resolve Supabase config.** `src/lib/supabase.ts:3` imports
`SUPABASE_URL`, `SUPABASE_KEY` from `astro:env/server`; `createClient()` returns
`null` when either is falsy (`:5-8`), and every route + the middleware then
short-circuits to `500 "Supabase is not configured"`
(`src/pages/api/flashcards/index.ts:21-23`, `[id].ts:20-22`,
`[id]/review.ts:15-17`, `generate.ts:17-19`, `src/middleware.ts:7`).

**`astro.config.mjs:17-24`** declares all four env fields as
`envField.string({ context: "server", access: "secret", optional: true })`.
`optional: true` ⇒ **no error at config load when absent** — they just resolve
to `undefined`.

**Resolution order under `getViteConfig()` in vitest** (traced through
`node_modules`):
1. `getViteConfig()` loads `astro.config.mjs`; during `astro:config:done` the
   `@astrojs/cloudflare` adapter reads `.dev.vars` if present and does
   `Object.assign(process.env, parsed)`
   (`node_modules/@astrojs/cloudflare/dist/index.js:292-303`). Missing
   `.dev.vars` → silent no-op. **Vite's own env loader never opens `.dev.vars`.**
2. First import of `astro:env/server` triggers Vite `loadEnv(mode, root, "")`,
   which parses `.env`, `.env.local`, `.env.<mode>`, `.env.<mode>.local`
   (**not** `.dev.vars`, **not** `.env.example`) and then lets **`process.env`
   override** every file value.
3. Because vitest runs Vite in `serve` mode, the resolved env object is inlined
   into the virtual module at first-import time — frozen thereafter.

**Repo env-file state:** `.dev.vars` (gitignored) has the **local** stack values
(`SUPABASE_URL=http://127.0.0.1:54321`, `SUPABASE_KEY=sb_publishable_…`,
`OPENROUTER_API_KEY=…`). `.env` (gitignored) has **production** values. Only
`.env.example` is tracked (empty `SUPABASE_URL=`/`SUPABASE_KEY=`), and `loadEnv`
doesn't read it anyway.

**`tests/integration/setup.ts`** (runs as `setupFiles`, once per test file,
before that file's imports):
1. `readLocalStatus()` — `execSync("npx supabase status -o json")` → throws
   `"Local Supabase is not reachable…"` if the stack/CLI/Docker is down
   (`helpers/local-env.ts:18-24`).
2. `applyLocalEnv(status)` — sets `process.env.SUPABASE_URL = status.API_URL`,
   `process.env.SUPABASE_ANON_KEY`, `process.env.SUPABASE_SERVICE_ROLE_KEY`.
   **Does NOT set `process.env.SUPABASE_KEY`** (`helpers/local-env.ts:34-38`).
3. `await import("astro:env/server")` — first evaluation; picks up whatever is
   in `process.env` now.
4. Mismatch guard: `if (handlerSupabaseUrl && handlerSupabaseUrl !==
   status.API_URL) throw` (`setup.ts:20-25`). Throws only when the handler URL
   is **truthy and different** (e.g. `.dev.vars` points at production while the
   local stack is on `127.0.0.1`). Silently passes when `handlerSupabaseUrl` is
   `undefined`. **It only compares `SUPABASE_URL` — it does not catch a missing
   `SUPABASE_KEY`.**
5. `fetch(${API_URL}/auth/v1/health)` — throws if not `ok`.

**Consequence for a bare CI runner (no `.dev.vars`):**
- `SUPABASE_URL` — *usually* OK: `applyLocalEnv()` sets it from `supabase
  status` before the first `astro:env/server` import.
- `SUPABASE_KEY` — **`undefined`** ⇒ `createClient()` → `null` ⇒ every route
  handler 500s ⇒ every integration assertion fails.
- **Fix:** the CI `test` job must export `SUPABASE_URL` and `SUPABASE_KEY` from
  the running local stack before `npm run test:integration` — e.g.
  `eval "$(npx supabase status -o env)"` then map `API_URL`→`SUPABASE_URL` and
  the publishable/anon key→`SUPABASE_KEY` (or use
  `supabase status -o env --override-name api.url=SUPABASE_URL
  --override-name auth.anon_key=SUPABASE_KEY`), and put them in the step/job
  `env:`. These local keys are static well-known values, **not secrets**.

**`tests/integration/global.ts`** — exports only `teardown` (no `setup`); a
belt-and-braces sweep of `test+cpc-*` users via `adminClient().auth.admin`.
Every failure is caught and swallowed (`global.ts:11-13`) — if the stack is
already down at teardown it is a silent no-op. Does **not** require the stack.

**`helpers/clients.ts`** — `adminClient()` (service-role, used **only** for
`auth.admin` user CRUD in `helpers/users.ts`), `anonClient()` (per-user
sessions). Both hit the local stack over the network. `env()` throws a clear
message if `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
are unset.

### 4. Local Supabase in GitHub Actions (Context7: `/supabase/cli`, checked 2026-09-10)

- **`supabase start` is CI-safe with no flags.** The start handler detects
  non-TTY (GitHub Actions) and falls through to `startNonInteractive()`
  automatically — no `--yes`/`--detach` needed.
- **Two install paths:**
  1. `npx supabase …` — already works (devDep `supabase@^2.115.0`); zero
     workflow change beyond a start step. `npx` resolves the local binary after
     `npm ci`.
  2. Official **`supabase/setup-cli@v2`** GitHub Action — installs the CLI
     globally on `PATH`, pinned by commit SHA with a `version:` input (e.g.
     `v2.x`). Marginally faster / decouples CLI version from `package.json`.
     Either is fine; the `npx` path is the smaller diff.
- **Env export:** `supabase status -o json` (what the harness already parses) or
  `supabase status -o env [--override-name api.url=SUPABASE_URL ...]` for a
  `eval`-able block. Local `anon` / `service_role` JWTs are fixed across every
  install — not secrets.
- **Migrations:** `supabase/config.toml` `[db.migrations] enabled = true` ⇒
  `supabase start` on a fresh volume applies `supabase/migrations/*.sql` in
  timestamp order (3 files: create `flashcards` + RLS, list index, FSRS
  columns). A CI runner is always a fresh volume, so this always happens. No
  `supabase/seed.sql` exists ⇒ seeding is a no-op. `supabase db reset` is only
  needed to *replay* migrations against an existing volume — not relevant in CI.
- **Cost:** first `supabase start` pulls the stack's Docker images (Postgres,
  GoTrue, Kong, PostgREST, Realtime, Storage, Studio, imgproxy, …) — typically a
  few minutes on a cold runner. Options for the plan to weigh: accept it,
  cache `~/.cache/... ` / Docker layers, or trim `supabase/config.toml`
  services not exercised by tests (only Postgres + Auth + PostgREST/Kong are
  actually used).
- **`lessons.md` interaction:** the migration-push rule
  (`context/foundation/lessons.md:5-11`) is scoped to the **`deploy` job** and
  the **linked cloud project**. A `test` job that runs `supabase start` against
  a throwaway local DB is exactly the "local application" path — it must **not**
  run `supabase db push`, must **not** touch the cloud project, and must **not**
  need `SUPABASE_ACCESS_TOKEN`. Any workflow rewrite must preserve the existing
  `deploy`-job `supabase db push --project-ref "$REF" --yes` step verbatim.

### 5. `OPENROUTER_API_KEY` gate — a dummy value un-skips 13 tests

| File:line | Gate | Tests skipped when key falsy |
|---|---|---|
| `tests/integration/flashcards.generate.test.ts:15` | `const suite = OPENROUTER_API_KEY ? describe : describe.skip` | 5 (`:86,:100,:110,:119,:129`) |
| `tests/integration/flashcards.input-validation.test.ts:272` | `const generateSuite = OPENROUTER_API_KEY ? describe : describe.skip` | 8 (the `generateSuite(...)` block) |

The provider is **always** mocked: `mockProvider()`
(`tests/integration/helpers/mock-provider.ts`) `vi.spyOn`s `globalThis.fetch`
and intercepts any URL containing `openrouter.ai`, passing all other requests
(Supabase auth/DB) through to the local stack. The only reason the suite is
gated is that `generateFlashcardProposals()` throws before `fetch` if
`OPENROUTER_API_KEY` is falsy
(`src/lib/services/flashcard-generation.ts:34-37`). The gate is a plain
truthiness check — **any non-empty string** (`"ci-dummy"`) un-skips all 13, and
no real `openrouter.ai` call is ever made. (Astro's env loader coerces `""` →
`undefined`, so the value must be non-empty.)

Decision for the plan: set `OPENROUTER_API_KEY: ci-dummy` in the `test` job so
CI runs the full 72, not 59. Not a secret.

### 6. Vitest CI behavior (Context7: `/vitest-dev/vitest`, checked 2026-09-10)

- `vitest run` (all three scripts already use it) is the CI command — exits
  after one pass, no watch.
- Vitest auto-detects CI (`isCI`): disables `watch` and `open`, and disables
  `allowOnly` — a stray `.only` / `describe.only` **fails** the run in CI
  (desirable).
- When `process.env.GITHUB_ACTIONS === 'true'`, Vitest auto-appends the
  `github-actions` reporter (inline file/line annotations on the PR for
  failures) — no config needed.
- `--project <name>` filtering already works and is what the scripts use.
- **No `vitest.config.ts` change is required for CI.** Optional niceties the
  plan may consider: `--reporter=github-actions --reporter=default` explicitly,
  `--bail=1` for the integration job, or JUnit/blob output — none load-bearing.

### 7. Constraints inherited from Phases 1–3 and foundation docs

- **CI wiring of every tier is explicitly Phase 4.** Stated in all three
  archived phase plans
  (`context/archive/2026-09-09-testing-critical-path-coverage/plan.md:90-92`,
  `context/archive/2026-09-09-core-flow-correctness/plan.md:107`,
  `context/archive/2026-09-09-client-state-and-input-hardening/plan.md:124`) and
  `test-plan.md:340-341`, `:378-380`. **Why deferred:** the current `ci` job
  provides no Docker + local Supabase; the `unit`/`components` tiers never
  needed it. No cost/flakiness rationale beyond §7's "solo, after-hours
  project; infrastructure should follow a real suite, not precede it"
  (`test-plan.md:417`).
- **Local Supabase keys are not secrets.** *"the well-known **static**
  local-Supabase anon/service-role JWTs … are identical across every local
  install and are not real secrets"* … *"must never be added to Workers secrets
  or the app runtime"*
  (`context/archive/2026-09-09-testing-critical-path-coverage/plan.md:310-315`,
  `:533-536`; `plan-brief.md:95-97`). No new `.env.test` file — if a future need
  forces one it must land in `.gitignore` in the same change. Service-role is
  confined to `auth.admin` (`test-plan.md:185-190`).
- **Production `SUPABASE_KEY` must be the anon/publishable key, never
  `service_role`** (`research.md:153` in the Phase-1 archive, citing
  `context/deployment/deploy-plan.md`). A `test` job using the static local
  service-role key must keep it isolated from every deploy path.
- **`deploy` job invariants** (`context/foundation/lessons.md:9-10`): keep
  `supabase db push --project-ref "$REF" --yes` + its `SUPABASE_ACCESS_TOKEN`
  secret through any `ci.yml` rewrite; the rule warns explicitly that "the whole
  `db push` step needs re-adding after any workflow rewrite".
- **Fork-PR secret limitation** (`context/deployment/deploy-plan.md` E8):
  PRs from forks can't read repo secrets. This is *not* a blocker for the `test`
  job — it needs **no** real secrets (local stack keys are static + inlined), so
  the integration gate can run on fork PRs too. `deploy` is already
  `push`→`master` only.
- **`@cloudflare/vitest-pool-workers` / workerd runtime** was deferred "to
  Phase 4" in Phase 1 (`test-plan.md:322-324`). The user's locked scope for
  *this* change is CI wiring of the existing Node-environment projects — adopting
  the Workers pool is a separate, still-open question (see Open Questions).
- **`roadmap.md` exists** (`context/foundation/roadmap.md`, 200 lines) but has
  **zero** items referencing CI, quality gates, test infrastructure, or any
  test-rollout change-id. The rollout is tracked solely in `test-plan.md` §3.
  (A future `/10x-archive quality-gates-wiring` will find no matching Change ID
  — expected.)
- **Docs that go stale when the test job lands:** `AGENTS.md:29-32`
  ("No test framework is configured yet"; "runs `npm ci` → `astro sync` → lint →
  build"), `CLAUDE.md:52-54` ("runs lint + build ... Requires `SUPABASE_URL`
  and `SUPABASE_KEY` repository secrets for the build step"). `test-plan.md` §3
  Phase 4 row status and §6.6 (a Phase 4 note) will also want updating — that is
  the implement/epilogue step's job, flagged here so the plan scopes it.

## Code References

- `.github/workflows/ci.yml:9-24` — `ci` job (lint + build), no test step
- `.github/workflows/ci.yml:26-53` — `deploy` job; `:37-43` the `supabase db push` step to preserve
- `vitest.config.ts:17-19` — `getViteConfig()` root wrapper, `projects` only
- `vitest.config.ts:20-27` / `:28-39` / `:40-56` — `unit` / `integration` / `components` project configs
- `package.json:13-16` — the three `test*` scripts; `:63` `supabase` devDep
- `src/lib/supabase.ts:5-8` — `createClient()` returns `null` when `SUPABASE_URL`/`SUPABASE_KEY` falsy
- `src/pages/api/flashcards/index.ts:21-23` — representative `if (!supabase) return 500` guard (same in every route + `src/middleware.ts:7`)
- `astro.config.mjs:17-24` — `env.schema`, all four fields `access: "secret", optional: true`
- `tests/integration/setup.ts:12-30` — startup: `readLocalStatus` → `applyLocalEnv` → `import astro:env/server` → mismatch guard → health fetch
- `tests/integration/helpers/local-env.ts:18` — `execSync("npx supabase status -o json")` (only child process in the suite)
- `tests/integration/helpers/local-env.ts:34-38` — `applyLocalEnv` sets `SUPABASE_URL` but **not** `SUPABASE_KEY`
- `tests/integration/helpers/clients.ts:4-14` — `env()` throws if keys unset; `adminClient` / `anonClient`
- `tests/integration/global.ts:7-14` — teardown-only `test+cpc-*` sweep, all failures swallowed
- `tests/integration/helpers/mock-provider.ts` — `openrouter.ai` fetch interceptor (provider never really hit)
- `tests/integration/flashcards.generate.test.ts:15` / `flashcards.input-validation.test.ts:272` — `OPENROUTER_API_KEY ? describe : describe.skip`
- `src/lib/services/flashcard-generation.ts:34-37` — throws before `fetch` if `OPENROUTER_API_KEY` falsy (the only reason for the gate)
- `supabase/config.toml` — `project_id = "app"`, API port 54321, `[db.migrations] enabled = true`, no `seed.sql`
- `supabase/migrations/` — `20260903000000_create_flashcards.sql`, `20260904000000_add_flashcards_list_index.sql`, `20260906000000_add_review_state_to_flashcards.sql`
- `context/foundation/test-plan.md:85-97` (§3 rollout table) / `:124-134` (§5 gate table) / `:340-341`, `:378-380` (§6.6 CI-deferral notes)
- `context/foundation/lessons.md:5-11` — migration-push rule (binds `deploy` job)
- `AGENTS.md:29-32`, `CLAUDE.md:52-54` — stale CI descriptions

## Architecture Insights

- **The gate topology the user chose is clean:** `ci` (lint+build) and `test`
  (3 projects) are independent and parallelizable; `deploy: needs: [ci, test]`
  makes "unverified code reaches `master`/production" impossible without
  serializing lint+build behind tests. `deploy`'s existing `if: push && master`
  guard already keeps the slow Supabase-in-CI cost off the deploy path (deploy
  re-runs nothing test-related; it just gains a dependency edge).
- **The `integration` project's env contract is split-brain by design:** the
  *harness's* supabase-js clients read `SUPABASE_ANON_KEY` /
  `SUPABASE_SERVICE_ROLE_KEY` from `process.env` (set by `applyLocalEnv` from
  `supabase status`), while the *route handlers under test* read `SUPABASE_URL` /
  `SUPABASE_KEY` from `astro:env/server` (Vite `loadEnv` + `process.env`
  override). The two only agree today because `.dev.vars` locally carries the
  same local values *and* `applyLocalEnv` front-runs the `astro:env/server`
  import for the URL. CI has neither `.dev.vars` nor a `SUPABASE_KEY` from
  `applyLocalEnv`, so CI must supply `SUPABASE_URL` + `SUPABASE_KEY` itself —
  this is the single most important fact for the plan.
- **`fileParallelism: false`** on `integration` means the suite is inherently
  serial (~15–25 s wall for 72 tests locally, plus `supabase start` cold-start).
  Sharding wouldn't help within one runner; a matrix would need one stack per
  shard.
- **No production code changes are implied.** This phase touches
  `.github/workflows/ci.yml`, possibly `package.json` (a convenience
  `test:ci` / `test:all` script), possibly `vitest.config.ts` (optional CI
  reporter), and docs. It is a config/gates change, matching test-plan §7's
  "the test configuration itself" exclusion caveat — Phase 4 *is* the sanctioned
  follow-through, not speculative infra.

## Historical Context (from prior changes)

- `context/archive/2026-09-09-testing-critical-path-coverage/plan.md:88-92`,
  `:552-554` — first statement that CI wiring is Phase 4 and *why* (`ci` job has
  no Docker + local Supabase).
- `context/archive/2026-09-09-testing-critical-path-coverage/plan.md:308-315` —
  the local-key handling contract (static JWTs inlined or `.dev.vars`, never a
  new `.env.test`, never a Workers secret).
- `context/archive/2026-09-09-core-flow-correctness/plan.md:390-397` — "do not
  mock `astro:env/server` in integration tests" (it nulls `SUPABASE_*` and 500s
  the DB path) — the same failure mode CI hits without an exported `SUPABASE_KEY`.
- `context/archive/2026-09-09-client-state-and-input-hardening/plan.md:124`,
  `:529-540` — `components` project is standalone with a 4th devDep
  (`@vitejs/plugin-react`); CI must `npm ci` + run this project too.
- `context/foundation/lessons.md:5-11` — the production outage that produced the
  `deploy`-job `supabase db push` step; any `ci.yml` edit must preserve it.

## Related Research

- `context/archive/2026-09-09-testing-critical-path-coverage/research.md` — first
  test-runner selection research; `:154` notes no prior test-infra decision
  existed before `test-plan.md`.
- `context/archive/2026-09-09-core-flow-correctness/research.md` — provider-edge
  mocking patterns; env-plumbing for the generate route smoke.
- `context/archive/2026-09-09-client-state-and-input-hardening/research.md` —
  the `components` project / `getViteConfig()` null-dispatcher investigation.

## Open Questions

1. **`supabase start` cold-start cost.** How long on `ubuntu-latest`? Worth
   caching Docker layers, or trimming `supabase/config.toml` to
   Postgres + Auth + PostgREST + Kong (the only services the tests touch)? A
   quick spike run would settle this for the plan.
2. **`supabase/setup-cli@v2` action vs. `npx supabase`.** The `npx` path is the
   smaller diff; the action decouples CLI version from `package.json` and is
   marginally faster. Plan-phase call.
3. **How CI exports `SUPABASE_URL` / `SUPABASE_KEY`.** Options:
   `eval "$(npx supabase status -o env)"` + remap;
   `supabase status -o env --override-name …`; or hardcode the well-known static
   local anon key + `http://127.0.0.1:54321` in the workflow `env:` (they never
   change). Plan-phase call — leaning toward reading from `status` so it can't
   drift from `config.toml`.
4. **`OPENROUTER_API_KEY: ci-dummy` in the workflow** — confirm the plan wants
   the full 72 tests (vs. accepting 13 skips). Research says a dummy is safe and
   costless; recommend setting it.
5. **Concurrency / cancel-in-progress.** Add
   `concurrency: { group: ..., cancel-in-progress: true }` so superseded PR
   pushes don't queue a full Supabase run? Nice-to-have, plan-phase.
6. **`@cloudflare/vitest-pool-workers`** was parked "for Phase 4"
   (`test-plan.md:322-324`), but the user scoped *this* change to CI wiring of
   the existing Node-env projects. Confirm the Workers pool stays a separate
   future change (recommended — it is an environment migration, not a gate).
7. **Docs update boundary.** `AGENTS.md` / `CLAUDE.md` / `test-plan.md` §3+§6.6
   all go stale when the job lands. In-scope for this change's implement step,
   or a follow-up? (Recommend in-scope — small, and leaving them stale
   contradicts the gate they describe.)
