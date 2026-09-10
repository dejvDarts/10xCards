---
date: 2026-09-09T19:53:54Z
researcher: Claude Sonnet 5
git_commit: 371fc26c69a66ed85ea4dee0eb72464d5938cfb8
branch: master
repository: 10xCards
topic: "Ground rollout Phase 3 of context/foundation/test-plan.md — Risk #5 (optimistic-update rollback drift) and Risk #6 (untrusted input bypassing server-side validation)"
tags: [research, codebase, hooks, optimistic-update, zod, validation, react-testing, test-plan]
status: complete
last_updated: 2026-09-09
last_updated_by: Claude Sonnet 5
---

# Research: Grounding Risks #5 and #6 for rollout Phase 3 (Client-state & input hardening)

**Date**: 2026-09-09T19:53:54Z
**Researcher**: Claude Sonnet 5
**Git Commit**: 371fc26c69a66ed85ea4dee0eb72464d5938cfb8
**Branch**: master
**Repository**: 10xCards

## Research Question

Ground rollout Phase 3 of `context/foundation/test-plan.md` (Risks #5 and #6) in actual
code: locate the optimistic-update / rollback logic in the client hooks, recommend a
concrete component-test stack (none exists yet), and produce a comprehensive
adversarial-input matrix for every flashcard write route, cross-referenced against what
Phases 1–2 already cover.

## Summary

- **Risk #5** — all server-sync optimistic rollback lives in **two** of the three hooks:
  `useFlashcardList` (`editFlashcard`, `deleteFlashcard`) and `useFlashcardProposals`
  (`updateFlashcard`). `createFlashcard` is deliberately non-optimistic (rethrows, state
  untouched); `useReviewSession.submitRating` is non-optimistic (advance-on-success-only).
  The rollback contracts are testable at the hook level with `renderHook` + a mocked
  `fetch`. **The canonical never-automated bug** is `deleteFlashcard`'s pagination
  bookkeeping (S-04 impl-review: closure-capture drift under concurrent deletes "strands the
  user on an empty page"). Three UI-only behaviors (create-draft retention, edit-editor
  close-on-failure, generator retry-replay) live in the `.tsx` components, **not** the
  hooks — a decision the plan must make: hook-only, or hook + a few component render tests.
- **Risk #6** — every write route validates in a fixed order (auth → uuid param → body
  JSON → zod → DB), and **a schema failure always returns before the first DB mutation** —
  no partial write is possible on any route. `generate` also gates the DB write behind the
  AI call. **Zero** negative-validation coverage exists today for create / PATCH / review;
  malformed-`[id]` (400), non-JSON body (400), `.strict()` extra-key (400), and `.refine()`
  violation all have zero coverage across the board.
- **Three real schema gaps** the matrix pins: (1) PATCH `front`/`back` have **no `.max`**
  (create caps at 1000); (2) `generate` has **no `.strict()`** (extra keys ignored); (3)
  `generate` has **no `.trim()`** (100 spaces passes). The plan must decide: test current
  behavior (document the gap) or fix the schemas this phase.
- **Tooling**: `@testing-library/react@^16` (React 19) + `@testing-library/dom@^10` +
  **happy-dom** for hook-only tests. `getViteConfig()` **already injects
  `@vitejs/plugin-react`** — do not add it. Add a third Vitest project `components`
  (`environment: "happy-dom"`, `src/**/*.test.tsx`).

## Detailed Findings

### Risk #5 — optimistic-update rollback in the client hooks

**Hooks and their single consumers** (`src/components/hooks/`):

| Hook | Consumer `.tsx` | Astro island |
|---|---|---|
| `useFlashcardList` | `src/components/FlashcardList.tsx` (`client:load`) | `src/pages/flashcards.astro:46` — SSR `initialData` from `listFlashcards` |
| `useReviewSession` | `src/components/ReviewSession.tsx` (`client:load`) | `src/pages/flashcards/review.astro:40` — SSR `getDueFlashcards` |
| `useFlashcardProposals` | `src/components/FlashcardGenerator.tsx` (`client:only="react"`) | `src/pages/generate.astro:17` — no SSR data |

**`readJsonResponse`** (`src/lib/http.ts:5-12`) — the mechanism every hook `catch` depends
on. It `await response.json().catch(() => ({}))`, then **throws `new Error(body.error ??
"The request could not be completed")` on any `!response.ok`**. Both a `fetch` promise
rejection (network) and any non-2xx response reach the hook's `catch`. A 204 (DELETE
success) is `response.ok`, `.json()` fails on the empty body → swallowed to `{}` → returned
as `T`, no throw. Hooks call `fetch` directly; only parsing is centralized.

