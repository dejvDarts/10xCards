---
change_id: saved-flashcard-maintenance
title: Saved flashcard maintenance
status: planned
created: 2026-09-05
updated: 2026-09-05
---

# Plan: Saved flashcard maintenance

## Overview

Deliver FR-007 and FR-008 (roadmap S-04): a signed-in user can edit or delete
a flashcard already in their saved collection, from the same `/flashcards`
page S-03 built. This extends the existing review-flow `PATCH` endpoint and
adds the repo's first `DELETE` endpoint and first confirmation-dialog UI.

## Current State Analysis

- `PATCH /api/flashcards/[id].ts` exists (from S-01) but its zod schema
  requires `status: "accepted" | "rejected"` on every call — it was built for
  the accept/reject review flow, not standalone editing of an already-saved
  card.
- No `DELETE` handler exists anywhere in the repo. The `flashcards` table
  already has a `flashcards_delete_own` RLS policy scoped to
  `user_id = auth.uid()` (from the original S-01 migration) — the DB layer
  is ready, only the API route is missing.
- `FlashcardList.tsx` (S-03) renders cards read-only, no action buttons.
- `useFlashcardList.ts` (S-03) has no mutation functions — only
  `goToPage`/`retry`.
- `useFlashcardProposals.ts`'s `updateFlashcard` (S-01) is the established
  precedent for optimistic mutation with rollback-on-error: remove/update
  local state immediately, fire the request, restore prior state on failure.
- No `Dialog`/`AlertDialog` component is installed (only `Button`, `Card`,
  `Textarea` from shadcn/ui) — this is the first destructive-action
  confirmation UI in the repo.

## Definitions

| Term | Decided meaning | Origin | On degenerate data | Verified by |
| --- | --- | --- | --- | --- |
| "delete" (FR-008) | Permanent (hard) delete via SQL `DELETE` — no trash/undo | user | Deleted rows are gone immediately and are not recoverable | Phase 1 manual: delete then confirm a subsequent GET no longer returns the row |
| delete confirmation | Required — an `AlertDialog` must be confirmed before the `DELETE` request fires | user | Clicking Delete alone does not remove anything; only confirming does | Phase 2 manual: Cancel leaves the card untouched, Confirm removes it |
| "edit" (FR-007) contract | `PATCH` `status` becomes optional; a pure text edit sends only `front`/`back` and leaves `status` unchanged | user | A `PATCH` with neither `status`, `front`, nor `back` present is now meaningless (previously `status` was required, so an empty-intent request was impossible) — see Critical Implementation Details for the added guard | Phase 1 manual: empty-body PATCH returns 400; status-only PATCH (S-01 regression) still works; front/back-only PATCH works without status |
| ownership ("their") | `user_id = auth.uid()`, enforced by RLS and an explicit `.eq("user_id", user.id)` filter, same as `GET`/existing `PATCH` | product (PRD Access Control, established in S-01/S-03) | A request for another user's card ID (edit or delete) returns 404, never another user's data | Phase 1 manual: cross-user edit/delete attempt returns 404 |

## Desired End State

On `/flashcards`, each card has Edit and Delete actions. Clicking Edit turns
that card's front/back into editable text with Save/Cancel; Save persists
the change and Cancel discards it, both without touching `status`. Clicking
Delete opens a confirmation dialog; confirming permanently removes the card
(with an automatic page-back if that was the last card on a non-first page),
cancelling leaves it untouched. Both actions update the UI immediately
(optimistic) and roll back with an inline error if the request fails.
Actions never succeed against another user's cards.

### Verification

- Manual walkthrough against the Definitions table's "Verified by" column
  plus `npm run lint` / `npm run build` (no automated test framework exists
  in this repo yet — same convention as S-01/S-03).

### Key Discoveries

- `flashcards_delete_own` RLS policy already exists (S-01 migration) — no
  new migration needed for delete.
