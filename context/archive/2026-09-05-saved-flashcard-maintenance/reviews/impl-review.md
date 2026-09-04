<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Saved flashcard maintenance

- **Plan**: context/changes/saved-flashcard-maintenance/plan.md
- **Scope**: Phase 1 of 2, Phase 2 of 2 (full plan)
- **Date**: 2026-09-05
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Concurrent deletes on different cards can corrupt `total`/`totalPages`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/hooks/useFlashcardList.ts:78-82, 87, 92-93
- **Detail**: `deleteFlashcard` computes `remaining` and `newTotal` from the closure-captured `flashcards`/`total` at call time, and both the success path's page-back check (`remaining === 0`) and the failure path's rollback (`setTotal(total)`) reuse that same stale snapshot rather than a functional updater. If a user confirms deletes on two different cards before React re-renders between the two clicks (plausible on a slow connection — exactly the scenario `mutatingCardIds` was introduced to guard against for same-card double-submission), both closures capture the same pre-mutation `total`/array length. The second `setTotal`/`setTotalPages` call overwrites the first instead of composing, leaving `total` off by one; and if the two deletes are the last two cards on a non-first page, neither closure's `remaining` reflects the true post-delete count, so `goToPage(page - 1)` may never fire, stranding the user on an empty page. Self-heals on next manual page navigation (which refetches from the server), so it is not data loss.
- **Fix**: Replace the closure-captured `remaining`/`newTotal`/rollback `total` with functional state updates — e.g. `setTotal((t) => t - 1)` and `setTotal((t) => t + 1)` for rollback, and derive the "was this the last card on the page" check from the array returned by the `setFlashcards` functional updater's callback rather than a separately-computed `remaining` constant.
  - Strength: Removes the whole class of stale-closure drift; matches the `mutatingCardIds` fix from plan-review, which already established that this hook needs to tolerate concurrent mutations on different cards.
  - Tradeoff: Slightly more code to correctly capture "was this empty" from inside a functional updater instead of a plain local variable.
  - Confidence: HIGH — the race is real by inspection, though it requires two deletes to land inside the same React batch window to trigger (single-user, low-frequency MVP usage lowers real-world likelihood).
  - Blind spot: Not reproduced end-to-end (requires precise timing); assessed by code inspection only.
- **Decision**: FIXED — switched `total`/`totalPages` updates in `deleteFlashcard` to functional updaters (`setTotal((t) => ...)`), and `willBeEmpty` is now captured via a mutable object inside the `setFlashcards` functional updater (avoids a TS control-flow-narrowing false positive on a plain `let` reassigned only inside a closure). Re-verified `npm run lint`, `npm run build`, and the page-2-auto-back manual scenario in-browser — all pass.

### F2 — Nav nav-bar changes are outside the plan's stated scope

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/components/Topbar.astro, src/components/Welcome.astro, src/pages/{dashboard,flashcards,generate}.astro (commit 038becb)
- **Detail**: These five files are not mentioned anywhere in plan.md's Changes Required, and add Generate/Flashcards nav links plus width/spacing unification across pages. This is legitimate EXTRA scope by the plan-drift definition — but it was surfaced to you mid-session (missing nav links, then missing navbar on subpages, then inconsistent width/spacing), explicitly approved by you each time, and deliberately landed in a separate commit (038becb) rather than folded into either phase's commit. Flagging for the record only.
- **Fix**: None needed — already handled as intended (separate, disclosed, approved).
- **Decision**: SKIPPED — acknowledged, no action needed.

### F3 — Delete confirm action doesn't use the `destructive` button variant

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/FlashcardList.tsx:193 (AlertDialogAction)
- **Detail**: The Delete-confirm `AlertDialogAction` uses the default button variant rather than `variant="destructive"` (defined in `src/components/ui/button.tsx`). This is the repo's first destructive-confirmation UI, so there's no existing pattern being violated — just a missed opportunity for a stronger visual cue on an irreversible action.
- **Fix**: Add `variant="destructive"` to the `AlertDialogAction` in the delete-confirm dialog.
- **Decision**: FIXED — added `variant="destructive"`; confirmed visually (red Delete button in the confirm dialog) and via `npm run lint`.
