# Quality-Gates Wiring (Test Rollout Phase 4) Implementation Plan

## Overview

Wire all three Vitest projects — `unit`, `components`, `integration` — into
`.github/workflows/ci.yml` as required PR gates, closing test-rollout Phase 4
(`context/foundation/test-plan.md` §3, §5). A Docker-free `test` job runs
`unit` + `components`; a `test-integration` job stands up a local Supabase stack
and runs `integration`. The `deploy` job gains `needs: [ci, test,
test-integration]` so unverified code can't reach `master`/production. No
production code changes; the app source and `supabase/migrations/` are
untouched.

## Current State Analysis

- **`.github/workflows/ci.yml`** has two jobs (`.github/workflows/ci.yml:9-53`):
  - `ci` — `push` + `pull_request` on `master`; `checkout` → `setup-node@v4`
    (node 22, `cache: npm`) → `npm ci` → `npx astro sync` → `npm run lint` →
    `npm run build` (build gets `SUPABASE_URL`/`SUPABASE_KEY` from repo
    secrets). **No test step, no Docker.**
  - `deploy` — `needs: ci`, `if: github.event_name == 'push' && github.ref ==
    'refs/heads/master'` (never runs on PRs). Runs `supabase db push
    --project-ref "$REF" --yes` (env `SUPABASE_URL` + `SUPABASE_ACCESS_TOKEN`),
    then `npm run build`, then `cloudflare/wrangler-action@v4` `command: deploy`.
- **Three Vitest projects** (`vitest.config.ts:17-56`), scripts in
  `package.json:13-16`:
  - `unit` (`npm test`) — `src/**/*.test.ts`, `node` env. **Zero external
    deps** — every file mocks `astro:env/server` and/or `globalThis.fetch`. 43
    tests.
  - `components` (`npm run test:components`) — `src/**/*.test.tsx`, `happy-dom`,
    standalone (own `@vitejs/plugin-react`). **Zero external deps** — all mock
    `fetch`. 6 tests.
  - `integration` (`npm run test:integration`) — `tests/integration/**/*.test.ts`,
    `node`, `setupFiles: [tests/integration/setup.ts]`, `globalSetup:
    [tests/integration/global.ts]`, `fileParallelism: false`. 72 tests (13 skip
    without `OPENROUTER_API_KEY`).
- **The `integration` env contract is split-brain** (research Finding 3): the
  harness's supabase-js clients read `SUPABASE_ANON_KEY` /
  `SUPABASE_SERVICE_ROLE_KEY` from `process.env`, set at test-runtime by
  `applyLocalEnv()` from `npx supabase status`
  (`tests/integration/helpers/local-env.ts:34-38`). But the **route handlers
  under test** read `SUPABASE_URL` / `SUPABASE_KEY` from `astro:env/server`
  (`src/lib/supabase.ts:3-8`), which resolves via Vite `loadEnv` + `process.env`
  override — and `applyLocalEnv()` **never sets `process.env.SUPABASE_KEY`**. On
  a bare CI runner `SUPABASE_KEY` is `undefined` → `createClient()` returns
  `null` → every route returns `500 "Supabase is not configured"` → the whole
  suite fails.
- **`supabase` CLI** is a devDependency (`package.json:63`,
  `supabase@^2.115.0`); `npx supabase start` works after `npm ci`.
  `supabase/config.toml` has `[db.migrations] enabled = true`, so `supabase
  start` on a fresh runner volume applies all three
  `supabase/migrations/*.sql` in order. No `supabase/seed.sql` exists.
- **`OPENROUTER_API_KEY` gate**: 13 tests in two suites
  (`tests/integration/flashcards.generate.test.ts:15`,
  `tests/integration/flashcards.input-validation.test.ts:272`) are behind
  `OPENROUTER_API_KEY ? describe : describe.skip`. The provider is always
  intercepted by `mockProvider` (`tests/integration/helpers/mock-provider.ts`),
  so any non-empty string un-skips them with no real network call.
- **Vitest CI behavior** (research Finding 6): `vitest run` auto-detects CI
  (disables watch, fails on stray `.only`) and auto-adds the `github-actions`
  reporter when `GITHUB_ACTIONS === 'true'`. No `vitest.config.ts` change
  needed.
