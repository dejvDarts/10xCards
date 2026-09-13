<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Full generate → accept → study journey E2E coverage

- **Plan**: context/changes/full-journey-e2e-coverage/plan.md
- **Scope**: Phase 1 of 1 (full plan)
- **Date**: 2026-09-13
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | WARNING |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Findings

### F1 — plan.md's Contract text no longer matches the shipped test

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/full-journey-e2e-coverage/plan.md:76, 42, 75
- **Detail**: The plan's Contract says the test signs in "through the real `/auth/signin` form (same sequence as `seed.spec.ts:52-58`)" and its "What We're NOT Doing" list says "this spec signs in through the real UI each run, like `seed.spec.ts`." The shipped test (`tests/e2e/full-journey.spec.ts:98-101`) instead calls `signInViaCookie(context, user, baseURL)` (added in commit `3e3c50c`, hardened in `82027db`) — no `/auth/signin` round trip at all. Separately, the plan's mocked-response bullet (line 75) specifies a 5-field body (`id, front, back, user_id, status`); the shipped mock (`full-journey.spec.ts:69-89`) now returns the full `Flashcard` shape (adds `source_text`, `due`, `stability`, `difficulty`, `scheduled_days`, `learning_steps`, `reps`, `lapses`, `state`, `last_review`), per `82027db`. Both changes are deliberate, code-reviewed improvements, and both are already cross-referenced elsewhere (`context/foundation/test-plan.md` §6.3, `AGENTS.md` line 36, and the two commits' own messages) — but `plan.md` itself was never amended, so it's now a stale record of what the test actually does.
- **Fix**: Update `plan.md`'s Contract (sign-in step + mock-body bullet) and the "What We're NOT Doing" bullet to describe `signInViaCookie` as the actual mechanism, with a one-line pointer to `test-plan.md` §6.3 for the rationale — matching how the rest of this plan already cites that section.
- **Decision**: FIXED — plan.md's Contract and "NOT Doing" sections updated to describe `signInViaCookie` and the full-`Flashcard`-shaped mock, each with a "Superseded from ..." note and a pointer to test-plan.md §6.3.

### F2 — `tests/e2e/helpers/auth.ts` not declared in the plan

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: tests/e2e/helpers/auth.ts (new file, not in plan.md's "Changes Required")
- **Detail**: The plan named exactly one file to create (`tests/e2e/full-journey.spec.ts`). This new helper (added in `3e3c50c`) was not planned, but it is a well-justified, documented evolution: it reuses existing integration-test infrastructure (`cookieHeaderFor`), carries a docstring explaining exactly when to use it vs. the real form, and was itself hardened by a later code-review pass (`82027db`) to mirror `@supabase/ssr`'s real cookie defaults. Both review sub-agents independently confirmed it introduces no security, reliability, or data-safety concern (test-only, no path to a non-local target, no hand-rolled cookie construction, cleanup via cascade delete unaffected).
- **Fix**: None required. Optionally add one line to `plan.md`'s References section noting the helper, for future readers tracing the file list.
- **Decision**: FIXED — added a References bullet noting `tests/e2e/helpers/auth.ts` as an implementation-time addition.

### F3 — Generate-route mock doesn't check HTTP method

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: tests/e2e/full-journey.spec.ts:69 (`page.route("**/api/flashcards/generate", ...)`)
- **Detail**: The route handler fulfills unconditionally for any request matching the URL, regardless of method — inconsistent with the `waitForResponse` call a few lines later (`full-journey.spec.ts:115`) which does filter on `response.request().method() === "PATCH"`. Currently harmless (the app only ever POSTs to this path), but if the route pattern is ever matched by a different verb/purpose in the future, the mock would silently return a fabricated 201 instead of failing loudly.
- **Fix**: Add `&& route.request().method() === "POST"` to the route predicate (or assert the method inside the handler) for symmetry with the adjacent PATCH check.
- **Decision**: FIXED — the handler now checks `route.request().method()` and calls `route.continue()` for any non-POST request instead of fulfilling unconditionally. Re-verified green (`npx playwright test tests/e2e/full-journey.spec.ts`).

## Notes on Success Criteria (Step 3)

- **Automated**: re-ran fresh during this review — `npx playwright test tests/e2e/full-journey.spec.ts` ✅, `npm run test:e2e` (2/2) ✅.
- **Manual**: both Progress rows (1.3 deliberate-break check, 1.4 headed run) are checked `[x]` with commit SHA `287a1ea`. Not rubber-stamped — the deliberate-break check was independently re-performed and re-verified during this same session's earlier `/10x-e2e` phase-end ritual (temporarily broke `getDueFlashcards`'s status filter, confirmed the spec went red at the `/flashcards/review` step, reverted, confirmed `git diff` clean and the spec green again).

## Why APPROVED despite three WARNING-verdict dimensions

Only one finding (F1) is WARNING-severity; the other two are OBSERVATION-severity. All three findings share the same character: real, but low-stakes and already substantively addressed elsewhere (in code, in `test-plan.md`, in `AGENTS.md`, or in the commits' own messages) — none represent hidden risk, and both automated success criteria are green. The dimension table shows WARNING wherever any finding (even OBSERVATION-severity) touches that dimension, per this skill's own dimension-verdict rules; that is a stricter signal than the overall verdict, which weighs finding severity.
