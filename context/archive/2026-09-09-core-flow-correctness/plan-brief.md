# Core-Flow Correctness (Test Rollout Phase 2) — Plan Brief

> Full plan: `context/changes/core-flow-correctness/plan.md`
> Research: `context/changes/core-flow-correctness/research.md`

## What & Why

Rollout Phase 2 of `context/foundation/test-plan.md`: add automated coverage for the two
must-have flows — **Risk #2** (FSRS review-session scheduling recalculates due-dates
incorrectly — card stuck, skipped, or resurfaces in the same session) and **Risk #3** (the
AI generation pipeline fails or returns malformed output without a clear error). Both flows
work today; neither has a single test.

## Starting Point

FSRS scheduling lives entirely in `src/lib/services/reviews.ts` — `ts-fsrs@5.4.2` (fuzz off
by default → deterministic) plus a thin row↔`Card` mapping and an optimistic-concurrency
guard. `enable_short_term: false` is the load-bearing choice behind "no in-session
requeue". AI generation lives in `src/lib/services/flashcard-generation.ts` — one bare
`fetch`, seven error branches all flattened to HTTP 502, no timeout/retry. The Phase-1
harness (`tests/integration/helpers/`, `unit`/`integration` Vitest projects) is available;
`seedFlashcard` can't yet set `due`/FSRS columns.

## Desired End State

`npm test` runs the Phase-1 unit suite plus `reviews.test.ts` and
`flashcard-generation.test.ts` (green, no deps). `npm run test:integration` runs the
Phase-1 suites plus `flashcards.review.test.ts` and `flashcards.generate.test.ts` (green,
local Supabase). The suite fails loudly if a rating stops moving `due` in the right
direction, a rated card can resurface in-session, `enable_short_term` is flipped, the
concurrency guard breaks, due-list ordering drifts, any generation error branch stops
mapping to a clear 502, or the generate route stops inserting `pending` rows.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| FSRS assertion style | Structural only — ordering `Again<Hard<Good<Easy`, `reps +1`, `state 0→2`, `due > now`, `scheduled_days ≥ 1` | ts-fsrs enforces these by construction; exact `due`/stability values are parameter-dependent and would break on a minor bump (oracle problem) | Research |
| Risk #2 layers | Unit (mapping + structural scheduler props + guard-contract, fixed `now`) **and** integration (real DB read-back) | Matches test-plan Risk #2 "unit + integration"; the unit tier is the fast/bump-resilient layer — Phase 2 re-covers the same regressions through the real path (deliberate overlap) | Plan |
| Scheduling internals visibility | Add `export` (with `// exported for unit tests` comments) to `toFsrsCard` / `toRowUpdate` / `scheduler` in `reviews.ts` | Lets the unit layer test the real functions and real configured scheduler; visibility-only, zero behavior change; diverges from private-internals sibling `flashcards.ts` — comment marks intent | Plan (review) |
| Concurrency-guard proof | Deterministic Phase-1 unit test (stub `supabase` arg → `recordReview` returns `null`); Phase-2 `Promise.all` race is best-effort only | The true race may not interleave under Vitest (both handlers could return 200) — the contract needs a deterministic proof | Plan (review) |
| `seedFlashcard` gap | Extend it with `due`/`state`/`reps`/`stability`/`id` overrides (options object) | Due-list-ordering and mid-schedule fixtures become one-liners; Phase 3 will want it; existing callers unaffected | Plan |
| Risk #3 test level | Exhaustive unit on the service (7 branches + happy) + **one** route integration smoke | Branch coverage is fast and DB-free where it belongs; the smoke proves route wiring (502 passthrough, `pending` insert) without re-testing every branch over HTTP | Plan |
| Risk #3 mock seam | `vi.spyOn(globalThis, "fetch")`; no `msw`. `vi.mock("astro:env/server")` **only in the unit test** (not the route smoke — it would null `SUPABASE_*` and 500 the DB path) | One hard-coded URL, one call site; the smoke relies on the real `.dev.vars` `OPENROUTER_API_KEY` | Research + review |
| "times out" clause | Document the gap, test current behavior (rejected `fetch` → "Failed to reach the AI provider" → 502) | No `AbortController` exists; adding one is a separate change, not a coverage phase | Research + user |
| Cross-flow generate→review test | Not included | Each risk's suite stays self-contained; the `pending`→`accepted` seam is documented, not a top risk | Plan |
| Risk #2 edge cases | Second-review "Again" (lapses +1), concurrency race (1×200/1×404), due-list ordering tie | Kill the "only Good, never Again" anti-pattern; lock in the prior concurrency fix (F1) and ordering fix (F3), both only ever manually verified | Plan |

