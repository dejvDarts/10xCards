---
date: 2026-09-09T13:31:17Z
researcher: Claude Sonnet 5
git_commit: 8f19a10e79c4e61604e3c0bcd699cc602f93d27f
branch: master
repository: 10xCards
topic: "Ground rollout Phase 2 of context/foundation/test-plan.md — Risk #2 (FSRS review-session scheduling) and Risk #3 (AI generation pipeline)"
tags: [research, codebase, fsrs, ts-fsrs, reviews, ai-generation, openrouter, test-plan]
status: complete
last_updated: 2026-09-09
last_updated_by: Claude Sonnet 5
---

# Research: Grounding Risks #2 and #3 for rollout Phase 2 (Core flow correctness)

**Date**: 2026-09-09T13:31:17Z
**Researcher**: Claude Sonnet 5
**Git Commit**: 8f19a10e79c4e61604e3c0bcd699cc602f93d27f
**Branch**: master
**Repository**: 10xCards

## Research Question

Ground rollout Phase 2 of `context/foundation/test-plan.md` (Risks #2 and #3) in actual
code: locate the FSRS scheduling logic and its determinism guarantees, the AI generation
pipeline and its error taxonomy, identify what is unit- vs integration-testable, recommend a
mock seam + tool for the AI provider, verify the Risk Response Guidance, and flag anything
that changes the plan's shape.

## Summary

Both flows are implemented and correct-looking; **neither has any automated test**. The
production code is small and well-factored, which makes the cost×signal picture favorable.

- **Risk #2 (FSRS scheduling)** — all scheduling lives in one file, `src/lib/services/reviews.ts`.
  `ts-fsrs@5.4.2` (FSRS-6) is **fully deterministic** given a fixed `card` + fixed `now`
  (fuzz is off by default and the code never enables it; no `Math.random`). The project's
  own logic is just the row↔`Card` mapping (`toFsrsCard`/`toRowUpdate`) plus an
  optimistic-concurrency guard. The "no in-session requeue" guarantee is **structurally
  enforced** by ts-fsrs (`enable_short_term:false` + a hard ≥1-day interval floor), so a
  rated card's new `due` is always strictly `> now` and drops out of the due-list filter.
  Oracle-safe assertions: strict interval ordering `Again < Hard < Good < Easy`, `reps +1`
  per review, `state 0 → 2`, `due > now`, `scheduled_days ≥ 1`. Do **not** hard-code day
  counts or stability/difficulty values (parameter-dependent, could shift on a ts-fsrs
  minor bump).
- **Risk #3 (AI generation)** — one file, `src/lib/services/flashcard-generation.ts`, one
  outbound call: a bare `fetch(OPENROUTER_URL, …)`. Seven distinct `FlashcardGenerationError`
  throw paths, **all flattened to HTTP 502** `{"error":"<message>"}` by the route. **No
  timeout / AbortController / retry anywhere** — confirmed in code and in the archived
  `reviewed-ai-flashcards` plan, where the CPU-time risk was documented and left unhandled.
  Recommended mock seam: **`vi.spyOn(globalThis, "fetch")`** (+ `vi.mock("astro:env/server")`
  for the API key), no `msw`.

Corrections/flags for `test-plan.md` surfaced (see "Response-guidance and anchor
corrections" below) — the biggest is that `getDueFlashcards` has **two** production callers,
not one.

## Detailed Findings

### Risk #2 — FSRS review-session scheduling

**Where the logic lives.** `ts-fsrs` is imported in exactly one file:
`src/lib/services/reviews.ts:1`. One module-level scheduler:
`src/lib/services/reviews.ts:9` — `fsrs(generatorParameters({ enable_short_term: false }))`.
One scheduling call: `src/lib/services/reviews.ts:82` —
`scheduler.next(toFsrsCard(row), new Date(), rating)`.

| Function | Location | Production callers |
|---|---|---|
| `recordReview(supabase, userId, flashcardId, rating)` | `src/lib/services/reviews.ts:61-102` | **1** — `src/pages/api/flashcards/[id]/review.ts:45` only |
| `getDueFlashcards(supabase, userId)` | `src/lib/services/reviews.ts:44-59` | **2** — `src/pages/api/flashcards/due.ts:22` **and** `src/pages/flashcards/review.astro:22` (SSR page calls the service directly, bypassing the route) |
| `toFsrsCard` / `toRowUpdate` | `src/lib/services/reviews.ts:11-42` | internal to `recordReview` |

**Determinism (ts-fsrs 5.4.2 / FSRS-6).** Fully deterministic for fixed `(card, now, rating)`:
- `default_enable_fuzz = false` (`node_modules/ts-fsrs/dist/index.mjs:505`); resolved via
  `enable_fuzz: props?.enable_fuzz ?? default_enable_fuzz` (`index.mjs:654`) — the app never
  passes it. `apply_fuzz` returns `Math.round(ivl)` before touching its (seeded Alea) PRNG
  when fuzz is off (`index.mjs:814-824`).
- No `Math.random` anywhere in `index.mjs`. `Date.now()` appears only as an Alea seed
  fallback (`index.mjs:440`), unreachable on the `next()` path because the seed strategy is
  deterministic in `(review_time, reps, difficulty*stability)` (`index.mjs:318-323`).
- `next()` uses the `now` you pass in. `recordReview` passes `new Date()` at call time
  (`reviews.ts:82`), so a *unit* test that wants exact values must inject a fixed clock
  (`vi.useFakeTimers()` / `vi.setSystemTime()`); otherwise only direction/ordering
  assertions are safe.

**Rating mapping (1:1 pass-through, no remap layer).** `z.union([z.literal(1..4)])`
(`src/pages/api/flashcards/[id]/review.ts:10`) → `Grade` straight into `recordReview`
(`review.ts:45`, `reviews.ts:65`). ts-fsrs `Rating`: `Again=1, Hard=2, Good=3, Easy=4`
(`index.mjs:23-30`); `checkGrade` rejects `<1 || >4` (`index.mjs:356-360`).
`src/types.ts:71` `SubmitReviewRequest { rating: 1|2|3|4 }`; `src/types.ts:9`
`ReviewState = 0|1|2|3` (hand-mirrored, does not import the lib).

**Fresh-card outputs** (DB defaults `state=0, stability=0, difficulty=0, reps=0, due=now`
from `supabase/migrations/20260906000000_add_review_state_to_flashcards.sql:6-15`; scheduler
`enable_short_term:false`; empirically verified with a throwaway ts-fsrs 5.4.2 script):

| rating | due offset | scheduled_days | state | reps | lapses |
|---|---|---|---|---|---|
| Again (1) | 1 day | 1 | 2 (Review) | 1 | 0 (first Again does **not** increment lapses) |
| Hard (2) | 2 days | 2 | 2 | 1 | 0 |
| Good (3) | 3 days | 3 | 2 | 1 | 0 |
| Easy (4) | 8 days | 8 | 2 | 1 | 0 |

On a **second** review (card now in Review state), Again yields `lapses: 1` and offset ~1 day.

**Oracle-safe assertions** (structurally guaranteed, parameter-independent):
- `due(Again) < due(Hard) < due(Good) < due(Easy)` and same for `scheduled_days` — enforced
  by construction in `LongTermScheduler.next_interval` via `Math.max(hard, again+1)` etc.
  (`index.mjs:1266-1269`), so the inequalities are strict regardless of the `w` vector.
- `reps` increments by **exactly 1** per `next()` (`index.mjs:370`).
- `state` moves New(0) → Review(2) for every rating in this config (`index.mjs:1282-1291`).
- `scheduled_days ≥ 1` and `due` **strictly after `now`** for every rating including Again —
  interval floors at 1 (`index.mjs:830-836`), then `date_scheduler(now, ≥1, isDay=true)`
  adds `≥1 * 86_400_000 ms` (`index.mjs:115-118`, `:1271`).
- `lapses`: unchanged on the first review for all ratings; on a later review of a
  Review-state card, `+1` for Again only (`index.mjs:1250`).

**Parameter-dependent — do NOT assert** (true for default `w` but not code-enforced; a
ts-fsrs `^5.4.2` minor bump could shift them): exact day counts (1/2/3/8), the monotonic
`stability`/`difficulty` orderings, any absolute stability/difficulty number.

**"No in-session requeue"** (Risk #2's second clause). Because every rated card's `due` is
`≥ now + 1 day` and `getDueFlashcards` filters `.lte("due", new Date().toISOString())`
(`reviews.ts:50`), a same-session refetch (whose `now` is seconds later) cannot resurface
the card. This is exactly why `enable_short_term:false` was chosen — with the default
`true`, Again reschedules ~1 min out and would requeue (`reviews.ts:5-8` code comment; see
Historical Context).

**Due-list ordering.** `.order("due", asc).order("id", asc)` (`reviews.ts:51-52`). `id` is
`uuid primary key default gen_random_uuid()` (`supabase/migrations/20260903000000_create_flashcards.sql:12`)
— a total, stable sort key. Deterministically testable with 2-3 seeded cards at **controlled
`due`** values (distinct → assert ascending; identical → assert the UUID tiebreak). **Caveat:**
`tests/integration/helpers/db.ts` `seedFlashcard` currently only overrides
`front`/`back`/`status`; FSRS columns fall back to `due default now()`, so seeded cards
differ only by microseconds. The helper needs a `due` (and ideally `id`) override, or the
test must `UPDATE` `due` after seeding.

**Optimistic-concurrency guard.** `recordReview` does SELECT → `scheduler.next` → UPDATE
with `.eq("updated_at", fetchResult.data.updated_at)` (`reviews.ts:88-95`) and writes a
fresh `updated_at` in `toRowUpdate` (`reviews.ts:40`). There is **no DB trigger** for
`updated_at` (`create_flashcards.sql:19` is `default now()` only) — the guard works solely
because the app rewrites it. In a race of two reviews of the same card:
- **Winner** → UPDATE matches 1 row → `recordReview` returns the row → route **200** with
  the full updated `Flashcard` JSON (`review.ts:49`).
- **Loser** → `.eq("updated_at", U0)` matches **0 rows** → `.maybeSingle()` resolves
  `{data: null, error: null}` → `recordReview` returns `null` → route **404**
  `{"error":"Flashcard not found"}` (`review.ts:46-48`) — indistinguishable from a genuinely
  missing card.
- Postgres row-locking serializes the UPDATEs, so the aggregate is deterministic: exactly
  one 200, exactly one 404.

**`recordReview` returns `null` for two distinct reasons**, both → 404: row not
found / not owned / not `accepted` (`reviews.ts:78-80`), and lost concurrency race
(`reviews.ts:88-95`). Worth a dedicated test each.

### Risk #3 — AI generation pipeline

**Where the logic lives.** `src/lib/services/flashcard-generation.ts` — one exported
function `generateFlashcardProposals(sourceText)` (`:34-92`), one custom error class
`FlashcardGenerationError` (`:22-27`), one outbound call: `fetch(OPENROUTER_URL, …)`
(`:43-57`, `OPENROUTER_URL` const at `:4`). One production caller:
`src/pages/api/flashcards/generate.ts:43`. **Zero** test files reference it today.

**Error taxonomy → HTTP status.** The route wraps the whole call in one try/catch
(`generate.ts:41-47`): `error instanceof FlashcardGenerationError ? error.message :
"Flashcard generation failed"`, always status **502**, body `{"error": <message>}`
(`jsonError`, `generate.ts:70-74`). All service throws are `FlashcardGenerationError`, so
the generic fallback is only reachable via an unexpected bug (all schema checks use
`safeParse`, which does not throw).

| # | Trigger | Service `file:line` | Message string | Route |
|---|---|---|---|---|
| 1 | `OPENROUTER_API_KEY` falsy (it is `optional` in `astro.config.mjs:21`) | `flashcard-generation.ts:35-37` | `OPENROUTER_API_KEY is not configured` | 502 |
| 2 | `fetch()` rejects (DNS/refused/TLS) — bare `catch {}` discards the cause | `:58-60` | `Failed to reach the AI provider` | 502 |
| 3 | `response.ok === false` (OpenRouter 4xx/5xx) | `:62-64` | `` AI provider returned an error (status ${response.status}) `` | 502 |
| 4 | `response.json()` throws (body not JSON) | `:70-72` | `AI provider returned an invalid JSON response` | 502 |
| 5 | envelope fails `openRouterResponseSchema` (no `choices` / `choices:[]` / no `message`), or `content` is `null` / absent / **`""`** | `:74-77` (helper `:106-112`, schema `:94-104`) | `AI provider response was missing message content` | 502 |
| 6 | `JSON.parse(content)` throws (non-empty non-JSON) | `:80-84` | `AI provider content was not valid JSON` | 502 |
| 7 | `proposalsSchema.safeParse` fails — not `{flashcards:[…]}`, empty array (`.min(1)`), **>15 (`.max(15)`)**, or any `front`/`back` not a non-empty string | `:86-89` (schema `:13-20`) | `AI provider output did not match the expected flashcard shape` | 502 |

Route-level pre-service guards (part of the endpoint surface): `500` Supabase not configured
(`generate.ts:17-18`); `401` Unauthorized (`:23-27`); `400` body not JSON (`:30-34`); `400`
`sourceText` <100 / >10000 chars, zod message (`:36-39`, schema `:9-14`); `500` insert error
(`:57-61`); **`201`** success `{"flashcards":[<inserted rows>]}` (`:63-67`).

**No timeout / retry.** Confirmed: no `AbortController`, `AbortSignal`, `signal:`,
`setTimeout`, retry, or backoff anywhere in `src/lib/services/` or
`src/pages/api/flashcards/`. `fetch` at `flashcard-generation.ts:43` passes no `signal` and
awaits indefinitely. A never-resolving mocked `fetch` hangs until Vitest's per-test timeout
(default 5000 ms). A rejecting `fetch` hits branch 2, and the bare `catch {}` (`:58`)
discards the underlying error, so a test can only assert the mapped message, not the cause.

**Mock seam — recommendation: `vi.spyOn(globalThis, "fetch")`** (with `restoreMocks: true`
or `afterEach(() => vi.restoreAllMocks())`):
- One call site, no wrapper/SDK, global reference → stubbing the global is complete coverage
  with zero indirection.
- `.mockResolvedValueOnce(new Response(body, { status }))` / `.mockRejectedValueOnce(new
  TypeError("fetch failed"))` per branch; assert the request with `expect(fetchSpy).toHaveBeenCalledWith(OPENROUTER_URL, …)`.
- `vi.stubGlobal("fetch", fn)` + `vi.unstubAllGlobals()` is equivalent — pick it only if
  `globalThis.fetch` is non-configurable in the runtime.
- **`msw` is not worth it** here: a dependency + server lifecycle to intercept one hard-coded
  URL, buying request-matching sugar that `toHaveBeenCalledWith` already covers. Lower cost,
  equal signal: the spy. (This also settles the `test-plan.md` §4 "API mocking — see Phase 3"
  row for this phase's needs.)
- For branches 2-7 the API key must be present: `vi.mock("astro:env/server", () => ({
  OPENROUTER_API_KEY: "test-key", OPENROUTER_MODEL: "test/model" }))`. Omit / falsify it to
  hit branch 1.

**Mock response shapes.** Envelope: `{choices:[{message:{content: <JSON string>}}]}`; `content`
is `JSON.parse`d then validated against `{flashcards:[{front:string≥1, back:string≥1}], min 1,
max 15}`.
- **Happy (→ 201):** `{"choices":[{"message":{"content":"{\"flashcards\":[{\"front\":\"Q\",\"back\":\"A\"}]}"}}]}`
- Branch 3: `new Response("rate limited", { status: 429 })`
- Branch 4: `new Response("<html>502</html>", { status: 200 })`
- Branch 5: `{"choices":[]}` / `{"choices":[{"message":{"content":null}}]}` / `…"content":""`
- Branch 6: `content` = `"Here are your flashcards!"`
- Branch 7: `content` = `"{\"cards\":[…]}"` (wrong key) / `"{\"flashcards\":[]}"` / 16 items / blank `front`

**`generate.ts` persists `status: "pending"`** (`generate.ts:49-55`), never `accepted`. So a
card created via `/generate` is invisible to `getDueFlashcards` and `recordReview` (both
filter `.eq("status","accepted")`, `reviews.ts:49,72`) until promoted. An integration test
spanning generate→review must flip `status` directly (no accept endpoint was found in the
reviewed files).

### Test infrastructure reuse (from Phase 1)

- `vitest.config.ts` — `unit` project (`src/**/*.test.ts`, `npm test`) and `integration`
  project (`tests/integration/**/*.test.ts`, `npm run test:integration`, needs
  `npx supabase start`; `fileParallelism:false`; `setupFiles` + `globalSetup`).
- `tests/integration/helpers/` — `users.ts` (`createTestUser`/`deleteTestUser` via
  service-role `auth.admin`; `signedInClient(user)` → RLS-scoped client), `session.ts`
  (`cookieHeaderFor(user)`, `apiContext({method,path,cookieHeader?,body?,params?})`),
  `db.ts` (`seedFlashcard(ownerClient, userId, overrides?)`, `resetFlashcards(clients[])`),
  `clients.ts`, `local-env.ts`.
- `eslint.config.js` — `tests/**` + `src/**/*.test.*` override turning off
  `@typescript-eslint/no-unsafe-*`.
- **Gap for Risk #2 integration:** `seedFlashcard` cannot set `due` / FSRS columns — needed
  for due-list ordering and "not-yet-due" scenarios. Extend the helper or `UPDATE` post-seed.
- **Risk #3 is unit/integration on the *service*, not the DB** — the recommended pattern is
  a unit test (`src/lib/services/flashcard-generation.test.ts`, `unit` project, `fetch`
  spied, env mocked) covering all 7 branches + happy path, plus optionally one thin
  integration test on the `generate` route (real DB insert of `pending` rows on the happy
  path; 502 passthrough on a mocked failure).

## Code References

- `src/lib/services/reviews.ts:9` — scheduler singleton, `enable_short_term:false`
- `src/lib/services/reviews.ts:11-42` — `toFsrsCard` / `toRowUpdate` row↔Card mapping
- `src/lib/services/reviews.ts:44-59` — `getDueFlashcards` (`.eq status accepted`, `.lte due now`, `.order due,id`)
- `src/lib/services/reviews.ts:61-102` — `recordReview` (fetch → `scheduler.next` → guarded UPDATE)
- `src/lib/services/reviews.ts:82` — the only `scheduler.next(...)` call
- `src/pages/api/flashcards/[id]/review.ts:8-12,45-49` — rating schema, `recordReview` call, 200/404
- `src/pages/api/flashcards/due.ts:22` / `src/pages/flashcards/review.astro:22` — the two `getDueFlashcards` callers
- `src/lib/services/flashcard-generation.ts:34-92` — `generateFlashcardProposals`
- `src/lib/services/flashcard-generation.ts:43-57` — the single `fetch` to OpenRouter
- `src/lib/services/flashcard-generation.ts:13-20,94-104` — `proposalsSchema`, `openRouterResponseSchema`
- `src/pages/api/flashcards/generate.ts:41-47,49-55,63-67` — 502 error mapping, `status:"pending"` insert, 201
- `src/types.ts:6,9,12-30,44-46,65-67,70-72` — `FlashcardStatus`, `ReviewState`, `Flashcard`, `GenerateFlashcardsResponse`, `DueFlashcardsResponse`, `SubmitReviewRequest` (no `ReviewResponse` type — route returns a bare `Flashcard`)
- `supabase/migrations/20260906000000_add_review_state_to_flashcards.sql:6-15` — FSRS columns + defaults
- `supabase/migrations/20260904000000_add_flashcards_list_index.sql:7-8` — `(user_id, status, created_at desc, id desc)` index
- `node_modules/ts-fsrs/dist/index.mjs:23-30` (Rating enum), `:318-323` (deterministic seed), `:505,654` (fuzz default off), `:814-824` (`apply_fuzz`), `:830-836` (interval floor ≥1), `:1266-1291` (long-term interval ordering + state), `:1250` (lapses += 1)

## Architecture Insights

- **Scheduling is a thin wrapper over a deterministic library.** The project owns only the
  DB↔`Card` mapping and the concurrency guard. Unit tests should target `toFsrsCard`/
  `toRowUpdate` round-tripping and *structural* `scheduler.next` properties (ordering, floors,
  `reps`), never reproduced arithmetic. Integration tests should target `recordReview`
  (rate → re-fetch due list → assert the card is gone and `due > now`) and the due-list
  ordering — both against real local Supabase.
- **The AI service is a pure function with an injectable global boundary.** All seven
  failure modes are reachable by controlling one `fetch` mock + one env mock; no DB needed
  for the branch coverage. This is a `unit`-project test.
- **Two independent "no requeue" mechanisms reinforce each other:** ts-fsrs's ≥1-day floor,
  and the session being a single fixed pass over a due-list snapshotted at session start
  (`useReviewSession` / `review.astro`). Phase 2's automated scope is the server side
  (`due` never `≤ now` after a rating); the client-side fixed-queue behavior is Risk #5
  territory (Phase 3).
- **`getDueFlashcards`'s second caller (`review.astro`) is not a route** — a Phase 2 test of
  the `/due` route does not cover the SSR page's identical call. Options: test the service
  directly (recommended — one test covers both callers), or accept the route-only gap and
  note it.
- **`status:"pending"` on generated rows** is a deliberate seam between generation and the
  study loop; cross-flow tests must bridge it explicitly.

## Historical Context (from prior changes)

- `context/archive/2026-09-06-spaced-repetition-session/plan.md:24` — Definitions: "in-session
  'Again' requeue → **Not requeued**. FSRS configured with `enable_short_term: false` … a
  card rated 'Again' leaves the session's fixed queue and only reappears in a future
  due-check." Origin: user-confirmed.
- `…/plan.md:50,54` — `enable_short_term: false` is "load-bearing … not just a tuning knob";
  with default `true`, Again reschedules ~1-10 min later and the session "would never
  re-check for it".
- `…/reviews/plan-review.md:23,60-65` — ts-fsrs "Again-floor ✓ (hard 1-day minimum,
  confirmed against `algorithm.ts`'s `Math.max(1, …)`)"; the symmetric "newly-due
  mid-session" case verified safe by the same floor.
- `…/reviews/impl-review.md:23-40` (F1, FIXED via Fix A) — the optimistic-concurrency guard
  was added because two concurrent submissions "both read the same stale row, and the second
  UPDATE silently clobbers the first's scheduling result — a lost review with no error
  surfaced." Tradeoff accepted: a genuine double-submit now surfaces as "flashcard not
  found" (404).
- `…/reviews/plan-review.md:39-45` (F2, FIXED) — `flashcards` has **no `updated_at`
  trigger**; every mutating write must set it explicitly. `recordReview` does
  (`reviews.ts:40`).
- `…/reviews/plan-review.md:47-55` (F3, FIXED) — `.order("id", asc)` tiebreak added because
  the FSRS-column `ALTER TABLE … default now()` backfill evaluates `now()` once → guaranteed
  multi-row `due` tie on first deploy. Manual verify step "seed two flashcards with the same
  `due`, confirm stable ordering" was **never automated** — a direct Phase 2 target.
- `…/plan.md:264-268` Manual Testing Step 4: "Rate one card 'Again', finish the rest of the
  session, and confirm the 'Again'-rated card does not reappear before the session ends" —
  the core no-requeue guarantee, verified by hand only.
- `…/reviews/impl-review.md:60-66` (F4, ACCEPTED) — "API doesn't enforce due-ness at
  submission time": a user can `POST …/review` on a not-yet-due card. Conscious gap; Phase 2
  can document current behavior (it still schedules from the card's state), not "fix" it.
- `context/archive/2026-09-06-choose-review-algorithm/ts-fsrs-api-reference.md:20-22,82-91`
  — `Rating { Manual=0, Again=1, Hard=2, Good=3, Easy=4 }`, `Grade = Exclude<Rating, Manual>`;
  `default_enable_fuzz=false`, `default_enable_short_term=true`, 21-length FSRS-6 `w` array
  "ship as-is". `codebase-compatibility-review.md:15,33-34` — the 1-4 literals "map straight
  to `Rating.Again|Hard|Good|Easy`"; "fully compatible … no runtime-compatibility risk."
- `context/archive/2026-09-02-reviewed-ai-flashcards/plan.md:117-118,187-189` — service
  "calls OpenRouter … parses/validates with zod, caps at 15"; **"`wrangler.jsonc` sets no
  CPU-time override … the synchronous OpenRouter call … is subject to Cloudflare's default
  CPU-time limits; revisit if generation calls start timing out."** `reviews/plan-review.md:67-75`
  (F5, OBSERVATION) — timeout risk noted as a known limitation, **no code change**.
- `…/plan.md:41,158,169`, `plan-brief.md:45`, `change.md:12-14` — "a clear actionable error"
  was defined as an **inline retryable banner that preserves the pasted text + explicit
  Retry button**, not a per-cause error taxonomy or user-facing error codes. (The 7-message
  taxonomy exists only in code and is flattened to 502.)
- **Doc/code deviation:** archived plan says default model `openai/gpt-4o-mini`;
  `src/lib/services/flashcard-generation.ts:5` uses `"openrouter/auto"`. Cosmetic for
  testing (mock ignores the model), but worth noting in the plan.

## Response-guidance and anchor corrections (for `/10x-test-plan` backport)

1. **Risk #2 cheapest-layer guidance is confirmed** — "unit (scheduling calc) + integration
   (rate → re-fetch due list → assert)" — with one refinement: the "scheduling calc" unit is
   *not* re-implementing FSRS; it is asserting `toFsrsCard`/`toRowUpdate` round-trips and the
   structural properties in "Oracle-safe assertions" above. Add to "Must challenge":
   *"asserting an exact `due` date reproduces ts-fsrs's arithmetic — assert ordering
   (`Again < Hard < Good < Easy`), `reps +1`, `state 0→2`, and `due > now` instead."*
2. **Risk #2 context to ground — add:** `getDueFlashcards` has **two** callers
   (`/api/flashcards/due` route + `review.astro` SSR). The "Context `/10x-research` must
   ground" cell should note that testing the service (not just the route) covers both, and
   that `seedFlashcard` currently cannot set `due` (blocks deterministic ordering tests).
3. **Risk #3 cheapest-layer guidance is confirmed** — "integration (mock the provider edge
   only)". Refine: the provider edge is a **single bare `globalThis.fetch`**; the cheapest
   real-signal test is a **unit** test on `generateFlashcardProposals` with `vi.spyOn(globalThis,
   "fetch")` + `vi.mock("astro:env/server")`, covering all 7 error branches + happy path.
   `msw` is explicitly not needed. This also resolves the §4 "API mocking — see Phase 3" row
   for Phase 2's scope.
4. **Risk #3 "times out" clause** — there is **no timeout handling** in the code (confirmed
   here and in the archive). Per this change's scope decision, Phase 2 **documents the gap
   and tests current behavior** (a rejected `fetch` → "Failed to reach the AI provider" →
   502); it does not add an `AbortController`. The plan's "Must challenge" cell should note
   that "the timeout case" currently means "the platform kills a hung Worker", not an
   application-level deadline.
5. **§6.4 cookbook** (AI pipeline) and **§6.6 Phase 2 note** get filled in when this change
   lands (mirroring the Phase 1 fill-in).

No risk was found to be speculative — both #2 and #3 describe real, currently-implemented
behavior with zero automated protection.

## Related Research

- `context/archive/2026-09-09-testing-critical-path-coverage/research.md` — Phase 1
  (Risks #1, #4); established the `tests/integration/` harness this phase reuses.
- `context/archive/2026-09-06-choose-review-algorithm/research.md` — algorithm selection;
  `ts-fsrs-api-reference.md` in the same folder is the canonical ts-fsrs API notes.

## Open Questions

- **`seedFlashcard` extension** — add `due` / `id` overrides to
  `tests/integration/helpers/db.ts`, or `UPDATE` post-seed in the ordering test? (Planning
  decision; the former is reusable, the latter is local.)
- **Cross-flow generate→review test** — worth one integration test that generates
  (`pending`), flips `status` to `accepted`, then reviews? Or keep the two flows' tests
  fully separate this phase? (Risk #3's statement is scoped to "clear error / no
  silently-corrupt list", which doesn't require the study loop.)
- **`review.astro` coverage** — accept that Phase 2 tests the `getDueFlashcards` *service*
  (covering both callers) and does not render the `.astro` page, or is a page-level check
  wanted? (Page rendering is out of scope per test-plan §6.3 / Phase 1 precedent.)
