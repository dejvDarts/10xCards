# Core-Flow Correctness (Test Rollout Phase 2) Implementation Plan

## Overview

Add automated coverage for the two must-have flows the test plan ranks next, on top of the
Phase-1 harness:

- **Risk #2** — FSRS review-session scheduling recalculates due-dates incorrectly (card
  stuck, skipped, or resurfaces in the same session).
- **Risk #3** — the AI generation pipeline fails or returns malformed output without a
  clear error to the user.

Neither flow has any test today. Risk #2 gets a unit layer (row↔`Card` mapping + structural
`scheduler.next` properties) plus integration against real Supabase for the study-loop
behavior. Risk #3 gets exhaustive unit coverage of every error branch with a spied `fetch`,
plus one route integration smoke.

## Current State Analysis

- **Risk #2 lives in one file:** `src/lib/services/reviews.ts`. `ts-fsrs@5.4.2` (FSRS-6) is
  **fully deterministic** for a fixed `(card, now, rating)` — `default_enable_fuzz = false`
  and the code never enables it (`reviews.ts:9` only sets `enable_short_term: false`); no
  `Math.random` in the library. The project's own logic is just `toFsrsCard` /
  `toRowUpdate` (`reviews.ts:11-42`, module-private today) and an optimistic-concurrency
  guard (`reviews.ts:88-95`).
- **`enable_short_term: false` is load-bearing**, not tuning: it is what makes "no
  in-session requeue" true. With the default `true`, an "Again" card reschedules ~1-10 min
  out and could resurface mid-session (`context/archive/2026-09-06-spaced-repetition-session/plan.md:50,54`;
  code comment `reviews.ts:5-8`).
- **`getDueFlashcards` has two production callers:** `src/pages/api/flashcards/due.ts:22`
  and `src/pages/flashcards/review.astro:22` (SSR page calls the service directly). Testing
  the *service* covers both.
- **`recordReview` returns `null` for two distinct reasons**, both surfaced as HTTP 404 by
  the route: row not found / not owned / not `accepted` (`reviews.ts:78-80`), and a lost
  optimistic-concurrency race (`reviews.ts:88-95` → 0 rows). No DB trigger maintains
  `updated_at` — the guard works only because `toRowUpdate` rewrites it (`reviews.ts:40`).
- **Risk #3 lives in one file:** `src/lib/services/flashcard-generation.ts`, one outbound
  call — a bare `fetch(OPENROUTER_URL, …)` (`:43-57`). Seven `FlashcardGenerationError`
  throw paths (`:36,59,63,71,76,83,88`), **all flattened to HTTP 502** `{"error":"<message>"}`
  by the route's single try/catch (`src/pages/api/flashcards/generate.ts:41-47`).
- **No timeout / AbortController / retry** anywhere in the generation path — confirmed in
  code and in `context/archive/2026-09-02-reviewed-ai-flashcards/plan.md:187-189` (CPU-time
  risk documented, left unhandled).
- **Generated rows are `status:"pending"`** (`generate.ts:49-55`), invisible to
  `getDueFlashcards` and `recordReview` (both filter `.eq("status","accepted")`).
- **Phase-1 harness available:** `vitest.config.ts` (`unit` / `integration` projects),
  `tests/integration/helpers/` (`users.ts`, `session.ts`, `db.ts`, `clients.ts`,
  `local-env.ts`), `setup.ts` / `global.ts`, the `tests/**` eslint override.
  `seedFlashcard` (`tests/integration/helpers/db.ts`) currently overrides only
  `front`/`back`/`status` — FSRS columns fall back to `due default now()`.

## Desired End State

- `npm test` runs the Phase-1 unit suite **plus** `reviews.test.ts` and
  `flashcard-generation.test.ts`, green, with no external dependencies.
- `npm run test:integration` runs the Phase-1 integration suites **plus**
  `flashcards.review.test.ts` and `flashcards.generate.test.ts`, green, against a running
  local Supabase.
