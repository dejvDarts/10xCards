---
change_id: core-flow-correctness
title: "Test rollout Phase 2: core-flow correctness (study loop + AI generation)"
status: impl_reviewed
created: 2026-09-09
updated: 2026-09-09
archived_at: null
---

## Notes

Open a change folder for rollout Phase 2 of `context/foundation/test-plan.md`: "Core flow correctness".
Risks covered: #2, #3. Test types planned: unit + integration.

Risk response intent:

- **#2 (FSRS review-session scheduling).** Prove that after a rating the card's due-date moves in the
  direction and rough magnitude the rating implies, and that a rated card never resurfaces in the same
  session. Must challenge that a `200` response means the schedule was recalculated correctly. Cheapest
  layer: unit (scheduling calc) + integration (rate → re-fetch due list → assert). Avoid the oracle
  problem (asserting against the implementation's own output) and happy-path-only ("Good" but never
  "Again").
- **#3 (AI generation pipeline).** Prove that when the AI provider errors, times out, or returns
  malformed output, the user sees a clear actionable error and never a silently empty or corrupted
  proposal list. Must challenge that "the AI call didn't throw" means the proposals are well-formed.
  Cheapest layer: integration, mocking only the provider's HTTP edge (never internal modules). Avoid
  over-mocking past the response-validation code and testing only successful generation.

Builds on the Phase 1 harness (`tests/integration/helpers/`, the `unit` / `integration` Vitest
projects). Fills in the `test-plan.md` §6.4 cookbook stub (AI pipeline) when it lands; §6.6 gets a
Phase 2 note.
