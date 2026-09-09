---
date: 2026-09-09T06:03:36Z
researcher: Claude Sonnet 5
git_commit: db9f9370eaa689d61dcaca39eada0cce887564e3
branch: master
repository: 10xCards
topic: "Ground rollout Phase 1 of context/foundation/test-plan.md — Risk #1 (cross-user flashcard access) and Risk #4 (auth/session gating)"
tags: [research, codebase, auth, rls, flashcards, middleware, test-plan]
status: complete
last_updated: 2026-09-09
last_updated_by: Claude Sonnet 5
---

# Research: Grounding Risks #1 and #4 for rollout Phase 1 (Critical-path coverage)

**Date**: 2026-09-09T06:03:36Z
**Researcher**: Claude Sonnet 5
**Git Commit**: db9f9370eaa689d61dcaca39eada0cce887564e3
**Branch**: master
**Repository**: 10xCards

## Research Question

Ground rollout Phase 1 of `context/foundation/test-plan.md` (Risks #1 and #4) in actual code: locate the real ownership/authorization enforcement, the real session-gating enforcement, verify the plan's Risk Response Guidance, identify existing tests and test infra, and flag any speculative risks or misleading hot-spot evidence.

## Summary

Both risks are **currently mitigated in code** but have **zero automated regression protection** — no test runner, no test files, no `test` script anywhere in the repo. The gap the test-plan set out to close is real and confirmed.

- **Risk #1 (cross-user flashcard access):** every flashcard route that reads, updates, or deletes an existing row enforces ownership **twice** — an app-level `.eq("user_id", user.id)` filter *and* a matching RLS policy (`user_id = auth.uid()`), and the Supabase client is session-scoped via the anon key (not service-role), so RLS is a genuinely live control, not dead code. Cross-user PATCH/DELETE returns **404**, not 403 — that's the exact behavior a test must assert.
- **Risk #4 (auth/session gating):** page routes and API routes are protected by **two structurally different mechanisms**. Pages are gated centrally by `src/middleware.ts` (`PROTECTED_ROUTES` prefix match → redirect to `/auth/signin`). API routes are **not** covered by `PROTECTED_ROUTES` at all (`/api/...` never matches `/dashboard`, `/generate`, `/flashcards`) — each API handler independently re-checks `getUser()` and returns `401 {"error":"Unauthorized"}` with no redirect. A test suite that only exercises one of these two mechanisms will not generalize to the other.

Two corrections to `test-plan.md` §2 surfaced (see "Response-guidance and anchor corrections" below) — worth backporting via `/10x-test-plan` before planning.

## Detailed Findings

### Risk #1 — Cross-user flashcard access (IDOR)

**Routes touching flashcards** (`src/pages/api/flashcards/`):

| Route | Handler | Ownership enforcement |
|---|---|---|
| `index.ts` | `GET` (list) | `src/lib/services/flashcards.ts:8` — `.eq("user_id", userId).eq("status", "accepted")` |
| `index.ts` | `POST` (create) | `index.ts:73-83` — inserts with `user_id: user.id` (server-set, not client-supplied) |
| `[id].ts` | `PATCH` | `[id].ts:50-61` — `.eq("id", cardId).eq("user_id", user.id)`; 404 if no match (`[id].ts:66-68`) |
| `[id].ts` | `DELETE` | `[id].ts:91-97` — same `.eq("id", ...).eq("user_id", ...)` + 404-on-no-match pattern |
| `due.ts` | `GET` | `src/lib/services/reviews.ts:44-58` — `.eq("user_id", userId)...` |
| `[id]/review.ts` | `POST` | `src/lib/services/reviews.ts:61-102` — ownership check on both the read (line 67-73) and the write (line 88-95), plus an optimistic-concurrency guard on `updated_at` |
| `generate.ts` | `POST` | `generate.ts:49-57` — inserts with `user_id: user.id` per row; no existing-row read/update |

**No route was found missing the ownership filter.**

**RLS policies** — `supabase/migrations/20260903000000_create_flashcards.sql:26-49`:

```sql
create policy "flashcards_select_own" on flashcards for select to authenticated
  using (user_id = auth.uid());
create policy "flashcards_insert_own" on flashcards for insert to authenticated
  with check (user_id = auth.uid());
create policy "flashcards_update_own" on flashcards for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "flashcards_delete_own" on flashcards for delete to authenticated
  using (user_id = auth.uid());
```

Correct per-operation USING/WITH CHECK split (select/delete: USING only; insert: WITH CHECK only; update: both) — the file's own header comment (lines 1-9) documents this intent, and the implementation matches it. Later migrations (`20260904000000`, `20260906000000`) only add an index and FSRS columns; no policy changes, and none needed (existing row-scoped policies already cover new columns per `context/archive/2026-09-06-spaced-repetition-session/plan.md:87`).

**Supabase client is session-scoped, not service-role.** `src/lib/supabase.ts:5-24` builds the client via `@supabase/ssr`'s `createServerClient`, keyed by `SUPABASE_KEY` and driven by request cookies. `SUPABASE_KEY` is documented everywhere (`.env.example:2`, `README.md`, `astro.config.mjs:20`) as the **anon public key**; no service-role client exists anywhere in the codebase. `context/deployment/deploy-plan.md:89,182,243,438,440` explicitly warns `SUPABASE_KEY` must never be `service_role`, since that would bypass RLS from an internet-reachable surface. **Conclusion: RLS actually evaluates as the requesting user on every request — it is a live defense, not documentation.**

**Existing tests: none.** No `test` script in `package.json`, no `*.test.*`/`*.spec.*` files, no test runner dependency.

### Risk #4 — Auth/session gating

**`src/middleware.ts` (full logic, 25 lines):**

```ts
const PROTECTED_ROUTES = ["/dashboard", "/generate", "/flashcards"]; // line 4

// user resolution, lines 6-16
const supabase = createClient(context.request.headers, context.cookies);
if (supabase) {
  const { data: { user } } = await supabase.auth.getUser();
  context.locals.user = user ?? null;
} else {
  context.locals.user = null;
}

// gate, lines 18-22
if (PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route))) {
  if (!context.locals.user) {
    return context.redirect("/auth/signin");
  }
}
```

Matching is `pathname.startsWith(route)` — **prefix match, not exact/segment match**. Currently correct for the four existing pages (`dashboard.astro`, `generate.astro`, `flashcards.astro`, `flashcards/review.astro`), but it is a design fragility: any future route beginning with one of these three strings (e.g. a hypothetical `/generated-report`) would be silently swept into the gate, and nothing enforces that a newly-added page needing protection gets added to this array.

**API routes are NOT covered by `PROTECTED_ROUTES`.** `/api/flashcards/...` never starts with `/dashboard`, `/generate`, or `/flashcards`, so middleware provides **zero** enforcement there. Instead, every flashcard-touching API handler independently repeats the same guard:

```ts
const { data: { user } } = await supabase.auth.getUser();
if (!user) return jsonError("Unauthorized", 401);
```

confirmed present in `generate.ts:22-27`, `[id].ts` (PATCH lines 25-30, DELETE lines 79-84), `index.ts` (GET lines 26-31, POST lines 54-59), `due.ts:14-19`, `[id]/review.ts:20-25`. Each defines its own local `jsonError` helper (duplicated per file, not shared).

**Behavioral split confirmed** — a test suite must exercise both:
- Page route, no session → `context.redirect("/auth/signin")`, i.e. a redirect (302), destination verified to exist (`src/pages/auth/signin.astro`).
- API route, no session → `401` JSON body `{"error":"Unauthorized"}`, no redirect.

**`dashboard.astro` (CLAUDE.md's documented "protected page example") relies solely on middleware**, with no page-level fallback check: `const { user } = Astro.locals;` then `{user?.email}` (optional chaining — would render `undefined`, not fail closed, if `user` were ever null on this page). Its protection depends entirely on `PROTECTED_ROUTES` and the middleware running correctly, with no second layer.

**Existing tests: none.**

### Test infrastructure and stack (all three agents converged on this)

- No test runner installed: no `vitest`, `@cloudflare/vitest-pool-workers`, `jest`, or `playwright` in `package.json` dependencies.
- No `test` script in `package.json` (`scripts` has only `dev`, `build`, `preview`, `astro`, `lint`, `lint:fix`, `format`).
- Zero test files anywhere under `src/` or repo root (all `*.test.*`/`*.spec.*` glob hits resolve to `node_modules`).
- Confirmed current versions relevant to test-runner choice: `astro ^6.3.1`, `@astrojs/cloudflare ^13.5.0`, `@astrojs/react ^5.0.4`, `react ^19.2.6`, `@supabase/ssr ^0.10.3`, `@supabase/supabase-js ^2.99.1`, `wrangler ^4.128.0` (dev), `typescript ^5.9.3` (dev), `vite ^7.3.2` (override).
- `test-plan.md` §4 already names Vitest + `@cloudflare/vitest-pool-workers` as the leading candidate (Context7-confirmed current) — nothing here contradicts that; it remains a hypothesis to execute, not something already wired.

## Code References

- `src/pages/api/flashcards/index.ts:26-31,54-59,73-83` — auth guard + `user_id` set on insert
- `src/pages/api/flashcards/[id].ts:25-30,50-61,66-68,79-84,91-97` — auth guard + ownership filter + 404-on-mismatch, PATCH and DELETE
- `src/pages/api/flashcards/due.ts:14-19` — auth guard
- `src/pages/api/flashcards/[id]/review.ts:20-25` — auth guard
- `src/lib/services/flashcards.ts:8` — `baseQuery` ownership filter
- `src/lib/services/reviews.ts:44-58,61-102` — due-list ownership filter; review read+write ownership + optimistic-concurrency guard
- `src/pages/api/flashcards/generate.ts:22-27,49-57` — auth guard + server-set `user_id` on generated rows
- `supabase/migrations/20260903000000_create_flashcards.sql:1-9,11-20,22-24,26-49` — table definition, RLS enable/grant, four per-operation policies
- `src/lib/supabase.ts:5-24` — session-scoped `createServerClient`, anon key, cookie-driven
- `src/middleware.ts:1-25` — full file: `PROTECTED_ROUTES`, user resolution, redirect gate
- `src/pages/dashboard.astro:5,19` — `Astro.locals.user`, optional-chained render, no page-level guard
- `src/components/Topbar.astro:2,9,11` — reads `Astro.locals.user` for nav personalization, decoupled from `PROTECTED_ROUTES`

## Architecture Insights

- **Defense-in-depth is real, not aspirational.** Every route that reads/mutates an existing flashcard row enforces ownership at both the app-query layer and the RLS layer, and the RLS layer is live because the Supabase client is always session-scoped (anon key + cookies), never service-role.
- **Cross-user access denial surfaces as 404, not 403.** Both the app-level filter (`.eq("user_id", ...)` then check `!result.data`) and RLS (`using (user_id = auth.uid())`, so a non-owned row is invisible, not merely forbidden) produce a "not found" outcome. Tests must assert 404 for a cross-user PATCH/DELETE attempt, not 403.
- **Page-level and API-level auth gating are two independent mechanisms**, not one shared code path: middleware prefix-match + redirect for pages; per-handler `getUser()` + 401 JSON for API routes (`/api/**` is entirely outside `PROTECTED_ROUTES`). A regression could break one without the other.
- **`PROTECTED_ROUTES` prefix matching (`startsWith`) is a latent fragility.** Currently correct for the four existing pages, but nothing enforces that a new user-data page gets added to this array, and nothing prevents an unrelated future route from accidentally colliding with an existing prefix.

## Historical Context (from prior changes)

- `context/archive/2026-09-02-reviewed-ai-flashcards/plan.md:54,75,85,91` — original design decision: RLS is "non-negotiable," build order is "persistence + RLS first."
- `context/archive/2026-09-02-reviewed-ai-flashcards/reviews/plan-review.md:37-45` (finding F2) — reviewer flagged missing USING/WITH CHECK specification per operation; marked SKIPPED at review time, but the shipped migration implements the correct per-operation split anyway (confirmed above).
- `context/archive/2026-09-04-personal-flashcard-list/plan.md:236` — added `/flashcards` to `PROTECTED_ROUTES`; documented the double-enforcement pattern (RLS + app-level filter) and flagged a manual test need for cross-user isolation that was never automated.
- `context/archive/2026-09-05-saved-flashcard-maintenance/plan.md:230,235` — documents that cross-user edit/delete must return 404, not 403/leak — matches the confirmed current behavior.
- `context/archive/2026-09-05-manual-flashcard-creation/reviews/impl-review.md:82` — documents the zod `.strict()` schema blocking client injection of `user_id`/`status` on manual create, backed by `flashcards_insert_own` RLS.
- `context/archive/2026-09-06-spaced-repetition-session/plan.md:87,195` — confirms no new RLS policies were needed for FSRS columns; documents that cross-user card-ID guessing on the review endpoint returns 404 via RLS.
- `context/deployment/deploy-plan.md:89,182,243,438,440` — explicit warning that `SUPABASE_KEY` must be the anon key, never `service_role`, or RLS would be bypassed on an internet-reachable surface.
- No archived change or prior research document proposes a test runner or testing-infrastructure decision — `test-plan.md` is the first document to address this.

## Response-guidance and anchor corrections (for `/10x-test-plan` backport)

1. **Risk #4 hot-spot citation is misleading.** §2 cites `src/components/auth` (6 commits/30d) and `src/pages/auth` (5 commits/30d) as the evidence directories. The actual gating logic lives in `src/middleware.ts` (not in either cited directory) and is independently duplicated across `src/pages/api/**` handlers. `src/pages/auth/*.astro` holds the sign-in/sign-up **pages**, not the enforcement logic. Recommend updating the Source citation to reference `src/middleware.ts` churn and `src/pages/api/` (already cited for Risk #1) rather than `src/components/auth`.
2. **Risk #4's response guidance under-specifies a real behavioral split.** The current guidance ("prove an unauthenticated request to any protected route/endpoint is redirected/rejected") treats page and API protection as one behavior. Research shows they are two independently-implemented mechanisms with different observable outcomes (302 redirect vs. 401 JSON). Recommend the Phase 1 plan explicitly requires **two** integration-test groups for Risk #4 — one exercising a `PROTECTED_ROUTES` page, one exercising an API route — rather than one generalized case, and the "Must challenge" cell should add: "a passing page-level redirect test says nothing about API-route enforcement, since `/api/**` is not in `PROTECTED_ROUTES` at all."
3. **Risk #1's cheapest-layer guidance is confirmed as-is** (integration, two authenticated users, assert cross-access rejected) — no correction needed, but note for `/10x-plan`: assert **404**, not 403, matching actual behavior.

No risk was found to be speculative — both #1 and #4 describe real, currently-mitigated-but-untested behavior.

## Related Research

None yet — this is the first research document under `context/changes/testing-critical-path-coverage/`.

## Open Questions

- Should the duplicated per-handler `jsonError`/`getUser()` guard in the API routes be refactored to a shared helper as part of Phase 1, or left as-is and simply tested per-route? (Test-plan scope question, not a research gap — the current duplication doesn't affect correctness, just maintainability.)
- Should a page-level fallback guard be added to `dashboard.astro` (matching the pattern hinted at in `flashcards.astro`'s code comment), or is middleware-only protection accepted as the permanent single-layer design? Out of scope for Phase 1 test coverage either way, since testing existing behavior doesn't require changing it — flagged for `/10x-plan` to decide whether it's in-scope to *recommend* (not required to fix).
