---
change_id: spaced-repetition-session
title: Spaced-repetition review session (S-05)
status: archived
created: 2026-09-06
updated: 2026-09-06
archived_at: 2026-09-06T21:09:21Z
---

## Notes

Implements S-05 from `context/foundation/roadmap.md` — study saved flashcards in a review session driven by FSRS (`ts-fsrs`).

Upstream research lives in `context/changes/choose-review-algorithm/` (F-02):
- `research.md` — algorithm comparison, why `ts-fsrs` was chosen
- `ts-fsrs-api-reference.md` — library API reference
- `codebase-compatibility-review.md` — confirms compatibility with this codebase, recommends extending the `flashcards` table with FSRS `Card` columns rather than a separate reviews table
