# Full generate → accept → study journey E2E coverage — Implementation Plan

## Overview

Add one new Playwright spec, `tests/e2e/full-journey.spec.ts`, proving `context/foundation/test-plan.md` Risk #7: a user can generate an AI flashcard proposal, accept it, and reach a study session where it is immediately ratable — the promotion seam between three phases (generation, acceptance, FSRS scheduling) that were each tested in isolation and never bridged.

## Current State Analysis

- The `pending → accepted` seam is entirely the `flashcards.status` column. FSRS fields (`due`, `stability`, `state`, etc.) are set once, at row-creation time, by DB column defaults (`supabase/migrations/20260906000000_add_review_state_to_flashcards.sql:6-15`) that mirror `ts-fsrs`'s `createEmptyCard()`. `PATCH /api/flashcards/[id]` (`src/pages/api/flashcards/[id].ts:50-61`) only ever writes `status`/`front`/`back`/`updated_at` — it never touches FSRS columns.
- `getDueFlashcards` (`src/lib/services/reviews.ts:47-62`) filters `status = 'accepted' AND due <= now()`. Because `due` defaults to `now()` at generation time and is never rewritten by the accept PATCH, **a freshly-accepted card is immediately due** — this is also PRD acceptance criterion US-01 ("Accepted flashcards are immediately available for study in a review session," `context/foundation/prd.md:70-74`).
- Phase 2's rollout explicitly decided **not** to build this test ("the `pending`→`accepted` seam is documented, not a top risk" — archived `context/archive/2026-09-09-core-flow-correctness/plan.md:98-99`). Risk #7 reverses that call because the PRD frames this exact journey as the product's Primary Success Criterion.
- The UI journey has no direct link from `/generate` to the study session: `/generate` (`FlashcardGenerator`) → Accept (PATCH) → Topbar "Flashcards" link → `/flashcards` (`FlashcardList`, SSR via `listFlashcards`, which already filters `status = 'accepted'` — `src/lib/services/flashcards.ts:8`) → "Study" link → `/flashcards/review` (`ReviewSession`, SSR via `getDueFlashcards`) → "Show answer" → rate.
- Navigation throughout is plain full-page `<a href>` / `<form>` (`src/components/Topbar.astro:13-29`, `src/pages/flashcards.astro:38-43`) — no SPA router — so ordinary `page.goto`/click + `expect(page).toHaveURL(...)` (the `tests/e2e/seed.spec.ts` pattern) is sufficient; no special reload handling is needed to prove state survives real navigation.
- Every test helper this spec needs already exists as plain Node code, reusable from Playwright exactly as `seed.spec.ts` already proves for two of them: `createTestUser`/`deleteTestUser`/`signedInClient` (`tests/integration/helpers/users.ts:14-53`), `applyLocalEnv`/`readLocalStatus` (`tests/integration/helpers/local-env.ts:15-38`), `seedFlashcard` (`tests/integration/helpers/db.ts:30-52`, accepts an `id` override).
- `flashcards.id` is `uuid primary key default gen_random_uuid()` (`supabase/migrations/20260903000000_create_flashcards.sql:12`) — a client-generated UUID passed as `SeedOverrides.id` is a valid insert value. `flashcards.user_id` references `auth.users(id) on delete cascade` (`...create_flashcards.sql:13`) — `deleteTestUser` cascades away any seeded flashcard automatically; no separate `resetFlashcards` call is needed in `afterEach`.
- `tests/integration/helpers/mock-provider.ts`'s `vi.spyOn(globalThis.fetch)` is confirmed **not** usable from Playwright — it mocks the Vitest process's own `fetch`, not the separate `npm run dev` server process Playwright drives. The already-made project decision (this conversation) is to mock `/api/flashcards/generate` at the browser network layer instead (`page.route`) — the browser-initiated call to our own endpoint, not the server's outbound OpenRouter call (unreachable from Playwright; documented limitation, `test-plan.md §6.3`).
- shadcn's `CardTitle` renders a plain `<div>`, not a semantic heading (`src/components/ui/card.tsx:28-30`) — `getByRole("heading", ...)` will not resolve card labels anywhere in this journey; use `getByText` for card front/back content and section labels instead.

### Key Discoveries:

- `src/components/hooks/useReviewSession.ts:13-15,54` — `remainingCount = queue.length - currentIndex`; after a successful `submitRating`, `currentIndex` increments and `isRevealed` resets. With a single-card queue, one successful rating makes `remainingCount === 0` and `isSessionComplete === true` immediately — the natural, deterministic end state for this test.
- `src/components/ReviewSession.tsx:56-64` — the session-complete/empty state renders "No cards due right now. Come back later." with a link back to `/flashcards` — this is the test's final assertion.
- `src/pages/flashcards/review.astro:12-27` and `src/pages/flashcards.astro:9-25` both perform the due/list fetch **server-side** at request time (SSR), not via a client-side `useEffect` — so navigating to either page after the accept step reflects the real DB state immediately, no client-side wait/race to account for.
- `src/components/FlashcardGenerator.tsx` proposal cards render "Accept"/"Reject" buttons and the proposal's `front`/`back` inside plain (non-labelled-by-role) textareas — read via `getByText`/`getByDisplayValue` as appropriate, following `seed.spec.ts`'s `getByRole`-first-else-`getByLabel`/`getByText` convention.

