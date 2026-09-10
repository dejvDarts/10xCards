# Quality-Gates Wiring (Test Rollout Phase 4) — Plan Brief

> Full plan: `context/changes/quality-gates-wiring/plan.md`
> Research: `context/changes/quality-gates-wiring/research.md`

## What & Why

Test-rollout Phase 4: add the Vitest suite to `.github/workflows/ci.yml` as a
required PR gate, so regressions in the coverage built by Phases 1-3 (access
control, the study loop, AI generation, client-state rollback, input hardening)
can't reach `master` or production unverified. `AGENTS.md` has said it since
day one: *"if you add [a test framework], wire it into CI before relying on it."*

## Starting Point

`.github/workflows/ci.yml` has a `ci` job (lint + build) and a `deploy` job
(`needs: ci`, `push`→`master` only; runs `supabase db push` + `wrangler
deploy`). No test step, no Docker. Three Vitest projects exist and are green
locally: `unit` (43), `components` (6), `integration` (72). `unit` +
`components` have zero external dependencies; `integration` needs Docker + a
local Supabase stack.

## Desired End State

Every PR to `master` runs two new jobs — `test` (unit + components, Docker-free,
seconds) and `test-integration` (boots a local Supabase via `npx supabase
start`, runs the 72-test integration suite). `deploy` waits on `ci`, `test`, and
`test-integration`. No new repo secrets — the integration job uses the
well-known static local Supabase keys and a dummy OpenRouter key, so it works on
fork PRs too and never touches the linked cloud project.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Which projects in CI | All three (`unit` + `components` + `integration`) | Phase 4's stated goal is the full suite in CI; test-plan §5 gate row | Research |
| Job structure | Separate `test` job; `deploy` gains `needs` on it | Unverified code must not be deployable | Research |
| Fast vs. slow split | Two jobs: `test` (fast) + `test-integration` (Supabase) | "Cheapest signal first" (test-plan §1) — a broken hook test fails in seconds, integration flakes stay isolated | Plan |
| Supabase CLI in CI | `npx supabase start` (existing devDep) | Zero new supply-chain surface; version stays pinned by the lockfile | Plan |
| Handler env plumbing | Derive `SUPABASE_URL` + `SUPABASE_KEY` from `supabase status -o env` → `$GITHUB_ENV` | `applyLocalEnv()` never sets `SUPABASE_KEY`, so a bare runner 500s every route; deriving can't drift from `config.toml` | Research + Plan |
| OpenRouter key | `OPENROUTER_API_KEY: ci-dummy` in `test-integration` | Any non-empty string un-skips 13 provider-mocked tests; `mockProvider` makes no real call | Research + Plan |
| Docs | Fix `AGENTS.md` / `CLAUDE.md` §CI / `test-plan.md` §3+§6.6 in this change | Leaving them stale contradicts the gate they describe; matches Phases 1-3 | Plan |
| `@cloudflare/vitest-pool-workers` | Not now — stays a separate future change | It's an environment migration, not a gate | Plan |

## Scope

**In scope:**
- New `test` job (`npm test` + `npm run test:components`).
- New `test-integration` job (`npx supabase start` → env derivation →
  `npm run test:integration` → `supabase stop`).
- Workflow-level `concurrency: cancel-in-progress`.
- `deploy.needs` → `[ci, test, test-integration]`.
- Doc sync: `AGENTS.md`, `CLAUDE.md` §CI, `test-plan.md` §3 Phase 4 row + §6.6
  note.
- Optional: one `package.json` convenience script.

**Out of scope:**
- Any application / `vitest.config.ts` / `supabase/migrations/` change.
- `@cloudflare/vitest-pool-workers` / workerd runtime.
- e2e tier; any new test.
- Touching the `deploy` job's `supabase db push` step, its
  `SUPABASE_ACCESS_TOKEN` secret, `wrangler-action`, or the `push`→`master`
  guard.
- A `.env.test` / `.dev.vars.ci` file; adding any local key to GitHub/Workers
  secrets.
- Integration matrix/sharding; Docker-image caching (a possible follow-up).

## Architecture / Approach

`.github/workflows/ci.yml` gains two jobs beside `ci`, all three triggered by
the existing `push`/`pull_request` on `master` and all parallelisable. `test`
mirrors the `ci` job's preamble (`checkout` → `setup-node` → `npm ci` → `astro
sync`) then runs the two Docker-free projects. `test-integration` adds
`npx supabase start`, writes `SUPABASE_URL` + `SUPABASE_KEY` (from `supabase
status -o env`, mirroring the harness's `PUBLISHABLE_KEY ?? ANON_KEY` fallback)
into `$GITHUB_ENV`, sets `OPENROUTER_API_KEY: ci-dummy`, runs
`npm run test:integration`, and stops the stack on `always()`. `deploy` only
changes its `needs:` line. Verification of a workflow change is inherently a
branch push — local checks cover YAML validity + running the underlying
commands.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Fast test job + deploy gating | `test` job (unit+components), `concurrency` block, `deploy: needs: [ci, test]` | Low — zero-dependency jobs; only risk is YAML/`needs` wiring |
| 2. Integration test job | `test-integration` job (Supabase in CI), `deploy: needs: [ci, test, test-integration]` | `supabase start` cold-start time; env derivation must land `SUPABASE_KEY` or all 72 tests 500 |
| 3. Documentation sync | `AGENTS.md`, `CLAUDE.md` §CI, `test-plan.md` §3+§6.6 corrected | Low — prose only; done after both jobs are branch-verified |

**Prerequisites:** Docker + `npx supabase start` locally for the Phase-2 repro;
push access to a branch/PR against `master` to observe CI runs; existing repo
secrets unchanged (none added).
**Estimated effort:** ~1-2 sessions across 3 phases; most of the time is
branch-push iteration on the `test-integration` job.

## Open Risks & Assumptions

- **CI can't be verified locally.** No GitHub Actions runner is configured;
  each phase's real proof is a branch push. Automated criteria are YAML
  validity + the underlying commands run locally.
- **`supabase start` cold-start cost on `ubuntu-latest` is unmeasured.** If it
  dominates CI time, the `-x` service trim or an image cache is a follow-up,
  not a blocker. Correctness must not depend on the trim.
- **`supabase status -o env` field names** (`API_URL`, `ANON_KEY`,
  `PUBLISHABLE_KEY`) are assumed stable for `supabase@^2.115.0` — matches what
  `local-env.ts` already reads from `-o json`. `--override-name` is the
  fallback.
- **Fork-PR secret behavior** is assumed fine because the test jobs need no
  secrets; confirmed only by inspection until a fork PR actually runs.

## Success Criteria (Summary)

- A PR to `master` shows `ci`, `test`, and `test-integration` as checks; all
  three green on a clean branch; `test-integration` runs 72 tests, 0 skipped.
- Introducing a failing test on a branch turns the relevant job red and would
  block `deploy`.
- `deploy` (on a `master` push) is visibly gated on all three jobs; its
  `supabase db push` step is unchanged.
- `AGENTS.md`, `CLAUDE.md`, and `test-plan.md` describe CI as it now is.
