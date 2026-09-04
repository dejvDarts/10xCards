# Personal flashcard list — Plan Brief

> Full plan: `context/changes/personal-flashcard-list/plan.md`

## What & Why

Deliver FR-006 / roadmap S-03: a signed-in user can browse the flashcards
they've saved to their collection. Right now, once a card is accepted during
the S-01 review flow, it disappears from the UI entirely — there's no way to
see it again. This is the first read/list surface on the `flashcards` table
and the prerequisite for S-04 (edit/delete).

## Starting Point

The `flashcards` table (with `status: pending|accepted|rejected` and per-user
RLS) and the review flow (`POST /api/flashcards/generate`, `PATCH
/api/flashcards/[id]`) already exist from S-01. There is no `GET` endpoint, no
list/pagination types, and no pagination or empty-state UI pattern anywhere in
the codebase yet.

## Desired End State

A user visits `/flashcards` and sees their accepted cards as a grid, newest
first, 20 per page, with Prev/Next controls, rendered without a loading flash
on first visit. Zero cards shows a friendly empty state pointing at
`/generate`. A failed fetch shows an inline retry banner.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Which statuses count as "saved" | `accepted` only | Matches PRD/S-01 language; pending/rejected are review-flow states, not collection members |
| Pagination approach | Offset (page/limit), 20/page, Prev/Next | Standard, scales past MVP volume, matches Supabase `.range()` |
| Sort order | `created_at DESC`, `id DESC` tiebreak | Newest-first matches "just generated, now review" mental model; tiebreak makes offset pagination deterministic |
| Rendering | Server-rendered first page + client-side pagination | No loading flash on first visit; first server-fetch-then-hydrate pattern in this repo |
| Card fields shown | Front + back text only | Matches FR-006's plain "browse" ask, no extra data plumbing |
| Interaction scope | Read-only, no edit/delete affordances | S-04 (next slice) owns edit/delete UI; avoids building UI S-04 will immediately change |
| Testing | Manual verification only | Matches repo convention — no test framework exists yet |

## Scope

**In scope:**
- `GET /api/flashcards` (paginated, accepted-only, newest-first)
- `/flashcards` protected page + `FlashcardList` island + `useFlashcardList` hook
- Empty state, inline error/retry, Prev/Next pagination
- New composite index on `flashcards(user_id, status, created_at, id)`

**Out of scope:**
- Edit/delete (S-04), status filtering, search
- Site-wide navigation linking to the new page
- Automated tests

## Architecture / Approach

A shared `listFlashcards()` service function backs both the new API route and
the Astro page's server-side first-page fetch, so the query logic (filter,
sort, paginate) exists exactly once. The React island and hook mirror the
existing `FlashcardGenerator`/`useFlashcardProposals` shape (local state,
`fetch` + shared JSON/error helper).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. List API & types | Index, types, shared service, `GET` endpoint | Pagination correctness under duplicate `created_at` values (mitigated by `id` tiebreak) |
| 2. Browse page & UI | Protected page, island, hook, pagination/empty/error UI | First server-fetch-then-hydrate pattern in this repo — no prior example to copy |

**Prerequisites:** S-01 (done) — `flashcards` table and auth/API conventions.
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- Fixed page size (20, server-side) is a design choice, not a stated
  requirement — revisit if user feedback wants it configurable.
- No composite index existed before this plan; if the migration turns out to
  need tuning under real data volume, that's a fast follow, not a blocker.
- Offset pagination can show a duplicate or skip a card if the collection
  changes between page loads (e.g. accepting a new card in another tab while
  paginating) — an inherent tradeoff of offset vs. cursor pagination, accepted
  for MVP given single-user, low-frequency usage.

## Success Criteria (Summary)

- A user can see every accepted flashcard they own, newest first, across pages
- No other user's flashcards are ever visible
- Zero cards and failed fetches both have a clear, actionable UI state
