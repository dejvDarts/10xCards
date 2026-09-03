---
change_id: reviewed-ai-flashcards
title: Reviewed AI flashcards
---

# Plan Brief: Reviewed AI flashcards

## What
A logged-in user pastes source text on a new `/generate` page, triggers AI
flashcard generation (via OpenRouter), and reviews each proposal — accepting
(optionally after editing), or rejecting it. Accepted cards are saved to their
private collection. This is roadmap north star **S-01**, covering PRD
must-haves **FR-003** and **FR-004**.

## Why
Full end-to-end review loop is the PRD's primary Success Criterion and the
riskiest assumption to validate: whether AI-generated proposals are good
enough that users actually accept ≥75% of them. Nothing downstream (manual
creation, list/edit/delete, spaced-repetition sessions) matters if this loop
doesn't work.

## Scope decisions made during planning
- **F-01 folded in**: the private-flashcard-storage foundation has no plan of
  its own yet, so its minimal schema + RLS ships as this plan's Phase 1 instead
  of blocking on a separate change.
- **AI provider**: OpenRouter, default model `openai/gpt-4o-mini` (env-var
  overridable) — no vendor was pre-selected in PRD/tech-stack.
- **Persistence model**: proposals are written to the DB immediately as
  `pending` (not held client-side), so a page refresh mid-review doesn't lose
  work.
- **Editing included**: PRD FR-004/US-01 explicitly require every proposal to
  be editable before saving — the plan keeps this in scope.
- **Generation limits**: pasted text bounded to 100–10,000 chars; AI-decided
  card count capped at 15 per submission.
- **Testing**: manual verification only — no test framework exists in this
  repo yet, and none is introduced by this slice.

## Phases
1. **Flashcard storage foundation** — `flashcards` table + per-user RLS
   policies + shared `src/types.ts`.
2. **AI generation API** — `POST /api/flashcards/generate`, zod-validated,
   calls OpenRouter, persists proposals as `pending`, caps at 15.
3. **Review UI** — protected `/generate` page + React island for paste →
   review → accept/edit/reject, `PATCH /api/flashcards/[id]`.
4. **Error handling polish & verification** — inline retry without data loss,
   full manual QA pass against every US-01 Acceptance Criterion.

## Risks / open items
- AI output quality (≥75% acceptance guardrail) is not enforced in code — it's
  a product metric to watch post-launch, not a build blocker.
- OpenRouter API key must be provisioned in `.dev.vars` / deployment secrets
  before Phase 2 can be manually verified.

## Next step
`/10x-implement reviewed-ai-flashcards phase 1`
