<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Personal flashcard list

- **Plan**: `context/changes/personal-flashcard-list/plan.md`
- **Mode**: Deep
- **Date**: 2026-09-04
- **Verdict**: SOUND
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Requirement Definition | PASS |
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | PASS |

## Grounding

9/9 paths ✓, zod default/null behavior confirmed via node against installed zod 4.5.4, `readResponse` blast radius confirmed (1 consumer: `FlashcardGenerator.tsx`), middleware `/flashcards` prefix collision confirmed none, brief↔plan ✓, definitions 4/4 user|product (1 partially code — list-order tiebreaker, disclosed in Critical Implementation Details).

## Findings

### F1 — `page` query param default doesn't actually apply

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — List endpoint (`src/pages/api/flashcards/index.ts`)
- **Detail**: `z.coerce.number().int().min(1).default(1)` parsed directly from `context.url.searchParams.get("page")` (`string | null`) would 400 on a plain `GET` with no `?page=` param, since zod's `.default()` only substitutes for `undefined`, not `null` (confirmed empirically against installed zod 4.5.4: `Number(null)` → `0`, fails `.min(1)`). No Phase 1 manual test exercised the omitted-param case.
- **Fix**: Convert `null` to `undefined` before parsing (`searchParams.get("page") ?? undefined`) so the default actually applies when the param is absent.
- **Decision**: FIXED — Phase 1 #4 Contract updated with the `?? undefined` conversion and an explanatory note; added Manual Verification bullet 1.8 (`curl` GET with no `page` param returns page 1, does not 400).

### F2 — Offset-pagination drift not disclosed as an accepted risk

- **Severity**: OBSERVATION
- **Impact**: LOW — documentation note, not a code change
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details / Open Risks
- **Detail**: If a new card is accepted (newest-first insert) while a user is paginating, every subsequent row's offset shifts by one, so Prev/Next can show a duplicate or skip a card vs. what was seen before. Inherent, well-known offset-pagination tradeoff (vs. cursor-based) — not a bug — but the plan never named it as an accepted risk.
- **Fix**: Documented as an accepted MVP limitation.
- **Decision**: FIXED — added to plan's Critical Implementation Details and to `plan-brief.md`'s Open Risks & Assumptions.
