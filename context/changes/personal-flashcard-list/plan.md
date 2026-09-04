---
change_id: personal-flashcard-list
title: Personal flashcard list
status: planned
created: 2026-09-04
updated: 2026-09-04
---

# Plan: Personal flashcard list

## Overview

Deliver FR-006 (roadmap S-03): a signed-in user can browse the flashcards they've
saved to their collection. This adds the first read/list surface on top of the
`flashcards` table that S-01 created — a new paginated `GET /api/flashcards`
endpoint and a protected `/flashcards` page showing accepted cards, newest first.

## Current State Analysis

- `flashcards` table exists (`supabase/migrations/20260903000000_create_flashcards.sql`)
  with `status: 'pending' | 'accepted' | 'rejected'`, per-user RLS (`user_id = auth.uid()`
  on all four operations), and no index beyond the primary key.
- No `GET` handler exists anywhere under `src/pages/api/flashcards/` — only
  `POST generate.ts` (creates pending proposals) and `PATCH [id].ts` (accept/reject
  a single card) exist. No `index.ts` route file.
- `src/types.ts` has `Flashcard`, `FlashcardStatus`, and the generate/update DTOs —
  no list/pagination response type exists yet.
- No pagination, empty-state, or skeleton pattern exists anywhere in this codebase
  (confirmed by search) — this slice introduces the first one.
- `src/middleware.ts:4` protects routes by prefix via `PROTECTED_ROUTES` (currently
  `["/dashboard", "/generate"]`); a new route just needs to join that array.
- `src/pages/generate.astro` mounts its React island with `client:only="react"` —
  no server data, pure client fetch on mount via `useFlashcardProposals.ts`. This is
  the only existing "list of cards" UI (`src/components/FlashcardGenerator.tsx`),
  reused here for the grid/error-banner visual pattern, but it fetches nothing
  server-side — this plan introduces the repo's first server-fetch-then-hydrate
  page (origin: `code`, a pattern choice made in this plan, not an existing
  convention to follow).
- Both existing API routes independently call `supabase.auth.getUser()` for auth
  (not `Astro.locals.user`) and return a local `jsonError(message, status)` shape
  `{ error: string }` — this plan's new endpoint follows the same convention.

## Definitions

| Term | Decided meaning | Origin | On degenerate data | Verified by |
| --- | --- | --- | --- | --- |
| "saved flashcard" | Only rows with `status = 'accepted'` | user | A card left `pending` (unreviewed) or `rejected` never appears in this list | Phase 3 manual: seed one card of each status, confirm only the accepted one shows |
| "browse" (pagination) | Offset pagination, fixed page size 20, Prev/Next controls | user | Requesting a page past the last page returns an empty `flashcards` array with `200`, not an error | Phase 3 manual: request a page beyond `totalPages` |
| list order | `created_at DESC`, with `id DESC` as a tiebreaker | user (recency) + code (tiebreaker, see Critical Implementation Details) | Two cards from the same `/generate` batch can share an identical `created_at` down to the second; without the `id` tiebreaker, offset pagination could show one twice or skip it across page loads | Phase 1 automated: verify the query includes both `order()` calls |
| ownership ("their") | `user_id = auth.uid()`, enforced by RLS and an explicit `.eq("user_id", user.id)` filter | product (PRD Access Control: per-user isolation) | A request for another user's session never returns rows outside that session's `user_id` | Phase 3 manual: cross-user isolation check |

## Desired End State

A signed-in user visits `/flashcards` and sees their accepted flashcards as a
card grid, newest first, 20 per page, with Prev/Next controls. The first page
renders with data already present (no loading flash). Users with zero accepted
cards see a friendly empty state linking to `/generate`. A failed fetch (initial
or on page change) shows an inline error banner with a retry action, matching
the pattern already established in `FlashcardGenerator.tsx`. Unauthenticated
visits redirect to `/auth/signin`.

### Verification

- Manual walkthrough against the Definitions table's "Verified by" column plus
  the standard `npm run lint` / `npm run build` checks (no automated test
  framework exists in this repo yet — same convention as S-01).

### Key Discoveries

- `src/pages/api/flashcards/[id].ts:47-58` double-scopes every query with both
  RLS and an explicit `.eq("user_id", ...)` — the new endpoint follows this
  defense-in-depth convention.
- `src/components/hooks/useFlashcardProposals.ts:8-15` defines a local
  `readResponse<T>` fetch/error helper. It will be reused (not duplicated) for
  the new list hook — see Phase 2.
- No composite index exists on `flashcards` for `(user_id, status, created_at)` —
  the list query filters and sorts on exactly these columns, so this plan adds one.