- **Stale docs**: `AGENTS.md:29-32` ("No test framework is configured yet";
  "runs `npm ci` → `astro sync` → lint → build"), `CLAUDE.md:52-54` ("runs lint
  + build ... Requires `SUPABASE_URL` and `SUPABASE_KEY` repository secrets for
  the build step"), `test-plan.md` §3 Phase 4 row (`not started`) and §6.6 (no
  Phase 4 note yet).

## Desired End State

- Every PR to `master` runs `test` (unit + components) and `test-integration`
  (integration, against a real local Supabase) as required checks.
- `deploy` runs only after `ci`, `test`, and `test-integration` all pass —
  broken tests cannot reach `master`/production.
- A superseded PR push cancels its in-flight CI run (`concurrency:
  cancel-in-progress`).
- The `test-integration` job runs all 72 integration tests (dummy
  `OPENROUTER_API_KEY`), needs no repo secrets (so it also works on fork PRs),
  and never touches the linked cloud Supabase project.
- The `deploy` job's `supabase db push` step and `SUPABASE_ACCESS_TOKEN` secret
  are unchanged.
- `AGENTS.md`, `CLAUDE.md`, and `test-plan.md` (§3 Phase 4 row, §5 gate table
  context, §6.6) describe CI accurately.

### Key Discoveries:

- The CI job must **export `SUPABASE_URL` + `SUPABASE_KEY`** for the handlers —
  `applyLocalEnv()` only sets `SUPABASE_URL`, never `SUPABASE_KEY`
  (`tests/integration/helpers/local-env.ts:34-38`; research Finding 3). Derive
  both from `npx supabase status -o env`, mirroring the harness's
  `PUBLISHABLE_KEY ?? ANON_KEY` fallback (`local-env.ts:36`).
- Local Supabase anon/service-role JWTs are **well-known static values, not
  secrets** — never a GitHub or Workers secret
  (`context/archive/2026-09-09-testing-critical-path-coverage/plan.md:310-315`).
