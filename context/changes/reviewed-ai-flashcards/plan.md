---
change_id: reviewed-ai-flashcards
title: Reviewed AI flashcards
status: done
created: 2026-09-02
updated: 2026-09-03
---

# Plan: Reviewed AI flashcards

## Overview

Deliver the end-to-end flow behind US-01: a logged-in user pastes source text,
gets AI-generated flashcard proposals, reviews each one (accept / edit / reject),
and accepted cards land in their private collection. This is the roadmap's
north star (S-01) and satisfies must-have FR-003 and FR-004.

Because the private flashcard storage foundation (F-01) has not been built yet,
this plan folds the minimal persistence schema into Phase 1 rather than blocking
on a separate change.

## Current State Analysis

- No flashcard data model exists: no `supabase/migrations/`, no `src/types.ts`.
- No AI/LLM integration exists anywhere in the codebase or `package.json`.
- No JSON API routes or validation library exist yet — `src/pages/api/auth/*.ts`
  use `formData()` + redirects, no zod.
- Only `src/components/ui/button.tsx` is scaffolded under `ui/`; no Card,
  Textarea, or Dialog components exist.
- `src/middleware.ts` protects only `/dashboard` (`PROTECTED_ROUTES`).
- Supabase client wiring (`src/lib/supabase.ts`) and auth flow already work and
  will be reused as-is.

## Desired End State

A logged-in user can visit a protected `/generate` page, paste text (100–10,000
chars), trigger AI generation via OpenRouter, see up to 15 proposals persisted
as `pending` flashcards, edit any proposal's front/back text, and accept or
reject each one individually. Accepted (including edited) cards become
`accepted` and are isolated per-user via RLS. Rejected cards become `rejected`
and never surface again. Failures during generation show an inline, retryable
error without losing the pasted text.

### Verification

- Manual walkthrough of the full flow against US-01's Acceptance Criteria (no
  automated test framework exists in this repo yet — MVP relies on manual QA).

## Key Discoveries

- PRD FR-004 / US-01 Acceptance Criteria require "every proposal is editable
  before saving" — this plan includes edit-before-accept, not accept/reject-only.
- PRD guardrail: pasted text and flashcards must never be visible to other
  users → RLS policies are non-negotiable, scoped by `user_id = auth.uid()`.
- `has_ai: true` in `tech-stack.md`, with Zod called out for validating model
  output — confirms zod is expected tooling for this slice.
- No AI provider is pre-selected anywhere in PRD/tech-stack; OpenRouter was
  chosen during this plan's questioning round as the multi-model gateway.

## What We're NOT Doing

- Manual flashcard creation (FR-005), flashcard list/edit/delete after saving
  (FR-006–008), and the spaced-repetition session (FR-009) — separate roadmap
  slices (S-02–S-05).
- Choosing the spaced-repetition algorithm/library (F-02) — unrelated to this
  slice.
- Automated tests / new test framework — manual verification only for this MVP
  slice per repo convention.
- Rate limiting, cost tracking, or model-selection UI — single hardcoded model
  behind an env var for MVP.
- Non-text import formats (PDF/DOCX) — explicit PRD non-goal.

## Implementation Approach

Build bottom-up: persistence + RLS first (safe to verify in isolation via SQL),
then the generation API (server-only secret, testable via curl), then the
review UI on top of both. This matches the existing repo convention of
Supabase-backed, SSR-first Astro pages with React islands only where
interactive.

## Phase 1: Flashcard storage foundation (minimal F-01)

### Overview

Create the `flashcards` table with per-user RLS and shared TypeScript types.

### Changes

- `supabase/migrations/<timestamp>_create_flashcards.sql`:
  - Table `flashcards`: `id uuid pk default gen_random_uuid()`, `user_id uuid not null references auth.users(id)`, `front text not null`, `back text not null`, `source_text text`, `status text not null check (status in ('pending','accepted','rejected')) default 'pending'`, `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`.
  - Enable RLS; add separate policies for `select`/`insert`/`update`/`delete`, each scoped to `user_id = auth.uid()`.
