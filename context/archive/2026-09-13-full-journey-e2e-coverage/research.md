---
date: 2026-09-13T09:05:15Z
researcher: Claude Sonnet 5
git_commit: 9b5ec5d3513d0621b6610ef97d9ebb857002a5e7
branch: master
repository: 10xCards
topic: "Full generate → accept → study-session E2E journey (test-plan.md Risk #7)"
tags: [research, codebase, e2e, playwright, flashcards, fsrs, review-session, test-plan]
status: complete
last_updated: 2026-09-13
last_updated_by: Claude Sonnet 5
---

# Research: Full generate → accept → study-session E2E journey (Risk #7)

**Date**: 2026-09-13T09:05:15Z
**Researcher**: Claude Sonnet 5
**Git Commit**: 9b5ec5d3513d0621b6610ef97d9ebb857002a5e7
**Branch**: master
**Repository**: 10xCards

## Research Question

Ground rollout Phase 5 (`context/foundation/test-plan.md` §3, Risk #7): how should an E2E test drive the full user journey — generate AI flashcard proposals, accept one, and reach a study/review session where it can be rated — given that each leg of this journey (generation, acceptance, scheduling) was built and tested in isolation across Phases 1–3, and no cross-flow test bridges them?

**Scope decision made before research**: mock `/api/flashcards/generate` at the browser network layer (`page.route`), not the real OpenRouter call — deterministic, no dependency on a real API key, consistent with the project's "mock only what's expensive/non-deterministic" convention.

## Summary

The `pending → accepted` "promotion seam" is entirely the `status` column — FSRS scheduling fields (`due`, `stability`, `state`, etc.) are fully initialized by DB column defaults at row-creation time (mirroring `ts-fsrs`'s `createEmptyCard()`), identically whether the row is `pending` or later `accepted`. `PATCH /api/flashcards/[id]` never touches FSRS fields, so **a freshly-accepted card is immediately due** — this is also an explicit PRD acceptance criterion (US-01: "Accepted flashcards are immediately available for study in a review session"), not just an implementation detail.

The UI journey is: `/generate` (mount `FlashcardGenerator`) → POST `/api/flashcards/generate` → Accept a proposal (PATCH `/api/flashcards/[id]`) → navigate via Topbar to `/flashcards` (`FlashcardList`, shows "N saved") → click "Study" → `/flashcards/review` (mount `ReviewSession`) → "Show answer" → rate (Again/Hard/Good/Easy) → POST `/api/flashcards/[id]/review`. All navigation is plain full-page `<a href>`/`<form>` — no SPA router — so the existing `seed.spec.ts` pattern (`page.goto` / click + `expect(page).toHaveURL(...)`, no fixed waits) applies directly.

Every helper the new spec needs (`createTestUser`, `deleteTestUser`, `signedInClient`, `applyLocalEnv`/`readLocalStatus`, `seedFlashcard`/`resetFlashcards`) already exists and is plain Node code, reusable from Playwright exactly as `seed.spec.ts` already proves for the first two. There is **no shared `storageState`/auth-setup project** — every spec, including this one, signs in through the real UI form.

**The one real architectural snag, not yet solved by any existing pattern**: fully mocking (`route.fulfill`) the browser's `POST /api/flashcards/generate` returns `Flashcard` objects with IDs that were never inserted into the real DB — so the subsequent, unmocked `PATCH /api/flashcards/{id}` (Accept click) would 404 against a nonexistent row. See **Architecture Insights** below for the resolution this research recommends: pre-seed a real `status:"pending"` row via `seedFlashcard(..., { id: <chosen-uuid>, front, back })`, then have the mocked generate response echo that same id/front/back — the mock only stands in for the AI call and its own DB insert; the Accept step onward is 100% real (real PATCH, real DB, real due-list, real review).

Phase 2's rollout **explicitly decided not to build this test** ("Not writing a cross-flow generate → accept → review test... the `pending`→`accepted` seam is documented, not a top risk" — archived `plan.md:98-99`) — Risk #7 is a deliberate reversal of that call, now justified because the PRD frames this exact journey as its Primary Success Criterion.

## Detailed Findings

### The pending → accepted → due-list seam (backend)

- `PATCH /api/flashcards/[id]` (`src/pages/api/flashcards/[id].ts:19`) accepts `{status?: "accepted"|"rejected", front?, back?}` (`.strict()`, at least one field required — `[id].ts:8-17`) and writes **only** `status`/`front`/`back`/`updated_at` (`[id].ts:50-61`). It never touches any FSRS column. Ownership enforced via `.eq("user_id", user.id)` plus RLS policy `flashcards_update_own` (`supabase/migrations/20260903000000_create_flashcards.sql:38-43`).
- FSRS fields are **DB column defaults**, not app code: `supabase/migrations/20260906000000_add_review_state_to_flashcards.sql:6-15` — `due timestamptz not null default now()`, `stability/difficulty default 0`, `state default 0`, etc. — an explicit migration comment says these mirror `ts-fsrs`'s `createEmptyCard()` "so both the historical backfill and every future INSERT get correct initial state with zero application changes." The generate-route insert (`src/pages/api/flashcards/generate.ts:49-55`) sets only `user_id`/`front`/`back`/`source_text`/`status:"pending"` — every FSRS field comes from these defaults at proposal-creation time.
- `getDueFlashcards` (`src/lib/services/reviews.ts:47-62`): filters `.eq("status","accepted").lte("due", now).order("due","id")`. Called from `GET /api/flashcards/due` (`src/pages/api/flashcards/due.ts:8-27`).
- `recordReview` (`src/lib/services/reviews.ts:64-105`): re-checks `status = 'accepted'` on fetch (a pending/rejected card 404s), converts to a `ts-fsrs` `Card`, calls `scheduler.next(card, new Date(), rating)`, writes back with an optimistic-concurrency guard (`.eq("updated_at", ...)` — a concurrent review loses the race). Invoked from `POST /api/flashcards/[id]/review` (`src/pages/api/flashcards/[id]/review.ts:14-53`), `{rating: 1|2|3|4}` zod-validated.
- **A freshly-accepted card is immediately due, definitively**: `due` defaults to `now()` once, at generate-time INSERT; PATCH-to-accepted never rewrites it; `getDueFlashcards` only requires `due <= now()`, which is already true from the moment of creation. Confirmed independently by the archived Phase 2 research (`context/archive/2026-09-09-core-flow-correctness/research.md:220-224`) and by PRD acceptance criterion US-01 (`context/foundation/prd.md:70-74`: "Accepted flashcards are immediately available for study in a review session").
- `scheduler = fsrs(generatorParameters({ enable_short_term: false }))` (`reviews.ts:10`) — no in-session "Again" requeue; a card rated Again leaves the fixed due-list queue for that session (confirmed by the archived `spaced-repetition-session/plan.md:18-26` Definitions table).
- Oracle-safe FSRS assertions for a new E2E test (parameter-independent, from Phase 2's grounding): strict ordering `due(Again) < due(Hard) < due(Good) < due(Easy)`, `reps += 1`, `state 0 → 2`, `due` strictly `> now` post-review. **Never** assert an exact `due`/`stability`/`difficulty` value.

### The browser-driven UI journey

- `/generate` (`src/pages/generate.astro:17`) mounts `<FlashcardGenerator client:only="react" />`. Locators: textarea labeled "Source text" (`id="source-text"`), submit button "Generate flashcards"/"Generating" while in flight, each proposal card has "Question"/"Answer" labeled textareas plus "Reject"/"Accept" buttons (`src/components/FlashcardGenerator.tsx`, already read in full earlier this conversation).
- **There is no direct link from `/generate` or `/dashboard` to the study session.** `dashboard.astro` is a bare welcome/sign-out page with **no flashcard data at all** (`src/pages/dashboard.astro:8-30`) — don't assume it shows the accepted-card count.
- The accepted-flashcards list lives at `/flashcards` (`src/pages/flashcards.astro`), rendering `FlashcardList` — heading "Your flashcards" + "`{total}` saved" count (`FlashcardList.tsx:230-233`), each card's front/back rendered as plain text (`FlashcardList.tsx:274-278`). Empty state (`total === 0`) shows a "Generate flashcards" link and a "Create manually" button (`FlashcardList.tsx:206-224`).
- `/flashcards.astro:38-43` has the **"Study" link** → `/flashcards/review`.
- `/flashcards/review.astro` fetches due cards server-side via `getDueFlashcards` and passes them as `initialData` to `<ReviewSession client:load />` (`review.astro:40`). `useReviewSession` only re-fetches `GET /api/flashcards/due` on an explicit `retry()` (`useReviewSession.ts:30`) — the initial page load is real SSR, not a client fetch.
- `ReviewSession.tsx` locators: `CardTitle` "Question" then the card's front text; "Show answer" button (`:100-102`) reveals an "Answer" label + back text (`:76-81`); once revealed, four rating buttons "Again"/"Hard"/"Good"/"Easy" (`RATING_BUTTONS`, `:7-12, 85-98`) each POST `/api/flashcards/{id}/review`; a "{remainingCount} card(s) left in this session" counter (`:69`); empty/complete state "No cards due right now. Come back later." with a link back to `/flashcards` (`:56-64`).
  - **Caveat to verify live, not assume**: shadcn's `CardTitle` typically renders a plain `div`, not a semantic heading — `getByRole("heading", {name:"Question"})` may not resolve. Confirm the actual rendered tag via a live accessibility snapshot before locking this locator in the generated spec (per the E2E skill's browser-driven-generation discipline); `getByText(currentCard.front)` is a safe fallback.
- Navigation is **entirely full-page** — plain `<a href>` (Topbar, Study link) and a real `<form method="POST" action="/api/auth/signout">` for sign-out (`src/components/Topbar.astro:13-29`). No `astro:transitions`/view-transitions, no SPA router. `page.goto()` / click + `expect(page).toHaveURL(...)` (exactly `seed.spec.ts`'s pattern) is safe and sufficient.
- Topbar renders on every page alongside page-specific content, so duplicate-text/role collisions (e.g. two "Sign out" buttons) recur here too — `seed.spec.ts:67,70` already established the `.first()` disambiguation pattern for this.

### Reusable test infrastructure

- `tests/e2e/seed.spec.ts` is the reference pattern: `getByRole`-first locators (falling back to `getByLabel` only where no role exists, e.g. the password input), state-based `expect(...).toHaveURL/toBeVisible` waits (never `waitForTimeout`), one uniquely-identified test user per test (`beforeEach`/`afterEach`), real-UI sign-in (`getByRole("textbox",{name:"Email"})` → `getByLabel("Password",{exact:true})` → `getByRole("button",{name:"Sign in"})` → wait for the post-login redirect), `.first()` for Topbar/body duplicates.
- **Directly reusable, unmodified, as plain Node async functions** (confirmed usable from a Playwright spec exactly as `seed.spec.ts` already does for two of them):
  - `createTestUser()` / `deleteTestUser(id)` / `signedInClient(user)` — `tests/integration/helpers/users.ts:14-53`.
  - `applyLocalEnv(readLocalStatus())` — `tests/integration/helpers/local-env.ts:15-38` — must run in `beforeAll` before any of the above (they read `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` off `process.env`).
  - `seedFlashcard(ownerClient, userId, overrides)` / `resetFlashcards(clients[])` — `tests/integration/helpers/db.ts:30-63` — `overrides` includes `id`, `front`, `back`, `status`, `due`, `state`, `reps`, `stability`, so a specific row (specific id, specific status) can be pre-seeded. Requires an owner-scoped client — obtained via `signedInClient(user)`.
- **Not usable**: `tests/integration/helpers/mock-provider.ts`'s `vi.spyOn(globalThis.fetch)` — an in-process Vitest mock; Playwright drives a separate `npm run dev` process (`playwright.config.ts:23-28`), so this spy has zero effect there. Confirms the already-made decision to mock at the browser network layer (`page.route`) against the app's **own** `/api/flashcards/generate` endpoint (the browser-initiated call), not the server's outbound OpenRouter call (unreachable from Playwright — same limitation already documented in test-plan.md §6.3 from the Risk #3 discussion).
- **No `storageState`/auth-setup project exists** in `playwright.config.ts` — every spec (including this one) must sign in through the real UI form; there is no shared authenticated-session fixture to reuse.
- `package.json` has `"test:e2e": "playwright test"` (runs the whole `tests/e2e` dir) but no dedicated single-spec script — use the bare `playwright test <file>` CLI arg for the tight per-risk verification loop.

### Historical context

- **Phase 2 (`core-flow-correctness`) explicitly decided against this test**: "Not writing a cross-flow generate → accept → review test. Each risk's suite stays self-contained; the `pending`→`accepted` seam is documented, not a top risk." (archived `plan.md:98-99`). Its own Open Questions (`research.md:378-380`) had already asked "worth one integration test that generates, flips status to accepted, then reviews?" and answered "keep separate" — Risk #7 is the considered reversal of that call now that the PRD's Primary Success Criterion frames the full journey as the product's headline promise.
- **Phase 3 (`client-state-and-input-hardening`)** left `FlashcardGenerator`'s actual rendered DOM/interaction path untested — only `useFlashcardProposals` was covered via `renderHook` (no component render). The planned E2E test would be the **first** test to actually exercise `FlashcardGenerator.tsx`'s real accept/reject click path. Also relevant: on a generation failure, the pasted `sourceText` and the retry banner are component-owned state (`FlashcardGenerator.tsx`, not the hook) — not directly needed for the happy-path journey, but worth knowing if the plan later touches the generator's error branch (already resolved out-of-scope per the earlier Risk #3 discussion in this conversation).
- **`spaced-repetition-session` (archived) manual test scenarios map almost directly onto good E2E scenarios**: seed ≥5 accepted flashcards → confirm all due; a `pending` and a `rejected` card must **not** appear in the due list (this is literally the seam Risk #7 is about, stated from the feature-build era); rate one card "Again" → confirm it does not reappear before the session ends; a second user's session never shows the first user's cards. Desired end state: visit `/flashcards/review`, see first due card's front, reveal back, pick one of 4 ratings, immediately see the next due card; empty/exhausted state is a simple message, no summary screen (explicitly out of scope — "no session summary/results screen").
- **PRD** (`prd.md:45-50` Success Criteria Primary, `prd.md:70-74` US-01 Acceptance Criteria) is the strongest grounding: the full generate→review→accept→study flow is literally the headline success metric, and "accepted flashcards are immediately available for study in a review session" is a named acceptance criterion — directly justifying an assertion that there is no delay between accepting and being able to rate a card.

## Code References

- `src/pages/api/flashcards/[id].ts:8-61` — PATCH accept/reject handler, request schema, exact update payload (status/front/back/updated_at only)
- `supabase/migrations/20260906000000_add_review_state_to_flashcards.sql:6-19` — FSRS column defaults + `flashcards_due_idx` partial index
- `src/pages/api/flashcards/generate.ts:49-55` — generate-time insert (status: "pending", no FSRS fields set)
- `src/lib/services/reviews.ts:10,47-105` — `scheduler`, `getDueFlashcards`, `recordReview`
- `src/pages/api/flashcards/due.ts:8-27` — `GET /api/flashcards/due`
- `src/pages/api/flashcards/[id]/review.ts:14-53` — `POST /api/flashcards/[id]/review`
- `src/pages/generate.astro:17` — mounts `FlashcardGenerator`
- `src/pages/dashboard.astro:8-30` — no flashcard data; welcome/sign-out only
- `src/pages/flashcards.astro:38-43` — "Study" link → `/flashcards/review`
- `src/components/FlashcardList.tsx:206-233,274-278` — list heading/count, per-card text, empty state
- `src/pages/flashcards/review.astro:40` — mounts `ReviewSession` with SSR `initialData`
- `src/components/ReviewSession.tsx:7-12,56-103` — rating buttons, reveal, empty/complete state
- `src/components/Topbar.astro:13-29` — full-page nav links + sign-out form
- `tests/e2e/seed.spec.ts` — reference E2E pattern (locators, cleanup, sign-in flow)
- `tests/integration/helpers/users.ts:14-53`, `local-env.ts:15-38`, `db.ts:30-63` — reusable Node-side test helpers
- `tests/integration/helpers/mock-provider.ts` — confirmed NOT usable from Playwright (in-process Vitest fetch spy)
- `playwright.config.ts` — `testDir`, `webServer`, no `storageState`/auth-setup project

## Architecture Insights

- **The promotion seam is purely `status`, never FSRS state** — this simplifies the E2E test's job: it doesn't need to reason about scheduling math at all for the "accept → becomes due" claim, only about the `status` transition and the due-index filter.
- **Recommended resolution for the generate-mock/DB-mismatch snag**: don't fully bypass the DB for the generate step. Pre-seed a real `status:"pending"` row via `seedFlashcard(await signedInClient(user), user.id, { id: <uuid>, front, back })`, then `page.route("**/api/flashcards/generate")` to fulfill with a response body whose `flashcards[0]` echoes that same `id`/`front`/`back` (plus whatever other `Flashcard` fields the UI reads — only `id`, `front`, `back` are actually consumed by `FlashcardGenerator`/`useFlashcardProposals`). This keeps the mock scoped to exactly the AI-generation step (deterministic proposal content, no real OpenRouter call) while everything from the Accept click onward — the real `PATCH`, the real DB row, the real due-list query, the real review — is unmocked and genuinely end-to-end. This is the one open design decision `/10x-plan` should confirm before writing Success Criteria.
- Full-page navigation (no SPA router) means this journey is safe to test with ordinary `page.goto`/click + URL assertions — no special handling for client-side route transitions is needed anywhere in the flow.

## Historical Context (from prior changes)

- `context/archive/2026-09-09-core-flow-correctness/plan.md:98-99` — the origin "not writing a cross-flow test" decision that Risk #7 reverses.
- `context/archive/2026-09-09-core-flow-correctness/research.md:220-224,378-380` — FSRS defaults grounding, and the Open Question that first raised this exact idea.
- `context/archive/2026-09-09-client-state-and-input-hardening/plan.md:109-127` — accepted UI-render test gaps in `FlashcardGenerator`/`useFlashcardProposals` this new E2E test would be the first to close.
- `context/archive/2026-09-06-spaced-repetition-session/plan.md:18-46,190-268` — study-session feature definitions, desired end state, and manual test scenarios this E2E test should mirror.
- `context/archive/2026-09-06-choose-review-algorithm/` — why `ts-fsrs` + `enable_short_term:false` was chosen (background, not directly actionable for this test).

## Related Research

- `context/foundation/test-plan.md` §2 (Risk #7 row, added this session) and §6.3 (e2e cookbook, known `page.route` server-boundary limitation).

## Open Questions

1. **Confirm live**: does shadcn's `CardTitle` render a role-`heading` element, or a plain `div`? Decides whether `getByRole("heading", {name:"Question"})` is valid or `getByText` must be used instead. Resolve during the browser-driven PLAN step, not by guessing.
2. **Confirm the seeded-id + mocked-response approach works end to end** (see Architecture Insights) — specifically, whether a client-generated UUID passed as `SeedOverrides.id` is accepted by the `flashcards` table's `id` column type/constraints, and whether the mocked generate response needs any `Flashcard` field beyond `id`/`front`/`back` to satisfy TypeScript/runtime expectations in `useFlashcardProposals`.
3. Should the test also assert the negative case from the archived manual-test scenarios (a `pending`/`rejected` sibling card never appears in the due list), or is that already adequately covered by existing integration tests and out of scope for the E2E budget (test-plan.md §1: "one test per risk," "rarely more than 1-3 per phase")?