**Rollback contracts (failure = fetch rejects OR non-2xx):**

| Function | file:line | Optimistic write | On failure | Stale/phantom risk |
|---|---|---|---|---|
| `useFlashcardList.editFlashcard` | `useFlashcardList.ts:51-71` | `map` merges `{front,back}` into the matching card | restores `front`/`back` **from the `card` arg**; sets `error`; `finally` `stopMutating` | none — list length/`total`/`totalPages` never touched; rollback is a no-op if the card was removed meanwhile |
| `useFlashcardList.deleteFlashcard` | `useFlashcardList.ts:73-110` | `filter` out the card; `setTotal(t=>t-1)`; recompute `totalPages`; capture `willBeEmpty` via a mutable object inside the updater | re-insert **original `card` at original `cardIndex`**; `setTotal(t=>t+1)`; recompute `totalPages`; sets `error`. **No `goToPage` on failure** (that branch is inside `try` after the `await`) | rollback is clean single-op; **concurrent-delete drift is the known gap** (see Historical Context) |
| `useFlashcardList.createFlashcard` | `useFlashcardList.ts:112-140` | **none** — inserts only after `readJsonResponse` resolves | sets `error` **and `throw`s** (rethrows so the form can stay open) | **no phantom possible** — nothing added pre-response; `total`/`totalPages` untouched on failure. Contract to test: the promise **rejects** |
| `useFlashcardProposals.updateFlashcard` (accept/reject a proposal) | `useFlashcardProposals.ts:37-59` | `filter` out the proposal (`updatingCardId` = single id) | re-insert **original `card` at original `cardIndex`**; sets `error` | none — no pagination in this hook |
| `useReviewSession.submitRating` | `useReviewSession.ts:42-61` | **none** — `setCurrentIndex(i=>i+1)` + `setIsRevealed(false)` are inside `try`, after the `await` | sets `error` only; `currentIndex`/`isRevealed`/`queue` untouched (deliberate — retry same card) | none — lighter Risk #5 case |
| `useFlashcardProposals.editFlashcard` (local proposal text edit) | `useFlashcardProposals.ts:33-35` | local `map`, **no request, no rollback** | n/a | n/a |

**Success-path pagination (the other half of `deleteFlashcard`):** on 204, **if
`willBeEmpty && page > 1`** → `await goToPage(page - 1)` which re-`GET`s and **overwrites**
`flashcards`/`page`/`limit`/`totalPages`/`total`. If `willBeEmpty && page === 1` → stays on
an empty page 1. If not empty → stays on the optimistically-filtered list with decremented
counters, never re-synced until the next navigation (accepted offset-pagination drift, S-03
decision).

