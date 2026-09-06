---
change_id: choose-review-algorithm
purpose: Verify ts-fsrs-api-reference.md against the actual codebase before planning S-05
reviewed_at: 2026-09-06
verdict: compatible — no blockers
---

## What was checked

| Constraint | Found in codebase | Compatible with `ts-fsrs`? |
|---|---|---|
| Runtime | `wrangler.jsonc`: Cloudflare Workers, `compatibility_flags: ["nodejs_compat"]` | Yes — and with `nodejs_compat` on, even Node built-ins would be polyfilled if `ts-fsrs` needed them (it doesn't: zero runtime deps, pure JS/TS) |
| Module system | `package.json`: `"type": "module"` | Yes — native ESM import of `ts-fsrs`'s `dist/index.mjs`, no CJS interop needed |
| Language | TypeScript 5.9.3, `astro/tsconfigs/strict` | Yes — `ts-fsrs` ships its own `.d.ts`; `State`/`Rating` are real TS `enum`s (importable as values), `Card`/`ReviewLog` are plain interfaces. No `verbatimModuleSyntax`/isolated-modules friction. |
| Validation convention | Every API route (`src/pages/api/flashcards/index.ts`) validates with `zod` `.strict()` schemas | A review-rating endpoint validates cleanly as `z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])` mapping straight to `Rating.Again\|Hard\|Good\|Easy` |
| DB/migrations | `supabase/migrations/20260903000000_create_flashcards.sql` — per-operation RLS policies scoped to `user_id = auth.uid()` | Same pattern applies directly to whatever table stores FSRS `Card` state |
| Service layer | `src/lib/services/flashcards.ts` — plain async functions taking `SupabaseClient` + `userId` | `ts-fsrs` calls (`createEmptyCard`, `fsrs().next()`) drop straight into this same shape |
| API route shape | `export const prerender = false`, uppercase `GET`/`POST`, `createClient(...)` + `auth.getUser()` guard, `jsonError` helper | New review endpoints follow the identical skeleton |
| Auth-gated routes | `src/middleware.ts`: `PROTECTED_ROUTES = ["/dashboard", "/generate", "/flashcards"]` | A new study-session route needs adding here if it lives outside `/flashcards/*` |

## The one real design decision: where does `Card` state live?

The existing `flashcards` table (`id, user_id, front, back, source_text, status, created_at, updated_at`) has **no review-state columns yet** — this is genuinely new schema, not something to adapt.

Two options, both compatible with the codebase's conventions:

1. **Add FSRS columns directly to `flashcards`** (`due`, `stability`, `difficulty`, `scheduled_days`, `learning_steps`, `reps`, `lapses`, `state`, `last_review`) — 1:1 relationship (every flashcard has exactly one review state), no join needed to fetch due cards, matches the single-table-per-concept style already used for `flashcards` itself.
2. **Separate `flashcard_reviews` table** keyed by `flashcard_id` — needed only if per-review history (`ReviewLog`) must be queried later (e.g. a stats/analytics feature). Not required by FR-009's scope ("study saved flashcards in a review session").

**Recommendation for MVP**: option 1 (extend `flashcards` directly). `ts-fsrs` doesn't require persisting `ReviewLog` at all — only the returned `card` needs to be saved between reviews — so a separate log table would be speculative for a scope that doesn't ask for review history. This can be revisited later without migration pain since FSRS can `reschedule()` from a log if one is added afterward.

## Verdict

`ts-fsrs-api-reference.md` is **fully compatible** with this codebase as-is. No blockers, no version conflicts, no runtime-compatibility risk. The only new work is:
1. One migration adding review-state columns to `flashcards` (or a new table, per the decision above) with matching RLS policies.
2. `src/lib/services/reviews.ts` (or extending `flashcards.ts`) wrapping `createEmptyCard`/`fsrs().next()`.
3. New API route(s) (e.g. `src/pages/api/flashcards/due.ts` for the session queue, `src/pages/api/flashcards/[id]/review.ts` for submitting a rating).
4. A React island for the study-session UI (flip card, rate buttons) mounted on a new Astro page, added to `PROTECTED_ROUTES`.

This is planning-level detail — the actual step-by-step implementation belongs in `/10x-plan choose-review-algorithm` (or a dedicated `spaced-repetition-session` change once F-02 is closed).