- Any `ci.yml` rewrite must **preserve** the `deploy` job's `supabase db push
  --project-ref "$REF" --yes` step + its `SUPABASE_ACCESS_TOKEN` secret
  (`context/foundation/lessons.md:9-10`).
- `unit` + `components` have zero external deps — safe to run right after
  `npm ci` + `npx astro sync` (research Finding 2).
- `npx astro sync` is needed in the test jobs too so the `astro:*` virtual
  modules/types resolve when Vitest builds config through `getViteConfig()`.
- CI verification of a workflow change is inherently "push a branch and watch
  the run" — there is no local GitHub Actions runner configured. Automated
  verification is limited to YAML validity + running the underlying commands
  locally; the run itself is a manual-verification step.

## What We're NOT Doing

- **Not** adopting `@cloudflare/vitest-pool-workers` / the workerd runtime.
  Parked "for Phase 4" in Phase 1 (`test-plan.md:322-324`), but that is an
  environment migration, not a gate; it stays a separate future change. This
  phase wires the existing Node-environment projects as-is.
- **Not** changing any application source, `vitest.config.ts`, or
  `supabase/migrations/`. No new production or test code — only the workflow,
  optionally one `package.json` script, and docs.
- **Not** adding an e2e tier or any new test (test-plan §4: e2e "not currently
  justified").
- **Not** touching the `deploy` job's `supabase db push` step, its
  `SUPABASE_ACCESS_TOKEN` secret, the `wrangler-action` step, or the
  `push`→`master` guard.
- **Not** adding a `.env.test` / `.dev.vars.ci` file, and **not** adding any
  local-Supabase key to GitHub or Workers secrets.
- **Not** running the integration suite as a matrix/shard (it is
  `fileParallelism: false` against one shared DB — sharding within a runner
  gains nothing).
- **Not** wiring CI to run `npm run lint` / `npm run build` a second time in
  the test jobs — the `ci` job already owns those gates.

## Implementation Approach

Three phases, each independently shippable and each verifiable by a branch push:

1. **Fast test job + deploy gating + concurrency.** The certain, cheap win —
   `unit` + `components` need nothing but `npm ci`. Add the `test` job, the
   workflow-level `concurrency` block, and extend `deploy`'s `needs`.
2. **Integration test job.** The risky part, isolated: a `test-integration` job
   that runs `npx supabase start`, derives the handler env from `supabase
   status -o env`, sets `OPENROUTER_API_KEY: ci-dummy`, runs `npm run
   test:integration`, and stops the stack on `always()`. Extend `deploy`'s
   `needs` again.
3. **Doc sync.** Once both CI jobs are confirmed green on a branch, correct
   `AGENTS.md`, `CLAUDE.md` §CI, and `test-plan.md` (§3 Phase 4 row + a §6.6
   Phase 4 note).

## Critical Implementation Details

- **`SUPABASE_KEY` must reach the route handlers or every integration test
  500s.** After `npx supabase start`, read the running stack's URL + anon key
  and write them to `$GITHUB_ENV` before `npm run test:integration`. Mirror the
  harness's key preference (`PUBLISHABLE_KEY ?? ANON_KEY`,
  `tests/integration/helpers/local-env.ts:36`). One workable form:

  ```bash
  eval "$(npx supabase status -o env)"
  {
    echo "SUPABASE_URL=$API_URL"
    echo "SUPABASE_KEY=${PUBLISHABLE_KEY:-$ANON_KEY}"
  } >> "$GITHUB_ENV"
  ```

  (`supabase status -o env` emits `API_URL`, `ANON_KEY`, `PUBLISHABLE_KEY`,
  `SERVICE_ROLE_KEY`, … — the same fields `local-env.ts` reads from `-o json`.
  If a field name differs on the installed CLI, `--override-name api.url=...`
  is the fallback.) These values are static local defaults — safe in plain
  YAML/logs, **not** secrets.

- **`setup.ts` ordering already handles `SUPABASE_URL`, but export it anyway.**
  `applyLocalEnv()` runs before the first `astro:env/server` import
  (`tests/integration/setup.ts:13,19`), so `SUPABASE_URL` would resolve even
  without the job-level export — but exporting it explicitly also satisfies the
  `setup.ts:20-25` mismatch guard cleanly and documents intent. `SUPABASE_KEY`
  has no such fallback and **must** be exported.

- **Do not set `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` at job
  level.** `applyLocalEnv()` sets those from `supabase status` at test runtime
  (`local-env.ts:34-38`); a stale job-level value could shadow the real one.
  Only `SUPABASE_URL`, `SUPABASE_KEY`, and `OPENROUTER_API_KEY` belong in the
  job env.

- **`supabase start` service trim is optional and needs a fallback.** The suite
  only exercises Postgres + Auth + PostgREST via Kong. `npx supabase start -x
  <unused services>` (candidates: `imgproxy`, `studio`, `edge-runtime`,
  `realtime`, `storage`, `vector`, `pooler`) cuts cold-start time. Only adopt it
  if `supabase status` + the `setup.ts` health check still pass; if a trimmed
  start is flaky, fall back to a bare `npx supabase start`. Correctness must not
  depend on the trim.

- **`concurrency` at workflow level**, keyed on `${{ github.workflow }}-${{
  github.ref }}` with `cancel-in-progress: true`, so a new push to a PR branch
  cancels the in-flight (Supabase-heavy) run rather than queuing it.

## Phase 1: Fast Test Job + Deploy Gating

### Overview

Add a Docker-free `test` job running `unit` + `components`, add a workflow-level
`concurrency` block, and make `deploy` depend on `test`. This half needs no
Supabase and no secrets — a clean, low-risk first landing.

### Changes Required:

#### 1. `test` job

**File**: `.github/workflows/ci.yml`

**Intent**: Run the two Docker-free Vitest projects on every push/PR to
`master`, in parallel with the existing `ci` (lint+build) job, so a broken
unit/hook test blocks merge and deploy.

**Contract**: New job `test`, `runs-on: ubuntu-latest`, triggered by the
existing `on:` block (no `on:` change). Steps mirror the `ci` job's preamble:
`actions/checkout@v4` → `actions/setup-node@v4` (`node-version: 22`, `cache:
npm`) → `npm ci` → `npx astro sync` → `npm test` → `npm run test:components`.
No `env:` block (these projects read no env). Does **not** re-run lint or build.

#### 2. Workflow-level `concurrency`

**File**: `.github/workflows/ci.yml`

**Intent**: A newer push to the same ref supersedes an in-flight run instead of
queueing behind it — matters once the expensive integration job exists (Phase
2), added here so it's in place first.

**Contract**: Top-level `concurrency:` key (sibling of `on:` / `jobs:`):
`group: ${{ github.workflow }}-${{ github.ref }}`, `cancel-in-progress: true`.

#### 3. `deploy` depends on `test`

**File**: `.github/workflows/ci.yml`

**Intent**: Deploy must not run if the fast tests fail.

**Contract**: `deploy.needs` changes from `ci` to `[ci, test]`. Nothing else in
`deploy` changes — the `if:` guard, `supabase db push` step,
`SUPABASE_ACCESS_TOKEN`, `wrangler-action` step all stay verbatim.

### Success Criteria:

#### Automated Verification:

- `.github/workflows/ci.yml` is valid YAML (parses with a YAML linter / `python
  -c 'import yaml,sys;yaml.safe_load(open("...")) ' ` or equivalent) and every
  job has `runs-on` + `steps`
- `npm test` exits 0 locally (43 unit tests)
- `npm run test:components` exits 0 locally (6 component tests)
- `npm run lint` and `npm run build` still pass locally (unchanged, sanity)
- `git grep -n "needs: \[ci, test\]" .github/workflows/ci.yml` matches the
  `deploy` job

#### Manual Verification:

- Push the change on a branch / open a PR to `master`: the `test` job appears,
  runs green, and completes in well under a minute
- On that PR, `deploy` does not run (PR guard) and on a subsequent push to
  `master` `deploy` is shown waiting on `ci` **and** `test`
- Pushing a second commit to the PR branch cancels the first run
  (`concurrency`)

**Implementation Note**: After automated verification passes, pause for human
confirmation of the branch-push manual checks before starting Phase 2.

---

## Phase 2: Integration Test Job

### Overview

Add a `test-integration` job that stands up a local Supabase stack, supplies the
handler env the harness doesn't, runs the 72-test integration suite, and gates
`deploy`. This is the phase with real unknowns (Supabase-in-CI cold start,
env derivation) — isolated so a problem here doesn't hold up Phase 1.

### Changes Required:

#### 1. `test-integration` job

**File**: `.github/workflows/ci.yml`

**Intent**: Run `vitest run --project integration` against a real local Supabase
in CI, so cross-user / RLS / auth-gating / study-loop / generate / input-
validation regressions block merge and deploy.

**Contract**: New job `test-integration`, `runs-on: ubuntu-latest`, same
trigger. Steps:
1. `actions/checkout@v4`
2. `actions/setup-node@v4` (`node-version: 22`, `cache: npm`)
3. `npm ci`
4. `npx astro sync`
5. `npx supabase start` (optionally `-x <unused services>` per Critical
   Implementation Details, with a bare-`start` fallback)
6. Derive env → `$GITHUB_ENV`: `SUPABASE_URL` and `SUPABASE_KEY` from `npx
   supabase status -o env` (see the snippet in Critical Implementation Details)
7. `npm run test:integration` with job/step `env:` `OPENROUTER_API_KEY:
   ci-dummy` (any non-empty non-secret string)
8. `npx supabase stop` in a step with `if: always()` (cleanup hygiene)

No repo secrets are referenced. `fileParallelism: false` keeps the suite
serial; expect ~1-4 min for `supabase start` + ~20-30 s for the tests.

#### 2. `deploy` depends on `test-integration`

**File**: `.github/workflows/ci.yml`

**Intent**: Deploy must not run if integration tests fail.

**Contract**: `deploy.needs` becomes `[ci, test, test-integration]`. No other
`deploy` change.

### Success Criteria:

#### Automated Verification:

- `.github/workflows/ci.yml` still parses as valid YAML; `test-integration` has
  `runs-on` + `steps`
- Local repro of the job's env derivation works: with a local stack up,
  `eval "$(npx supabase status -o env)"; echo "${API_URL:?} ${ANON_KEY:?}"`
  prints non-empty values
- Locally, exporting `SUPABASE_URL` + `SUPABASE_KEY` (from `supabase status`)
  and `OPENROUTER_API_KEY=ci-dummy`, then `npm run test:integration` exits 0
  with **72 passed, 0 skipped**
- `git grep -n "needs: \[ci, test, test-integration\]" .github/workflows/ci.yml`
  matches the `deploy` job
- The `deploy` job's `supabase db push --project-ref "$REF" --yes` step and
  `SUPABASE_ACCESS_TOKEN` env are byte-for-byte unchanged (`git diff` on
  `deploy` shows only the `needs:` line)

#### Manual Verification:

- Branch push / PR: `test-integration` runs green, reports 72 passing tests, no
  `test+cpc-*` user leakage (job ends cleanly)
- The job succeeds with **no** repo secrets available (confirming fork-PR
  compatibility) — e.g. observable from the run logs / a fork PR if feasible
- On a push to `master`, `deploy` is shown gated on all three of `ci`, `test`,
  `test-integration`
- Total `test-integration` wall time is acceptable (note it; if `supabase
  start` dominates, the service trim / a cache step is a follow-up
  optimization, not a blocker)

**Implementation Note**: After automated verification passes, pause for human
confirmation of the branch-push manual checks before starting Phase 3.

---

## Phase 3: Documentation Sync

### Overview

With both CI jobs confirmed green, update the repo's own descriptions of CI so
they match reality. Small prose edits only.

### Changes Required:

#### 1. `AGENTS.md`

**File**: `AGENTS.md`

**Intent**: Remove the stale "no test framework" claim and add the test jobs to
the CI description.

**Contract**: In the "Testing, commits & CI" section (`AGENTS.md:29-32`):
replace "No test framework is configured yet; if you add one, wire it into CI
before relying on it." with a line stating Vitest is configured (`unit` /
`components` / `integration` projects) and CI runs it. Update the CI-pipeline
sentence to include the `test` and `test-integration` jobs alongside lint +
build. Keep the `SUPABASE_URL`/`SUPABASE_KEY` repo-secret note (still true for
`build`).

#### 2. `CLAUDE.md`

**File**: `CLAUDE.md`

**Intent**: The `## CI` section says "runs lint + build" — add the test jobs.