## Desired End State

A new, passing `tests/e2e/full-journey.spec.ts` that fails if the `pending → accepted → due` promotion seam breaks — verified by a deliberate-break check against `getDueFlashcards`'s status filter (Phase 1 Manual Verification) before this plan is considered done.

### Key Discoveries:

(see above — captured together with Current State Analysis to avoid duplication)

## What We're NOT Doing

- Not splitting into two tests — one `test()` covers the full journey (test-plan.md §1: "typically one test per risk," "rarely more than 1-3 per phase").
- Not exercising the Reject path or a second/third proposal in the same test — the mock returns exactly one proposal.
- Not asserting the FSRS "Again doesn't requeue in-session" behavior — that needs ≥2 seeded cards and is a separate concern from the promotion seam; this test submits "Good" only.
- Not adding an explicit assertion that a `pending`/`rejected` sibling card is excluded from the due list in this test — that already follows from `getDueFlashcards`'s existing `status = 'accepted'` filter and is left to existing/future integration coverage, not this E2E budget.
- Not adding an explicit hard `page.reload()` check — four separate full-page SSR navigations (`/generate` → `/flashcards` → `/flashcards/review`) already prove state survives real page loads; a bare reload adds cost without a new claim.
- Not building test infrastructure to stub the real OpenRouter/AI-provider boundary — that limitation is already documented (`test-plan.md §6.3`) and out of scope; this test only proves the promotion seam, not AI-failure handling (Risk #3, separately resolved in this project as "no test for now").
- Not adding a `storageState`/auth-setup Playwright project — auth is per-test via `signInViaCookie` (`tests/e2e/helpers/auth.ts`), not a shared Playwright project; see `test-plan.md` §6.3 for why this replaced the originally-planned real-UI sign-in.
- Not writing the cheaper chained-handler integration test test-plan.md's Risk #7 guidance also suggests — that remains a candidate for a future, separate change if the team wants belt-and-braces backend-only coverage; this plan is scoped to the E2E layer only.

## Implementation Approach

Seed a real `status: "pending"` flashcard row (via `seedFlashcard`, with a client-chosen `id`) before the browser ever calls `/api/flashcards/generate`, then mock that one endpoint to echo the same `id`/`front`/`back`. Every step from the Accept click onward — the real `PATCH`, the real DB write, the real SSR list/due queries, the real review POST — is completely unmocked. This keeps the mock scoped to exactly the non-deterministic/expensive AI call while the rest of the journey is genuinely end-to-end, reusing the existing `seed.spec.ts` conventions (role-based locators, state-based waits, unique per-test user, cleanup via cascade delete).

## Critical Implementation Details

### State sequencing

The seeded row's `id` and the mocked `/api/flashcards/generate` response's `flashcards[0].id` **must be the same value**, chosen client-side (e.g. `crypto.randomUUID()`) before either the seed insert or the route mock is set up. Register `page.route()` before navigating to `/generate` (Playwright routes only intercept requests made after registration). Getting this order or the id match wrong makes the later, unmocked `PATCH /api/flashcards/[id]` 404 against a row that either doesn't exist yet or has a different id than what the UI displays.

## Phase 1: Full-journey E2E spec

### Overview

Add the single new spec file proving Risk #7, following `tests/e2e/seed.spec.ts`'s conventions.

### Changes Required:

#### 1. New E2E spec

**File**: `tests/e2e/full-journey.spec.ts`

**Intent**: Prove that a user can generate an AI flashcard proposal, accept it, and immediately study/rate it in a review session — the full journey the PRD names as its Primary Success Criterion, spanning three previously-isolated test phases.

**Contract**:

- `test.describe("full generate → accept → study journey (test-plan.md Risk #7)", ...)` with one `test(...)` inside, mirroring `seed.spec.ts`'s structure.
- `test.beforeAll`: `applyLocalEnv(readLocalStatus())`.
- `test.beforeEach`: `user = await createTestUser()`; obtain `ownerClient = await signedInClient(user)`; choose a `proposalId` (`crypto.randomUUID()`); seed a `status: "pending"` row via `seedFlashcard(ownerClient, user.id, { id: proposalId, front, back })` with fixed, test-owned `front`/`back` text.
- `test.afterEach`: `await deleteTestUser(user.id)` (cascades the seeded flashcard row — no separate cleanup call).
- Inside the test: register `page.route("**/api/flashcards/generate", ...)` to fulfill the `POST` with the full `Flashcard` shape (`id, user_id, front, back, source_text, status, created_at, updated_at, due, stability, difficulty, scheduled_days, learning_steps, reps, lapses, state, last_review`, status 201) — registered before any navigation. (Superseded from an initial 5-field body during code review, to keep the mock realistic against the real endpoint's response shape.)
- Sign in via `signInViaCookie(context, user, baseURL)` (`tests/e2e/helpers/auth.ts`) — injects a real `@supabase/ssr` session cookie, skipping the `/auth/signin` UI round trip. (Superseded from an initial real-UI sign-in, same sequence as `seed.spec.ts:52-58`; this test isn't exercising the login flow itself, so `test-plan.md` §6.3 made cookie injection the default for that case.) Then:
  1. Navigate to `/generate`, fill "Source text" with ≥100 characters, click "Generate flashcards" — assert the mocked proposal's front text is visible.
  2. Click "Accept" on that proposal — this fires the real (unmocked) `PATCH /api/flashcards/{proposalId}`.
  3. Click the Topbar "Flashcards" link — assert URL `/flashcards`, "1 saved" (or the count text), and the accepted card's front text visible.
  4. Click "Study" — assert URL `/flashcards/review` and the same card's front text visible (proves the real SSR `getDueFlashcards` call sees it as due).
  5. Click "Show answer" — assert the back text is visible.
  6. Click "Good" — this fires the real `POST /api/flashcards/{proposalId}/review`; assert the session-complete message ("No cards due right now. Come back later.") is visible.
- Locators: `getByRole` for every button/link ("Generate flashcards", "Accept", "Study", "Show answer", "Good", the Topbar "Flashcards" link); `getByText` for card front/back content and the "N saved"/session-complete copy (no heading role available — `src/components/ui/card.tsx:28-30`). Use `.first()` only where Topbar + page body genuinely duplicate text, per `seed.spec.ts:67,70`'s established pattern — confirm during generation whether this journey's pages actually hit that collision (unlike the sign-in/dashboard pages `seed.spec.ts` covers, `/flashcards` and `/flashcards/review` render different body text than the Topbar, so it may not recur here).

### Success Criteria:

#### Automated Verification:

- New spec passes: `npx playwright test tests/e2e/full-journey.spec.ts`
- Full e2e suite still passes (no regression to the existing seed spec): `npm run test:e2e`

#### Manual Verification:

- Deliberate-break check: temporarily change `getDueFlashcards`'s status filter (`src/lib/services/reviews.ts:52`) so a freshly-accepted card is excluded from the due list (e.g. filter on `"pending"` instead of `"accepted"`), re-run the new spec, confirm it fails at the `/flashcards/review` step, then revert the change immediately (never commit it).
- Run the spec headed (`npx playwright test tests/e2e/full-journey.spec.ts --headed`) once and visually confirm each of the six journey steps renders as expected against the real local dev server + local Supabase.

**Implementation Note**: After this phase's automated verification passes, pause here for the human to confirm the manual deliberate-break check before committing — there is only one phase in this plan, so this is also the plan's final checkpoint.

---

## Testing Strategy

### Unit Tests:

- None — no application/production code changes in this plan.

### Integration Tests:

- None added here. Test-plan.md's Risk #7 guidance also names a cheaper chained-handler integration test (`generate` → `PATCH accept` → `getDueFlashcards`/`recordReview`) as a way to pin the backend seam alone; that is explicitly out of scope for this plan (see "What We're NOT Doing") and would be a separate future change if wanted.

### Manual Testing Steps:

1. `npx supabase start` (if not already running), then `npx playwright test tests/e2e/full-journey.spec.ts --headed` — watch the full journey execute in a real browser.
2. Perform the deliberate-break check described in Phase 1's Manual Verification.

## Performance Considerations

None — a single E2E test, no new production code path.

## Migration Notes

None — no schema or data changes.

## References

- Related research: `context/changes/full-journey-e2e-coverage/research.md`
- Similar implementation: `tests/e2e/seed.spec.ts`
- Risk definition: `context/foundation/test-plan.md` §2 Risk #7, §3 Phase 5
- Added during implementation (not originally planned): `tests/e2e/helpers/auth.ts` (`signInViaCookie`) — see impl-review F1/F2

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Full-journey E2E spec

#### Automated

- [x] 1.1 New spec passes: `npx playwright test tests/e2e/full-journey.spec.ts` — 287a1ea
- [x] 1.2 Full e2e suite still passes: `npm run test:e2e` — 287a1ea

#### Manual

- [x] 1.3 Deliberate-break check on `getDueFlashcards`'s status filter confirms the spec fails, then the break is reverted — 287a1ea
- [x] 1.4 Headed run visually confirmed against real local dev server + local Supabase — 287a1ea
