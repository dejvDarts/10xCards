# Client-State & Input Hardening (Test Rollout Phase 3) Implementation Plan

## Overview

Add coverage for the two risks the test plan ranks next:

- **Risk #5** — optimistic-update rollback drift leaves the flashcard list showing stale or
  incorrect state after a failed edit / delete / create.
- **Risk #6** — untrusted input reaching an API route bypasses server-side validation
  (oversized text, malformed payload) and is persisted.

Risk #5 gets a **new hook-level test layer** — `@testing-library/react`'s `renderHook` in a
third `components` Vitest project (`happy-dom`), with `fetch` mocked — covering the
rollback contracts in `useFlashcardList` / `useFlashcardProposals` / `useReviewSession`.
Risk #6 gets an adversarial-input integration sweep on the existing Phase-1 harness: bad
payloads POSTed straight to the route handlers, asserting `400` + nothing persisted.

No production code changes. Three schema gaps found in research are **pinned as
current-behavior tests** with a flagged follow-up, not fixed here.

## Current State Analysis

- **Risk #5 rollback lives in the hooks** (`src/components/hooks/`), each with one `.tsx`
  consumer:
  - `useFlashcardList.editFlashcard` (`:51-71`) — optimistic `map`; on failure restores
    `front`/`back` **from the `card` arg**; list length / `total` / `totalPages` never
    touched.
  - `useFlashcardList.deleteFlashcard` (`:73-110`) — optimistic `filter` + `setTotal(t=>t-1)`
    + recompute `totalPages` + capture `willBeEmpty`; **on success** if `willBeEmpty &&
    page > 1` → `await goToPage(page-1)` (refetch); **on failure** re-insert the original
    `card` at its original `cardIndex` + `setTotal(t=>t+1)` + recompute. No `goToPage` on
    failure.
  - `useFlashcardList.createFlashcard` (`:112-140`) — **not optimistic**; inserts only after
    the response resolves; on failure sets `error` **and `throw`s** (so the form stays
    open). No phantom row possible.
  - `useFlashcardProposals.updateFlashcard` (`:37-59`) — optimistic `filter`; on failure
    re-insert original `card` at original `cardIndex`.
  - `useReviewSession.submitRating` (`:42-61`) — **not optimistic**; `setCurrentIndex(i=>i+1)`
    is inside `try` after the `await`; on failure only sets `error`, queue/index untouched
    (deliberate — retry same card).
- **`readJsonResponse`** (`src/lib/http.ts:5-12`) throws `new Error(body.error ?? "The
  request could not be completed")` on any `!response.ok`. Both a `fetch` rejection and a
  non-2xx response reach every hook's `catch`. A 204 does not throw.
- **No React/DOM test infrastructure exists** — no `@testing-library/*`, no `happy-dom` /
  `jsdom`; both Vitest projects are `environment: "node"`. `getViteConfig()` **already
  injects `@vitejs/plugin-react`** via `@astrojs/react`'s `astro:config:setup`, so `.tsx` /
  JSX transform works in tests with nothing added.
- **Risk #6 — every write route validates before the DB** in a fixed order: `createClient`
  (500) → `getUser` (401) → *(id routes)* `z.uuid()` param (400 `"Invalid flashcard ID"`) →
  *(body routes)* `request.json()` try/catch (400 `"Request body must be valid JSON"`) →
  `schema.safeParse` (400 `issues[0]?.message ?? "Invalid request body"`) → **DB write**.
  A schema failure always `return`s before the first mutation — **no partial write is
  possible on any route**. `generate` also gates the DB insert behind the AI call.
- **Zod is `4.5.4`.** Its auto-generated messages (`"Invalid input: expected string,
  received number"`, `"Unrecognized key: \"x\""`, and the generic `"Invalid input"` for the
  `rating` union) are **not contract** — assert status + not-persisted, never wording.
