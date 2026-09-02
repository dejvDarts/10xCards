<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Reviewed AI flashcards

- **Plan**: context/changes/reviewed-ai-flashcards/plan.md
- **Mode**: Deep
- **Date**: 2026-09-02
- **Verdict**: REVISE
- **Findings**: 1 critical, 3 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | FAIL |

## Grounding
Grounding: 6/6 paths ✓ (`src/pages/api/auth/signup.ts`, `src/lib/supabase.ts`, `src/middleware.ts`, `src/components/ui/button.tsx`, `astro.config.mjs`, `components.json`), 3/3 symbols ✓ (`App.Locals.user` typed nullable in `src/env.d.ts:3`, `PROTECTED_ROUTES` array in `src/middleware.ts:4`, `zod` confirmed absent from `package.json`), brief↔plan ✓ (phases, decisions, and scope match).

## Findings

### F1 — Progress section violates the mechanical contract

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1–4 Success Criteria, and `## Progress`
- **Detail**: Two contract violations from `references/progress-format.md`:
  1. Every Phase's Success Criteria use `- [ ]` checkboxes (e.g. lines 95–99, 115–121, 139–145, 159–163), but "Phase blocks contain plain `- ` bullets only — no `- [ ]` or `- [x]` outside the Progress section."
  2. The `## Progress` section only has one `- [ ] Phase N: <name>` line per phase — it's missing the required `### Phase N: <name>` headings with `#### Automated` / `#### Manual` subsections and `<phase>.<index>` numbered steps mirroring each Success Criteria bullet. `/10x-implement` parses Progress mechanically (next pending step = first `- [ ]` in document order, phase.index numbering) and will fail against this shape.
- **Fix**: Convert Phase Success Criteria bullets to plain `- ` bullets, and rewrite `## Progress` to enumerate every criterion as `- [ ] <phase>.<index> <title>` under `### Phase N: <name>` / `#### Automated` / `#### Manual`, per the template in `references/progress-format.md`.
- **Decision**: FIXED

### F2 — RLS policies don't specify USING vs WITH CHECK per operation

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — Changes
- **Detail**: The plan says policies are "scoped to `user_id = auth.uid()`" but doesn't specify which clause type each policy needs. This is a common RLS mistake: `insert` policies need `WITH CHECK` (there's no existing row to `USING`-filter against), while `select`/`delete` need `USING`, and `update` needs both. Getting this wrong (e.g. only `USING` on the insert policy) would silently allow inserting rows with an arbitrary `user_id`.
- **Fix**: Add one sentence to Phase 1 specifying: `select`/`delete` use `USING (user_id = auth.uid())`; `insert` uses `WITH CHECK (user_id = auth.uid())`; `update` uses both clauses.
- **Decision**: SKIPPED

### F3 — README.md contradicts the new migration

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — Changes
- **Detail**: `README.md:114` states "No database tables or migrations are required — this project uses Supabase Auth's built-in `auth.users` table only." This plan's Phase 1 adds the first product-data migration, making that line stale. A future contributor or agent reading the README would get the wrong impression that no schema exists.
- **Fix**: Add a Phase 1 change item to update `README.md:114` once the `flashcards` migration lands.
- **Decision**: FIXED

### F4 — No note on provisioning OPENROUTER_API_KEY for production deploy

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 — Changes / Migration Notes
- **Detail**: `astro.config.mjs`'s existing `SUPABASE_URL`/`SUPABASE_KEY` secrets are wired into `.github/workflows/ci.yml`'s `build`/`deploy` jobs (`ci.yml:20-21,38-39`) as GitHub secrets, but Cloudflare Workers runtime secrets are typically provisioned separately (`wrangler secret put`) rather than as build-time env vars. The plan never mentions how `OPENROUTER_API_KEY` reaches the deployed Worker — without it, Phase 2 works locally via `.dev.vars` but the generation endpoint will fail at runtime in production.
- **Fix**: Add a line to Phase 2 or Migration Notes: provision `OPENROUTER_API_KEY` via `wrangler secret put OPENROUTER_API_KEY` (or the equivalent Cloudflare dashboard step) before Phase 2 is verified in production.
- **Decision**: FIXED

### F5 — Cloudflare Worker CPU-time limits for synchronous AI calls

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2
- **Detail**: `wrangler.jsonc` sets no CPU-time limit override, and the generation endpoint calls OpenRouter synchronously inside a Workers request handler. Default platform CPU-time limits could be hit under slow model responses. Not a blocker for MVP scale, but worth a one-line note for future observability if generation calls start timing out.
- **Fix**: none required now — note as a known limitation in Performance Considerations if it becomes an issue.
- **Decision**: FIXED

### F6 — Typo in Phase 2 changes

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — Changes
- **Detail**: "On AI/par501se failure" contains a typo (should be "parse").
- **Fix**: Correct the typo.
- **Decision**: FIXED