- `src/pages/api/flashcards/[id].ts:47-58`'s double-scoping
  (`.eq("id", cardId).eq("user_id", user.id)`) is the pattern the new
  `DELETE` handler follows.
- `FlashcardGenerator.tsx`'s edit-in-place Textareas (lines 110-137) and its
  disabled-until-valid Accept button are the direct UI precedent for this
  slice's inline edit and Save-button validation.

## What We're NOT Doing

- Soft delete / trash / undo — explicitly decided against; see Definitions.
- Editing a card's `status` from the saved list (accept/reject stays owned
  by the S-01 review flow at `/generate`) — this slice only edits
  `front`/`back`.
- Bulk edit or bulk delete (multi-select) — not requested by FR-007/FR-008.
- Automated tests / a new test framework — manual verification only, per
  existing repo convention (see S-01, S-03).
- Any change to `/flashcards`'s pagination/browsing behavior beyond what's
  needed to keep it correct after a delete (S-03's behavior is otherwise
  untouched).

## Implementation Approach

Bottom-up, matching the S-01/S-03 convention: extend the API first
(verifiable via `curl`), then build the UI on top. The `PATCH` schema change
and the new `DELETE` handler both reuse the exact auth/validation/error
conventions already established in `[id].ts`. The UI reuses two existing
precedents rather than inventing new ones: `FlashcardGenerator.tsx`'s
edit-in-place Textareas, and `useFlashcardProposals.ts`'s optimistic
mutation-with-rollback shape — extended into `useFlashcardList.ts`.

## Critical Implementation Details

- **Empty-intent PATCH guard**: making `status` optional means a `PATCH`
  body containing none of `status`, `front`, or `back` is now syntactically
  valid against a schema of three independent optional fields, where
  previously `status` being required made that impossible. Add a
  `.refine((data) => data.status !== undefined || data.front !== undefined || data.back !== undefined, { message: "At least one of status, front, or back must be provided" })`
  to the schema so an empty-intent request still gets a clear 400 instead of
  silently no-op-updating only `updated_at`.
- **Delete + pagination interaction**: after a successful delete, decrement
  `total` locally and recompute `totalPages` from the new total (no extra
  round trip needed for the common case). If the current page's local
  `flashcards` array becomes empty and `page > 1`, call `goToPage(page - 1)`
  — which re-fetches from the server and corrects any local total/totalPages
  drift at that point. This mirrors the offset-pagination drift tradeoff
  already accepted in S-03's plan (single-user, low-frequency usage).

## Phase 1: Edit & delete API

### Overview

Make the existing `PATCH` endpoint support status-less text edits, and add
the new `DELETE` endpoint.

### Changes Required:

#### 1. Decouple `status` from the PATCH contract

**File**: `src/pages/api/flashcards/[id].ts`

**Intent**: A saved-list text edit should not need to resend `status` —
`status` stays supported (S-01's accept/reject flow keeps working
unchanged) but becomes optional, with `front`/`back` doing the same as today.

**Contract**: `requestSchema` changes `status: z.enum(["accepted", "rejected"])` → `status: z.enum(["accepted", "rejected"]).optional()`, keeping `front`/`back` as they are (`.trim().min(1, ...).optional()`), plus the empty-intent `.refine(...)` guard described in Critical Implementation Details. The `PATCH` handler's update object already conditionally spreads `front`/`back` (`...(update.front !== undefined && { front: update.front })`) — extend the same conditional-spread treatment to `status` (currently unconditional) so an edit-only request doesn't overwrite `status`. `UpdateFlashcardRequest` in `src/types.ts` changes `status: "accepted" | "rejected"` → `status?: "accepted" | "rejected"`.

#### 2. Delete endpoint

**File**: `src/pages/api/flashcards/[id].ts`

**Intent**: Permanently delete a caller-owned flashcard.