- **Zero negative-validation coverage today.** `flashcards.auth-gating.test.ts` uses only
  valid bodies; `flashcards.generate.test.ts` has one case (undersized `sourceText` → 400).
  Malformed `[id]`, non-JSON body, `.strict()` extra-key, `.refine()` violation — all
  uncovered across every route.
- **Three schema gaps** (research): PATCH `front`/`back` have **no `.max`** (create caps at
  1000) → a 5,000-char PATCH persists; `generate` has **no `.strict()`** (extra keys
  ignored) and **no `.trim()`** (100 spaces passes, stored).

## Desired End State

- `npm run test:components` runs a green `renderHook` suite (`happy-dom`, no Docker) for the
  hook rollback contracts.
- `npm run test:integration` runs the Phase-1/2 suites **plus** the input-validation sweep,
  green, against local Supabase.
- `npm test` (unit) is unchanged — still fast, DOM-free, `--project unit`.
- The suite fails loudly if any of these regress:
  - a failed `editFlashcard` / `deleteFlashcard` / `updateFlashcard` no longer rolls the
    list (and `total` / `totalPages`) back to its pre-mutation value;
  - `deleteFlashcard` on the last card of a page > 1 no longer navigates back a page on
    success;
  - `createFlashcard` stops rejecting on failure, or starts leaving a phantom row;
  - `submitRating` starts advancing `currentIndex` on failure;
  - any flashcard write route stops rejecting an adversarial payload with `400`, or starts
    persisting one;
  - one of the three pinned schema gaps changes behavior (then the pinning test flips —
    which is the point).

### Key Discoveries:

- **Tooling** (research): `@testing-library/react@^16` (React 19), `@testing-library/dom@^10`,
  `happy-dom`. `renderHook` needs a DOM env (`react-dom/client` `createRoot`). RTL v16 sets
  `IS_REACT_ACT_ENVIRONMENT`; wrap async mutation calls in `await act(async () => { … })`.
- **Do not add `@vitejs/plugin-react`** — `getViteConfig()` already carries it; a second
  copy risks a double transform.
- Per-project `test.environment` is supported in Vitest 3.2 `test.projects[]` (the config
  already varies `fileParallelism` per project).
- `.test.tsx` files will not double-run: the `unit` project's `include` is `src/**/*.test.ts`.
- Risk #6 assertion shape (research): fixture size is a literal from the spec; assert
  `status === 400` + a `count: "exact", head: true` query showing 0 rows (or a re-read
  showing the row unchanged). `expect(body).toHaveProperty("error")` for shape; a
  `/at most 1,?000/` regex only if a custom domain message is genuinely contractual; never
  for `rating`.
- `useFlashcardProposals` has no `initialData` — the `updateFlashcard` rollback test must
  first populate `flashcards` via a mocked-success `generate()` call.
- `deleteFlashcard` success-pagination needs a `fetch` mock that branches on
  `init?.method === "DELETE"` (→ 204) vs the follow-up `GET /api/flashcards?page=1` (→ 200
  page body).
- The `generate` boundary-pass cells in the Risk #6 sweep need the OpenRouter `fetch`
  mocked — reuse the conditional-intercept pattern from
  `tests/integration/flashcards.generate.test.ts` (capture `realFetch` inside the helper,
  guard with `expect(vi.isMockFunction(globalThis.fetch)).toBe(false)`).

## What We're NOT Doing

- **Not** writing component render tests (`jsdom`, RTL `render`, `@testing-library/user-event`).
  The three component-owned UI-buffer behaviors — create-draft retention
  (`FlashcardList.tsx:70-80`), edit-editor close-on-failure (`:92-95`), generator
  retry-replay (`FlashcardGenerator.tsx:78-79`) — stay untested, each an individual
  S-01/S-02/S-04 manual-verification decision.
- **Not** fixing the three schema gaps. PATCH `.max`, `generate` `.strict()` / `.trim()`
  are pinned as current-behavior tests with a comment and a follow-up note; changing them
  is a product/hardening decision for its own change.
