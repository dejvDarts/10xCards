# Manual flashcard creation — Plan Brief

> Full plan: `context/changes/manual-flashcard-creation/plan.md`

## What & Why

Deliver FR-005 / roadmap S-02: a signed-in user can create a flashcard directly from typed front/back text, without pasting source material or going through AI review. This is the secondary, full-alternative path to S-01's AI-generation flow, for the case where the user already knows exactly what they want on the card.

## Starting Point

`flashcards` (S-01's schema) already anticipates this — its `status` enum includes `'accepted'` and `source_text` is nullable — so no migration is needed. `src/pages/api/flashcards/index.ts` only has `GET` today. `/flashcards` (S-03/S-04) already renders, edits, and deletes saved cards with an optimistic-mutation hook (`useFlashcardList.ts`) this plan extends.

## Desired End State

On `/flashcards`, a user opens a "New flashcard" form (persistent button, empty-state CTA, or via a new Topbar link), types a front and back, and saves. The card appears at the top of the collection immediately; the form clears and stays open for the next entry.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Insert status | `'accepted'` immediately, no `pending` review step | `listFlashcards` only shows `accepted` rows, and FR-005 describes direct creation, not a review flow |
| front/back length | 1–1,000 characters each | First place a manual, free-typed field exists in the app; the existing PATCH endpoint has no max to inherit |
| Form placement | Inline, expandable, on `/flashcards` | Fastest loop — see the card land in the collection with zero navigation; no new route or modal component |
| Post-save behavior | Form clears and stays open (no separate "add another" button) | Optimized for the realistic case of adding several cards in one sitting |
| Post-save feedback | New card prepended to the grid immediately (snaps to page 1 if elsewhere) | Visible proof the save worked, no extra reload/refetch round-trip |
| Validation UX | Save disabled until both fields are non-empty | Reuses the exact guard already used for inline editing |
| Discovery | "New flashcard" link in Topbar + persistent on-page button + empty-state CTA | Matches existing flat-nav pattern; discoverable from anywhere and from a first-run empty state |

## Scope

**In scope:**
- `POST /api/flashcards` (new)
- Inline create form + toggle on `/flashcards`
- `createFlashcard` mutation in `useFlashcardList.ts`
- Topbar "New flashcard" link
- Empty-state "Create manually" CTA

**Out of scope:**
- DB migration (schema already supports this)
- `pending`/review step for manual cards
- Dedicated `/flashcards/new` route or modal dialog
- "Save & add another" / "Save & close" button split
- Bulk/multi-card entry in one submission
- Automated tests

## Architecture / Approach

Extends the same two files S-04 already extended (`src/pages/api/flashcards/[...].ts` pattern, `useFlashcardList.ts`) rather than introducing a new route, component, or mutation shape. The only new behavior is `createFlashcard`, which — unlike the existing optimistic `editFlashcard`/`deleteFlashcard` — waits for server confirmation before touching local state, so a failed save never re-populates a draft the user just watched clear (see plan's Critical Implementation Details).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Manual creation API | `POST /api/flashcards`, zod-validated, inserts as `accepted` | Forgetting the `status: 'accepted'` override would silently make new cards invisible in the list |
| 2. Manual creation UI | Inline form, prepend-on-create hook logic, Topbar link, empty-state CTA | Pagination bookkeeping (page-1 full-page trim, snap-to-page-1 from elsewhere) drifting if not handled explicitly |

**Prerequisites:** F-01 (done) — `flashcards` table + RLS.
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- No uniqueness constraint on front/back — duplicate manual cards are allowed, same as the existing AI flow (no dedup requested).
- Snapping to page 1 on create-while-elsewhere is a reasonable extrapolation of the "see it land immediately" decision, not something explicitly asked — flagged here in case that surprises anyone reviewing the plan.

## Success Criteria (Summary)

- A user can create a flashcard from scratch and see it in their collection without leaving `/flashcards`
- The form supports adding several cards back-to-back without extra clicks between saves
- No user can create, see, or affect another user's flashcards