**Contract**: In `## CI` (`CLAUDE.md:52-54`): state that CI also runs the
Vitest suite — a Docker-free `test` job (`unit` + `components`) and a
`test-integration` job that boots a local Supabase via `npx supabase start`
(no secrets; local static keys). Note `deploy` depends on `ci`, `test`, and
`test-integration`. Optionally add the `npm test` / `test:components` /
`test:integration` script names to `## Commands`.

#### 3. `context/foundation/test-plan.md`

**File**: `context/foundation/test-plan.md`

**Intent**: Mark rollout Phase 4 done and record the CI wiring in §6.6.

**Contract**:
- §3 rollout table (`test-plan.md:94`): Phase 4 row `Status` `not started` →
  `complete` (per the §3 status vocabulary literals), `Change folder` →
  `context/changes/quality-gates-wiring/` (or its archived path once archived —
  leave as the active path here; `/10x-archive` rewrites it).
- §6.6: append a **"Phase 4 — Quality-gates wiring"** note covering: the two new
  jobs (`test` = unit+components no-Docker; `test-integration` = `npx supabase
  start` + env derived from `supabase status -o env` + `OPENROUTER_API_KEY:
  ci-dummy`), `deploy` now `needs: [ci, test, test-integration]`, no repo
  secrets needed for tests (fork-PR safe), local keys never a secret, and the
  `deploy` `supabase db push` step left intact.