- The suite fails loudly if any of these regress:
  - a rating no longer moves `due` in the right direction (ordering `Again<Hard<Good<Easy`
    breaks), `reps` stops incrementing by 1, or `state` stops advancing 0→2;
  - a rated card's new `due` is not strictly after `now` (i.e. it could resurface in the
    same session) — including the "Again" case, first review and second;
  - `enable_short_term` is flipped to `true` (the requeue-enabling change);
  - the optimistic-concurrency guard stops working (two racing reviews both "succeed");
  - the due-list stops ordering by `due` asc then `id` asc on a tie;
  - any `generateFlashcardProposals` error branch stops throwing / stops mapping to a 502
    with its message, or the happy path stops returning well-formed proposals;
  - `/api/flashcards/generate` stops inserting `status:"pending"` rows on success or stops
    passing a generation failure through as 502.

### Key Discoveries:

- Oracle-safe FSRS assertions (structurally enforced by ts-fsrs, parameter-independent):
  strict interval ordering `Again<Hard<Good<Easy` (`index.mjs:1266-1269` `Math.max(hard,
  again+1)` etc.), `reps += 1` per `next()` (`:370`), `state` New(0)→Review(2) for every
  rating in this config (`:1282-1291`), interval floor `≥ 1` day (`:830-836`), `due =
  now + ≥1·86_400_000 ms` (`:115-118`).
- **Do NOT assert** exact day counts (1/2/3/8) or `stability`/`difficulty` values —
  parameter-dependent, could shift on a ts-fsrs `^5.4.2` minor bump.
- Rating literals `1|2|3|4` map 1:1 to ts-fsrs `Rating.Again|Hard|Good|Easy` with no remap
  (`review.ts:10,45` → `reviews.ts:65,82`).
- First-ever "Again" does **not** increment `lapses`; a second review of a Review-state
  card rated "Again" does (`index.mjs:1250`).
- Mock seam for Risk #3: `vi.spyOn(globalThis, "fetch")` + `vi.mock("astro:env/server", …)`
  for `OPENROUTER_API_KEY`. `msw` is not needed (one hard-coded URL, one call site).
- Happy-path mock envelope shape: `{"choices":[{"message":{"content":"<JSON string>"}}]}`
  where the string parses to `{"flashcards":[{"front":…,"back":…}]}` (max 15).
- `.slice(0, 15)` at `flashcard-generation.ts:91` is effectively dead — `proposalsSchema`
  `.max(15)` rejects an over-long list first (branch 7).

## What We're NOT Doing

- **Not** adding an `AbortController` / timeout / retry to `flashcard-generation.ts`. The
  "times out" clause of Risk #3 is covered by documenting the gap and testing current
  behavior (a rejected `fetch` → "Failed to reach the AI provider" → 502). Application-level
  deadlines are a separate change.
- **Not** writing a cross-flow generate → accept → review test. Each risk's suite stays
  self-contained; the `pending`→`accepted` seam is documented, not a top risk.
- **Not** testing `review.astro` page rendering. The `getDueFlashcards` *service* tests
  cover both its callers; page render is out of scope (test-plan §6.3, Phase-1 precedent).
- **Not** adding a "not-yet-due card is still reviewable" test (impl-review F4 accepted
  gap) — tangential to Risk #2's statement, and it tests behavior nobody has asked to
  change.
- **Not** covering `PATCH`/`DELETE`/list scheduling side-effects — `PATCH` never touches
  FSRS columns (`[id].ts:52-57`), confirmed in research.
- **Not** adopting `@cloudflare/vitest-pool-workers`, wiring CI, or touching Risks #1/#4/#5/#6.
- **Not** unit-testing `ts-fsrs`'s own arithmetic — only the structural properties our
  config choice relies on, asserted against the real exported `scheduler`.
- **Not** asserting `stability`/`difficulty`/exact-interval values (oracle problem).

## Implementation Approach

Three phases, mirroring the Phase-1 rollout shape (unit-first, then integration, then the
next concern), each independently shippable; Docker only from Phase 2.

1. **Risk #2 unit.** Make `toFsrsCard`, `toRowUpdate`, and `scheduler` exportable from
   `reviews.ts` (three `export` keywords, no behavior change), then unit-test the mapping
   round-trip and the structural scheduler properties with a fixed `now`.
2. **Risk #2 integration.** Extend `seedFlashcard` with schedule-column overrides, then
   drive `recordReview` / `getDueFlashcards` against real local Supabase for the study-loop
   behavior, the second-review "Again" case, the concurrency race, and the due-list
   ordering tie.
