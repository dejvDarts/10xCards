# Manual flashcard creation Implementation Plan

## Overview

Let a signed-in user create a flashcard directly from typed front/back text — no pasted source, no AI review step — so it lands immediately in their `/flashcards` collection. This delivers PRD FR-005 and roadmap slice S-02, the secondary alternative to the AI-generation flow (S-01).

## Current State Analysis

- The `flashcards` table (`supabase/migrations/20260903000000_create_flashcards.sql`) already anticipates this slice — its header comment says "and, in future slices, manually created flashcards" — and needs **no migration**: `source_text` is nullable and `status` already accepts `'accepted'`.
- `listFlashcards` (`src/lib/services/flashcards.ts:8`) filters `status = 'accepted'` only. This is a `code` origin fact the plan depends on: a manually created row must be inserted as `'accepted'` directly, or it will silently never appear in the collection.
- `src/pages/api/flashcards/index.ts` currently only exports `GET`. `generate.ts` and `[id].ts` establish the auth → zod-parse → Supabase → `jsonError` pattern this plan follows for the new `POST`.
- `FlashcardList.tsx` + `useFlashcardList.ts` already implement the optimistic-mutation UI/hook split this plan extends; `FlashcardGenerator.tsx` supplies the character-counter pattern to reuse.
- `Topbar.astro` is a flat, hand-written link list (`Generate` / `Flashcards` / `Dashboard`) — no nav component abstraction to extend, just add a line.

### Key Discoveries:

- `[id].ts`'s `PATCH` validates `front`/`back` as `trim().min(1)` with **no max** — this plan is the first place a max length is introduced, decided at 1,000 chars/field this session (see Definitions).
- `useFlashcardList.ts`'s `editFlashcard`/`deleteFlashcard` both mutate local state **optimistically before** the request, rolling back on failure. This plan's `createFlashcard` deliberately does **not** follow that shape — see Critical Implementation Details → State sequencing.

## Definitions

| Term | Decided meaning | Origin | On degenerate data (tie, duplicate, empty, boundary, legacy) | Verified by |
| --- | --- | --- | --- | --- |
| Manual flashcard | Created from user-typed front/back only; persisted immediately with `status: 'accepted'`, `source_text: null` — no `pending`/review step | product (FR-005) + code (`status` enum semantics, `listFlashcards` filter) | Front/back identical to an already-saved card — allowed; no uniqueness constraint exists (same as the AI flow) | Manual test: create a card duplicating an existing one, confirm both appear in the list |
| front/back length | 1–1,000 characters each, trimmed | user (this session) | Exactly 1,000 chars accepted; 1,001 rejected client- and server-side; whitespace-only trims to empty and is rejected | Manual test at the 1,000/1,001 boundary and with whitespace-only input |
| "Prepend to grid" | New card inserted at the top of page 1; if the user isn't already on page 1, they're navigated there | user (Q4) + inferred consequence for the not-on-page-1 case | User creates a card while viewing page 2 of a multi-page collection; or page 1 already holds a full 20-item page | Manual test: create while on page 2 (expect navigation to page 1, new card on top); create with a full page 1 (expect the 21st/oldest-of-20 item dropped from the client array, `total`/`totalPages` still correct) |
| Repeat entry | On success, the form clears and stays open — no separate close action | user (Q3) | Two saves in a row without navigating away or reloading | Manual test: save two cards consecutively |

## Desired End State

A signed-in user on `/flashcards` can open a "New flashcard" form (via a persistent button, an empty-state CTA, or by navigating from a new Topbar link), type a front and back, and save it. The card appears at the top of their collection immediately, the form clears for the next entry, and the same validation/error conventions used elsewhere in the app apply (disabled Save until both fields are filled, existing red error banner on failure).

### Key Discoveries:

- No DB migration needed — see Current State Analysis.
- `POST /api/flashcards` slots into the existing `index.ts` file next to `GET`, following `generate.ts`'s auth/validation/insert shape almost verbatim.

## What We're NOT Doing

- No DB schema change / migration.
- No "pending" review step for manually created cards — they save straight to the collection (unlike the AI flow).
- No `source_text` capture for manual cards (stays `null`).
- No dedicated `/flashcards/new` route or modal dialog — the form is inline on `/flashcards`.
- No "Save & add another" / "Save & close" button split — a single Save action, form always clears and stays open on success.
- The Topbar "New flashcard" link does not auto-expand the form via a query param or hash — it navigates to `/flashcards`, where the visible toggle button opens it. Keeps this slice to a one-line nav change instead of introducing URL-driven UI state.
- No automated tests — matches the established convention in this repo (S-01, S-03, S-04); no test framework exists yet.
- No bulk/multi-card manual entry in one submission.

