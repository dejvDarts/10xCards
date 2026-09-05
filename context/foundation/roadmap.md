---
project: "10xCards"
version: 1
status: draft
created: 2026-09-02
updated: 2026-09-05
prd_version: 1
main_goal: speed
top_blocker: time
milestone_id: first-personal-learning-loop
milestone_seq: 1
milestone_status: open
---

# Roadmap: 10xCards

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Milestone

**M-1: First personal learning loop** — Status: open

- **Intent:** Deliver the complete personal flashcard loop: a signed-in professional turns pasted source text into reviewed, saved flashcards and can learn from their collection. The sequence prioritizes the core AI-assisted flow within the stated delivery constraint.
- **Source materials:** `context/foundation/prd.md` (v1)
- **Done when:** every S-NN below is `done`.
- **Scope anchors:** US-01; FR-001–FR-009.

## Vision recap

Professionals lose too much time creating high-quality learning flashcards by hand, which discourages regular spaced-repetition study. 10xCards turns pasted source text into AI-generated flashcard proposals so users can move from material to regular study much faster while retaining control over what enters their collection.

## North star

**S-01: User can turn pasted text into reviewed, saved flashcards.** This is the smallest end-to-end flow that demonstrates the product's central promise, so it is placed first for rapid delivery.

> Here, the north star means the smallest end-to-end user flow whose delivery proves that the product's central promise works.

## At a glance

| ID   | Change ID                   | Outcome (user can ...)                                                         | Prerequisites | PRD refs                               | Status   |
| ---- | --------------------------- | ------------------------------------------------------------------------------ | ------------- | -------------------------------------- | -------- |
| F-01 | private-flashcard-storage   | (foundation) private flashcard storage is available to signed-in users         | —             | FR-001, FR-002, NFR: Prywatność danych | done     |
| F-02 | choose-review-algorithm     | (foundation) an existing review algorithm is selected for the learning session | —             | FR-009                                 | blocked  |
| S-01 | reviewed-ai-flashcards      | turn pasted text into reviewed, saved flashcards                               | F-01          | US-01, FR-003, FR-004                  | done     |
| S-02 | manual-flashcard-creation   | create a flashcard manually                                                    | F-01          | FR-005                                 | done |
| S-03 | personal-flashcard-list     | browse their saved flashcards                                                  | S-01          | FR-006                                 | done |
| S-04 | saved-flashcard-maintenance | edit or delete a saved flashcard                                               | S-03          | FR-007, FR-008                         | done |
| S-05 | spaced-repetition-session   | study saved flashcards in a review session                                     | S-01, F-02    | FR-009                                 | blocked  |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                     | Chain                                      | Note                                                                        |
| ------ | ------------------------- | ------------------------------------------ | --------------------------------------------------------------------------- |
| A      | AI-assisted learning loop | `F-01` → `S-01` → `S-03` → `S-04` → `S-05` | S-05 joins Stream C through F-02 after the core flow is available.          |
| B      | Manual collection entry   | `S-02`                                     | Shares F-01 and can proceed independently after the storage contract lands. |
| C      | Learning-session decision | `F-02`                                     | Resolves the prerequisite for S-05 without building a bespoke algorithm.    |

## Baseline