3. **Risk #3.** Exhaustively unit-test `generateFlashcardProposals` (7 branches + happy)
   with a spied `fetch` and mocked env; add one route integration smoke; fill in the
   `test-plan.md` §6.4 cookbook and §6.6 Phase-2 note.

The one production edit (Phase 1) is visibility-only. Everything else is new test files and
one additive change to a test helper.

## Critical Implementation Details

- **Fixed clock for the unit layer.** `scheduler.next` takes `now` as an argument, so the
  unit tests pass an explicit `new Date("2026-01-01T00:00:00.000Z")` — no `vi.useFakeTimers()`
  needed. `recordReview` itself calls `new Date()` internally (`reviews.ts:82,40`); the
  integration tests do not pin it and rely only on direction/ordering/`> now` assertions.

- **Structural assertions only.** For each of the four ratings on a fresh card, assert:
  `due(rating) > now`, `scheduled_days ≥ 1`, `reps === prev + 1`, `state === 2`. Across the
  four: `due(1) < due(2) < due(3) < due(4)` (strict). Never assert an exact `due`,
  `stability`, or `difficulty`.

- **`enable_short_term` guard.** One unit test imports the real exported `scheduler` and
  asserts that an "Again" on a fresh card lands `≥ 1` day out (`due - now >= 86_400_000`).
  If someone flips `reviews.ts:9` to `enable_short_term: true`, this test fails — that is
  its whole purpose.

- **Concurrency race (integration).** Seed one `accepted` card, then
  `Promise.all([reviewRoute(ctx1), reviewRoute(ctx2)])` with the same body and the same
  user's cookie. Assert exactly one response is `200` and exactly one is `404`
  `{"error":"Flashcard not found"}`, and that a read-back shows `reps === 1`. Postgres
  row-locking serializes the UPDATEs, so the split is deterministic even though which
  request wins is arbitrary.

- **Integration project mocking (Phase 3 smoke).** `flashcards.generate.test.ts` is the
  first integration file to mock anything, and it mocks **only** the network edge:
  `vi.spyOn(globalThis, "fetch")`, restored in `afterEach` (`vi.restoreAllMocks()`). It
  must **not** `vi.mock("astro:env/server", …)` — that factory replaces the whole virtual
  module and nulls `SUPABASE_URL`/`SUPABASE_KEY`, so `createClient` returns `null` and the
  route 500s instead of inserting. `.dev.vars` already carries a real `OPENROUTER_API_KEY`,
  so the happy path needs no env control; env-mocking for branch 1 (missing key) lives in
  the *unit* test, which has no DB. `fileParallelism` is already off. Verify the `fetch`
  spy does not bleed into the other integration files (run the whole `integration`
  project, not just this file).

- **Don't `vi.mock` internal service modules.** Risk #2's unit layer tests the pure
  mapping functions and the exported scheduler directly; the DB-touching paths
  (`recordReview` read-back, RLS/status filters) are the integration layer's job. The one
  exception is the guard-contract test, which passes a **stub object as `recordReview`'s
  `supabase` argument** — that is dependency injection at the external boundary, not a
  `vi.mock` of `@/lib/services/*`. The chainable stub only needs `.from().select().eq()
  .eq().eq().maybeSingle()` (returns a row) and `.from().update().eq().eq().eq().select()
  .maybeSingle()` (returns `{ data: null }`).

## Phase 1: Risk #2 — FSRS Scheduling Unit Coverage

### Overview

`scheduler.next`'s user-relevant properties and the row↔`Card` mapping are locked in as
fast, Docker-free unit tests, and the load-bearing `enable_short_term: false` choice is
guarded.