## What We're NOT Doing

- Editing or deleting flashcards (FR-007/FR-008, roadmap S-04) — this list is
  read-only display only, with no edit/delete affordances, matching the
  roadmap's own sequencing (S-04 depends on S-03).
- Showing `pending` or `rejected` cards, or any status filter/badge UI — out of
  scope per the Definitions table above.
- Search or free-text filtering — not requested by FR-006.
- Any new site-wide navigation/menu linking to `/flashcards` — no persistent
  nav exists today (the unused `Topbar.astro` aside; `/generate` itself has no
  nav link either), so this plan doesn't introduce one.
- Automated tests / a new test framework — manual verification only, per
  existing repo convention (see S-01).
- Displaying `created_at` or `source_text` on each card — scoped to front/back
  text only per the confirmed design decision.

## Implementation Approach

Bottom-up, matching the S-01 convention: data layer (index + types + endpoint)
first, verifiable via `curl`, then the page/UI on top. Server-render the first
page inside the Astro page's frontmatter (a new pattern for this repo, see Key
Discoveries) so there's no loading flash on first visit; subsequent page
changes happen client-side against the same `GET` endpoint the server used.
Both the endpoint and the Astro page share one `listFlashcards()` service
function so the query logic isn't duplicated between the two call sites.

## Critical Implementation Details

- **Pagination stability (ordering tiebreaker)**: Rows inserted in the same
  `/generate` batch (see `generate.ts:49-57`) can share an identical
  `created_at` timestamp. Sorting by `created_at DESC` alone is not a total
  order in that case, which means offset pagination (`.range()`) can
  nondeterministically duplicate or skip a row across two page loads whose
  results straddle a tied boundary. Add `.order("id", { ascending: false })`
  as a secondary sort key wherever `created_at` is the primary sort, so the
  ordering is deterministic and pagination is stable.
- **Offset-pagination drift (accepted risk)**: separately from the tiebreaker
  above, if a new card is accepted (inserted newest-first) while a user is
  actively paginating, every row after it shifts by one offset — Prev/Next
  can then show a duplicate or skip a card relative to what was already
  seen. This is an inherent tradeoff of offset pagination (vs. cursor-based)
  and is accepted for this MVP given single-user, low-frequency usage; not
  something this plan builds a fix for.

## Phase 1: List API & types

### Overview

Add the query index, list response type, a shared `listFlashcards()` service,
and the new `GET /api/flashcards` endpoint.

### Changes Required:

#### 1. Composite index for the list query

**File**: `supabase/migrations/20260904000000_add_flashcards_list_index.sql`

**Intent**: The list query filters on `user_id` + `status` and sorts on
`created_at`/`id` — support that access pattern with a matching index instead
of a full table scan per request.

**Contract**: New migration, additive only (no change to existing schema or
policies):

```sql
create index if not exists flashcards_user_status_created_idx
  on flashcards (user_id, status, created_at desc, id desc);
```

#### 2. List response type

**File**: `src/types.ts`

**Intent**: Give the endpoint and the Astro page a shared, typed response
shape for a page of results.

**Contract**: Add one exported interface, following the existing DTO
naming/shape convention (`GenerateFlashcardsResponse`, etc.):

```ts
export interface ListFlashcardsResponse {
  flashcards: Flashcard[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
```

#### 3. Shared list service

**File**: `src/lib/services/flashcards.ts` (new)

**Intent**: One function, `listFlashcards(supabase, userId, page)`, that runs
the accepted-only, paginated, ordered query and shapes it into
`ListFlashcardsResponse`. Used by both the new API route (Phase 1) and the
Astro page's server-side first-page fetch (Phase 2) so the query logic exists
once.

**Contract**: `listFlashcards(supabase: SupabaseClient, userId: string, page: number): Promise<ListFlashcardsResponse>`. Fixed page size of 20 (`FLASHCARDS_PAGE_SIZE = 20`, not client-configurable). Internally: `.from("flashcards").select("*", { count: "exact" }).eq("user_id", userId).eq("status", "accepted").order("created_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + limit - 1)`, with `offset = (page - 1) * limit` and `totalPages = Math.max(1, Math.ceil(total / limit))`. Throws on a Supabase query error (callers decide how to surface it).

#### 4. List endpoint

**File**: `src/pages/api/flashcards/index.ts` (new)

**Intent**: `GET` handler returning one page of the caller's accepted
flashcards, following the same auth/validation/error conventions as
`generate.ts` and `[id].ts`.

