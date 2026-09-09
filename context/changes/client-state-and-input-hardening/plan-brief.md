# Client-State & Input Hardening (Test Rollout Phase 3) — Plan Brief

> Full plan: `context/changes/client-state-and-input-hardening/plan.md`
> Research: `context/changes/client-state-and-input-hardening/research.md`

## What & Why

Rollout Phase 3 of `context/foundation/test-plan.md`: cover **Risk #5** (optimistic-update
rollback drift — a failed edit/delete/create leaves the flashcard list showing stale or
phantom state) and **Risk #6** (an oversized or malformed payload POSTed straight to an API
route bypasses server-side zod validation and is persisted). Neither has any test today.

## Starting Point

Risk #5's rollback logic lives entirely in the client hooks: `useFlashcardList`
(`editFlashcard`, `deleteFlashcard`), `useFlashcardProposals.updateFlashcard`;
`createFlashcard` and `useReviewSession.submitRating` are deliberately non-optimistic. The
canonical never-automated bug is `deleteFlashcard`'s pagination bookkeeping. Risk #6: every
write route validates before any DB write (no partial writes possible), but there is zero
negative-validation coverage. No React/DOM test layer exists; `getViteConfig()` already
provides the JSX transform.

## Desired End State

`npm run test:components` runs a green `renderHook` suite (happy-dom, no Docker) for the
hook rollback contracts. `npm run test:integration` runs the Phase-1/2 suites plus an
adversarial-input sweep that rejects bad payloads with `400` and asserts nothing is
persisted. `npm test` is unchanged — fast, DOM-free. Breaking a rollback, a route's
validation, or one of three pinned schema gaps turns exactly one test red.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Risk #5 test layer | Hook-only (`renderHook`), no component render tests | test-plan §2's named cheapest layer; the 3 component-owned UI-buffer behaviors are individually-accepted manual-verification calls | Plan |
| Three schema gaps (PATCH no `.max`; `generate` no `.strict`/`.trim`) | Pin current behavior with a comment + flagged follow-up | This is a coverage phase; changing 3 schemas pulls in product questions and expands review scope | Plan |
| Risk #5 cases | Single-op failure rollback (edit/delete/updateFlashcard) + delete success-pagination + createFlashcard rejects/no-phantom + submitRating no-advance | The success-pagination branch is where the S-04 bug lived; the two non-optimistic contracts are cheap to pin | Plan |
| Concurrent-delete drift | Not tested | The functional-updater refactor fixed it; a `Promise.all` interleave test isn't deterministic enough to gate on | Plan |
| Risk #6 breadth | One representative per cell-class per route + boundary-passes + universal cells | Redundant type variants (`{front:123}`/`null`/`[]`) hit one zod path; ~6-8 assertions/route | Plan |
| DOM environment | Third Vitest project `components` (`happy-dom`, `src/**/*.test.tsx`) + `test:components` script | One place defines the env; `npm test` stays fast; mirrors the `unit`/`integration` `--project` pattern | Plan |

## Scope

**In scope:**
- Dev deps: `@testing-library/react@^16`, `@testing-library/dom@^10`, `happy-dom`
- `vitest.config.ts` `components` project + `package.json` `test:components` script
- `src/components/hooks/{useFlashcardList,useFlashcardProposals,useReviewSession}.test.tsx`
- `tests/integration/flashcards.input-validation.test.ts` — adversarial sweep of the 4 write routes
- `test-plan.md` §6.5 + §6.6 Phase-3 note

**Out of scope:**
- Component render tests (jsdom, RTL `render`, user-event) — the 3 UI-buffer behaviors stay untested
- Fixing the 3 schema gaps (flagged follow-up)
- Concurrent-delete drift test
- Non-rollback hook paths; CI wiring (`test:components` → ci.yml is Phase 4)
- Risks #1/#2/#3/#4; `@cloudflare/vitest-pool-workers`
- Asserting exact zod message strings

## Architecture / Approach

Two phases, Docker only in Phase 2. Phase 1: three dev deps + a third `components` Vitest
project (`happy-dom`, `.test.tsx` glob — no overlap with `unit`'s `.test.ts`); `renderHook`
+ `await act` tests with `globalThis.fetch` spied per test. Phase 2: one integration file
POSTing bad payloads straight to the four route handlers via the Phase-1 harness, asserting
`400` + a `count`/re-read query showing nothing persisted; the `generate` boundary cells
reuse the conditional-`fetch` mock from `flashcards.generate.test.ts`. Cookbook fill-in at
the end.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Component/hook harness + Risk #5 | `components` project + 3 `.test.tsx` files: edit/delete/updateFlashcard rollback, delete success-pagination, create-rejects, submitRating-no-advance | React 19 + happy-dom + `renderHook`/`act` under `getViteConfig()` is a new, unproven combination |
| 2. Risk #6 sweep + cookbook | `flashcards.input-validation.test.ts` (adversarial payloads → 400 + not persisted, per route) + `test-plan.md` §6.5/§6.6 | Keeping the sweep behavior-only (status + count) and not re-deriving zod's rules; `generate` boundary cells need the provider mocked |

**Prerequisites:** Docker + `npx supabase start` for Phase 2. Three new dev deps.
**Estimated effort:** ~2 sessions.

## Open Risks & Assumptions

- Assumes `@testing-library/react@^16`'s `renderHook` works under `happy-dom` +
  `getViteConfig()`'s React plugin on React 19 without extra `act()` plumbing beyond
  `await act(async () => …)` — first use in this repo; Phase 1's spike-like first step is
  running the harness.
- The three pinned schema-gap tests encode *current* behavior; a reader must not mistake
  them for endorsement (mitigated by an inline comment + the §6.6 follow-up note).
- `deleteFlashcard` success-pagination relies on a `fetch` mock that branches on
  `init?.method` — if a future refactor changes the follow-up call shape, that mock needs
  updating.
- `generate`'s boundary-pass cells depend on `.dev.vars` carrying `OPENROUTER_API_KEY` (the
  conditional mock still calls through for auth); `describe.skip` if absent, per the
  existing generate smoke.

## Success Criteria (Summary)

- `npm run test:components` green with no Docker; `npm run test:integration` green with
  local Supabase; `npm test` unchanged and DOM-free.
- Breaking any one control — a hook's rollback `catch`, a route's zod guard, the malformed-id
  check — turns exactly one test red.
- The three pinned schema gaps each have a test that flips the moment the schema is
  tightened, making any future hardening a deliberate, reviewed change.