What's already in place in the codebase as of `2026-09-02` (auto-researched + user-confirmed). Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — declared in `context/foundation/tech-stack.md` (Astro, React, TypeScript, Tailwind).
- **Backend / API:** present — API handlers and request middleware are implemented under `src\pages\api\` and `src\middleware.ts`.
- **Data:** partial — Supabase is declared in `context/foundation/tech-stack.md`, but no product-data migration is present under `supabase\migrations\`.
- **Auth:** present — Supabase account and session support is declared in `context/foundation/tech-stack.md`.
- **Deploy / infra:** present — Cloudflare and GitHub Actions are declared in `context/foundation/tech-stack.md`.
- **Observability:** absent — no application logging, error tracking, metrics, or tracing was found.

## Foundations

### F-01: Private flashcard storage

- **Outcome:** (foundation) signed-in users have a private persistence contract for their flashcards.
- **Change ID:** private-flashcard-storage
- **PRD refs:** FR-001, FR-002, NFR: Prywatność danych
- **Unlocks:** S-01, S-02
- **Prerequisites:** —
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Both creation paths need the same private collection boundary; adding only this shared contract avoids duplicating it while leaving user-facing behavior to the slices.
- **Status:** done

### F-02: Choose review algorithm

- **Outcome:** (foundation) an existing review algorithm is selected for the learning session.
- **Change ID:** choose-review-algorithm
- **PRD refs:** FR-009
- **Unlocks:** S-05, Open Roadmap Question 1
- **Prerequisites:** —
- **Parallel with:** F-01
- **Blockers:** —
- **Unknowns:**
  - Which existing spaced-repetition algorithm will drive review sessions? — Owner: user. Block: yes.
- **Risk:** Resolve this decision before planning the learning session so its behavior is not designed around an unstated algorithm.
- **Status:** blocked

## Slices

### S-01: Reviewed AI flashcards

- **Outcome:** user can paste source text, receive flashcard proposals, review each proposal, and save accepted flashcards to their collection.
- **Change ID:** reviewed-ai-flashcards
- **PRD refs:** US-01, FR-003, FR-004
- **Prerequisites:** F-01
- **Parallel with:** S-02
- **Blockers:** —
- **Unknowns:** —
- **Risk:** This first slice tests whether AI proposals save preparation time while preserving user control; poor proposal quality would weaken the product's central promise.
- **Status:** done

### S-02: Manual flashcard creation

- **Outcome:** user can create a front-and-back flashcard without pasted source text.
- **Change ID:** manual-flashcard-creation
- **PRD refs:** FR-005
- **Prerequisites:** F-01
- **Parallel with:** S-01
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Keep this independent path narrow so it remains a fallback without delaying the AI-assisted flow.
- **Status:** done

### S-03: Personal flashcard list

- **Outcome:** user can browse the flashcards saved in their personal collection.
- **Change ID:** personal-flashcard-list
- **PRD refs:** FR-006
- **Prerequisites:** S-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Sequencing after saved AI cards ensures the list is verified with the collection created by the primary flow.
- **Status:** done

### S-04: Saved flashcard maintenance

- **Outcome:** user can edit or delete a flashcard already in their collection.
- **Change ID:** saved-flashcard-maintenance
- **PRD refs:** FR-007, FR-008
- **Prerequisites:** S-03
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Browsing comes first so maintenance actions operate on a clear personal collection rather than adding an isolated management surface.
- **Status:** done

### S-05: Spaced-repetition session

- **Outcome:** user can study their saved flashcards in a review session driven by an existing spaced-repetition algorithm.
- **Change ID:** spaced-repetition-session
- **PRD refs:** FR-009
- **Prerequisites:** S-01, F-02
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Which existing spaced-repetition algorithm will drive review sessions? — Owner: user. Block: yes.
- **Risk:** The review experience depends on selecting the existing algorithm; building a bespoke algorithm would exceed the defined scope.
- **Status:** blocked

## Backlog Handoff

| Roadmap ID | Change ID                   | Suggested issue title                    | Ready for `/10x-plan` | Notes                           |
| ---------- | --------------------------- | ---------------------------------------- | --------------------- | ------------------------------- |
| F-01       | private-flashcard-storage   | Establish private flashcard storage      | no                    | Completed within S-01 Phase 1   |
| F-02       | choose-review-algorithm     | Select the review algorithm              | no                    | Resolve Open Roadmap Question 1 |
| S-01       | reviewed-ai-flashcards      | Let users review AI-generated flashcards | no                    | Completed 2026-09-03            |
| S-02       | manual-flashcard-creation   | Let users create flashcards manually     | no                    | Requires F-01                   |
| S-03       | personal-flashcard-list     | Let users browse personal flashcards     | no                    | Requires S-01                   |
| S-04       | saved-flashcard-maintenance | Let users maintain saved flashcards      | no                    | Requires S-03                   |
| S-05       | spaced-repetition-session   | Let users study in review sessions       | no                    | Requires S-01 and F-02          |

## Open Roadmap Questions

1. **Który gotowy algorytm/biblioteka spaced repetition zostanie wykorzystany do FR-009?** — Owner: user. Block: S-05.

## Parked

- **Własny zaawansowany algorytm powtórek** — Why parked: PRD §Non-Goals requires an existing algorithm rather than a bespoke one.
- **Import wielu formatów (PDF, DOCX itp.)** — Why parked: PRD §Non-Goals limits MVP input to pasted text.
- **Współdzielenie zestawów fiszek między użytkownikami** — Why parked: PRD §Non-Goals defines a personal, isolated collection.
- **Integracje z innymi platformami edukacyjnymi** — Why parked: PRD §Non-Goals excludes educational integrations.
- **Apl specifies a web-first release.

## Milestone History

## Done

- **2026-09-03 — F-01 / private-flashcard-storage:** delivered as Phase 1 of S-01 with per-user RLS.
- **2026-09-03 — S-01 / reviewed-ai-flashcards:** paste, generate, review, edit, accept/reject, and private persistence verified end-to-end. Spaced-repetition availability remains in S-05.
- **S-01: user can paste source text, receive flashcard proposals, review each proposal, and save accepted flashcards to their collection.** — Archived 2026-09-03 → `context/archive/2026-09-02-reviewed-ai-flashcards/`. Lesson: —.
- **S-03: browse their saved flashcards** — Archived 2026-09-04 → `context/archive/2026-09-04-personal-flashcard-list/`. Lesson: —.
- **S-04: user can edit or delete a flashcard already in their collection.** — Archived 2026-09-05 → `context/archive/2026-09-05-saved-flashcard-maintenance/`. Lesson: —.
- **S-02: user can create a front-and-back flashcard without pasted source text.** — Archived 2026-09-05 → `context/archive/2026-09-05-manual-flashcard-creation/`. Lesson: —.
