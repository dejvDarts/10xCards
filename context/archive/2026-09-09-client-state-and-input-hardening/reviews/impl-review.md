<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Client-State & Input Hardening (Test Rollout Phase 3)

- **Plan**: context/changes/client-state-and-input-hardening/plan.md
- **Scope**: Full plan — Phase 1 (Component/Hook Harness + Risk #5) and Phase 2 (Risk #6 Input Sweep + Cookbook)
- **Date**: 2026-09-10
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Success Criteria Verification

### Phase 1 — Automated

| Check | Command | Result |
|---|---|---|
| 1.1 smoke passes + file deleted | `ls src/components/_harness.smoke.test.tsx` | PASS — file absent; never committed in 48f6a0b |
| 1.2 `test:components` > 0 passing across 3 files | `npm run test:components` | PASS — 3 files, 6 tests |
| 1.3 `npm test` (unit) green, no Docker | `npm test` | PASS — 3 files, 43 tests |
| 1.4 `npm run lint` | `npm run lint` | PASS — clean |
| 1.5 `npm run build` | `npm run build` | PASS — Complete |

### Phase 2 — Automated

| Check | Command | Result |
|---|---|---|
| 2.1 `test:integration` green incl. input-validation | `npm run test:integration` | PASS — 6 files, 72 tests (input-validation 35, generate 5 unchanged) |
| 2.2 components / unit / lint / build | all four | PASS |
| 2.3 §6.5 no "TBD"; §6.6 "Phase 3" entry | grep | PASS — 0 TBD in §6.5; 1 Phase 3 entry |

### Manual

| Check | Result |
|---|---|
| 1.6 break `editFlashcard` catch-restore → edit-rollback test fails | Marked `[x]` in Phase 1 (48f6a0b); commit message + plan record it. Not re-run this review. |
| 1.7 `vitest --project components` watch picks up 3 `.test.tsx` | Marked `[x]` Phase 1. |
| 1.8 `npm test` output shows only `unit` project | Marked `[x]` Phase 1; re-confirmed — unit run spins up no happy-dom env. |
| 2.4 add `.strict()` to generate schema → pinned junk-key test fails | RE-VERIFIED this session — `expected 400 to be 201`; reverted via `git checkout`. |
| 2.5 `test:integration` twice → no `test+cpc-*` residue | RE-VERIFIED — admin `listUsers` after run: 0 users, 0 `test+cpc-*`. |
| 2.6 delete `!z.uuid()` PATCH guard → malformed-id test fails | RE-VERIFIED — `expected 500 to be 400`; reverted via `git checkout`. |

## Findings

### F1 — Plan "Changes Required" prose still contradicts the shipped `components` project + `@vitejs/plugin-react`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: plan.md:89-90, plan.md:220, plan.md:229 vs vitest.config.ts:40-56, package.json
- **Detail**: The plan says three times not to do what shipped: Key Discoveries (line 89) "Do not add `@vitejs/plugin-react`"; Change #1 (line 220) "No `@vitejs/plugin-react`"; Change #2 (line 229) specifies `{ extends: true, ... }` for the `components` project. What shipped (48f6a0b): `@vitejs/plugin-react@^5.2.0` added as a devDep, and the `components` project is **standalone** — not `extends: true` — carrying its own `plugins: [react()]`, `resolve.alias` for `@/`, and `dedupe: ["react","react-dom"]`. The root cause is real and sound: `getViteConfig()`'s Astro-SSR React wiring leaves `renderHook` with a null dispatcher ("invalid hook call"). It is documented in the Phase 1 commit message and an inline comment in `vitest.config.ts`, and the deviation was approved interactively during Phase 1. But the plan's own "Changes Required" text was never amended, so a reader — or `/10x-archive` — sees a plan that states the opposite of the code. `test-plan.md` §6.5/§6.6 *do* describe the shipped design correctly; only `plan.md` is stale.
- **Fix**: Add a short "Phase 1 deviation" note to plan.md (under Change #1/#2, or a Completion Notes block): standalone `components` project + explicit `@vitejs/plugin-react` devDep, one line on the null-dispatcher reason, and that the "Do not add" note in Key Discoveries is superseded.
- **Decision**: FIXED — added a `## Completion Notes` block to plan.md documenting the standalone `components` project + `@vitejs/plugin-react` devDep deviation and marking the "Do not add" note superseded.

### F2 — Phase 1 completion summary (happy-dom vs jsdom outcome) was never written

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: plan.md:198-208 (Change #0), plan.md:319-320 (Implementation Note)
- **Detail**: Change #0 says the harness-smoke outcome "(happy-dom vs jsdom) is noted in the Phase 1 completion summary", and the Phase 1 Implementation Note calls for a pause for human confirmation of the manual checks. No completion-summary block exists in `plan.md` or the change folder. The outcome is recoverable (happy-dom — it is in `vitest.config.ts` and the 48f6a0b commit message; the jsdom fallback was not needed), so impact is low, but the plan explicitly asked for the note.
- **Fix**: One line in plan.md (fold into F1's addendum): "Phase 1 shipped on happy-dom; jsdom fallback not needed."
- **Decision**: FIXED — folded into the plan.md `## Completion Notes` block as a "Phase 1 smoke outcome" subsection (happy-dom; jsdom fallback not needed; smoke file deleted pre-commit).

### F3 — `mock-provider.ts` extraction went slightly beyond "move `mockProvider` verbatim"

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: tests/integration/helpers/mock-provider.ts:16-35
- **Detail**: Change #1's contract is "Move `mockProvider` (and its `realFetch`-capture-with-`vi.isMockFunction` guard) verbatim ... as an `export function`." The shipped helper also relocates `providerCalled`, `urlOf`, and the `OPENROUTER` const, and `mockProvider` gained a `return fetchSpy;` line not in the original. All defensible — `providerCalled` shares the module-local `fetchSpy` and the new input-validation sweep needs it; `urlOf`/`OPENROUTER` are its dependencies — and `npm run test:integration` stays green (72/72) with the generate smoke unchanged (5/5). The added `return fetchSpy;` is currently unused by every caller (dead return value).
- **Fix**: Drop the unused `return fetchSpy;` from `mockProvider` (or keep it and note it) — cosmetic.
- **Decision**: FIXED — removed `return fetchSpy;` and changed the return annotation to `: void`. Lint clean; `flashcards.generate` + `flashcards.input-validation` re-run 40/40. The `providerCalled` / `urlOf` / `OPENROUTER` co-relocation is accepted as necessary coupling.

### F4 — `test-plan.md` §6.6 Phase 2 status line was rewritten, beyond the Change #3 contract

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: context/foundation/test-plan.md §6.6 — "Phase 2 — Core flow correctness" paragraph
- **Detail**: Change #3 says "Append a 'Phase 3' entry to §6.6 ... Do not touch §1–§5 or other §6 subsections." The shipped edit also changed the §6.6 Phase 2 line from "in progress, `context/changes/core-flow-correctness/`" to "complete, archived 2026-09-09 at `context/archive/2026-09-09-core-flow-correctness/`". This is a truthful staleness fix (core-flow-correctness was archived in `c0c68d7`; the §3 rollout table was already updated in `371fc26` but the §6.6 prose lagged) and it sits inside §6.6 — the subsection being edited, not an "other" one — so it is within the spirit of the contract. Flagged only so an archive check does not read it as unexplained drift.
- **Fix**: None — keep the correction. Noted here for the record.
- **Decision**: ACCEPTED — correction kept (factually right; the §3 rollout table was already updated in 371fc26). Recorded here so `/10x-archive` doesn't read it as unexplained drift.

## Notes

- **No production code was changed** — verified: the only non-doc, non-test files in the diff are `vitest.config.ts`, `eslint.config.js`, `package.json`, `package-lock.json`. The three schema gaps (PATCH `.max`, generate `.strict()`/`.trim()`) are pinned as current-behavior tests with inline `// PINNED:` comments and a §6.6 follow-up, exactly as the plan directs.
- **Risk #5 coverage** matches the plan's locked Phase-3 decisions: hook-only `renderHook` tests (no component render), single-op failure rollback for edit/delete/updateFlashcard, delete success-pagination, createFlashcard rejects/no-phantom, submitRating no-advance. The `deleteFlashcard` success-pagination test uses the staged-`act` + `setTimeout(0)` technique with an explanatory comment.
- **Risk #6 coverage** — 35 tests, one representative per validation cell-class per write route (create/PATCH/review/generate) + boundary passes + universal cells (non-JSON body, malformed `[id]`) + 3 pinned gaps. Assertions are status + `error` property + `rowCount`/re-read; the only message-string check is `/at most 1,?000/` on the create over-max boundary (plan-sanctioned). `"Invalid flashcard ID"` equality is a hand-written route message, not zod wording.
- **Minor (not a formal finding)**: `rawContext` in `flashcards.input-validation.test.ts` re-implements the ~7-line `cookieStub` from `helpers/session.ts`. Justified — `apiContext` always `JSON.stringify`s its body, so it cannot produce a non-JSON-body case — and it is commented. Extending `apiContext` with a `rawBody` option would be marginally cleaner but touches a shared helper.
