# Spaced-Repetition Review Session (S-05) Implementation Plan

## Overview

Implement S-05 from `context/foundation/roadmap.md:152-163`: a signed-in user studies their saved (accepted) flashcards in a review session driven by the FSRS algorithm (`ts-fsrs`, selected in F-02 — see `context/changes/choose-review-algorithm/research.md`). A session fetches every accepted flashcard currently due, walks through them one at a time (reveal back, rate 1-4), persists the FSRS scheduling result per rating, and ends with a simple "all done" message once the queue is empty.

## Current State Analysis

- `flashcards` table (`supabase/migrations/20260903000000_create_flashcards.sql`) has no review-state columns — every flashcard today is `front`/`back`/`source_text`/`status`/timestamps only. This is new schema, not an adaptation.
- `src/lib/services/flashcards.ts` already has the per-user, `status='accepted'`-filtered query pattern (`baseQuery`, `flashcards.ts:7-9`) that the due-list query mirrors.
- API routes (`src/pages/api/flashcards/index.ts`, `src/pages/api/flashcards/[id].ts`) establish the fixed skeleton every new route follows: `export const prerender = false`, `createClient()` + `auth.getUser()` guard returning 401, zod `.strict()` body validation, a local `jsonError()` helper, uuid validation on path params (`[id].ts:33`).
- `src/components/hooks/useFlashcardList.ts` and `FlashcardList.tsx` establish the hook-owns-state / component-is-presentational split, with `fetch()` + `readJsonResponse<T>()` (`src/lib/http.ts:5-12`) as the only API-calling convention — no shared API client exists, by design (`code` origin — not a constraint to introduce here).
- `src/pages/flashcards.astro:16-25` establishes the SSR-fetch-then-hydrate pattern (`client:load` + `initialData`/`initialError` props) this plan reuses for the review page.
- `src/middleware.ts:4` already protects everything under `/flashcards` — a new `/flashcards/review` route needs no middleware change.
- No test framework is configured anywhere in the repo (no vitest/jest/playwright, no test files), and CI (`.github/workflows/ci.yml`) runs only `npm run lint` + `npm run build`. Both prior shipped slices (S-03, S-04 — see `context/archive/2026-09-04-personal-flashcard-list/plan.md` and `context/archive/2026-09-05-saved-flashcard-maintenance/plan.md`) used manual-verification-only plans for this reason; this plan does the same rather than inventing test tooling that doesn't exist.
- `context/foundation/lessons.md` records that new `supabase/migrations/*.sql` files must reach the production Supabase project, not just local Docker — this is already automated (CI's `deploy` job runs `supabase db push`), so this plan's migration needs no extra manual step, just awareness that it rides the existing pipeline.

## Definitions

| Term | Decided meaning | Origin | On degenerate data | Verified by |
| ---- | ---------------- | ------ | ------------------- | ----------- |
| "saved flashcards" (what a session studies) | `status = 'accepted'` flashcards only | product (PRD: "accepted flashcards immediately available for study") | pending/rejected flashcards never appear in a session | Manual Testing Step 3 (Phase 4) |
| "due" (which accepted cards enter a session) | `due <= now()`; every flashcard is immediately due at creation (`due` column defaults to `now()`) | user (confirmed via planning question) | a flashcard created before this migration backfills to `due = now()`, making it immediately due in the first post-deploy session | Manual Testing Step 2 (Phase 4) |
| in-session "Again" requeue | Not requeued. FSRS is configured with `enable_short_term: false`, so every rating schedules directly on the day-scale curve — a card rated "Again" leaves the session's fixed queue and only reappears in a future due-check. Symmetrically, a card that newly becomes due while a session is already open also won't appear until a future session, since the due-list is fixed once at session start | user (confirmed via planning question) | rating the same card "Again" twice in one sitting does not re-show it a second time that sitting | Manual Testing Step 4 (Phase 4) |
| rating scale | Full 4-button FSRS scale (Again / Hard / Good / Easy), passed straight through as `ts-fsrs`'s `Grade` (1-4) — no remapping | user (confirmed via planning question) | n/a — direct passthrough | Manual Testing Step 1 (Phase 4) |
| due-list ordering | `due` ascending, then `id` ascending as a tiebreak | product (matches `listFlashcards`'s existing pagination-determinism convention) | Phase 1's backfill gives every pre-existing accepted flashcard the identical `due` timestamp — a guaranteed multi-row tie on first deploy | Manual: seed two flashcards with the same `due`, confirm stable ordering across repeated `GET /api/flashcards/due` calls |

## Desired End State

A signed-in user visits `/flashcards/review`, sees the front of the first due accepted flashcard, reveals the back, picks one of 4 ratings, and immediately sees the next due card. When no due cards remain (at session start, or once the queue is exhausted), they see a simple "no cards due" message linking back to `/flashcards`. Each rating persists FSRS's updated scheduling state to the flashcard's row, so the card's next `due` date reflects the algorithm's decision.

### Key Discoveries:

- `ts-fsrs`'s `Rating` enum values (`Again=1, Hard=2, Good=3, Easy=4`) match the desired 4-button UI 1:1 — no mapping layer needed (`context/changes/choose-review-algorithm/ts-fsrs-api-reference.md`).
- Giving the new columns DB-level defaults (`due timestamptz not null default now()`, etc.) means both the historical backfill AND every future `INSERT` (manual creation, AI-accept flow) get correct initial FSRS state with zero application-code changes — `src/pages/api/flashcards/index.ts`'s `POST` handler and the AI-generation accept path need no edits.
- `flashcards.ts`'s `baseQuery` pattern (`.eq("user_id", userId).eq("status", "accepted")`) is reused verbatim for the due-list query, just adding `.lte("due", ...)` and an `order("due")`.

## What We're NOT Doing

- Daily new/review limits (Anki-style caps) — a session always includes every currently-due accepted flashcard.
- Review history / stats — no `ReviewLog` persistence, no retention charts, no per-card history view.
- Undo / rollback of a rating — no "undo last rating" control, even though `ts-fsrs` supports `rollback()`.
- Per-user FSRS parameter tuning UI — no settings surface for retention target or weights; every user gets the same defaults (`request_retention: 0.9`, default weights, `enable_short_term: false`).
- In-session requeue of "Again"-rated cards (see Definitions) — a session is a single fixed pass over the due-list fetched at session start.
- A session summary/results screen — session end is a simple message, no tallies.
- A separate `flashcard_reviews`/audit table — FSRS state lives directly on the `flashcards` row (per `codebase-compatibility-review.md`).

## Implementation Approach

Extend the existing `flashcards` table with FSRS `Card` fields (1:1 relationship, no join), add a small service module wrapping `ts-fsrs`, expose it through two new API routes following the exact skeleton already used by `flashcards/index.ts` and `flashcards/[id].ts`, and build the review UI as a new hook + component + page mirroring `useFlashcardList`/`FlashcardList`/`flashcards.astro`. The due-list is fetched once at session start (`GET /api/flashcards/due`); the client iterates it locally, POSTing one rating per card (`POST /api/flashcards/[id]/review`) without re-fetching the due-list mid-session (matches the "no in-session requeue" decision).

## Critical Implementation Details

**State sequencing** — `generatorParameters({ enable_short_term: false })` must be passed when constructing the `fsrs()` scheduler in Phase 2's service module. This single flag is what makes "no in-session requeue" true: with the default `enable_short_term: true`, a card rated "Again" would schedule ~1-10 minutes later (`ts-fsrs` default learning steps) rather than on the day-scale curve, and the session as designed here would never re-check for it. Getting this flag right is load-bearing for the Definitions table above, not just a tuning knob.

## Phase 1: FSRS review-state schema

### Overview

Add FSRS `Card` fields directly to the `flashcards` table via DB-level column defaults, so both the historical backfill and all future inserts get correct initial state automatically.

### Changes Required:

#### 1. New migration

**File**: `supabase/migrations/20260906000000_add_review_state_to_flashcards.sql`

**Intent**: Add the FSRS `Card` fields (minus the deprecated `elapsed_days`) as columns on `flashcards`, each with a default matching `ts-fsrs`'s `createEmptyCard()` output, so every row — existing or new — starts as an immediately-due, never-reviewed card. Add a partial index supporting the due-list query.

**Contract**:
```sql
alter table flashcards
  add column due timestamptz not null default now(),
  add column stability double precision not null default 0,
  add column difficulty double precision not null default 0,
  add column scheduled_days integer not null default 0,
  add column learning_steps integer not null default 0,
  add column reps integer not null default 0,
  add column lapses integer not null default 0,
  add column state smallint not null default 0 check (state in (0, 1, 2, 3)),
  add column last_review timestamptz;

create index if not exists flashcards_due_idx
  on flashcards (user_id, due)
  where status = 'accepted';
```
No RLS policy changes needed — the existing per-operation policies (`flashcards_select_own`, etc.) are row-scoped and already cover these new columns.

#### 2. Shared types

**File**: `src/types.ts`

**Intent**: Reflect the new columns on the `Flashcard` entity (every `select("*")` now returns them), and add the request/response DTOs the new API routes use.

**Contract**: Add `due: string`, `stability: number`, `difficulty: number`, `scheduled_days: number`, `learning_steps: number`, `reps: number`, `lapses: number`, `state: 0 | 1 | 2 | 3`, `last_review: string | null` to `Flashcard`. Add `DueFlashcardsResponse { flashcards: Flashcard[] }` and `SubmitReviewRequest { rating: 1 | 2 | 3 | 4 }`.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- `npx supabase db reset` (local) applies the new migration cleanly on top of the existing two
- A flashcard created before this migration (or any pre-existing row) shows `due` = its migration-apply timestamp and `state = 0` after reset/reapply

---

## Phase 2: FSRS scheduling service

### Overview

Wrap `ts-fsrs` in a small service module providing the due-list query and the review-recording mutation, matching the existing `src/lib/services/flashcards.ts` shape.

### Changes Required:

#### 1. Install dependency

**File**: `package.json`

**Intent**: Add `ts-fsrs` (zero runtime deps, MIT, confirmed Cloudflare Workers-compatible in `context/changes/choose-review-algorithm/codebase-compatibility-review.md`).

**Contract**: `npm install ts-fsrs`.

#### 2. Review service

**File**: `src/lib/services/reviews.ts`

**Intent**: Provide `getDueFlashcards(supabase, userId)` returning accepted flashcards due now, ordered soonest-due-first; and `recordReview(supabase, userId, flashcardId, rating)` that loads the flashcard, runs it through the FSRS scheduler, persists the updated state, and returns the updated row (or `null` if the flashcard doesn't exist / isn't owned by the user / isn't accepted).

**Contract**:
```ts
import { fsrs, generatorParameters, type Card, type Grade, State } from "ts-fsrs";

const scheduler = fsrs(generatorParameters({ enable_short_term: false }));

export async function getDueFlashcards(supabase: SupabaseClient, userId: string): Promise<Flashcard[]>;
export async function recordReview(
  supabase: SupabaseClient,
  userId: string,
  flashcardId: string,
  rating: Grade,
): Promise<Flashcard | null>;
```
Internal helpers convert between the DB row shape (ISO date strings, `state: 0-3`) and `ts-fsrs`'s `Card` shape (`Date` objects, `State` enum) — see the row↔`Card` mapping already worked out in `context/changes/choose-review-algorithm/ts-fsrs-api-reference.md`'s "Persisting across requests" section. `getDueFlashcards` orders by `due` ascending, then `id` ascending as a deterministic tiebreak (mirrors `listFlashcards`'s `.order("id")` in `flashcards.ts:28-29` — necessary here since Phase 1's backfill gives every pre-existing row the exact same `due` timestamp). `recordReview`'s update payload includes `updated_at: new Date().toISOString()`, matching the existing PATCH convention (`flashcards/[id].ts:56`) since the table has no DB trigger to do this automatically.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`
- Type checking passes as part of `npm run build` (Astro's build runs `tsc` via `astro check`/`astro sync`)

---

## Phase 3: Review session API

### Overview

Expose the service through two routes following the exact skeleton of the existing `flashcards` API routes.

### Changes Required:

#### 1. Due-list endpoint

**File**: `src/pages/api/flashcards/due.ts`

**Intent**: Return the signed-in user's currently-due accepted flashcards for a new session.

**Contract**: `export const prerender = false; export const GET: APIRoute`. Same auth-guard skeleton as `flashcards/index.ts`'s `GET` (`createClient` → `jsonError(500)` if unconfigured → `auth.getUser()` → `jsonError(401)` if absent). Calls `getDueFlashcards(supabase, user.id)`, returns `Response.json({ flashcards })` as `DueFlashcardsResponse`.

#### 2. Review-submission endpoint

**File**: `src/pages/api/flashcards/[id]/review.ts`

**Intent**: Record one rating for one flashcard.

**Contract**: `export const prerender = false; export const POST: APIRoute`. Same auth-guard skeleton, plus `context.params.id` UUID validation exactly like `flashcards/[id].ts:32-35`. Body validated with `z.object({ rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]) }).strict()`. Calls `recordReview(supabase, user.id, cardId, parsed.data.rating)`; `jsonError("Flashcard not found", 404)` if it returns `null` (matches `[id].ts:66-68`'s not-found pattern); otherwise `Response.json(updated)` (matches the PATCH convention of returning the updated resource).

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- `GET /api/flashcards/due` while signed in returns only `status='accepted'` flashcards with `due <= now`
- `GET /api/flashcards/due` while signed out returns 401
- `POST /api/flashcards/[id]/review` with `{"rating": 3}` on an owned, accepted, due flashcard returns 200 with an updated `due` date in the future
- `POST /api/flashcards/[id]/review` on another user's flashcard ID returns 404 (RLS prevents the row from being found)
- `POST /api/flashcards/[id]/review` with `{"rating": 5}` or a missing `rating` returns 400

---

## Phase 4: Review session UI

### Overview

Build the study-session experience: a hook driving a local queue over the due-list, a presentational component for the flip-and-rate interaction, a new protected page, and an entry point from the existing flashcard list.

### Changes Required:

#### 1. Review session hook

**File**: `src/components/hooks/useReviewSession.ts`

**Intent**: Own the session's local state — the due-list queue, current position, front/back reveal state, and submission busy/error state — mirroring `useFlashcardList`'s state-plus-async-actions shape.

**Contract**: `useReviewSession(initialData: DueFlashcardsResponse | null, initialError?: string)` returning `{ currentCard, isRevealed, reveal, submitRating, isSubmitting, error, remainingCount, isSessionComplete }`. `submitRating(rating)` POSTs to `/api/flashcards/${currentCard.id}/review`, advances to the next queue item on success (resetting `isRevealed`), and sets `error` (without advancing) on failure — same try/catch/finally shape as `useFlashcardList`'s mutation actions.

#### 2. Review session component

**File**: `src/components/ReviewSession.tsx`

**Intent**: Render the current card's front, a reveal control, the back once revealed, the 4 rating buttons, and the empty/complete state — using the existing `Card` and `Button` UI primitives (`src/components/ui/card.tsx`, `button.tsx`); no new dialog primitive is needed for this interaction.

**Contract**: `ReviewSession({ initialData, initialError }: { initialData: DueFlashcardsResponse | null; initialError?: string })`. Rating buttons are disabled while `isRevealed` is false and while `isSubmitting` is true (prevents double-submit, matching the `mutatingCardIds` pattern's intent).

#### 3. Review page

**File**: `src/pages/flashcards/review.astro`

**Intent**: SSR-fetch the due-list (same pattern as `flashcards.astro:16-25`, calling `getDueFlashcards` instead of `listFlashcards`) and hydrate `ReviewSession` with it.

**Contract**: `<ReviewSession client:load initialData={initialData} initialError={initialError} />`. No `PROTECTED_ROUTES` change needed — `/flashcards/review` already matches the existing `/flashcards` prefix guard (`src/middleware.ts:4`).

#### 4. Entry point from the flashcard list

**File**: `src/pages/flashcards.astro`

**Intent**: Give the user a way to reach the review session from the page where their collection lives.

**Contract**: Add a link/button to `/flashcards/review` near the existing page heading (e.g. next to "Your saved flashcards.").

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Visiting `/flashcards/review` with due accepted flashcards shows the first card's front only
- Clicking reveal shows the back and the 4 rating buttons
- Picking a rating advances to the next due card, and repeating this for all due cards ends with the "no cards due" message
- Visiting `/flashcards/review` with zero due flashcards immediately shows the "no cards due" message
- Signing in as a second user and visiting `/flashcards/review` never shows the first user's flashcards (RLS/cross-user isolation)
- The "Study" link on `/flashcards` navigates to `/flashcards/review`

---

## Testing Strategy

Manual verification only, per repo convention (no automated test framework configured yet — see Current State Analysis). Each phase's Manual checklist above must pass before moving to the next phase.

### Manual Testing Steps:

1. Seed at least 5 accepted flashcards for one test user (via the existing manual-creation flow or `/api/flashcards` POST), and confirm all 5 appear in `/flashcards/review` as due (rating scale definition check).
2. Confirm a flashcard created before this migration (or immediately after `db reset`) is immediately due (due definition check).
3. Create one `pending` and one `rejected` flashcard (via the AI-generation review flow) and confirm neither appears in the due list (saved-flashcards definition check).
4. Rate one card "Again", finish the rest of the session, and confirm the "Again"-rated card does not reappear before the session ends (in-session requeue definition check).
5. Sign in as a second user with their own accepted flashcards and confirm `/flashcards/review` only ever shows that user's own cards.

## Performance Considerations

Given the PRD's stated small data volume and per-user scale, a single unpaginated due-list query (bounded by the new `flashcards_due_idx (user_id, due) where status = 'accepted'` partial index) is sufficient — no pagination or cursor is needed for the due-list endpoint at this scale.

## Migration Notes

The new migration file is picked up automatically by the existing CI `deploy` job's `supabase db push` step (see `context/foundation/lessons.md`) — no manual production step is required, but confirm the deploy job's log shows the new migration applying before considering this change fully live in production.

## References

- Research: `context/changes/choose-review-algorithm/research.md`
- API reference: `context/changes/choose-review-algorithm/ts-fsrs-api-reference.md`
- Compatibility review: `context/changes/choose-review-algorithm/codebase-compatibility-review.md`
- Similar implementation: `src/lib/services/flashcards.ts`, `src/pages/api/flashcards/index.ts`, `src/components/hooks/useFlashcardList.ts`, `src/pages/flashcards.astro`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: FSRS review-state schema

#### Automated

- [x] 1.1 Lint passes: `npm run lint` — ae4e2a6
- [x] 1.2 Build passes: `npm run build` — ae4e2a6

#### Manual

- [x] 1.3 `npx supabase db reset` applies the new migration cleanly — ae4e2a6
- [x] 1.4 A pre-existing flashcard shows `due` = reset timestamp and `state = 0` after reset/reapply — ae4e2a6

### Phase 2: FSRS scheduling service

#### Automated

- [x] 2.1 Lint passes: `npm run lint` — 3d3aae5
- [x] 2.2 Build passes: `npm run build` — 3d3aae5
- [x] 2.3 Type checking passes as part of `npm run build` — 3d3aae5

### Phase 3: Review session API

#### Automated

- [x] 3.1 Lint passes: `npm run lint` — 27abccb
- [x] 3.2 Build passes: `npm run build` — 27abccb

#### Manual

- [x] 3.3 `GET /api/flashcards/due` returns only due, accepted flashcards for the signed-in user — 27abccb
- [x] 3.4 `GET /api/flashcards/due` returns 401 when signed out — 27abccb
- [x] 3.5 `POST /api/flashcards/[id]/review` with a valid rating returns 200 with an updated future `due` — 27abccb
- [x] 3.6 `POST /api/flashcards/[id]/review` on another user's flashcard returns 404 — 27abccb
- [x] 3.7 `POST /api/flashcards/[id]/review` with an invalid rating returns 400 — 27abccb

### Phase 4: Review session UI

#### Automated

- [x] 4.1 Lint passes: `npm run lint` — 03abb31
- [x] 4.2 Build passes: `npm run build` — 03abb31

#### Manual

- [x] 4.3 First due card shows front only until revealed — 03abb31
- [x] 4.4 Reveal shows back + 4 rating buttons — 03abb31
- [x] 4.5 Rating advances through the full due queue to the "no cards due" message — 03abb31
- [x] 4.6 Zero due cards shows the "no cards due" message immediately — 03abb31
- [x] 4.7 Cross-user isolation holds for the review session — 03abb31
- [x] 4.8 "Study" link on `/flashcards` navigates to `/flashcards/review` — 03abb31