**Contract**: `export const prerender = false; export const GET: APIRoute`. Same
auth sequence as the existing two routes (`createClient` → null check →
`getUser()` → 401 `jsonError`). Query param `page` validated with
`z.coerce.number().int().min(1).default(1)` via `safeParse` on
`context.url.searchParams.get("page") ?? undefined` — the `?? undefined` is
required because `URLSearchParams.get()` returns `null` (not `undefined`)
when the param is absent, and zod's `.default()` only substitutes for
`undefined`; passing `null` through would coerce to `0` and fail `.min(1)`
instead of defaulting to `1`. Invalid value → 400 `jsonError` with the zod
issue message (same pattern as the other routes' body validation).
Calls `listFlashcards`; a thrown query error → 500 `jsonError("Failed to load flashcards")`.
Success → `Response.json(result)` with the `ListFlashcardsResponse` body (200,
matching `[id].ts`'s plain-object response style rather than `generate.ts`'s
explicit-status style since this is a read, not a create).

### Success Criteria:

#### Automated Verification:

- `npx supabase db reset` (or migration apply) runs cleanly against local Supabase
- `npm run lint` passes on new files
- `npm run build` succeeds

#### Manual Verification:

- `curl` GET (authenticated) with 25 accepted cards seeded returns 20 rows on page 1, 5 on page 2, `total: 25`, `totalPages: 2`
- `curl` GET with no `page` query param returns page 1 (defaults correctly, does not 400)
- `curl` GET with `page=99` (beyond total) returns `200` and an empty `flashcards` array, not an error
- `curl` GET without a session cookie returns 401
- Seeding one `pending`, one `rejected`, and one `accepted` card confirms only the `accepted` one is returned

---

## Phase 2: Browse page & UI

### Overview

Protected `/flashcards` page rendering the first page server-side, plus the
React island, hook, and pagination/empty/error UI for browsing subsequent pages.

### Changes Required:

#### 1. Protect the route

**File**: `src/middleware.ts`

**Intent**: `/flashcards` needs the same auth gate as `/dashboard` and `/generate`.

**Contract**: Add `"/flashcards"` to the `PROTECTED_ROUTES` array (line 4).

#### 2. Shared fetch/error helper

**File**: `src/lib/http.ts` (new)

**Intent**: `useFlashcardProposals.ts` already defines a `readResponse<T>`
helper that parses a JSON response and throws using the `{ error: string }`
shape on failure. The new list hook needs the identical behavior — extract it
once instead of duplicating it a second time.

**Contract**: Export `readJsonResponse<T>(response: Response): Promise<T>`
with the same body as the current local `readResponse` in
`useFlashcardProposals.ts:8-15`. Update `useFlashcardProposals.ts` to import
it from here instead of defining it locally (no behavior change).

#### 3. List hook

**File**: `src/components/hooks/useFlashcardList.ts` (new)

**Intent**: Own the client-side state for the browse page — the current page's
cards, pagination metadata, loading/error state — seeded from the server-
rendered first page, and re-fetch on page change.

**Contract**: `useFlashcardList(initialData: ListFlashcardsResponse | null, initialError?: string)`. State: `flashcards`, `page`, `totalPages`, `total` (seeded from `initialData`, defaulting to an empty/1/1/0 shape when `initialData` is `null`), `error` (seeded from `initialError`), `isLoading`. Exposes `goToPage(page: number)` — sets `isLoading`, `GET /api/flashcards?page=<page>` via `readJsonResponse<ListFlashcardsResponse>`, replaces state on success, sets `error` and leaves existing `flashcards`/`page` in place on failure (no data loss, mirrors `updateFlashcard`'s rollback-on-error pattern in `useFlashcardProposals.ts:65-67`). `retry()` re-runs `goToPage(page)` for the current page.

#### 4. List component

**File**: `src/components/FlashcardList.tsx` (new)

**Intent**: Render the card grid, pagination controls, empty state, and error
banner, reusing `Card`/`CardHeader`/`CardTitle`/`CardContent`/`Button` from
`src/components/ui/` and the grid/error-banner visual patterns already
established in `FlashcardGenerator.tsx`.

**Contract**: `export default function FlashcardList({ initialData, initialError }: { initialData: ListFlashcardsResponse | null; initialError?: string })`, backed by `useFlashcardList`. Each card shows `front`/`back` only (`key={card.id}`), no action buttons (per "What We're NOT Doing"). `total === 0` (and no error) → empty state: message + a link (`<a href="/generate">`) to the generate page. `error` set → inline `role="alert"` banner with a "Retry" button calling `retry()`, matching `FlashcardGenerator.tsx:67-88`'s markup pattern. Pagination controls: "Page {page} of {totalPages}" text plus Prev/Next buttons calling `goToPage(page - 1)` / `goToPage(page + 1)`, disabled at the respective boundary and while `isLoading`.

#### 5. Page

**File**: `src/pages/flashcards.astro` (new)

**Intent**: Server-render the first page of the user's accepted flashcards and
hydrate the island with it — no loading flash on first visit.

**Contract**: Frontmatter creates a Supabase client (`createClient(Astro.request.headers, Astro.cookies)`), reads `Astro.locals.user` (non-null — middleware already guards this route), and calls `listFlashcards(supabase, user.id, 1)` in a `try`/`catch`; on success pass `initialData` to the island, on failure pass `initialData={null}` and `initialError={message}` so the island renders the same error-with-retry state client-side would. Mount with `<FlashcardList client:load initialData={initialData} initialError={initialError} />` (`client:load`, not `client:only`, since this page — unlike `/generate` — has server data to hydrate against).

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npm run build` succeeds

#### Manual Verification:

- Visiting `/flashcards` while signed in with 25+ accepted cards shows page 1 immediately (no spinner flash), 20 cards, front/back only
- Clicking Next/Prev loads the next/previous page and updates the "Page X of Y" text; Prev is disabled on page 1, Next disabled on the last page
- A user with zero accepted cards sees the empty state with a working link to `/generate`
- Simulating a failed page-change fetch shows the inline error banner with a working Retry button, without losing the currently displayed page's cards
- Unauthenticated visit to `/flashcards` redirects to `/auth/signin`

---

## Testing Strategy

Manual verification only, per repo convention (no automated test framework
configured yet). Each phase's Manual checklist above must pass before moving
to the next phase.

### Manual Testing Steps:

1. Seed a mix of `pending`/`accepted`/`rejected` cards (and 25+ accepted ones)
   for one test user via SQL or the existing `/generate` → accept flow.
2. Run through both phases' Manual Verification checklists in order.
3. Sign in as a second user and confirm `/flashcards` shows zero of the first
   user's cards (cross-user isolation).

## Performance Considerations

The new composite index (Phase 1) keeps the list query an index scan rather
than a full table scan as the table grows. Page size is fixed at 20 server-side
(not client-configurable), bounding response payload size regardless of query
params.

## Migration Notes

One additive migration (`supabase/migrations/20260904000000_add_flashcards_list_index.sql`,
index only — no column or policy changes, no backfill needed).

## References

- Related plan: `context/archive/2026-09-02-reviewed-ai-flashcards/plan.md` (S-01 — established the `flashcards` table, RLS, and API/UI conventions this plan follows)
- `context/foundation/prd.md` — FR-006, Access Control
- `context/foundation/roadmap.md` — S-03 entry (Outcome, Prerequisites: S-01)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: List API & types

#### Automated

- [x] 1.1 `npx supabase db reset` (or migration apply) runs cleanly against local Supabase — efdad9a
- [x] 1.2 `npm run lint` passes on new files — efdad9a
- [x] 1.3 `npm run build` succeeds — efdad9a

#### Manual

- [x] 1.4 `curl` GET (authenticated) with 25 accepted cards seeded returns 20 rows on page 1, 5 on page 2, `total: 25`, `totalPages: 2` — efdad9a
- [x] 1.5 `curl` GET with `page=99` (beyond total) returns `200` and an empty `flashcards` array, not an error — efdad9a
- [x] 1.6 `curl` GET without a session cookie returns 401 — efdad9a
- [x] 1.7 Seeding one `pending`, one `rejected`, and one `accepted` card confirms only the `accepted` one is returned — efdad9a
- [x] 1.8 `curl` GET with no `page` query param returns page 1 (defaults correctly, does not 400) — efdad9a

### Phase 2: Browse page & UI

#### Automated

- [x] 2.1 `npm run lint` passes
- [x] 2.2 `npm run build` succeeds

#### Manual

- [x] 2.3 Visiting `/flashcards` while signed in with 25+ accepted cards shows page 1 immediately (no spinner flash), 20 cards, front/back only
- [x] 2.4 Clicking Next/Prev loads the next/previous page and updates the "Page X of Y" text; Prev is disabled on page 1, Next disabled on the last page
- [x] 2.5 A user with zero accepted cards sees the empty state with a working link to `/generate`
- [x] 2.6 Simulating a failed page-change fetch shows the inline error banner with a working Retry button, without losing the currently displayed page's cards
- [x] 2.7 Unauthenticated visit to `/flashcards` redirects to `/auth/signin`
