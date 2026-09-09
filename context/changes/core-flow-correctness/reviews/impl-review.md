<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Core-Flow Correctness (Test Rollout Phase 2)

- **Plan**: context/changes/core-flow-correctness/plan.md
- **Scope**: Phases 1–3 of 3 (full plan)
- **Date**: 2026-09-09
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Success Criteria (re-verified 2026-09-09)

| Check | Result |
|-------|--------|
| `npm test` | PASS — 43/43 (middleware 16, reviews 15, flashcard-generation 12) |
| `npm run test:integration` | PASS — 37/37 across 5 files (auth-gating 13, cross-user 8, rls 5, review 6, generate 5) |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| test-plan.md §6.4 no "TBD" / §6.6 "Phase 2 — Core flow correctness" | PASS |
| Manual 1.5–1.6, 2.5–2.7, 3.5–3.7 | 1.5/1.6/2.6/2.7/3.7 executed live; 2.5/3.5/3.6 accepted via automated coverage + inspection (user's explicit call, recorded in commits) |

Working tree clean. 11 files changed across `2ea9fee → d827885`, all within the
plan's declared set (change folder, `test-plan.md`, `reviews.ts` +export ×3,
`db.ts` helper, 4 new test files). No unplanned files.

## Findings

### F1 — plan.md text drifted from the shipped implementation in two spots

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: plan.md — Phase 2 Changes #2 (concurrency race), Phase 1 Changes #2 (guard contract)
- **Detail**: Two descriptions in `plan.md` no longer match the code:
  (a) The Phase-2 race test's non-interleave branch is described as "asserts the
  weaker `reps === 1` invariant", but the shipped test asserts `reps === 2` —
  when the two `Promise.all` handlers run sequentially, both are legitimate
  reviews and both apply, so `reps` is 2, not 1. The implementation is correct;
  the plan wording (a leftover from plan-review F3) is wrong.
  (b) Phase-1 change #2 specifies the guard-contract stub as "`.update()…
  maybeSingle()` resolves `{ data: null }`". The shipped stub is richer — it
  tracks whether `.eq("updated_at", …)` was called and only returns `null` when
  the guard clause is present-but-stale, so *removing* the clause from
  `recordReview` now flips the test red (this is what makes manual check 2.6
  meaningful). Both changes were surfaced during implementation and are
  improvements; the plan text just wasn't reconciled.
- **Fix**: Add a short "Implementation Notes (deviations)" section to `plan.md`
  covering the two corrections, or leave it for `/10x-archive` to capture in the
  Done entry.
- **Decision**: PENDING

### F2 — generate-smoke captures `realFetch` at module load, assuming no prior fetch spy

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/integration/flashcards.generate.test.ts:14
- **Detail**: `const realFetch = globalThis.fetch.bind(globalThis)` runs at module
  evaluation. `flashcards.generate.test.ts` is the only integration file that
  mocks `fetch` today and it restores in `afterEach`, so `realFetch` is genuinely
  the platform fetch. But if a future integration file spies `globalThis.fetch`
  and fails to restore (or restores in a way Vitest defers), this file's
  `realFetch` could be captured as that spy, and the conditional
  `mockImplementation` would delegate non-OpenRouter traffic (Supabase auth) into
  it. Low probability; the file comment notes the intent but not the assumption.
- **Fix**: Capture `realFetch` inside `mockProvider` (or `beforeAll`) after
  `expect(vi.isMockFunction(globalThis.fetch)).toBe(false)`, so a poisoned global
  fails loudly instead of silently delegating.
- **Decision**: PENDING