- Do not touch §1–§5 tables' semantics or other §6 subsections (the §5 "test
  suite in CI ... required after §3 Phase 4" row is now simply satisfied — no
  edit needed).

### Success Criteria:

#### Automated Verification:

- `git grep -n "Vitest" AGENTS.md` matches (stale "no test framework" line gone:
  `! git grep -n "No test framework is configured yet" AGENTS.md`)
- `git grep -n "test-integration" CLAUDE.md context/foundation/test-plan.md`
  matches in both files
- `test-plan.md` §3 Phase 4 row no longer contains `not started`
- `npm run lint` still passes (markdown isn't linted by eslint, but run the
  full gate anyway); `npm run build` still passes

#### Manual Verification:

- Read-through: `AGENTS.md`, `CLAUDE.md` §CI, and `test-plan.md` §3/§6.6
  accurately describe the shipped workflow; no remaining "lint + build only"
  phrasing
- `test-plan.md` §6.6 Phase 4 note is consistent in tone/detail with the
  Phase 1-3 notes

**Implementation Note**: This is the final phase. After it, run the defensive
pending scan, flip `change.md` → `implemented`, and commit the epilogue.

---

## Testing Strategy

There is no application code under test in this change; "testing" here means
verifying the CI workflow behaves.

### Local (automated, pre-push):

