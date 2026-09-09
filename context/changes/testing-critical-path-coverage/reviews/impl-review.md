<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Critical-Path Test Coverage (Rollout Phase 1)

- **Plan**: context/changes/testing-critical-path-coverage/plan.md
- **Scope**: Phases 1–3 of 3 (full plan)
- **Date**: 2026-09-09
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Success Criteria (re-verified 2026-09-09)

| Check | Result |
|-------|--------|
| `npm test` | PASS — 16/16 (src/middleware.test.ts) |
| `npm run test:integration` | PASS — 26/26 across 3 suites |
| `npm run lint` | PASS (exit 0) |
| `npm run build` | PASS |
| Manual 1.6–1.7, 2.6–2.9, 3.5–3.7 | All executed live with observable output; no rubber-stamping |

Working tree clean except pre-existing `context/foundation/test-plan.md` (test-plan
orchestrator's `researched → planned` flip — not part of this change).

## Findings

### F1 — eslint.config.js override broader than "test globals"

- **Severity**: 🔷 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: eslint.config.js:72-84
- **Detail**: Phase 1 change #3 anticipated "add a lint override only if the flat config rejects test globals". The actual override disables five `@typescript-eslint/no-unsafe-*` rules for `tests/**` and `src/**/*.test.*` — driven by supabase-js's deliberately-loose generics, not test globals. Within the plan's contemplated "lint override" scope but broader than its literal wording, and it silences a rule family across all current and future test files.
- **Fix**: Leave as-is (the rules are genuine noise for test code interfacing with untyped query results); optionally add a one-line comment already present pointing at the reason. If tighter scoping is wanted later, narrow `files` to `tests/integration/helpers/**` where the friction actually lives.
- **Decision**: PENDING

### F2 — Harness/handler env split-brain not guarded

- **Severity**: 🔷 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/integration/setup.ts:40-46
- **Detail**: `setup.ts` sources the harness's Supabase URL/keys from `npx supabase status` (always the running local stack). The route handlers under test independently read `SUPABASE_URL`/`SUPABASE_KEY` from `astro:env/server`, resolved from `.dev.vars` at Vite-config load. If `.dev.vars` ever points somewhere other than the running local stack, the harness and the handlers target different backends — integration tests then fail with confusing auth errors rather than a clear message. Not a data-safety risk (both reads are local today), just a debuggability cliff.
- **Fix**: In `setup.ts`, after reading `status.API_URL`, assert it equals the handler-visible URL (import `SUPABASE_URL` from `astro:env/server`, or read `.dev.vars`) and throw a clear message on mismatch.
- **Decision**: PENDING

### F3 — deleteAllTestUsers is exported but never called

- **Severity**: 🔷 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: tests/integration/helpers/users.ts:32-40
- **Detail**: `deleteAllTestUsers()` (prefix-matched sweep) is implemented and exported but no test or teardown calls it — each suite does per-user `deleteTestUser` in `afterAll`. It's dead code today, though a reasonable safety net.
- **Fix**: Either wire it into a Vitest `globalTeardown` for the integration project as a belt-and-braces sweep, or delete it until needed.
- **Decision**: PENDING

### F4 — Approved plan drift (recorded for reconciliation)

- **Severity**: 🔷 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: tests/integration/setup.ts, tests/integration/helpers/db.ts, tests/integration/helpers/users.ts
- **Detail**: Two mechanism deviations from the written plan, both surfaced and approved mid-implementation: (1) Phase 2 change #2 — env comes from `npx supabase status` at runtime, not `process.env` set before handler import (Phase 1 spike showed `astro:env/server` resolves from `.dev.vars` at config load). (2) Phase 2 changes #5–#7 — seed/reset/re-read go through each user's session-scoped client, not a service-role client, because the `flashcards` migration grants privileges to `authenticated` only. Intent (real Supabase, real RLS, two real users) is unchanged; the plan document's Phase 2 change text still describes the original mechanism.
- **Fix**: Add a short "Implementation notes" addendum to `plan.md` (or leave it to `/10x-archive` to capture) recording the two mechanism changes so the plan and the code don't read as contradictory later.
- **Decision**: PENDING