- **Not** testing the concurrent-delete drift (two `deleteFlashcard` calls before the first
  resolves). The S-04 functional-updater refactor fixed it; a `Promise.all` interleave test
  isn't deterministic enough to gate on (Phase-2 `Promise.all`-race precedent).
- **Not** covering non-rollback hook paths — `goToPage` / `retry` happy paths,
  `useFlashcardProposals.generate` success, `useReviewSession.retry`.
- **Not** wiring `test:components` into `.github/workflows/ci.yml` — that is rollout Phase 4.
- **Not** adopting `@cloudflare/vitest-pool-workers`; not touching Risks #1/#2/#3/#4.
- **Not** asserting exact zod message strings anywhere.

## Implementation Approach

Two phases, Docker only in Phase 2.

1. **Component/hook harness + Risk #5.** Add the three dev deps, a third `components`
   Vitest project (`happy-dom`, `src/**/*.test.tsx`), and a `test:components` script.
   `renderHook` tests for the rollback contracts with `globalThis.fetch` spied per test.
2. **Risk #6 sweep + cookbook.** One integration file POSTing adversarial payloads straight
   to the four write-route handlers via the Phase-1 harness, asserting `400` + nothing
   persisted; the three schema gaps pinned as current-behavior. Fill in `test-plan.md`
   §6.5 + §6.6.

## Critical Implementation Details