## Implementation Approach

Two phases, mirroring the S-04 split that worked for the last slice: API first, then UI. Phase 1 adds the `POST` endpoint and shared types with no new files. Phase 2 adds the inline create form, a hook mutation, an empty-state CTA, and a Topbar link — all extending existing files, no new components.

## Critical Implementation Details

### State sequencing

`editFlashcard`/`deleteFlashcard` in `useFlashcardList.ts` mutate local state **before** awaiting the request (optimistic, with rollback on failure). `createFlashcard` must NOT follow that shape: per the "form clears and stays open" decision (Q3), the form should only clear once the save is confirmed — clearing eagerly and then rolling back on failure would re-populate the user's just-cleared draft, which reads as a bug. So `createFlashcard` awaits the `POST` response first, and only then prepends the returned row to local state and clears the form; on failure, state is untouched (nothing to roll back) and the existing error banner shows.

### Pagination bookkeeping on create

Reuses the existing `goToPage` primitive `deleteFlashcard` already calls post-mutation, but with different trigger/target logic — this is new logic, not a copy of a proven path, and needs its own careful testing (see Manual Verification 2.5/2.6). Specifically: if `page !== 1` when create succeeds, call `goToPage(1)` to navigate there unconditionally (a real refetch, but only in this less-common branch) — unlike `deleteFlashcard`'s navigation, which only fires when the current page becomes empty and always moves back exactly one page, not to page 1. If already on page 1, prepend the returned card to the local `flashcards` array and, if that pushes the array past `limit` (a full page of 20), trim the last (oldest-of-the-20) entry off the client array so the page-size invariant holds. Either way, increment `total` and recompute `totalPages = Math.max(1, Math.ceil(total / limit))`.

## Phase 1: Manual creation API

### Overview

Add `POST /api/flashcards` so a signed-in user can create a flashcard directly, and share its request type.

### Changes Required:

#### 1. Create endpoint

**File**: `src/pages/api/flashcards/index.ts`

**Intent**: Add a `POST` handler alongside the existing `GET` so a signed-in user can create a flashcard directly from front/back text, landing straight in their accepted collection.

**Contract**: New zod schema, `.strict()`: `front`/`back` as `z.string().trim().min(1, "front must not be empty").max(1000, "front must be at most 1,000 characters")` (mirrored for `back`). On success, insert one row `{ user_id: user.id, front, back, source_text: null, status: 'accepted' }` via `supabase.from("flashcards").insert(...).select().single()`, and return it as JSON with status `201`. Reuses the same auth check and `jsonError` helper already in this file.

#### 2. Shared request type

**File**: `src/types.ts`

**Intent**: Give the API and the UI hook one shared contract for the new endpoint.

**Contract**: `export interface CreateFlashcardRequest { front: string; back: string; }`. The response is a bare `Flashcard` (same shape `PATCH` already returns) — no wrapper type needed for a single-row create.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npm run build` succeeds

#### Manual Verification:

- `POST /api/flashcards` with valid front/back returns 201 and the new row has `status: 'accepted'`, `source_text: null`
- Empty or whitespace-only front/back returns 400
- Front or back over 1,000 characters returns 400
- Request without a valid session returns 401
- The created row is only visible to the creating user (existing `flashcards_select_own` RLS policy)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Manual creation UI

### Overview

Add the inline "New flashcard" form to `/flashcards`, wire it to the new endpoint, and make it discoverable.

### Changes Required:

#### 1. Create mutation

**File**: `src/components/hooks/useFlashcardList.ts`

**Intent**: Let the UI trigger a create and see the result land in the list without a full refetch, per the "prepend immediately" decision.

**Contract**: New `isCreating` boolean state and `async function createFlashcard(input: { front: string; back: string }): Promise<void>`. POSTs to `/api/flashcards`; on success, applies the pagination bookkeeping described in Critical Implementation Details, then returns (letting the caller clear its own draft state, mirroring how `saveEditing` clears `editingCardId` after `editFlashcard` resolves). On failure, sets `error` via the existing error state — no state to roll back per the State sequencing note above.

#### 2. Inline create form

**File**: `src/components/FlashcardList.tsx`

**Intent**: Add a collapsible "New flashcard" section above the grid, reachable via a persistent toggle button and (when the collection is empty) a second empty-state CTA next to "Generate flashcards". Front/Back `Textarea`s with live character counters capped at 1,000, matching `FlashcardGenerator.tsx`'s counter treatment; Save disabled until both fields are non-empty, same guard style as the existing inline-edit `canSave`.

**Contract**: New local state: `isCreateFormOpen`, `createFront`, `createBack`. Submitting calls the hook's `createFlashcard`, then clears `createFront`/`createBack` (form stays open per the Repeat entry decision). The empty-state block (`total === 0`) gains a second button, "Create manually", that sets `isCreateFormOpen(true)`.

#### 3. Nav entry point

**File**: `src/components/Topbar.astro`

**Intent**: Make manual creation discoverable from any protected page.

**Contract**: Add a `<a href="/flashcards">New flashcard</a>` entry to the signed-in link list, alongside `Generate`/`Flashcards`/`Dashboard`.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npm run build` succeeds

