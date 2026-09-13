---
change_id: full-journey-e2e-coverage
title: E2E coverage for the full generate → accept → study-session journey
status: impl_reviewed
created: 2026-09-13
updated: 2026-09-13
archived_at: null
---

## Notes

Opens rollout Phase 5 for Risk #7 in `context/foundation/test-plan.md` §2 —
the full "generate → review/accept → study session" user journey, which is
the PRD's Primary Success Criterion, but crosses the seam between three
already-shipped phases (Phase 1: access control, Phase 2: FSRS + AI
generation, Phase 3: client-state hardening), each tested in isolation.

Per the Risk Response Guidance row for #7: try a cheaper chained-handler
integration test first (`generate` → `PATCH accept` → `getDueFlashcards`/
`recordReview`) to pin the backend promotion seam, and reserve e2e
(Playwright, extending `tests/e2e/seed.spec.ts`) for the browser-driven
portion — generate page → accept a proposal → navigate to the study page →
rate the card — that a chain of direct API calls can't prove.

Known infra limit carried over from test-plan.md §6.3: the app's dev server
is a separate process, so `page.route()` can't intercept its server-side
call to the AI provider. Don't force e2e onto the AI-failure branch of this
journey — mock at the browser network layer for `/api/flashcards/generate`
only if the happy-path promotion itself needs it; if generation-failure
coverage comes up again, it stays with Risk #3 (already resolved as
"no test for now" per that earlier discussion).