- **DOM env fallback (happy-dom → jsdom).** If the Phase-1 harness smoke (Change #0) fails
  because `@testing-library/react` / `renderHook` needs a Web API happy-dom does not
  implement, switch the `components` project to `jsdom`: swap the `happy-dom` devDep for
  `jsdom` (`^24`) and set `environment: "jsdom"` in `vitest.config.ts`. Nothing else
  changes — the tests are DOM-agnostic. jsdom is slower but spec-complete.

- **React 19 `act`.** Every mutation call goes through `await act(async () => { await
  result.current.<fn>(...) })`. `editFlashcard` / `deleteFlashcard` / `updateFlashcard` do
  not rethrow, so `await` resolves and assertions read `result.current.*`. `createFlashcard`
  **rethrows** → `await expect(result.current.createFlashcard(...)).rejects.toThrow()`
  inside the `act` callback.

- **`fetch` mocking in `components` tests.** `vi.spyOn(globalThis, "fetch")` in each test;
  `afterEach(() => vi.restoreAllMocks())`. Failure injection is either
  `.mockRejectedValueOnce(new TypeError("network"))` or
  `.mockResolvedValueOnce(new Response(JSON.stringify({ error: "Boom" }), { status: 500 }))`
  — research confirms both reach the same `catch`. happy-dom supplies `location`
  (`http://localhost/`) so the hooks' relative-URL `fetch` calls resolve before the spy
  sees them.

- **`deleteFlashcard` success-pagination mock.** `mockImplementation((input, init) => {
  if (init?.method === "DELETE") return Promise.resolve(new Response(null, { status: 204 }));
  return Promise.resolve(new Response(JSON.stringify(page1Body), { status: 200 })); })`
  with `initialData = { flashcards: [only], page: 2, limit: 20, total: 21, totalPages: 2 }`.
  Assert `result.current.page === 1` and `result.current.flashcards` replaced by
  `page1Body.flashcards`, `error === null`.

- **`useFlashcardProposals` seeding.** No `initialData`. In the rollback test: mock `fetch`
  → success envelope with 2 proposals, `await act` `generate("...")`, then swap the mock to
  a 500/reject and `await act` `updateFlashcard(proposals[0], "accepted")`; assert the
  proposal is re-inserted at index 0 and `error` is truthy.

- **`npm test` stays DOM-free.** It remains `vitest run --project unit`; the `unit` glob is
  `src/**/*.test.ts`, so `.test.tsx` never loads into the fast loop.

- **Risk #6 `generate` boundary cells.** The len-100 / len-10000 "passes → 201" cells need
  the OpenRouter call mocked; the validation-*failure* cells never reach the provider (assert
  it was not called). Use the `mockProvider` helper extracted in Phase 2 Change #1
  (`tests/integration/helpers/mock-provider.ts`).

- **Pinned schema-gap tests carry a comment.** Each of the three (PATCH 5,000-char → 200;
  `generate` `{…,junk:true}` → 201; `generate` `" ".repeat(150)` → 201) gets an inline
  `// PINNED: no .max on PATCH front/back (create caps at 1000) — see test-plan §6.6
  follow-up` style note so the assertion isn't read as endorsement.

## Phase 1: Component/Hook Test Harness + Risk #5 Coverage

### Overview

A `components` Vitest project (`happy-dom`) runs `renderHook` tests that lock in the
optimistic-rollback contracts, with `fetch` mocked and no Docker.

### Changes Required:

#### 0. Harness smoke — verify `renderHook` + `act` resolve under the DOM env

**File**: `src/components/_harness.smoke.test.tsx` (new, temporary — deleted at end of Phase 1)

**Intent**: This is the first React/DOM test in the repo. Prove the toolchain works before
building the real suites on it.

**Contract**: A throwaway test in the `components` project that does
`const { result } = renderHook(() => useState(0))`, `await act(async () => {
result.current[1](1); })`, and asserts `result.current[0] === 1`. If it passes, delete the
file and proceed. If it fails, apply the fallback (see Critical Implementation Details:
happy-dom → jsdom), re-run, delete. The outcome (happy-dom vs jsdom) is noted in the Phase 1
completion summary.

#### 1. Test dependencies & script

**File**: `package.json`

**Intent**: Add the React testing stack and a grouped runner, mirroring the existing
`unit` / `integration` split.

**Contract**: New `devDependencies`: `@testing-library/react` (`^16`),
`@testing-library/dom` (`^10`), `happy-dom` (latest `^1x`). New script
`"test:components": "vitest run --project components"`. `"test"` stays
`"vitest run --project unit"` (unchanged — DOM-free). No `@vitejs/plugin-react`.

#### 2. `components` Vitest project

**File**: `vitest.config.ts`

**Intent**: Give `.test.tsx` files a DOM environment without touching the `node` projects.

**Contract**: Add a third entry to `test.projects`:
`{ extends: true, test: { name: "components", environment: "happy-dom", include:
["src/**/*.test.tsx"] } }`. `unit` / `integration` unchanged. If cross-test DOM leakage
appears, add `setupFiles` with `afterEach(cleanup)` from `@testing-library/react` — note it
in the file, don't add pre-emptively.

#### 3. ESLint override for hook-test files

**File**: `eslint.config.js`

**Intent**: `renderHook(() => useFlashcardList(x))` calls a hook from an anonymous arrow
that is neither a component nor a `use*` function — `reactConfig` (which globs all `.tsx`)
flags it via `react-hooks/rules-of-hooks` and `react-compiler/react-compiler: "error"`.

**Contract**: Extend `eslint.config.js` — either widen the existing `testConfig` block or
add a sibling — so `src/**/*.test.tsx` also turns off `react-hooks/rules-of-hooks`,
`react-hooks/exhaustive-deps`, and `react-compiler/react-compiler`. Scope the override to
the `.test.tsx` glob only; non-test `.tsx` keeps all React rules. Mirrors the `no-unsafe-*`
`tests/**` override already in the file.

#### 4. `useFlashcardList` hook tests

**File**: `src/components/hooks/useFlashcardList.test.tsx` (new)

**Intent**: Lock in the edit/delete rollback, the delete success-pagination branch, and the
non-optimistic create contract.

**Contract**: `components` project. `renderHook(() => useFlashcardList(initialData))`; a
local `makeCard(id, over?)` fixture; `vi.spyOn(globalThis, "fetch")` per test, restored in
`afterEach`. Tests:
- **edit rollback**: 2 cards; `fetch` → 500; `await act` `editFlashcard(cardA, { front:
  "NEW", back: "NEW" })` → `flashcards` has cardA with its **original** `front`/`back`,
  length 2, `total` / `totalPages` unchanged, `error` truthy, `mutatingCardIds.has(cardA.id)
  === false`.
- **delete rollback**: 3 cards (`total: 3`); `fetch` → reject; `await act`
  `deleteFlashcard(cardB)` → `flashcards.map(c => c.id) === [A, B, C]`, `total === 3`,
  `totalPages` restored, `error` truthy, `mutatingCardIds` cleared.
- **delete success-pagination**: `initialData` with one card on `page: 2`, `total: 21`,
  `totalPages: 2`; branching `fetch` mock — `init?.method === "DELETE"` →
  `new Response(null, { status: 204 })`; otherwise (the follow-up
  `GET /api/flashcards?page=1`) → `new Response(JSON.stringify(page1Body), { status: 200 })`
  where `page1Body` is a full `ListFlashcardsResponse` with **`page: 1`** (plus `flashcards`,
  `limit`, `total`, `totalPages`). `await act` `deleteFlashcard(only)` → `result.current.page
  === 1`, `flashcards` replaced by `page1Body.flashcards`, `error === null`.
- **create rejects, no phantom**: 2 cards; `fetch` → 500; `await
  expect(result.current.createFlashcard({ front: "x", back: "y" })).rejects.toThrow()`
  inside `act` → `flashcards` length still 2, `total` unchanged, `error` truthy.

#### 5. `useFlashcardProposals` hook test

**File**: `src/components/hooks/useFlashcardProposals.test.tsx` (new)

**Intent**: Lock in the accept/reject (`updateFlashcard`) optimistic-remove rollback.

**Contract**: `renderHook(() => useFlashcardProposals())`. Populate `flashcards` via a
mocked-success `generate("<100+ chars>")` whose `fetch` resolves a
**`GenerateFlashcardsResponse`** — `{ flashcards: [card0, card1] }` (the route's response
shape, **not** the OpenRouter `{ choices: [...] }` envelope; `generate` reads
`readJsonResponse<GenerateFlashcardsResponse>`). Then swap `fetch` to a 500/reject and
`await act` `updateFlashcard(proposals[0], "accepted")` → the proposal is re-inserted at
index 0 (list length back to 2, original order), `error` truthy, `updatingCardId === null`.

#### 6. `useReviewSession` hook test

**File**: `src/components/hooks/useReviewSession.test.tsx` (new)

**Intent**: Lock in the deliberate "don't advance on failure" contract.

**Contract**: `renderHook(() => useReviewSession({ flashcards: [cardA, cardB] }))`;
`fetch` → 500; `await act` `submitRating(3)` → `currentCard.id === cardA.id` (no advance),
`remainingCount === 2`, `isRevealed` unchanged, `error` truthy, `isSubmitting === false`.

### Success Criteria:

#### Automated Verification:

- The harness smoke (Change #0) passes — `renderHook` + `act` work under the DOM env
  (happy-dom, or jsdom via the documented fallback) — and the smoke file is deleted before
  Phase 1 completes
- `npm run test:components` exits 0 with > 0 passing tests across the three hook files
- `npm test` (unit) still exits 0 and still needs no Docker (no `.test.tsx` loaded)
- `npm run lint` passes (new `.test.tsx` files + `vitest.config.ts` + `eslint.config.js` edits)
- `npm run build` still passes

#### Manual Verification:

- Temporarily removing the `catch` restore in `useFlashcardList.editFlashcard` makes the
  edit-rollback test fail; reverting fixes it
- `npx vitest --project components` watch mode picks up the three `.test.tsx` files
- `npm test` output shows only the `unit` project (no `happy-dom` env spun up)

**Implementation Note**: After Phase 1 automated verification passes, pause for human
confirmation of the manual checks before starting Phase 2.

---

## Phase 2: Risk #6 Adversarial Input Sweep + Cookbook

### Overview

Adversarial payloads POSTed straight to the four flashcard write-route handlers are
rejected with `400` and never persisted; the three schema gaps are pinned; the cookbook
records both new patterns.

### Changes Required:

#### 1. Extract the conditional-provider `fetch` mock to a shared helper

**File**: `tests/integration/helpers/mock-provider.ts` (new);
`tests/integration/flashcards.generate.test.ts` (update the one import)

**Intent**: `mockProvider` (currently a file-local `function` in
`flashcards.generate.test.ts:39`) is needed by the new input-validation sweep's `generate`
boundary cells. Extract it so both files share one implementation.

**Contract**: Move `mockProvider` (and its `realFetch`-capture-with-`vi.isMockFunction`
guard) verbatim into `tests/integration/helpers/mock-provider.ts` as an `export function`;
have `flashcards.generate.test.ts` import it instead of defining it. No behavior change —
`npm run test:integration` still green with the generate smoke unchanged.

#### 2. Input-validation integration sweep

**File**: `tests/integration/flashcards.input-validation.test.ts` (new)

**Intent**: One representative test per validation cell-class per write route, plus the
universal cells and the three pinned schema gaps — asserting behavior, never zod wording.

**Contract**: `integration` project, Phase-1 harness (`createTestUser`, `signedInClient`,
`cookieHeaderFor`, `apiContext`, `resetFlashcards`, `deleteTestUser`). Import
`POST as createRoute` / `GET` from `@/pages/api/flashcards/index`, `PATCH` from
`@/pages/api/flashcards/[id]`, `POST as reviewRoute` from
`@/pages/api/flashcards/[id]/review`, `POST as generateRoute` from
`@/pages/api/flashcards/generate`. Helpers: `rowCount()` →
`client.from("flashcards").select("*", { count: "exact", head: true }).eq("user_id",
user.id)`; `seedFlashcard` (extended in Phase-2 rollout / present) for the PATCH & review
"row unchanged" cases; `mockProvider` from `./helpers/mock-provider` (change #1) for the
`generate` boundary-pass cells. `beforeAll` creates user + client + cookie; `afterEach`
`resetFlashcards([client])` + `vi.restoreAllMocks()`; `afterAll` deletes the user.

- **create** (`POST /api/flashcards`): `front` 1001 chars → 400 + `rowCount 0`; `front`
  1000 chars → 201; `front` `""` → 400; `front` `"   "` → 400; `front` `"  hi  "` → 201 +
  persisted `"hi"`; `front: 123` → 400; missing `front` → 400; `{ front, back, extra: 1 }`
  → 400 (`.strict()`); non-JSON body → 400. Each failure asserts `rowCount 0`.
- **PATCH** (`PATCH /api/flashcards/[id]`, seed one card): `{}` → 400 + row unchanged;
  `{ front: "x" }` → 200; `{ front: "" }` → 400; `{ status: "maybe" }` → 400;
  `{ front: 123 }` → 400; `{ status: "accepted", extra: 1 }` → 400; **PINNED**
  `{ front: "x".repeat(5000) }` → **200** + persisted 5,000 chars (comment: no `.max`);
  id `"not-a-uuid"` → 400 `"Invalid flashcard ID"` (body never parsed); a valid-format
  nonexistent uuid → 404; non-JSON body → 400.
- **review** (`POST /api/flashcards/[id]/review`, seed one card): `{ rating: 1 }` → 200;
  `{ rating: 0 }` → 400 + schedule unchanged; `{ rating: 3.5 }` → 400; `{ rating: "3" }` →
  400; `{}` → 400; `{ rating: 3, extra: 1 }` → 400; id `"abc"` → 400; non-JSON body → 400.
- **generate** (`POST /api/flashcards/generate`): `sourceText` len 99 → 400 + provider not
  called + `rowCount 0`; len 100 → provider called (mock) → 201; len 10001 → 400;
  `sourceText: 42` → 400; missing → 400; **PINNED** `{ sourceText: <valid>, junk: true }`
  → **201** + `junk` ignored (comment: no `.strict()`); **PINNED** `" ".repeat(150)` →
  provider called → **201** + `source_text` is 150 spaces (comment: no `.trim()`);
  non-JSON body → 400 + provider not called.

Assertions use `expect(res.status).toBe(400)` + `expect(body).toHaveProperty("error")` +
`rowCount`/re-read; no message-string equality except an optional
`expect(body.error).toMatch(/at most 1,?000/)` on the create over-max case.

#### 3. Cookbook fill-in

**File**: `context/foundation/test-plan.md`

**Intent**: Record the new hook-test pattern and the Phase-3 notes.

**Contract**: Replace the §6.5 stub ("Adding a test for a client-state hook (optimistic
update)") with: the `components` project / `happy-dom` / `renderHook` + `await act` setup,
`vi.spyOn(globalThis, "fetch")` failure injection, and the rollback assertion shape
(assert `result.current.*` after `await act`, not a thrown error — except `createFlashcard`,
which rethrows). Append a **"Phase 3 — Client-state & input hardening"** entry to §6.6
covering: the `components` Vitest project decision, the hook-only scope (the three
component UI-buffer behaviors accepted as untested), the three pinned schema gaps + the
follow-up, and the "assert status + not-persisted, never zod wording" rule for input tests.
Do not touch §1–§5 or other §6 subsections.

### Success Criteria:

#### Automated Verification:

- `npx supabase start` then `npm run test:integration` exits 0 with
  `flashcards.input-validation.test.ts` all passing and every prior integration suite
  unchanged
- `npm run test:components`, `npm test`, `npm run lint`, `npm run build` all pass
- `context/foundation/test-plan.md` §6.5 no longer contains "TBD" and §6.6 has a
  "Phase 3" entry

#### Manual Verification:

- Temporarily adding `.strict()` to the `generate` schema locally makes the pinned
  `{ …, junk: true } → 201` test fail (proving it pins current behavior); reverting fixes it
- Running `test:integration` twice leaves no leftover `test+cpc-*` users
- Temporarily deleting the `.eq("id", cardId)` uuid guard's `!z.uuid()...` check from
  `[id].ts` makes the malformed-id PATCH test fail

**Implementation Note**: After Phase 2 automated verification passes, pause for human
confirmation of the manual checks before the change is considered complete.

---

## Testing Strategy

### Component/Hook Tests (`components` project, `happy-dom`):

- `useFlashcardList.test.tsx` — edit rollback, delete rollback, delete success-pagination,
  create rejects/no-phantom.
- `useFlashcardProposals.test.tsx` — `updateFlashcard` rollback.
- `useReviewSession.test.tsx` — `submitRating` no-advance.
- `renderHook` + `await act`; `globalThis.fetch` spied per test; no DB, no Docker.

### Integration Tests (`integration` project):

- `flashcards.input-validation.test.ts` — one representative per validation cell-class per
  write route + universal cells (non-JSON, malformed id) + the three pinned schema gaps;
  each failure asserts `400` + a `count`/re-read showing nothing persisted or row unchanged.

### Manual Testing Steps:

1. `npm run test:components` (green, no Docker); `npm test` (green, `unit` only).
2. `npx supabase start` → `npm run test:integration` (green).
3. Break one rollback (`editFlashcard` catch restore) → the edit-rollback hook test fails;
   revert.
4. Add `.strict()` to the `generate` schema → the pinned junk-key test fails; revert.
5. Run `test:integration` twice; confirm no `test+cpc-*` residue.

## Performance Considerations

- The `components` suite must stay sub-second (no DB, no network) so it can run alongside
  `unit` in a fast local loop.
- The input-validation sweep adds ~30 short assertions across one file; the `generate`
  boundary cells are the only ones that touch a (mocked) provider call. Cache
  `cookieHeaderFor` per user within the file.

## Migration Notes

- No schema changes; `supabase/migrations/` untouched — the `lessons.md` migrations rule
  does not apply.
- Three new dev dependencies (`@testing-library/react`, `@testing-library/dom`,
  `happy-dom`). `vitest.config.ts` (third project) and `eslint.config.js` (test-file override) edits, one `package.json` script.
  Everything else is new test files + a `mock-provider` helper extraction (moves a
  file-local function in `flashcards.generate.test.ts` to `tests/integration/helpers/`,
  no behavior change) + `test-plan.md` doc edits. No production code changes.
- **Flagged follow-up (not this change):** PATCH `front`/`back` have no `.max`; `generate`
  has no `.strict()` / `.trim()`. Pinned as current-behavior tests here; hardening is a
  separate change.

## References

- Research: `context/changes/client-state-and-input-hardening/research.md`
- Change brief: `context/changes/client-state-and-input-hardening/change.md`
- Test plan: `context/foundation/test-plan.md` §2 (Risks #5, #6), §4 (component tests row),
  §6.5, §6.6
- Phase-1/2 harness + patterns: `tests/integration/helpers/`, `vitest.config.ts`,
  `tests/integration/flashcards.generate.test.ts` (conditional `fetch` mock)
- Risk #5 hooks: `src/components/hooks/useFlashcardList.ts:51-140`,
  `useFlashcardProposals.ts:37-59`, `useReviewSession.ts:42-61`; `src/lib/http.ts:5-12`
- Risk #6 routes: `src/pages/api/flashcards/index.ts:13-18,48-90`,
  `[id].ts:8-17,19-71`, `[id]/review.ts:8-12,14-53`, `generate.ts:9-14,16-68`
- React testing under Astro: `getViteConfig()` injects `@vitejs/plugin-react` via
  `node_modules/@astrojs/react/dist/index.js:137-144`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.
> Do not rename step titles. See `.github/skills/10x-plan/references/progress-format.md`.

### Phase 1: Component/Hook Test Harness + Risk #5 Coverage

#### Automated

- [x] 1.1 The harness smoke (Change #0) passes and the smoke file is deleted before Phase 1 completes
- [x] 1.2 `npm run test:components` exits 0 with > 0 passing tests across the three hook files
- [x] 1.3 `npm test` (unit) still exits 0 and still needs no Docker (no `.test.tsx` loaded)
- [x] 1.4 `npm run lint` passes (new `.test.tsx` files + `vitest.config.ts` + `eslint.config.js` edits)
- [x] 1.5 `npm run build` still passes

#### Manual

- [x] 1.6 Removing the `catch` restore in `useFlashcardList.editFlashcard` makes the edit-rollback test fail; reverting fixes it
- [x] 1.7 `npx vitest --project components` watch mode picks up the three `.test.tsx` files
- [x] 1.8 `npm test` output shows only the `unit` project (no `happy-dom` env)

### Phase 2: Risk #6 Adversarial Input Sweep + Cookbook

#### Automated

- [ ] 2.1 `npx supabase start` then `npm run test:integration` exits 0 with `flashcards.input-validation.test.ts` all passing and every prior integration suite unchanged
- [ ] 2.2 `npm run test:components`, `npm test`, `npm run lint`, `npm run build` all pass
- [ ] 2.3 `context/foundation/test-plan.md` §6.5 no longer contains "TBD" and §6.6 has a "Phase 3" entry

#### Manual

- [ ] 2.4 Adding `.strict()` to the `generate` schema makes the pinned junk-key test fail; reverting fixes it
- [ ] 2.5 Running `test:integration` twice leaves no leftover `test+cpc-*` users
- [ ] 2.6 Deleting the malformed-id `!z.uuid()` check from `[id].ts` makes the malformed-id PATCH test fail