#### Manual Verification:

- From an empty collection, "Create manually" opens the form; saving a card shows it immediately and the empty-state message disappears
- From a non-empty page 1, the toggle button opens the form; saving prepends the card to the top of the grid, form clears and stays open, a second save also succeeds
- Saving while on page 2 navigates back to page 1 with the new card visible on top
- Saving a card when page 1 already has 20 cards keeps the visible page at 20 items and updates the page count correctly
- Save stays disabled while either field is empty or whitespace-only; enables once both have content
- A 1,000-character entry saves; a 1,001-character entry is blocked client-side
- A failed save (e.g. simulate a network error) shows the existing red error banner and leaves the draft text in place
- The "New flashcard" Topbar link navigates to `/flashcards` from `/generate` and `/dashboard`
- The "New flashcard" Topbar link also appears and works for a signed-in user on the homepage (`/`), which renders the same `Topbar.astro`
- No regressions to existing edit/delete/pagination behavior on `/flashcards`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- None — no test framework exists in this repo (matches S-01/S-03/S-04 convention).

### Integration Tests:

- None, for the same reason.

### Manual Testing Steps:

1. Sign in, navigate to `/flashcards` with an empty collection; use "Create manually" to add a first card and confirm it appears.
2. With several cards saved, use the persistent "New flashcard" button to add another; confirm it lands on top and the form clears and stays open for a second entry.
3. Page to page 2 of a multi-page collection, create a card, confirm the view snaps back to page 1 with the new card on top.
4. Attempt to save with an empty field (Save stays disabled), then with 1,001 characters in one field (blocked), then exactly 1,000 (accepted).
5. Confirm a second user cannot see the first user's manually created cards.

## Performance Considerations

None beyond the existing single-row insert/select already used by `generate.ts` and `[id].ts` — no new query patterns.

## Migration Notes

None — no schema change required.

## References

- Prior art: `context/archive/2026-09-05-saved-flashcard-maintenance/plan.md` (closest analog — extends the same list page + hook with a new mutation and a new UI affordance)
- `src/pages/api/flashcards/generate.ts` — POST/insert pattern this plan's endpoint follows
- `src/pages/api/flashcards/[id].ts` — validation/`jsonError` pattern
- `src/components/hooks/useFlashcardList.ts` — existing mutation shapes (`editFlashcard`, `deleteFlashcard`)
- `src/components/FlashcardGenerator.tsx` — character-counter UI pattern

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Manual creation API

#### Automated

- [x] 1.1 `npm run lint` passes
- [x] 1.2 `npm run build` succeeds

#### Manual

- [x] 1.3 `POST /api/flashcards` with valid front/back returns 201 and the new row has `status: 'accepted'`, `source_text: null`
- [x] 1.4 Empty or whitespace-only front/back returns 400
- [x] 1.5 Front or back over 1,000 characters returns 400
- [x] 1.6 Request without a valid session returns 401
- [x] 1.7 The created row is only visible to the creating user (existing RLS policy)

### Phase 2: Manual creation UI

#### Automated

- [ ] 2.1 `npm run lint` passes
- [ ] 2.2 `npm run build` succeeds

#### Manual

- [ ] 2.3 From an empty collection, "Create manually" opens the form; saving shows the card immediately and clears the empty-state message
- [ ] 2.4 From a non-empty page 1, the toggle button opens the form; saving prepends the card, form clears and stays open, a second save also succeeds
- [ ] 2.5 Saving while on page 2 navigates back to page 1 with the new card visible on top
- [ ] 2.6 Saving with a full 20-item page 1 keeps the visible page at 20 items and updates the page count correctly
- [ ] 2.7 Save stays disabled while either field is empty/whitespace-only; enables once both have content
- [ ] 2.8 A 1,000-character entry saves; a 1,001-character entry is blocked client-side
- [ ] 2.9 A failed save shows the existing red error banner and leaves the draft text in place
- [ ] 2.10 The "New flashcard" Topbar link navigates to `/flashcards` from `/generate` and `/dashboard`
- [ ] 2.11 The "New flashcard" Topbar link also appears and works for a signed-in user on the homepage (`/`)
- [ ] 2.12 No regressions to existing edit/delete/pagination behavior on `/flashcards`