**Contract**: New `export const DELETE: APIRoute` in the same file, following the exact same auth sequence and `cardId` UUID validation as the existing `PATCH`. Query: `.from("flashcards").delete().eq("id", cardId).eq("user_id", user.id).select().maybeSingle()` — the `.select().maybeSingle()` on a delete mirrors `PATCH`'s existing not-found detection (a card owned by someone else, or a nonexistent id, both leave `.maybeSingle()` returning `null` under RLS + the explicit filter — respond 404 either way, never distinguishing "not yours" from "doesn't exist"). DB error → 500 `jsonError("Failed to delete flashcard")`. Success → `204` with no body (`new Response(null, { status: 204 })`).

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npm run build` succeeds

#### Manual Verification:

- `curl` PATCH with only `{ front, back }` (no `status`) on an existing accepted card updates the text and leaves `status` unchanged
- `curl` PATCH with `{}` (empty body) returns 400 with the "at least one of..." message
- `curl` PATCH with only `{ status: "accepted" }` (S-01 regression check) still works exactly as before
- `curl` DELETE on a card the caller owns returns 204, and a subsequent `GET /api/flashcards` no longer includes it
- `curl` DELETE on another user's card ID (or a nonexistent ID) returns 404
- `curl` DELETE without a session cookie returns 401

---

## Phase 2: Edit & delete UI

### Overview

Add edit-in-place and delete-with-confirmation to each card on `/flashcards`,
backed by optimistic mutations with rollback.

### Changes Required:

#### 1. Install the confirmation dialog primitive

**File**: `src/components/ui/alert-dialog.tsx` (new, via `npx shadcn@latest add alert-dialog`)

**Intent**: This repo has no destructive-action confirmation pattern yet; delete needs one.

**Contract**: Standard shadcn `AlertDialog` install — adds `@radix-ui/react-alert-dialog` to `package.json`. No custom modification to the generated component.

#### 2. List mutations

**File**: `src/components/hooks/useFlashcardList.ts`

**Intent**: Add `editFlashcard` and `deleteFlashcard`, both optimistic with rollback, following `useFlashcardProposals.ts`'s `updateFlashcard` shape.

**Contract**: New state: `mutatingCardIds: Set<string>` (not a single `mutatingCardId`, unlike `updatingCardId` in `useFlashcardProposals.ts` — that hook only ever has one proposal mutating at a time, but here a user can start an edit on one card and a delete on another before the first resolves, so a single shared id would let one mutation's completion re-enable a different card still in flight; add the card's id on start, remove it in the `finally` block of each mutation). `editFlashcard(card: Flashcard, updates: { front: string; back: string })`: optimistically replaces the card's `front`/`back` in local state, `PATCH /api/flashcards/${card.id}` with `{ front, back }` (no `status`), on failure restores the card's original `front`/`back` and sets `error`. `deleteFlashcard(card: Flashcard)`: optimistically removes the card from `flashcards`, decrements `total`, recomputes `totalPages`; `DELETE /api/flashcards/${card.id}`; on failure re-inserts the card at its original index, restores `total`/`totalPages`, sets `error`; on success, if the local `flashcards` array is now empty and `page > 1`, calls `goToPage(page - 1)` (see Critical Implementation Details).

#### 3. Card actions

**File**: `src/components/FlashcardList.tsx`

**Intent**: Add Edit (inline) and Delete (confirm-then-delete) to each card.

**Contract**: Local `useState` for `editingCardId: string | null` and per-card draft `front`/`back` strings, scoped to this component (UI-only concern, not part of the hook's server-sync state). When `editingCardId === card.id`, render `Textarea`s for front/back (matching `FlashcardGenerator.tsx`'s edit fields) with Save/Cancel buttons; Save disabled unless both trimmed values are non-empty (matches `FlashcardGenerator`'s Accept-button guard); Save calls `editFlashcard(card, { front, back })` then clears `editingCardId`; Cancel clears `editingCardId` without calling the hook. A Delete button per card opens an `AlertDialog` ("Delete this flashcard?" / Cancel / Delete); confirming calls `deleteFlashcard(card)`. Both Edit and Delete controls are disabled while `mutatingCardIds.has(card.id)`.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npm run build` succeeds