**Hook vs component split (scoping flag).** `renderHook` tests fully cover the server-sync
rollback (edit, delete, `updateFlashcard`) and the non-optimistic contracts (`createFlashcard`
rejects, `submitRating` doesn't advance). They do **not** cover:
- **Create-draft retention** — `useFlashcardList.createFlashcard` rethrows; the "don't
  re-populate the just-cleared draft" behavior (S-02 decision) is in
  `FlashcardList.tsx:70-80` (`handleCreateSubmit` clears the draft only after resolve; its
  `catch` keeps it).
- **Edit-editor close-on-failure** — `FlashcardList.tsx:62-64,92-95` holds
  `editingCardId`/`draftFront`/`draftBack` and closes the editor after `editFlashcard`
  resolves regardless of outcome (the hook rolled the text back). S-04 explicitly scoped
  this "UI-only, not the hook's server-sync state."
- **Generator retry-replay** — `useFlashcardProposals` sets `canRetryGeneration`;
  `FlashcardGenerator.tsx:22,78-79` owns the `sourceText` a retry replays. "Retry without
  data loss" (S-01) is component behavior.

### Risk #5 — component-test tooling (currently none)

**Confirmed absent:** no `@testing-library/*`, `jsdom`, `happy-dom`, `@vitejs/plugin-react`
(direct), or `@testing-library/jest-dom` in `package.json`. All existing unit tests are
`.test.ts` (server-side), both Vitest projects `environment: "node"` (`vitest.config.ts:20,28`).

- **`getViteConfig()` already provides the JSX transform.** `astro/dist/config/index.js`
  runs `runHookConfigSetup` → `@astrojs/react`'s `astro:config:setup`
  (`node_modules/@astrojs/react/dist/index.js:137-144`) injects `react({…})` (i.e.
  `@vitejs/plugin-react`) into `vite.plugins`. `astro.config.mjs:12` has `react()` in
  `integrations`. So `.tsx`/JSX works in tests with nothing added. Fast-Refresh preamble is
  dev-only (`command === "dev"`); `vitest run` passes `cmd = "build"` — fine.
- **Per-project `environment` is supported** in Vitest 3.2 `test.projects[]` (the existing
  config already sets `fileParallelism: false` only on `integration`). `vitest@3.2.7` is
  installed.
- **`@testing-library/react` v16** is required for React 19 (`react ^19.2.6`); it exports
  `renderHook` (the old `@testing-library/react-hooks` is deprecated and v16-incompatible).
  Peers: `react@^18||^19`, `react-dom`, `@testing-library/dom@^10`.
- **`renderHook` requires a DOM** — it mounts via `react-dom/client` `createRoot` into
  `document.body`; `environment: "node"` throws. A DOM env is mandatory.
- **happy-dom vs jsdom** — happy-dom is lighter/faster and sufficient for hook-only tests
  (no layout, no portals). **jsdom** is safer if full component renders are in scope
  (`FlashcardList.tsx:3-13` uses Radix `AlertDialog` — portals, focus traps, `matchMedia`).
- React 19 `act()` — RTL v16 sets `IS_REACT_ACT_ENVIRONMENT`; wrap async state changes in
  `await act(async () => { … })`.

**Recommended stack:** `@testing-library/react@^16` + `@testing-library/dom@^10` +
**`happy-dom`** (hook-only). Add a third Vitest project:
`{ extends: true, test: { name: "components", environment: "happy-dom", include:
["src/**/*.test.tsx"] } }` (distinct `.tsx` glob so it doesn't overlap `unit`'s
`src/**/*.test.ts`). npm script `"test:components": "vitest run --project components"`.
Optional: a `setupFiles` module with `afterEach(cleanup)` (RTL auto-cleans when the
`vitest` env is set, so often unnecessary). Do **not** add `@vitejs/plugin-react`.

### Risk #6 — server-side input-validation matrix

**Shared handler order (all four write routes):**
1. `createClient` falsy → **500** `{"error":"Supabase is not configured"}`
2. `getUser()` no user → **401** `{"error":"Unauthorized"}`
3. *(id routes)* `!z.uuid().safeParse(cardId).success` → **400** `{"error":"Invalid flashcard ID"}`
4. *(body routes)* `await request.json()` throws → **400** `{"error":"Request body must be valid JSON"}`
5. `schema.safeParse(body)` fails → **400** `{"error": issues[0]?.message ?? "Invalid request body"}`
6. **DB write happens here** — strictly after step 5 returns
7. DB error → 500; no row → **404** `{"error":"Flashcard not found"}`; else 2xx

**No partial write is possible on any validation failure** — the first DB mutation call is
always after `safeParse` succeeds. `generate` additionally gates the DB insert behind the
AI call (`generateFlashcardProposals`), so a schema failure never reaches the provider
(already asserted by `flashcards.generate.test.ts`).

**Zod is `4.5.4`.** Its auto-generated messages (`"Invalid input: expected string, received
number"`, `"Unrecognized key: \"extra\""`, `"Invalid option: expected one of …"`, and the
uselessly generic `"Invalid input"` for the `rating` union) are **not contract** — tests
assert **status + not-persisted**, not wording (see "Assertion guidance" below).

#### Route 1 — `POST /api/flashcards` (create) — `src/pages/api/flashcards/index.ts:48-90`

Schema (`:13-18`): `{ front: z.string().trim().min(1,"front must not be empty").max(1000,"front must be at most 1,000 characters"), back: <same> }.strict()`. No `.refine`, no id.
`.trim()` runs before min/max: `"   "` → `""` fails `.min(1)`; `"  hi  "` → passes, persists `"hi"`; 1002 chars with padding → trims to 1000, passes. Insert at `:73`, success **201**.

| Payload | Expected |
|---|---|
| `front` 1001 chars | 400; 0 rows |
| `front` 1000 chars (max boundary) | 201; `front` length 1000 |
| `front` `"x"` (min boundary) | 201 |
| `front: ""` / `"   "` | 400; 0 rows |
| `front: "  hi  "` | 201; persisted `"hi"` |
| missing `front` / `front: 123` / `null` / `["a"]` | 400; 0 rows |
| `{front:"A",back:"B",extra:1}` (`.strict()`) | 400; 0 rows |
| non-JSON / empty body | 400 `"Request body must be valid JSON"`; 0 rows |

#### Route 2 — `PATCH /api/flashcards/[id]` — `src/pages/api/flashcards/[id].ts:19-71`

Schema (`:8-17`): `{ status: z.enum(["accepted","rejected"]).optional(), front: z.string().trim().min(1,…).optional(), back: <same> }.strict().refine(status||front||back present, "At least one of status, front, or back must be provided")`. Param uuid check `:32-35`. Update at `:50`, success **200**.
**GAP — no `.max` on `front`/`back`** (create has one): a 5,000-char `front` passes and is written.

| Payload / id | Expected |
|---|---|
| `{}` (`.refine` violation) | 400 `"At least one of status, front, or back must be provided"`; row untouched |
| `{front:"x"}` (single field, min boundary) | 200; `front === "x"` |
| `{front:""}` / `{front:"   "}` | 400; untouched |
| `{status:"maybe"}` (bad enum) | 400; untouched |
| `{front:123}` / `{front:null}` | 400; untouched |
| `{status:"accepted",extra:1}` (`.strict()`) | 400; untouched |
| `{front:"x".repeat(5000)}` | **200; 5,000-char `front` persisted** (documents the gap) |
| id `"not-a-uuid"` (any body) | 400 `"Invalid flashcard ID"`; body never parsed |
| id = valid-format uuid, nonexistent | 404 `"Flashcard not found"` |
| non-JSON / empty body | 400 `"Request body must be valid JSON"` |

#### Route 3 — `POST /api/flashcards/[id]/review` — `src/pages/api/flashcards/[id]/review.ts:14-53`

Schema (`:8-12`): `{ rating: z.union([z.literal(1),z.literal(2),z.literal(3),z.literal(4)]) }.strict()`. Param uuid check `:27-30`. `recordReview` SELECTs then UPDATEs (`reviews.ts:70-98`), write at `:93`. `null` → **404**; throws → 500. Success **200**.
Every `rating` rejection produces the generic `"Invalid input"` — **assert status, not message**.

| Payload / id | Expected |
|---|---|
| `{rating:1}` / `{rating:4}` (boundaries) | 200; `reps` +1 |
| `{rating:0}` / `{rating:5}` / `{rating:3.5}` / `{rating:"3"}` / `{rating:null}` / `{}` | 400; schedule (`reps`/`due`/`updated_at`) untouched |
| `{rating:3,extra:1}` (`.strict()`) | 400; untouched |
| id `"abc"` | 400 `"Invalid flashcard ID"`; body never parsed |
| id = valid uuid, nonexistent | 404 `"Flashcard not found"` |
| non-JSON / empty body | 400 `"Request body must be valid JSON"` |

#### Route 4 — `POST /api/flashcards/generate` — `src/pages/api/flashcards/generate.ts:16-68`

Schema (`:9-14`): `{ sourceText: z.string().min(100,"sourceText must be at least 100 characters").max(10000,"sourceText must be at most 10,000 characters") }`.
**GAPS — no `.strict()`** (`{sourceText:<valid>,junk:true}` → 201), **no `.trim()`**
(`" ".repeat(150)` passes, sent to provider + stored). DB insert `:57` — after both the
schema parse and the AI call. Provider failure → **502**.

| Payload | Expected |
|---|---|
| `sourceText` len 99 / 10001 / `""` | 400; provider **not** called; 0 rows |
| `sourceText` len 100 / 10000 (boundaries) | provider called; 201 (with provider mock) |
| missing / number / null `sourceText` | 400; 0 rows |
| `" ".repeat(150)` (no `.trim()`) | **201; `source_text` = 150 spaces** (documents the gap) |
| `{sourceText:<valid>,junk:true}` (no `.strict()`) | **201; `junk` ignored** (documents the gap) |
| non-JSON / empty body | 400 `"Request body must be valid JSON"`; provider not called; 0 rows |

#### Already-covered cells (Phases 1–2)

- `tests/integration/flashcards.auth-gating.test.ts` — all 6 routes, **valid bodies only**;
  asserts 401 (unauth) / `okStatus` (authed). Incidentally covers: create min-boundary
  (`{front:"F",back:"B"}` → 201), single-field PATCH passes `.refine` (→ 200), mid-range
  `{rating:3}` → 200.
- `tests/integration/flashcards.generate.test.ts` — **undersized `sourceText` → 400 +
  provider not called** (the one real negative-validation test that exists). No boundary,
  type, missing-field, non-JSON, whitespace, or extra-key cells. Its 502 test asserts "0
  rows" but the 400 test does not.
- `tests/integration/flashcards.cross-user.test.ts` — valid bodies; exercises "schema OK,
  no row matched → 404" for PATCH/DELETE/review with a real card owned by another user.
  Never a malformed or nonexistent-uuid id.

**Zero coverage:** all negative validation for create / PATCH / review; malformed `[id]` →
400 (all 3 id routes); non-JSON / empty body → 400 (all 4 routes); `.strict()` extra-key
rejection; `.refine()` violation; the three `generate`/PATCH schema gaps.

#### Assertion guidance (avoiding the test-plan §2 anti-pattern)

The anti-pattern is a test that re-derives the verdict from the same rule the code uses, or
that pins an auto-generated zod string.

**Wrong:** `expect(res.status).toBe(front.length > 1000 ? 400 : 201)` /
`expect(body).toEqual({ error: "front must be at most 1,000 characters" })`.

**Right:** fixture size is a literal picked from the spec; assertions are pure observed
behavior — `"x".repeat(1001)` in → `expect(status).toBe(400)` + a `count: "exact", head:
true` query → `expect(count).toBe(0)`; and the paired `"x".repeat(1000)` → `expect(status)
.toBe(201)`. If a message is genuinely contractual, assert a **stable substring of a custom
domain message** (`expect(body.error).toMatch(/at most 1,?000/)`), never the zod-generated
string, and never for `rating` (no custom message exists).

## Code References

- `src/components/hooks/useFlashcardList.ts:51-71,73-110,112-140` — edit / delete / create
- `src/components/hooks/useFlashcardProposals.ts:37-59` — `updateFlashcard` optimistic + rollback
- `src/components/hooks/useReviewSession.ts:42-61` — `submitRating` (non-optimistic)
- `src/lib/http.ts:5-12` — `readJsonResponse` (throws on `!response.ok`)
- `src/components/FlashcardList.tsx:62-64,70-80,92-95` — component-owned draft / editor state
- `src/components/FlashcardGenerator.tsx:22,78-79` — component-owned retry `sourceText`
- `src/pages/api/flashcards/index.ts:13-18,48-90` — create schema + handler
- `src/pages/api/flashcards/[id].ts:8-17,19-71` — PATCH schema (`.refine`, no `.max`) + handler
- `src/pages/api/flashcards/[id]/review.ts:8-12,14-53` — review schema + handler
- `src/pages/api/flashcards/generate.ts:9-14,16-68` — generate schema (no `.strict`/`.trim`) + handler
- `vitest.config.ts` — two `node` projects; needs a third `components` project
- `node_modules/@astrojs/react/dist/index.js:137-144` — React Vite plugin injected via `astro:config:setup`
- `tests/integration/flashcards.auth-gating.test.ts`, `flashcards.generate.test.ts`,
  `flashcards.cross-user.test.ts` — what Phases 1–2 already exercise

## Architecture Insights

- **Server-sync rollback is entirely in the hooks; UI buffer state is entirely in the
  components.** A hook-only test suite (`renderHook`) is a genuine, cheap layer for the
  rollback contracts, but it structurally cannot see create-draft retention, editor
  close-on-failure, or generator retry-replay. Those are either accepted as out of scope
  (they're low-severity UX polish, individually decided in S-01/S-02/S-04) or covered by a
  small number of component render tests.
- **Validation is uniformly pre-DB.** Risk #6 is a pure integration sweep — POST/PATCH
  adversarial payloads straight to the route handlers (Phase-1 harness), assert
  `status === 400` + a `count` query showing zero rows written / row unchanged. No mocking,
  no DB-state fixtures beyond one seeded card for the PATCH/review "row unchanged" cases.
- **The `rating` union and all type mismatches yield generic zod messages** — the suite
  must assert status codes and persistence, never message strings, which also happens to be
  exactly what test-plan §2's anti-pattern warns against.
- **Three schema asymmetries** (PATCH no `.max`, `generate` no `.strict`, `generate` no
  `.trim`) are the highest-value cells: a test that pins current behavior turns any future
  tightening into a deliberate, reviewed change.
- **New test layer, contained.** The `components` project is additive: a third
  `vitest.config.ts` entry + 3 dev deps + one npm script, mirroring the `unit`/`integration`
  split. `getViteConfig()` already carries the React plugin, so the only genuinely new
  moving part is the `happy-dom` environment.

## Historical Context (from prior changes)

- `context/archive/2026-09-05-saved-flashcard-maintenance/reviews/impl-review.md:28-35` — **the
  canonical never-automated bug.** `deleteFlashcard` computed `remaining`/`newTotal` from
  closure-captured `flashcards`/`total`; two deletes on different cards before a re-render →
  "second `setTotal`/`setTotalPages` overwrites the first instead of composing, leaving
  `total` off by one; … `goToPage(page - 1)` may never fire, **stranding the user on an
  empty page**." Fixed with functional updaters + the `willBeEmpty` mutable-object trick.
  Re-verified only by lint/build + a manual in-browser page-2-auto-back scenario — **no
  regression test.**
- `context/archive/2026-09-05-saved-flashcard-maintenance/plan.md:181,190-191` — `editFlashcard`
  and `deleteFlashcard` were designed "both optimistic with rollback, following
  `useFlashcardProposals`'s `updateFlashcard` shape." `mutatingCardIds` is a **Set** (not a
  single id like `updatingCardId`) precisely so a user can edit one card and delete another
  concurrently without one completion re-enabling the other.
- `context/archive/2026-09-05-manual-flashcard-creation/plan.md:57,61` — `createFlashcard`
  **must not** be optimistic: "clearing eagerly and then rolling back on failure would
  re-populate the user's just-cleared draft, which reads as a bug." The `page !== 1` →
  `goToPage(1)` branch was flagged as "new logic, not a copy of a proven path, needs its
  own careful testing" and was never automated.
  `context/archive/2026-09-05-manual-flashcard-creation/reviews/impl-review.md:33` — a
  "known-narrow but real staleness window" in `total`/`totalPages` under a concurrent
  mutation during a create was **accepted, not fixed**.
- `context/archive/2026-09-02-reviewed-ai-flashcards/plan.md:41,165,169` — generation
  failure must "keep the pasted text in the textarea and show an inline error banner with a
  retry action (no navigation, no data loss)". The retry `sourceText` and button are in
  `FlashcardGenerator.tsx`; the hook only exposes `canRetryGeneration`.
- `context/archive/2026-09-06-spaced-repetition-session/reviews/impl-review.md:49-50` —
  `submitRating` deliberately does **not** advance `currentIndex` on failure "so the user
  can just retry the same rating without losing their place." No optimistic state → nothing
  to roll back.
- `context/archive/2026-09-04-personal-flashcard-list/` — S-03 shipped `useFlashcardList`
  with **only** `goToPage`/`retry` (no mutations); the offset-pagination-drift-after-mutation
  tradeoff was first accepted here (`plan.md`), carried into S-04.
- No archived change added any React/DOM/component test tooling — Phase 3 is the first.

## Related Research

- `context/archive/2026-09-09-testing-critical-path-coverage/research.md` — Phase 1
  (Risks #1, #4); established the `tests/integration/` harness the Risk #6 sweep reuses.
- `context/archive/2026-09-09-core-flow-correctness/research.md` — Phase 2 (Risks #2, #3);
  the `flashcards.generate.test.ts` "too-short → 400" test is the one existing
  negative-validation case, and the `vi.spyOn(globalThis,"fetch")` pattern transfers to the
  hook tests.

## Open Questions

- **Hook-only vs hook + component render tests.** The rollback contracts are hook-testable;
  create-draft retention / editor close-on-failure / generator retry-replay need component
  render tests (jsdom, RTL `render` + `user-event`). Is the extra component layer in scope
  for Phase 3, or are those UX behaviors accepted as untested (per their individual
  S-01/S-02/S-04 "manual verification" decisions)?
- **The three schema gaps** (PATCH no `.max`, `generate` no `.strict`, `generate` no
  `.trim`). Does Phase 3 (a) only pin current behavior with a test + a note, or (b) also
  add `.strict()` / `.trim()` / a PATCH `.max` and test the fixed behavior — a small
  production change inside a coverage phase?
- **happy-dom vs jsdom.** happy-dom is the recommendation for hook-only. If component render
  tests are pulled in (Radix `AlertDialog` portals/focus-traps in `FlashcardList`), switch
  the `components` project to jsdom.
- **`deleteFlashcard` success-pagination test** needs a `fetch` mock that branches on
  `method`/`url` (204 for the DELETE, then a 200 page-1 body for the follow-up `GET`). Is
  that success-path test in scope, or is Risk #5 scoped to failure-rollback only?