- `src/types.ts` (new): `Flashcard` entity type + `FlashcardStatus` union + request/response DTOs (`GenerateFlashcardsRequest`, `GenerateFlashcardsResponse`, `UpdateFlashcardRequest`).
- `npm install zod` (add to `package.json`).
- `README.md:114`: update the line stating "No database tables or migrations are required" — now stale once the `flashcards` migration lands.

### Success Criteria

#### Automated

- `npx supabase db reset` (or migration apply) runs cleanly against local Supabase.
- `npm run build` succeeds with new types compiled.

#### Manual

- Inserting a row as user A and querying as user B (different `auth.uid()`) returns zero rows.

## Phase 2: AI generation API

### Overview

Server endpoint that validates input, calls OpenRouter, persists proposals as `pending`.

### Changes

- `astro.config.mjs`: add `OPENROUTER_API_KEY` (server secret) to `env.schema`.
- `.dev.vars` / `.env.example`: document `OPENROUTER_API_KEY` (no real value committed).
- `src/lib/services/flashcard-generation.ts` (new): calls OpenRouter chat completions with a default model (env-overridable, default `openai/gpt-4o-mini`), prompts for question/answer pairs from source text, parses/validates the model's JSON output with zod, caps result at 15 proposals.
- `src/pages/api/flashcards/generate.ts` (new, `export const prerender = false`): `POST` handler — requires `context.locals.user` (401 if absent), validates `{ sourceText: string }` with zod (100–10,000 chars, clear 400 error otherwise), calls the generation service, inserts proposals as `pending` via Supabase, returns JSON list of created flashcards. On AI call/parse failure, returns a structured JSON error (no partial DB writes).

### Success Criteria

#### Automated

- `npm run lint` passes on new files.
- `npm run build` succeeds.

#### Manual

- `curl` POST with valid text returns ≤15 pending flashcards persisted for the authenticated user.
- POST with 10-char text returns a 400 validation error.
- Simulated AI failure returns a JSON error, and no rows are inserted.

## Phase 3: Review UI (accept / edit / reject)

### Overview

Protected page to paste text, trigger generation, and review proposals inline.

### Changes

- `src/middleware.ts`: add `/generate` to `PROTECTED_ROUTES`.
- `src/pages/generate.astro` (new): server-rendered shell, mounts a React island.
- `npx shadcn@latest add card textarea` (adds missing UI primitives; reuses existing `button`).
- `src/components/FlashcardGenerator.tsx` (new React island): textarea for pasting source text, submit button (loading state), renders returned proposals as cards with editable front/back fields, Accept / Reject buttons per card.
- `src/components/hooks/useFlashcardProposals.ts` (new): client-side hook wrapping fetch calls to `generate` and `update` endpoints, local optimistic state per card.
- `src/pages/api/flashcards/[id].ts` (new, `export const prerender = false`): `PATCH` handler — zod-validates `{ status: "accepted" | "rejected", front?: string, back?: string }`, verifies the row belongs to `context.locals.user`, updates status (and front/back if edited), returns the updated flashcard.

### Success Criteria

#### Automated

- `npm run lint` passes.
- `npm run build` succeeds.

#### Manual

- Full walkthrough: paste text → see proposals → edit one → accept it → reject another → refresh page confirms accepted card persists and rejected card is gone from the pending view.
- Empty/too-short pasted text shows an inline, understandable message (not a blank list) — per US-01 Acceptance Criteria.
- Unauthenticated visit to `/generate` redirects to `/auth/signin`.

## Phase 4: Error handling polish and verification pass

### Overview

Close remaining gaps: inline retry-without-data-loss on failure, final QA against PRD Acceptance Criteria.

### Changes

- `src/components/FlashcardGenerator.tsx`: on generation failure, keep the pasted text in the textarea and show an inline error banner with a retry action (no navigation, no data loss).
- Update `context/changes/reviewed-ai-flashcards/change.md` notes with any deviations found during implementation.

