# Saved flashcard maintenance — Plan Brief

> Full plan: `context/changes/saved-flashcard-maintenance/plan.md`

## What & Why

Deliver FR-007 / FR-008 / roadmap S-04: a signed-in user can edit or delete
a flashcard already in their saved collection. Right now (post S-03), a
user can browse their saved cards but has no way to fix a typo or remove a
card they no longer want — this closes that gap on the same `/flashcards`
page.

## Starting Point

`/flashcards` (S-03) renders accepted cards read-only. A `PATCH` endpoint
exists but requires `status` on every call (built for the S-01 accept/reject
flow). No `DELETE` endpoint exists, though the DB-level `flashcards_delete_own`
RLS policy already does (from S-01). No confirmation-dialog UI exists in the
repo yet.

## Desired End State

Each card on `/flashcards` has Edit (inline Textareas, Save/Cancel) and
Delete (confirmation dialog) actions. Both update the UI optimistically and
roll back on failure. Deleting the last card on a page auto-navigates back
a page.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Delete semantics | Hard delete, no trash/undo | Matches FR-008's plain wording and the existing schema (no soft-delete column); avoids scope creep against the MVP deadline |
| Delete confirmation | Required (shadcn AlertDialog) | Hard delete is irreversible — a confirmation step is the standard safeguard |
| Edit/PATCH contract | Make `status` optional on the existing PATCH endpoint | One endpoint keeps serving S-01's review flow and S-04's text-only edits, no duplicated auth/validation logic |
| Edit UI | Inline edit-in-place | Reuses `FlashcardGenerator.tsx`'s existing Textarea-edit pattern, no new UI concept |
| Mutation UX | Optimistic update + rollback | Matches the proven pattern in `useFlashcardProposals.ts`'s `updateFlashcard` |
| Edit validation | Disable Save until both fields are non-empty | Matches the existing Accept-button guard in `FlashcardGenerator.tsx` |
| Delete + pagination | Auto-navigate back a page if delete empties the current non-first page | Avoids stranding the user on a dead empty page |
| Error handling | Reuse the existing inline banner + Retry pattern | One consistent error UI across the whole app |
| Testing | Manual verification only | Matches repo convention (S-01, S-03) — no test framework exists yet |

## Scope

**In scope:**
- `PATCH /api/flashcards/[id]` — `status` becomes optional, empty-intent guard added
- `DELETE /api/flashcards/[id]` (new)
- Inline edit-in-place + delete-with-confirmation on each card in `FlashcardList.tsx`
- Optimistic `editFlashcard`/`deleteFlashcard` mutations in `useFlashcardList.ts`

**Out of scope:**
- Soft delete / trash / undo
- Editing a card's `status` from the saved list (that stays in the S-01 review flow)
- Bulk edit/delete
- Automated tests

## Architecture / Approach

Extends two existing, proven shapes rather than inventing new ones: the
`[id].ts` auth/validation/error pattern (for the API), and the
`useFlashcardProposals.ts` optimistic-mutation-with-rollback pattern (for the
UI state). The only genuinely new piece is the `AlertDialog` component for
delete confirmation.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Edit & delete API | `PATCH` decoupled from `status`, new `DELETE` endpoint | Empty-intent PATCH becoming a silent no-op if the `.refine()` guard is missed |
| 2. Edit & delete UI | Inline edit, delete confirmation, optimistic mutations | Pagination state drifting after delete if the auto-page-back logic is wrong |

**Prerequisites:** S-03 (done) — `/flashcards`, `FlashcardList.tsx`, `useFlashcardList.ts`.
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- Local `total`/`totalPages` recomputation after delete (rather than a
  server refetch) can drift under concurrent multi-tab edits — accepted for
  MVP given single-user, low-frequency usage (same tradeoff already accepted
  in S-03 for its offset pagination).
- `npx shadcn@latest add alert-dialog` requires network access at
  implementation time to pull the component + `@radix-ui/react-alert-dialog`.

## Success Criteria (Summary)

- A user can fix a typo in a saved card and see it persist
- A user can permanently remove a saved card, only after confirming
- No user can ever edit or delete another user's cards