## Scope

**In scope:**
- `+export` on 3 symbols in `src/lib/services/reviews.ts` (visibility only)
- `src/lib/services/reviews.test.ts` — mapping round-trip, structural scheduler props, `enable_short_term` guard, second-review "Again", concurrency-guard contract (stub `supabase` arg)
- `tests/integration/helpers/db.ts` — schedule-column overrides in `seedFlashcard`
- `tests/integration/flashcards.review.test.ts` — rate→read-back→leaves-due-list (Good + Again), direction across ratings, second-review lapses, best-effort concurrency race, ordering tie
- `src/lib/services/flashcard-generation.test.ts` — 7 error branches + happy path
- `tests/integration/flashcards.generate.test.ts` — route smoke: 201/`pending`, 502 passthrough, 400 bad input, 401 no-session
- `test-plan.md` §6.4 + §6.6 Phase-2 note

**Out of scope:**
- Adding an `AbortController`/timeout/retry to generation
- Cross-flow generate→accept→review test
- `review.astro` page rendering
- "not-yet-due card is still reviewable" test (accepted gap, impl-review F4)
- Risks #1/#4/#5/#6; CI wiring; `@cloudflare/vitest-pool-workers`
- Asserting exact `due`/`stability`/`difficulty` values

## Architecture / Approach

Three phases, mirroring the Phase-1 rollout shape (unit → integration → next concern),
Docker only from Phase 2. Phase 1: export the scheduling internals, unit-test the mapping
and the real scheduler's structural behavior with a fixed `now`. Phase 2: extend
`seedFlashcard`, then drive `recordReview` / `getDueFlashcards` against real local Supabase
for the study-loop behavior. Phase 3: spied-`fetch` unit tests for every generation branch,
one route integration smoke (mocks `fetch` only — no env mock), cookbook fill-in. The
`integration` project mocks `fetch` for the first time in Phase 3 — `restoreMocks`
discipline, verified not to bleed across files.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Risk #2 unit | Mapping round-trip + structural scheduler props + `enable_short_term` guard + guard-contract, Docker-free | Choosing structural-only assertions that still catch real regressions (mitigated: ts-fsrs enforces the orderings by construction) |
| 2. Risk #2 integration | Rate→read-back→leaves-due-list, direction, second-review "Again", best-effort race, ordering tie | `seedFlashcard` extension rippling to Phase-1 callers (mitigated: options object, additive) |
| 3. Risk #3 | 7 branches + happy (unit) + route smoke (201/`pending`, 502, 401) + cookbook | First `fetch` spy in the `integration` project — must not leak across files |

**Prerequisites:** Docker + `npx supabase start` for Phases 2–3. No new dependencies.
**Estimated effort:** ~2–3 sessions across 3 phases.

## Open Risks & Assumptions

- The concurrency-guard contract is proven by the Phase-1 deterministic unit test; the
  Phase-2 `Promise.all` race is best-effort (asserts the weaker `reps === 1` invariant when
  it does not interleave) and never fails the run.
- Exporting `scheduler` assumes the `fsrs()` return value is effectively stateless (it is —
  ts-fsrs schedulers hold only config).
- Structural assertions are pinned to ts-fsrs `^5.4.2`; a major bump could change even the
  structural guarantees and would require re-grounding.
- The Phase-3 route smoke depends on `.dev.vars` carrying a real `OPENROUTER_API_KEY`
  (`describe.skip` with a clear message if absent).

## Success Criteria (Summary)

- `npm test` green with no external services; `npm run test:integration` green with local
  Supabase; both Phase-1 suites still pass.
- Breaking any one control — `enable_short_term`, the `.eq("updated_at")` guard, a
  generation error branch, the `status:"pending"` insert — turns exactly one test red.
- The "no in-session requeue" guarantee (including for "Again") and the 7-branch generation
  error taxonomy both have executable coverage for the first time.