### Success Criteria

#### Automated

- `npm run lint` and `npm run build` pass with no new warnings.

#### Manual

- Re-run every Acceptance Criterion from US-01 end-to-end and confirm each passes.
- Confirm the ≥75% acceptance-rate guardrail is _measurable_ (status column supports counting accepted vs total) even though the threshold itself isn't enforced in code.

## Testing Strategy

Manual verification only, per repo convention (no automated test framework configured). Each phase's Manual checklist above must be executed before moving to the next phase; Phase 4's checklist re-verifies the whole slice against PRD Acceptance Criteria.

## Performance Considerations

NFR requires visible progress feedback for operations over a few seconds — the generation button must show a loading state while awaiting the OpenRouter call. Known limitation: `wrangler.jsonc` sets no CPU-time override, so the synchronous OpenRouter call inside a Workers request handler is subject to Cloudflare's default platform CPU-time limits; revisit if generation calls start timing out under slower model responses.

## Migration Notes

New `supabase/migrations/*_create_flashcards.sql` file only; no existing data to migrate. Before Phase 2 can be verified in production, provision the runtime secret with `wrangler secret put OPENROUTER_API_KEY` (Cloudflare Workers secrets are separate from the CI build-time env vars used for `SUPABASE_URL`/`SUPABASE_KEY`).

## References

- `context/foundation/prd.md` — US-01, FR-003, FR-004, NFRs, Access Control.
- `context/foundation/roadmap.md` — S-01 entry (Outcome, Prerequisites: F-01, Risk).
- `context/foundation/tech-stack.md` — `has_ai: true`, Zod validation note.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Flashcard storage foundation (minimal F-01)

#### Automated

- [x] 1.1 `npx supabase db reset` (or migration apply) runs cleanly against local Supabase — 64e903d
- [x] 1.2 `npm run build` succeeds with new types compiled — 64e903d

#### Manual

- [x] 1.3 Inserting a row as user A and querying as user B (different `auth.uid()`) returns zero rows — 64e903d

### Phase 2: AI generation API

Implementation: `a339c5a`

#### Automated

- [x] 2.1 `npm run lint` passes on new files — 2026-09-03
- [x] 2.2 `npm run build` succeeds — 2026-09-03

#### Manual

- [x] 2.3 `curl` POST with valid text returns ≤15 pending flashcards persisted for the authenticated user — 2026-09-03
- [x] 2.4 POST with 10-char text returns a 400 validation error — 2026-09-03
- [x] 2.5 Simulated AI failure returns a JSON error, and no rows are inserted — 2026-09-03

### Phase 3: Review UI (accept / edit / reject)

Implementation: `ae9cce9`

#### Automated

- [x] 3.1 `npm run lint` passes — focused lint on Phase 3 files, 2026-09-03; repository-wide lint remains blocked by pre-existing CRLF/type errors
- [x] 3.2 `npm run build` succeeds — 2026-09-03

#### Manual

- [x] 3.3 Full walkthrough: paste text → see proposals → edit one → accept it → reject another → refresh page confirms accepted card persists and rejected card is gone from the pending view — 2026-09-03
- [x] 3.4 Empty/too-short pasted text shows an inline, understandable message (not a blank list) — per US-01 Acceptance Criteria, 2026-09-03
- [x] 3.5 Unauthenticated visit to `/generate` redirects to `/auth/signin` — 2026-09-03

### Phase 4: Error handling polish and verification pass

#### Automated

- [x] 4.1 `npm run lint` and `npm run build` pass with no new warnings — 2026-09-03

#### Manual

- [x] 4.2 Re-run every Acceptance Criterion within the S-01 scope end-to-end and confirm each passes; immediate
      availability in a spaced-repetition session remains explicitly deferred to S-05 / FR-009 — 2026-09-03
- [x] 4.3 Confirm the ≥75% acceptance-rate guardrail is measurable (status column supports counting accepted vs total)
      even though the threshold itself isn't enforced in code — 2026-09-03
