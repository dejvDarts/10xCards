# Full generate → accept → study journey E2E coverage — Plan Brief

> Full plan: `context/changes/full-journey-e2e-coverage/plan.md`
> Research: `context/changes/full-journey-e2e-coverage/research.md`

## What & Why

Add one Playwright spec proving `test-plan.md` Risk #7: a user can generate an AI flashcard proposal, accept it, and immediately study/rate it — the exact journey the PRD names as its Primary Success Criterion, but which crosses the seam between three phases (generation, acceptance, FSRS scheduling) that were each tested in isolation and never bridged. Phase 2's rollout explicitly decided not to build this test; Risk #7 reverses that call.

## Starting Point

Generation, acceptance, and the study session each have solid unit/integration/component coverage on their own. Nothing today proves that an accepted card actually becomes visible and ratable in a real study session — the `pending → accepted → due` transition is only "documented," per the archived Phase 2 plan, not tested.

## Desired End State

A new `tests/e2e/full-journey.spec.ts` passes against the real dev server + local Supabase, and is confirmed (via a deliberate-break check on `getDueFlashcards`) to actually fail if the promotion seam breaks.

## Key Decisions Made

| Decision                                  | Choice                                                                     | Why (1 sentence)                                                                                                     | Source   |
| ----------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------- |
| Test structure                            | One test, full journey                                                     | Matches test-plan.md's "one test per risk" budget; splitting would double setup cost and weaken the cross-flow claim | Plan     |
| Generate-step mocking                     | Seed a real `pending` row + mock `/api/flashcards/generate` to echo its id | Keeps the mock scoped to the non-deterministic AI call; everything from Accept onward stays real (DB, SSR, review)   | Research |
| Flashcard count                           | One proposal, accepted                                                     | Simplest deterministic path — session naturally completes after one rating                                           | Plan     |
| Rating submitted                          | "Good" only                                                                | Oracle-safe (never assert exact `due`); proves the review call works without needing FSRS-specific edge cases        | Plan     |
| Negative case (pending/rejected excluded) | Not asserted here                                                          | Already implied by `getDueFlashcards`'s existing filter; left to integration coverage to keep this test narrow       | Plan     |
| Reload check                              | Ordinary page navigation, no explicit `page.reload()`                      | Four separate full-page SSR loads already prove state survives real navigation                                       | Plan     |
| Deliberate-break target                   | `getDueFlashcards`'s status filter                                         | Hits the exact seam Risk #7 is about                                                                                 | Plan     |

## Scope

**In scope:**

- One new E2E spec covering generate → accept → navigate → study → rate.
- Reuse of existing test helpers (`createTestUser`, `signedInClient`, `seedFlashcard`, `applyLocalEnv`).
- A deliberate-break verification step against the real promotion seam.

**Out of scope:**

- Reject path, multi-proposal scenarios, in-session "Again"-no-requeue behavior.
- A chained-handler integration test for the backend seam alone (test-plan.md names this as a cheaper alternative; left for a possible future change).
- Any infrastructure to stub the real OpenRouter/AI-provider call (documented limitation, unrelated to this risk).

## Architecture / Approach

Seed a real `pending` flashcard with a client-chosen `id`, mock only the browser's `POST /api/flashcards/generate` to echo that same `id`/`front`/`back`, then let every subsequent step (`PATCH` accept, `/flashcards` list, `/flashcards/review` SSR fetch, `POST .../review`) hit the real app and real local Supabase, unmocked.

## Phases at a Glance

| Phase                    | What it delivers                                         | Key risk                                                                                             |
| ------------------------ | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1. Full-journey E2E spec | `tests/e2e/full-journey.spec.ts`, green + break-verified | Seed-id/mock-id mismatch would 404 the Accept step — sequencing is called out explicitly in the plan |

**Prerequisites:** local Supabase running (`npx supabase start`), Playwright already installed (confirmed).
**Estimated effort:** one focused session — single new file, no production code changes.

## Open Risks & Assumptions

- Assumes the Topbar "Flashcards" link and `/flashcards`/`/flashcards/review` body text don't collide the way `seed.spec.ts` had to disambiguate with `.first()` — to be confirmed while writing the spec, not assumed.
- Assumes a plain client-generated UUID is accepted by Postgres for the `id` insert (confirmed via migration: `uuid primary key default gen_random_uuid()` accepts an explicit value too).

## Success Criteria (Summary)

- `npx playwright test tests/e2e/full-journey.spec.ts` passes against the real app + local Supabase.
- The spec is confirmed to fail when `getDueFlashcards`'s status filter is deliberately broken, then the break is reverted.