- YAML validity of `.github/workflows/ci.yml`
- `npm test`, `npm run test:components` green (Phase 1)
- Local repro of the Phase-2 env derivation + `npm run test:integration` green
  with 72/0 (requires `npx supabase start` locally — Docker)
- `git diff` on the `deploy` job shows only `needs:` changed across all phases

### CI (manual, per phase — the real proof):

1. Push the phase on a branch, open/refresh a PR to `master`.
2. Confirm the new job(s) appear as checks, run, and go green.
3. Confirm `deploy` (on a `master` push) is gated on the expected `needs:` set.
4. Phase 2 only: confirm 72 tests run, the job needs no secrets, and the stack
   is stopped cleanly.

### Manual Testing Steps:

1. On a throwaway branch, introduce a deliberately failing assertion in a
   `unit` test, push — confirm `test` goes red and `deploy` would be blocked;
   revert.
2. Phase 2: temporarily unset the `SUPABASE_KEY` export line, push — confirm
   `test-integration` fails with route 500s (proving the export is load-
   bearing); restore.
3. Phase 2: confirm a second rapid push to the branch cancels the first run.

## Performance Considerations

- `test` job: ~30-60 s (npm ci + astro sync + 49 fast tests).
- `test-integration` job: dominated by `npx supabase start` image pull +
  boot (~1-4 min cold on `ubuntu-latest`), then ~20-30 s for 72 serial tests.
  `concurrency: cancel-in-progress` prevents stacked runs. If start time proves
  painful, the `-x` service trim (Critical Implementation Details) or an
  `actions/cache` step for Docker images is a follow-up optimization — out of
  scope for the first landing.
- Both test jobs run in parallel with `ci` (lint+build), so wall-clock CI time
  grows by roughly `max(test-integration, ci) - ci`, not the sum.

## Migration Notes