#### Manual Verification:

- Click Edit on a card → front/back become editable, pre-filled with current text; Save is disabled if either field is emptied
- Save an edit → card updates immediately; refreshing the page confirms it persisted
- Cancel an edit → reverts to the original text with no request sent
- Click Delete → confirmation dialog appears; Cancel closes it with no change; Confirm removes the card immediately, and refreshing confirms it's gone
- Deleting the only card on page 2 of 2 automatically navigates back to page 1
- Simulating a failed edit or delete (network failure) shows the inline error banner and rolls back the optimistic change (text or presence reverts)
- A second user cannot edit or delete the first user's cards (their cards are never visible to edit/delete in the UI, and a direct API call against another user's card ID returns 404)

---

## Testing Strategy

Manual verification only, per repo convention (no automated test framework
configured yet). Each phase's Manual checklist above must pass before moving
to the next phase.

### Manual Testing Steps:

1. Reuse the seeded test users/cards from S-03 (or seed fresh accepted cards
   for one test user, including at least one page with exactly one card so
   the delete-triggers-page-back path is directly testable).
2. Run through both phases' Manual Verification checklists in order.
3. Sign in as a second user and confirm neither edit nor delete affects the
   first user's cards.

## Migration Notes

None — no schema changes. `DELETE` reuses the existing `flashcards_delete_own`
RLS policy from the S-01 migration.

## References

- Related plan: `context/archive/2026-09-04-personal-flashcard-list/plan.md` (S-03 — established `/flashcards`, `FlashcardList.tsx`, `useFlashcardList.ts`)
- Related plan: `context/archive/2026-09-02-reviewed-ai-flashcards/plan.md` (S-01 — established the `PATCH` endpoint, RLS policies including `flashcards_delete_own`, and the optimistic-mutation precedent)
- `context/foundation/prd.md` — FR-007, FR-008, Access Control
- `context/foundation/roadmap.md` — S-04 entry (Outcome, Prerequisites: S-03)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Edit & delete API

#### Automated

- [x] 1.1 `npm run lint` passes
- [x] 1.2 `npm run build` succeeds

#### Manual

- [x] 1.3 `curl` PATCH with only `{ front, back }` (no `status`) on an existing accepted card updates the text and leaves `status` unchanged
- [x] 1.4 `curl` PATCH with `{}` (empty body) returns 400 with the "at least one of..." message
- [x] 1.5 `curl` PATCH with only `{ status: "accepted" }` (S-01 regression check) still works exactly as before
- [x] 1.6 `curl` DELETE on a card the caller owns returns 204, and a subsequent `GET /api/flashcards` no longer includes it
- [x] 1.7 `curl` DELETE on another user's card ID (or a nonexistent ID) returns 404
- [x] 1.8 `curl` DELETE without a session cookie returns 401

### Phase 2: Edit & delete UI

#### Automated

- [ ] 2.1 `npm run lint` passes
- [ ] 2.2 `npm run build` succeeds

#### Manual

- [ ] 2.3 Click Edit on a card → front/back become editable, pre-filled with current text; Save is disabled if either field is emptied
- [ ] 2.4 Save an edit → card updates immediately; refreshing the page confirms it persisted
- [ ] 2.5 Cancel an edit → reverts to the original text with no request sent
- [ ] 2.6 Click Delete → confirmation dialog appears; Cancel closes it with no change; Confirm removes the card immediately, and refreshing confirms it's gone
- [ ] 2.7 Deleting the only card on page 2 of 2 automatically navigates back to page 1
- [ ] 2.8 Simulating a failed edit or delete shows the inline error banner and rolls back the optimistic change
- [ ] 2.9 A second user cannot edit or delete the first user's cards
