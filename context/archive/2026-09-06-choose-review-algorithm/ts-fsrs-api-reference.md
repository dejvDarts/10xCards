---
change_id: choose-review-algorithm
purpose: API reference to hand off to S-05 (spaced-repetition-session) implementation
fetched_at: 2026-09-06
source: github.com/open-spaced-repetition/ts-fsrs (main branch, packages/fsrs) — package.json confirms published npm name "ts-fsrs" v5.4.2, FSRS-6
tooling_note: context7 MCP tool was requested but not registered in this Claude Code session despite `claude mcp list` showing it Connected (see chat) — fetched straight from the GitHub source via `gh api` + WebFetch instead.
---

## Install

```bash
npm install ts-fsrs
```

Ships ESM (`dist/index.mjs`), CJS (`dist/index.cjs`), and UMD builds; zero runtime dependencies. `engines.node >= 20.0.0` is a dev/build-time hint, not an enforced runtime dependency — the compiled output is plain JS with no Node built-ins, so it's expected to run under Cloudflare's `workerd` runtime (matches `tech-stack.md`).

## Core types (`ts-fsrs/src/models.ts`)

```ts
enum State { New = 0, Learning = 1, Review = 2, Relearning = 3 }
enum Rating { Manual = 0, Again = 1, Hard = 2, Good = 3, Easy = 4 }
type Grade = Exclude<Rating, Rating.Manual>  // 1-4, what the UI actually sends

interface Card {
  due: Date                // when this card is next due
  stability: number
  difficulty: number
  elapsed_days: number      // @deprecated, removed in v6.0.0 — don't persist as source of truth
  scheduled_days: number
  learning_steps: number
  reps: number
  lapses: number
  state: State
  last_review?: Date
}

interface ReviewLog {
  rating: Rating
  state: State
  due: Date
  stability: number
  difficulty: number
  scheduled_days: number
  learning_steps: number
  review: Date               // when this review happened
}

type RecordLogItem = { card: Card; log: ReviewLog }
type RecordLog = { [key in Grade]: RecordLogItem }   // one entry per possible answer, keyed by Rating
```

**Mapping to a Supabase `flashcard_reviews`-style table**: persist `Card` fields flattened as columns (`due timestamptz`, `stability float8`, `difficulty float8`, `scheduled_days int`, `learning_steps int`, `reps int`, `lapses int`, `state smallint`, `last_review timestamptz null`) per `(user_id, flashcard_id)`. Drop the deprecated `elapsed_days` from the persisted shape — it's not used by FSRS-6 scheduling and is slated for removal upstream.

## Creating a card

```ts
import { createEmptyCard } from 'ts-fsrs'

const card = createEmptyCard(new Date())   // State.New, stability/difficulty = 0
```

Use this once, when a flashcard is first saved (S-01/S-02), so every flashcard has review state from creation — no separate "not yet in review system" state to model.

## Scheduling a review

```ts
import { fsrs, generatorParameters, Rating } from 'ts-fsrs'

const params = generatorParameters({ request_retention: 0.9 }) // see defaults below
const scheduler = fsrs(params)

// Preview all 4 possible outcomes before the user answers (e.g. to show "again / hard / good / easy" with predicted next-due dates):
const preview = scheduler.repeat(card, new Date())
// preview[Rating.Good].card.due, preview[Rating.Again].card.due, etc.

// After the user picks a rating, commit it:
const { card: updatedCard, log } = scheduler.next(card, new Date(), Rating.Good)
```

`repeat()` is what a review-session UI wants for showing predicted intervals per button; `next()` is the one-shot "user answered X, give me the new state" call if the UI doesn't preview intervals up front. Only one is needed for a minimal S-05 — `next()` is enough if the UI doesn't show "press Good for 3 days" style hints.

## Default parameters (`ts-fsrs/src/constant.ts`, v5.4.2 / FSRS-6)

```ts
default_request_retention = 0.9        // target 90% recall
default_maximum_interval  = 36500      // ~100 years cap
default_enable_fuzz       = false
default_enable_short_term = true
default_learning_steps    = ['1m', '10m']
default_relearning_steps  = ['10m']
// default_w: 21-length weight array (FSRS-6) — ship as-is, don't hand-tune for MVP
```

`generatorParameters({...})` with no args returns these defaults — safe to call `fsrs()` with zero config for a first implementation. Per-user parameter optimization (`@open-spaced-repetition/binding`) is a separate package for retraining weights against a user's review history — **out of scope for MVP**, matches the roadmap's non-goal of not building bespoke algorithm logic.

## Persisting across requests (important for a stateless Worker)

Cards must be serialized to/from storage since nothing is kept in memory between requests:

```ts
// Dates need conversion for JSON/DB storage:
const toRow = (card: Card) => ({
  ...card,
  due: card.due.toISOString(),
  last_review: card.last_review?.toISOString() ?? null,
})

const fromRow = (row): Card => ({
  ...row,
  due: new Date(row.due),
  last_review: row.last_review ? new Date(row.last_review) : undefined,
})
```

`scheduler.next()`/`repeat()` also accept an optional `afterHandler` callback to transform the result inline (e.g. produce the DB-row shape directly) instead of a separate mapping step.

## Other scheduler methods available (not needed for MVP, noted for completeness)

- `get_retrievability(card, now)` — current recall probability (0-1); could power a "how well do you know this" indicator later.
- `rollback(card, log)` — undo the last review.
- `forget(card, now)` — reset a card back to `State.New`.
- `reschedule(...)` — rebuild a card from its full review-log history (useful if parameters are retuned later).

## What this unblocks

This closes F-02's blocking unknown and gives S-05 (`context/foundation/roadmap.md:152-163`) everything needed to plan: `createEmptyCard` at flashcard creation time, `scheduler.next()` per review answer, and a small per-user-per-flashcard state table to persist `Card` between sessions.
