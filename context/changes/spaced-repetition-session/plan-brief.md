# Spaced-Repetition Review Session (S-05) — Plan Brief

> Full plan: `context/changes/spaced-repetition-session/plan.md`
> Research: `context/changes/choose-review-algorithm/research.md`

## What & Why

Build the review session that lets a signed-in user study their saved (accepted) flashcards, scheduled by the FSRS algorithm (`ts-fsrs`, chosen in F-02). This closes the last must-have gap in the milestone's north-star flow: paste text → review AI proposals → save → **study**.

## Starting Point

The `flashcards` table has no review-state columns today — front/back/status/timestamps only. `src/lib/services/flashcards.ts`, the `flashcards` API routes, and `FlashcardList`/`useFlashcardList` already establish every convention this plan reuses (service-layer shape, API route skeleton, hook-owns-state pattern, SSR-fetch-then-hydrate pages).

## Desired End State

Visiting `/flashcards/review` shows the next due flashcard's front, lets the user reveal the back, and rate recall on a 4-point scale (Again/Hard/Good/Easy). Each rating reschedules the card via FSRS. The session ends with a simple "no cards due" message once the queue is empty.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Data model | Extend `flashcards` directly with FSRS `Card` columns | 1:1 relationship, no join, matches the table's existing single-entity style | Research |
| Due scope | Only currently-due accepted flashcards (`due <= now()`) | Matches what a spaced-repetition session actually means; a new card is immediately due | Plan |
| In-session "Again" requeue | Not requeued — `enable_short_term: false` | Avoids building a live requeue loop; a card rated Again just becomes due later | Plan |
| Rating scale | Full 4-button FSRS scale, passed straight through | FSRS's scheduling accuracy depends on the granularity; matches `ts-fsrs`'s `Rating` enum 1:1 | Plan |
| Session end | Simple "all done" message, no summary | Minimal to build with 8 days left before the deadline | Plan |
| Out of scope | Daily limits, review history/stats, undo, per-user tuning UI | None are asked for by FR-009; keeps scope to a working session | Plan |

## Scope

**In scope:** migration adding FSRS columns to `flashcards`; `ts-fsrs`-backed service (`getDueFlashcards`, `recordReview`); `GET /api/flashcards/due` + `POST /api/flashcards/[id]/review`; review session hook + component + `/flashcards/review` page; a "Study" entry link from `/flashcards`.

**Out of scope:** daily new/review limits, review history/stats, undo/rollback, per-user FSRS tuning, in-session requeue of "Again" cards, a session summary screen, a separate reviews/audit table.

## Architecture / Approach

Extend `flashcards` with FSRS `Card` fields (DB-level defaults handle both backfill and future inserts with zero app-code changes) → a service module wraps `ts-fsrs` scheduling → two API routes expose it, following the exact skeleton of the existing flashcard routes → the UI fetches the due-list once per session and iterates it client-side, one rating POST per card.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. FSRS review-state schema | Migration adding `due`/`stability`/etc. columns + index | Column defaults must exactly match `ts-fsrs`'s `createEmptyCard()` semantics |
| 2. FSRS scheduling service | `getDueFlashcards`/`recordReview` wrapping `ts-fsrs` | Row↔`Card` date/enum conversion correctness |
| 3. Review session API | `GET /due`, `POST /[id]/review` | Auth/ownership checks must match existing route conventions exactly |
| 4. Review session UI | Hook + component + page + entry link | Double-submit prevention while a rating POST is in flight |

**Prerequisites:** F-02 decision (done — `ts-fsrs`), S-01 (done — accepted flashcards exist to study).
**Estimated effort:** ~1-2 after-hours sessions across the 4 phases, well within the 2026-09-14 deadline.

## Open Risks & Assumptions

- Assumes the current small-scale data volume holds — the due-list query is unpaginated by design.
- `enable_short_term: false` is a one-way scheduling choice for the MVP; revisiting same-day relearning later means changing this default, not just UI work.

## Success Criteria (Summary)

- A user with due accepted flashcards can complete a full review session end-to-end, and each rating visibly changes the card's next due date.
- A user with zero due flashcards sees a clear "nothing to study" state instead of an error or blank screen.
- Cross-user isolation holds: no user ever sees another user's flashcards in a session.