**Deliberate overlap with Phase 2:** the rating-ordering, `reps +1`, `state 0→2`, `due >
now`, and `enable_short_term` regressions are *also* observable through Phase 2's real
read-back (a short-term "Again" schedules ~1 min out → the card stays in the due list →
Phase 2's "absent after Again" assertion fails). This unit tier is the fast, Docker-free,
ts-fsrs-bump-resilient layer plus the mapping round-trip in isolation — not the sole guard.
If Phase 1 is ever dropped, Phase 2 still catches these regressions (more slowly).

### Changes Required:

#### 1. Export the scheduling internals for testing

**File**: `src/lib/services/reviews.ts`

**Intent**: Make the pure mapping functions and the configured scheduler reachable from a
unit test without changing any runtime behavior.

**Contract**: Add `export` to `function toFsrsCard` (`:11`), `function toRowUpdate` (`:29`),
and `const scheduler` (`:9`), each with a `// exported for unit tests (reviews.test.ts)`
comment. No signature, logic, or call-site change. `recordReview` / `getDueFlashcards`
exports and behavior are untouched. (Note: this diverges from the sibling
`src/lib/services/flashcards.ts`, which keeps `baseQuery` / `countTotal` private — the
comment marks the intent.)

#### 2. Scheduling unit tests

**File**: `src/lib/services/reviews.test.ts` (new)

**Intent**: Assert the mapping round-trips faithfully and that `scheduler.next` moves
schedule state in the direction/shape the UI and the "no requeue" guarantee depend on —
without reproducing ts-fsrs arithmetic.

**Contract**: `unit` project (`src/**/*.test.ts`), explicit `vitest` imports, fixed
`NOW = new Date("2026-01-01T00:00:00.000Z")`.

- **Mapping round-trip**: build a `Flashcard`-shaped row, `toFsrsCard(row)` → assert every
  FSRS field maps across, `due`/`last_review` parse to `Date`, `elapsed_days` is `0` and
  not sourced from the row; `toRowUpdate(card)` → assert ISO strings out, `last_review`
  `null` when the card has none, and `updated_at` is set. Round-trip a card through both and
  assert the FSRS fields survive.
- **Structural scheduler properties** (real exported `scheduler`, fresh card = migration
  defaults `state:0, stability:0, difficulty:0, reps:0, due:NOW`): for each rating
  `1|2|3|4`, `scheduler.next(freshCard, NOW, rating)` → `due > NOW`, `scheduled_days >= 1`,
  `reps === 1`, `state === 2`. Across the four: `due(1) < due(2) < due(3) < due(4)` strict.
- **`enable_short_term` guard**: `scheduler.next(freshCard, NOW, 1)` (Again) → `due.getTime()
  - NOW.getTime() >= 86_400_000`.
- **Second-review "Again" lapses**: take a card advanced one review into `state:2`, rate it
  `1` → `lapses === prevLapses + 1` and `due > NOW` still `>= 1` day out.
- **Optimistic-concurrency guard contract**: call `recordReview` with a stub `supabase`
  argument (dependency injection at the boundary — not a `vi.mock` of an internal module)
  whose `.select()…maybeSingle()` returns a valid `accepted` row and whose guarded
  `.update()…eq("updated_at", …).select().maybeSingle()` resolves `{ data: null, error:
  null }`; assert `recordReview` returns `null` (the "lost the race" path, which the route
  maps to 404 — same as not-found). This pins the guard deterministically; the true
  `Promise.all` race in Phase 2 is a best-effort supplement, not the contract's proof.

### Success Criteria:

#### Automated Verification:

- `npm test` exits 0 with `reviews.test.ts` reporting > 0 passing tests, including the
  optimistic-concurrency guard-contract test
- `npm run lint` passes (new test file + the 3 `export` edits)
- `npm run build` still passes
- `npm test` succeeds with no Docker / `supabase` process running

#### Manual Verification:

- Flipping `reviews.ts:9` to `enable_short_term: true` makes exactly the `enable_short_term`
  guard test (and possibly the second-review case) fail; reverting fixes it
- Removing one of the three `export` keywords breaks `reviews.test.ts`'s import, not any
  production build

**Implementation Note**: After Phase 1 automated verification passes, pause for human
confirmation of the manual checks before starting Phase 2.

---

## Phase 2: Risk #2 — Study-Loop Integration Coverage

### Overview

Against real local Supabase: a rated card's schedule actually advances and the card leaves
the due list, the second-review "Again" case behaves, two racing reviews resolve to exactly
one success, and the due-list ordering tiebreak holds.

### Changes Required:

#### 1. Schedule-column overrides in `seedFlashcard`

**File**: `tests/integration/helpers/db.ts`

**Intent**: Let a test seed a card with a controlled `due` (and, where useful, `state` /
`reps` / `stability` / `id`) so ordering and mid-schedule scenarios are one-liners.

**Contract**: Widen the `seedFlashcard` overrides parameter (keep it a single options
object) to accept optional `due`, `state`, `reps`, `stability`, `id`, each defaulting to
the DB default / current behavior when omitted. `SeededFlashcard` return type unchanged in
shape. Existing Phase-1 callers (which pass `front`/`back`/`status` or nothing) are
unaffected.

#### 2. Study-loop integration tests

**File**: `tests/integration/flashcards.review.test.ts` (new)

**Intent**: Prove the server-side study loop is correct end-to-end: recalculation
direction, no in-session requeue, the concurrency guard, and stable ordering.

**Contract**: `integration` project, Phase-1 harness (`createTestUser`, `signedInClient`,
`cookieHeaderFor`, `apiContext`, `resetFlashcards`). Invoke the real route handlers
(`POST /api/flashcards/[id]/review` from `src/pages/api/flashcards/[id]/review.ts`,
`GET /api/flashcards/due` from `src/pages/api/flashcards/due.ts`) and/or the
`getDueFlashcards` service directly.

- **Rate → read back → leaves due list**: seed an `accepted` card (`due` in the past),
  confirm it appears in `GET /api/flashcards/due`; `POST …/review` with `{rating: 3}` →
  200, body is the updated `Flashcard` with `reps === 1`, `state === 2`, `due` strictly in
  the future; re-fetch the due list → the card is **absent**. Repeat the review call for
  `{rating: 1}` (Again) on a fresh seeded card → same "absent from due list afterward"
  assertion (the core no-requeue guarantee).
- **Direction across ratings**: seed four fresh `accepted` cards, rate them `1/2/3/4`
  respectively, read back → `due(card1) < due(card2) < due(card3) < due(card4)`.
- **Second-review "Again"**: seed a card, review it once (`{rating: 3}`), then review again
  (`{rating: 1}`) → 200, read back `lapses === 1`, `due` still ≥ ~1 day out.
- **Concurrency race (best-effort, not a gate)**: seed one `accepted` card; `Promise.all`
  two identical `POST …/review` calls with the same cookie. When the two handlers actually
  interleave, assert exactly one 200 + one 404 `{"error":"Flashcard not found"}` and
  `reps === 1` on read-back. If the run does not produce a race (handler 1 commits before
  handler 2's SELECT — possible under Vitest), the test asserts only the weaker invariant
  `reps === 1` (no double-apply) and logs that it did not race. The guard's *contract* is
  proven deterministically by the Phase-1 guard-contract unit test; this is a supplement.
- **Due-list ordering tie**: seed 3 `accepted` cards — two with an **identical** past `due`,
  one earlier — via the extended `seedFlashcard`; `getDueFlashcards` → order is `due` asc,
  and the two tied rows are in ascending `id` order (compare their known UUIDs).

### Success Criteria:

#### Automated Verification:

- `npx supabase start` then `npm run test:integration` exits 0 with
  `flashcards.review.test.ts` all passing (the best-effort race case never *fails* the run —
  it asserts the weaker `reps === 1` invariant when it does not race)
- `npm test` (unit) still exits 0 and still needs no Docker, and the Phase-1
  guard-contract unit test is present and passing
- `npm run lint` passes over `tests/**`
- Existing Phase-1 integration suites still pass unchanged

#### Manual Verification:

- Against the running dev server: rate a real card "Again", then `GET /api/flashcards/due`
  and confirm that card is not in the response (manual echo of the automated assertion)
- Temporarily removing `.eq("updated_at", …)` from `recordReview` makes the Phase-1
  guard-contract unit test fail (`recordReview` returns the row instead of `null`);
  reverting fixes it
- Running `test:integration` twice leaves no leftover `test+cpc-*` users

**Implementation Note**: After Phase 2 automated verification passes, pause for human
confirmation of the manual checks before starting Phase 3.

---

## Phase 3: Risk #3 — AI Generation Pipeline Coverage

### Overview

Every failure mode of `generateFlashcardProposals` produces a clear, mapped error (never a
silently empty/corrupt list), the happy path returns well-formed proposals, and the route
persists `pending` rows / passes failures through as 502.

### Changes Required:

#### 1. Generation service unit tests

**File**: `src/lib/services/flashcard-generation.test.ts` (new)

**Intent**: Exhaustively cover the 7 error branches + the happy path at the cheapest layer,
and document the absence of an application-level timeout.

**Contract**: `unit` project. `vi.mock("astro:env/server", () => ({ OPENROUTER_API_KEY:
"test-key", OPENROUTER_MODEL: "test/model" }))`; `vi.spyOn(globalThis, "fetch")` with
`afterEach(() => vi.restoreAllMocks())`. One test per branch, asserting the thrown
`FlashcardGenerationError` message string:

| Branch | `fetch` mock (or env) | Expected message |
|---|---|---|
| 1 missing key | env mock returns falsy `OPENROUTER_API_KEY` | `OPENROUTER_API_KEY is not configured` |
| 2 unreachable | `mockRejectedValueOnce(new TypeError("fetch failed"))` | `Failed to reach the AI provider` |
| 3 provider error | `new Response("x", { status: 429 })` | `AI provider returned an error (status 429)` |
| 4 invalid envelope JSON | `new Response("<html>", { status: 200 })` | `AI provider returned an invalid JSON response` |
| 5 missing content | `{"choices":[]}` / `{"choices":[{"message":{"content":""}}]}` | `AI provider response was missing message content` |
| 6 content not JSON | `content: "not json"` | `AI provider content was not valid JSON` |
| 7 wrong shape | `content` = `{"flashcards":[]}` / 16 items / blank `front` | `AI provider output did not match the expected flashcard shape` |

Plus: **happy path** → `content` = `'{"flashcards":[{"front":"Q","back":"A"}]}'` → returns
`[{front:"Q", back:"A"}]`, and `fetch` was called with `OPENROUTER_URL` + a Bearer header.

No test is written for the "times out" case — there is no application-level timeout to
assert. Record it as a top-of-file comment (`// NOTE: no AbortController/timeout — a hung
provider is bounded only by the Cloudflare Workers platform CPU limit`) and in the §6.4
cookbook entry (change #3). Do **not** add a permanently-skipped `it.skip`.

#### 2. Generate route integration smoke

**File**: `tests/integration/flashcards.generate.test.ts` (new)

**Intent**: Prove the route wiring around the service — success inserts `pending` rows,
failure passes through as 502 — without re-testing every branch over HTTP.

**Contract**: `integration` project. **Do not mock `astro:env/server`** — `.dev.vars`
already provides a real `OPENROUTER_API_KEY` (so branch 1 never fires) and `SUPABASE_*`
must keep resolving for the real DB insert. A `vi.mock` factory would replace the whole
virtual module and null out `SUPABASE_URL`/`SUPABASE_KEY` → `createClient` returns `null` →
the route 500s. Mock only the network edge: `vi.spyOn(globalThis, "fetch")`, restored in
`afterEach` (`vi.restoreAllMocks()`). Phase-1 harness for a real authed user + cookie.
Invoke `POST /api/flashcards/generate` (`src/pages/api/flashcards/generate.ts`). If a run
environment lacks `OPENROUTER_API_KEY` in `.dev.vars`, `describe.skip` with a clear message
(mirrors `setup.ts`'s fail-fast).

- **Happy path**: mock `fetch` → valid envelope with 2 proposals; call with a valid
  `sourceText` (≥100 chars) → 201, body `{"flashcards":[…]}` with 2 rows; read back via the
  owner's client → 2 rows exist with `status === "pending"` and `source_text` set.
- **Failure passthrough**: mock `fetch` → `mockRejectedValueOnce(...)` → 502
  `{"error":"Failed to reach the AI provider"}`; read back → **no** rows inserted.
- **Bad input**: `sourceText` of 10 chars → 400 (zod message), `fetch` not called.
- **No session** → 401 `{"error":"Unauthorized"}`, `fetch` not called (closes
  `generate.ts:23-27`, the last untested flashcard-API auth guard — Phase 1 excluded
  `generate` from auth-gating).
- Verify (assertion or a follow-up run) that the `fetch` spy does not leak into
  `flashcards.review.test.ts` / the other integration files.

#### 3. Cookbook fill-in

**File**: `context/foundation/test-plan.md`

**Intent**: Record the Phase-2 patterns so the next contributor can follow them.

**Contract**: Replace the §6.4 stub ("Adding a test for the AI generation pipeline") with
the spied-`fetch` + mocked-env pattern, the branch table, and the "no app-level timeout"
note. Append a **Phase 2** entry to §6.6 (per-rollout-phase notes) covering: the
`export`-for-test decision in `reviews.ts`, the oracle-safe assertion set, the
`seedFlashcard` schedule-override extension, and that generated rows are `pending`. Do not
touch §1–§5 or other §6 subsections.

### Success Criteria:

#### Automated Verification:

- `npm test` exits 0 with `flashcard-generation.test.ts` covering all 7 branches + happy
  path (≥ 8 passing tests: 7 branches + happy)
- `npm run test:integration` exits 0 with `flashcards.generate.test.ts` all passing
  (happy → 201/`pending`, failure → 502, bad input → 400, **no session → 401**) and the
  Phase-1 + Phase-2 integration suites unchanged
- `npm run lint` and `npm run build` pass
- `context/foundation/test-plan.md` §6.4 no longer contains "TBD" and §6.6 has a Phase 2
  entry

#### Manual Verification:

- Locally set `OPENROUTER_API_KEY` empty in `.dev.vars` and `POST /api/flashcards/generate`
  → 502 `{"error":"OPENROUTER_API_KEY is not configured"}`; restore the key
- With a valid key, a real generation call still returns 201 with proposals (mocks are
  test-scoped, production path untouched)
- Run `npm test` and `npm run test:integration` back-to-back — no cross-file mock bleed
  (all suites green in both projects)

**Implementation Note**: After Phase 3 automated verification passes, pause for human
confirmation of the manual checks before the change is considered complete.

---

## Testing Strategy

### Unit Tests:

- `src/lib/services/reviews.test.ts` — mapping round-trip; structural `scheduler.next`
  properties (ordering, `reps +1`, `state 0→2`, `due > now`, `scheduled_days ≥ 1`);
  `enable_short_term` guard; second-review "Again" lapses. Fixed `now`, no fake timers, no
  DB.
- `src/lib/services/flashcard-generation.test.ts` — 7 error branches + happy path; spied
  `fetch`, mocked `astro:env/server`; the no-timeout note.

### Integration Tests:

- `tests/integration/flashcards.review.test.ts` — rate → read-back → leaves due list (Good
  and Again); direction across the four ratings; second-review "Again" lapses; concurrency
  race (1×200 / 1×404); due-list ordering tie. Real local Supabase.
- `tests/integration/flashcards.generate.test.ts` — route smoke: happy → 201 + `pending`
  rows; failure → 502 + no rows; bad input → 400.

### Manual Testing Steps:

1. `npm test` (green, no Docker).
2. `npx supabase start` → `npm run test:integration` (green).
3. Flip `enable_short_term: false` → `true` in `reviews.ts`; confirm the unit guard fails;
   revert.
4. Remove `.eq("updated_at", …)` from `recordReview`; confirm the concurrency-race test
   fails; revert.
5. Empty `OPENROUTER_API_KEY` in `.dev.vars`; `POST /api/flashcards/generate` → 502 config
   message; restore.
6. Run `npm test` then `npm run test:integration` back-to-back; confirm no mock bleed.

## Performance Considerations

- The unit additions must stay sub-second (no DB, no network) so they keep gating
  `lint`/`build` locally without friction.
- `flashcards.review.test.ts` adds ~5 scenarios of DB round-trips; the concurrency-race
  `Promise.all` is the slowest. Cache `cookieHeaderFor` per user within the file.
- The Phase-3 integration smoke is deliberately thin (3 cases) — branch coverage is at the
  unit layer.

## Migration Notes

- No schema changes; `supabase/migrations/` untouched, so the `lessons.md` "push migrations
  to cloud" rule does not apply.
- One production-file edit: three `export` keywords in `src/lib/services/reviews.ts`
  (visibility only). One additive change to `tests/integration/helpers/db.ts`. Everything
  else is new test files + `test-plan.md` doc edits.
- No new dependencies — `vitest`, `@supabase/*`, `ts-fsrs`, `zod` are all already present.

## References

- Research: `context/changes/core-flow-correctness/research.md`
- Change brief: `context/changes/core-flow-correctness/change.md`
- Test plan (strategy, risk map, response guidance, cookbook): `context/foundation/test-plan.md`
  §2 (Risks #2, #3), §6.4, §6.6
- Phase-1 harness + patterns: `context/archive/2026-09-09-testing-critical-path-coverage/plan.md`,
  `tests/integration/helpers/`, `vitest.config.ts`
- FSRS scheduling: `src/lib/services/reviews.ts:9,11-42,44-59,61-102`;
  `src/pages/api/flashcards/[id]/review.ts`; `src/pages/api/flashcards/due.ts:22`;
  `src/pages/flashcards/review.astro:22`
- AI generation: `src/lib/services/flashcard-generation.ts:34-92`;
  `src/pages/api/flashcards/generate.ts:41-47,49-55`
- ts-fsrs determinism / structural guarantees:
  `context/archive/2026-09-06-choose-review-algorithm/ts-fsrs-api-reference.md`;
  `node_modules/ts-fsrs/dist/index.mjs:23-30,318-323,505,830-836,1266-1291`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.
> Do not rename step titles. See `.github/skills/10x-plan/references/progress-format.md`.

### Phase 1: Risk #2 — FSRS Scheduling Unit Coverage

#### Automated

- [x] 1.1 `npm test` exits 0 with `reviews.test.ts` reporting > 0 passing tests, including the optimistic-concurrency guard-contract test — 2ea9fee
- [x] 1.2 `npm run lint` passes (new test file + the 3 `export` edits) — 2ea9fee
- [x] 1.3 `npm run build` still passes — 2ea9fee
- [x] 1.4 `npm test` succeeds with no Docker / `supabase` process running — 2ea9fee

#### Manual

- [x] 1.5 Flipping `enable_short_term` to `true` fails exactly the guard test; reverting fixes it — 2ea9fee
- [x] 1.6 Removing one `export` keyword breaks `reviews.test.ts`'s import, not the production build — 2ea9fee

### Phase 2: Risk #2 — Study-Loop Integration Coverage

#### Automated

- [x] 2.1 `npx supabase start` then `npm run test:integration` exits 0 with `flashcards.review.test.ts` all passing (the best-effort race case never fails the run) — 7817bb7
- [x] 2.2 `npm test` (unit) still exits 0 with no Docker, and the Phase-1 guard-contract unit test is present and passing — 7817bb7
- [x] 2.3 `npm run lint` passes over `tests/**` — 7817bb7
- [x] 2.4 Existing Phase-1 integration suites still pass unchanged — 7817bb7

#### Manual

- [x] 2.5 Against the dev server: a card rated "Again" is absent from the next `GET /api/flashcards/due` — 7817bb7
- [x] 2.6 Removing `.eq("updated_at", …)` from `recordReview` makes the Phase-1 guard-contract unit test fail; reverting fixes it — 7817bb7
- [x] 2.7 Running `test:integration` twice leaves no leftover `test+cpc-*` users — 7817bb7

### Phase 3: Risk #3 — AI Generation Pipeline Coverage

#### Automated

- [x] 3.1 `npm test` exits 0 with `flashcard-generation.test.ts` covering all 7 branches + happy path (≥ 8 tests)
- [x] 3.2 `npm run test:integration` exits 0 with `flashcards.generate.test.ts` passing and Phase-1/Phase-2 suites unchanged
- [x] 3.3 `npm run lint` and `npm run build` pass
- [x] 3.4 `context/foundation/test-plan.md` §6.4 no longer contains "TBD" and §6.6 has a Phase 2 entry

#### Manual

- [x] 3.5 Empty `OPENROUTER_API_KEY` locally → `POST /api/flashcards/generate` returns 502 with the config message; restore
- [x] 3.6 With a valid key, a real generation call still returns 201 with proposals
- [x] 3.7 `npm test` then `npm run test:integration` back-to-back — no cross-file mock bleed