- No schema changes; `supabase/migrations/` untouched — the `lessons.md`
  "push migrations to cloud" rule does not apply to this change. It **does**
  constrain the workflow edit: the `deploy` job's `supabase db push
  --project-ref "$REF" --yes` step and `SUPABASE_ACCESS_TOKEN` secret must
  survive verbatim (`context/foundation/lessons.md:9-10`). Verified by the
  Phase-2 automated check on the `deploy` diff.
- No new dependencies (the `supabase` CLI is already a devDependency). No new
  tracked files. Possibly one convenience `package.json` script
  (`test:ci` running all three projects) — optional, decide during Phase 1; not
  required by any phase.
- New repo secrets required: **none.** The test jobs use only the static local
  Supabase values and a dummy OpenRouter key.

## References

- Research: `context/changes/quality-gates-wiring/research.md`
- Change brief: `context/changes/quality-gates-wiring/change.md`
- Current workflow: `.github/workflows/ci.yml`
- Split-brain env contract: `tests/integration/setup.ts:12-30`,
  `tests/integration/helpers/local-env.ts:18-38`, `src/lib/supabase.ts:3-8`
- OpenRouter gate: `tests/integration/flashcards.generate.test.ts:15`,
  `tests/integration/flashcards.input-validation.test.ts:272`,
  `tests/integration/helpers/mock-provider.ts`
- Migration-push rule: `context/foundation/lessons.md:5-11`
- Rollout tracking: `context/foundation/test-plan.md` §3, §5, §6.6
- Local-key handling precedent:
  `context/archive/2026-09-09-testing-critical-path-coverage/plan.md:308-315`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.
> Do not rename step titles. See `.github/skills/10x-plan/references/progress-format.md`.

### Phase 1: Fast Test Job + Deploy Gating

#### Automated

- [x] 1.1 `.github/workflows/ci.yml` is valid YAML and every job has `runs-on` + `steps` — f2831a8
- [x] 1.2 `npm test` exits 0 locally (43 unit tests) — f2831a8
- [x] 1.3 `npm run test:components` exits 0 locally (6 component tests) — f2831a8
- [x] 1.4 `npm run lint` and `npm run build` still pass locally — f2831a8
- [x] 1.5 `git grep -n "needs: \[ci, test\]" .github/workflows/ci.yml` matches the `deploy` job — f2831a8

#### Manual

- [x] 1.6 On a branch/PR to `master`, the `test` job appears, runs green, and finishes in under a minute (PR #8: `test` pass 1m2s) — f2831a8
- [x] 1.7 `deploy` is shown waiting on `ci` and `test` (on a `master` push); does not run on the PR (PR #8: `deploy` skipping; merge run 34447043314: `deploy` ran after `ci`+`test`+`test-integration`) — f2831a8
- [ ] 1.8 A second push to the PR branch cancels the first run (`concurrency`) — NOT exercised; `concurrency` is now gated to `pull_request` events (F1 fix, 7d70d64) and is standard GH Actions behaviour

### Phase 2: Integration Test Job

#### Automated

- [x] 2.1 `.github/workflows/ci.yml` still parses as valid YAML; `test-integration` has `runs-on` + `steps` — 616a74a
- [x] 2.2 Local repro: with a local stack up, `eval "$(npx supabase status -o env)"` yields non-empty `API_URL` / `ANON_KEY` — 616a74a
- [x] 2.3 Locally, exporting `SUPABASE_URL` + `SUPABASE_KEY` from `supabase status` and `OPENROUTER_API_KEY=ci-dummy`, `npm run test:integration` exits 0 with 72 passed, 0 skipped — 616a74a
- [x] 2.4 `git grep -n "needs: \[ci, test, test-integration\]" .github/workflows/ci.yml` matches the `deploy` job — 616a74a
- [x] 2.5 `git diff` on the `deploy` job shows only the `needs:` line changed (the `supabase db push` step + `SUPABASE_ACCESS_TOKEN` untouched) — 616a74a

#### Manual

- [x] 2.6 Branch/PR: `test-integration` runs green, reports 72 passing tests, job ends cleanly (no `test+cpc-*` leakage) (PR #8 + merge runs: `Tests 72 passed`, `Stopped supabase local development setup`) — 616a74a
- [x] 2.7 The job succeeds with no repo secrets available (fork-PR compatible) (job references zero `secrets.*`; ran green) — 616a74a
- [x] 2.8 On a `master` push, `deploy` is gated on `ci`, `test`, and `test-integration` (merge run 34447043314: `deploy` success only after all three; `Push Supabase migrations` + `wrangler deploy` OK) — 616a74a
- [x] 2.9 `test-integration` wall time is noted and acceptable (~3m; `supabase start` ~1m12s image pull, tests ~26s; Docker-image cache is the noted follow-up) — 616a74a

### Phase 3: Documentation Sync

#### Automated

- [x] 3.1 `git grep -n "Vitest" AGENTS.md` matches and `! git grep -n "No test framework is configured yet" AGENTS.md` — ff92cb5
- [x] 3.2 `git grep -n "test-integration" CLAUDE.md context/foundation/test-plan.md` matches in both files — ff92cb5
- [x] 3.3 `test-plan.md` §3 Phase 4 row no longer contains `not started` — ff92cb5
- [x] 3.4 `npm run lint` and `npm run build` still pass — ff92cb5

#### Manual

- [x] 3.5 Read-through: `AGENTS.md`, `CLAUDE.md` §CI, `test-plan.md` §3/§6.6 accurately describe the shipped workflow; no "lint + build only" phrasing remains — ff92cb5
- [x] 3.6 `test-plan.md` §6.6 Phase 4 note is consistent in tone/detail with the Phase 1-3 notes — ff92cb5
