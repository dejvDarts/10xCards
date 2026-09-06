<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Spaced-Repetition Review Session (S-05)

- **Plan**: context/changes/spaced-repetition-session/plan.md
- **Scope**: Phase 1-4 of 4 (full plan)
- **Date**: 2026-09-06
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — recordReview has an unguarded read-then-write race

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/reviews.ts:67-96
- **Detail**: `recordReview` SELECTs the current Card state, computes the FSRS result in application code, then UPDATEs — with no optimistic-concurrency guard. Two concurrent submissions for the same card (double-click before the button disables, a duplicate network retry, two open tabs) both read the same stale row, and the second UPDATE silently clobbers the first's scheduling result — a lost review with no error surfaced.
- **Fix A ⭐ Recommended**: Conditional update keyed on the fetched row's `updated_at`
  - Strength: Makes the race impossible at the DB layer — a stale write matches zero rows instead of overwriting; `recordReview` already returns `null` on no-match, so callers already handle this shape (surfaces as the existing 404 path, reusable as-is).
  - Tradeoff: One extra `.eq("updated_at", fetchedRow.updated_at)` clause; a genuine double-submit now surfaces as "flashcard not found" rather than a friendlier "already reviewed" message.
  - Confidence: HIGH — standard optimistic-concurrency pattern, small diff.
  - Blind spot: None significant.
- **Fix B**: Accept the risk for MVP, note it as a known limitation
  - Strength: Zero code change; matches the app's current single-user-editing-their-own-data scale where true concurrent double-submits are rare.
  - Tradeoff: A real (if narrow) window for silently corrupting a card's schedule remains.
  - Confidence: MEDIUM — depends on how much a lost review actually matters to the product at this stage.
  - Blind spot: Haven't measured actual double-submit frequency in use.
- **Decision**: FIXED (Fix A) — added `.eq("updated_at", fetchResult.data.updated_at)` to the update chain in `recordReview`; smoke-tested that normal sequential submissions still return 200.

### F2 — Error state discards the session and forces a full reload

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/ReviewSession.tsx:23-43
- **Detail**: On any error, `ReviewSession`'s early return replaces the entire view (progress counter, current card, everything) with just the error banner, and its only recovery is `window.location.reload()`. `FlashcardList.tsx:99-118` renders the error banner alongside the existing content and offers an in-hook `retry()` with no page reload — losing the user's place in the queue here is avoidable.
- **Fix**: Render the error as a banner above the card (matching `FlashcardList`'s `{error && <banner/>}` placement) and add a retry action to `useReviewSession` that clears `error` without resetting `currentIndex`, instead of a full page reload.
- **Decision**: FIXED — error now renders as a banner alongside content; added `retry()` to `useReviewSession` (re-fetches the due-list, used for the initial-load-failure case); a mid-session `submitRating` failure leaves `currentIndex`/queue untouched so the user can just retry the same rating.

### F3 — Due-list query is unpaginated

- **Severity**: 📝 OBSERVATION
- **Dimension**: Safety & Quality (Performance)
- **Location**: src/lib/services/reviews.ts:44-59
- **Detail**: Unlike `listFlashcards` (which paginates), `getDueFlashcards` fetches every due card in one query, held entirely in client memory. This was an explicit, documented decision in the plan's own "Performance Considerations" section (small PRD data volume) — not an oversight. Flagging only so it's revisited if data volume assumptions change.
- **Decision**: ACCEPTED — no action; already a conscious plan decision for current scale.

### F4 — API doesn't enforce due-ness at submission time

- **Severity**: 📝 OBSERVATION
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/flashcards/[id]/review.ts
- **Detail**: A user could call `POST .../review` directly on a flashcard that isn't yet due (self-scoped only, RLS still prevents any cross-user access — no security issue). Not required by FR-009 or the plan; noted as a conscious gap, not a defect.
- **Decision**: ACCEPTED — no action; self-scoped, not a security issue, not required by FR-009.

## Success Criteria Verification

`npm run lint` and `npm run build` re-verified passing independently of the phase commits. All 21 Progress items are `[x]` with commit SHAs; manual items were verified with concrete evidence during Phase 3/4 (real HTTP calls against the local dev server, a real browser session with two separate signed-in users confirming cross-user isolation) — not rubber-stamped.
