# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-09-09

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the
   team is worried about X, and the failure would surface somewhere in
   area Y" carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents *what
   could fail* and *why we believe it's likely* — drawn from documents,
   interview, and codebase *signal* (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/migrations/`
(21 commits/30d — sufficient signal).

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the *evidence that surfaced
this risk* — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence — not anchor) |
|---|---|---|---|---|
| 1 | A user can retrieve, modify, or delete another user's flashcards | High | High | interview Q1; PRD §Success Criteria guardrail (data never visible cross-user); hot-spot dir `src/pages/api` (10 commits/30d) |
| 2 | FSRS review-session scheduling recalculates due-dates incorrectly (card stuck, skipped, or resurfaces in the same session) | High | High | interview Q3; PRD FR-009; roadmap S-05; hot-spot dir `src/lib/services` (5 commits/30d) |
| 3 | AI generation pipeline fails or returns malformed output without a clear error to the user | High | Medium | PRD FR-003; PRD NFR "odczuwalny czas generowania"; tech-stack.md `has_ai: true`; hot-spot dir `src/lib/services` (5 commits/30d) |
| 4 | Auth/session gating regresses on a protected route or API endpoint | High | Medium | hot-spot: `src/middleware.ts` (3 commits/30d — the actual `PROTECTED_ROUTES` gate) and `src/pages/api` (7 commits/30d — independently self-guarded, not covered by middleware); AGENTS.md protected-route rule; corrected via research.md (2026-09-09) — original citation of `src/components/auth`/`src/pages/auth` pointed at auth UI pages, not the gating logic |
| 5 | Optimistic-update rollback drift leaves the flashcard list showing stale or incorrect state after a failed edit/delete/create | Medium | High | interview Q3 ("deck"); hot-spot dir `src/components/hooks` (11 commits/30d) |
| 6 | Untrusted input reaching an API route bypasses server-side validation (oversized text, malformed payload) | Medium | Medium | AGENTS.md zod-validation rule; archived slice `reviewed-ai-flashcards` plan (100–10,000 char / 15-card limits); hot-spot dir `src/pages/api` (10 commits/30d) |

**Impact × Likelihood rubric.** Score both axes on a coarse High / Medium /
Low scale so two readers agree on the same row. Do not invent finer
gradations — the goal is ordering, not false precision.

| Rating | Impact | Likelihood |
|--------|--------|------------|
| High   | user loses access, data, or money; failure is publicly visible | area changes weekly, or we have already been burned here |
| Medium | feature degrades, a workaround exists, only some users affected | touched occasionally, has been a source of bugs |
| Low    | cosmetic, easily reverted, no data effect | stable code, rarely touched |

**Abuse / security lens.** Risk #1 (authorization/IDOR — does the endpoint
check ownership, not just authentication?) and Risk #6 (untrusted input —
server must not trust the client) satisfy this lens: the product has auth,
AI generation, and accepts pasted-text input.

**Challenger findings.** Dropped an initial "AI-generation rate-limit
bypass" risk during brief synthesis — no rate limiter exists today, so
"protection" would require building a safeguard first before it could be
tested (speculative). Reframed to Risk #6 (untrusted-input validation),
which tests a safeguard (zod validation) the codebase already claims to
apply everywhere.

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|------|-----------------------------|----------------|--------------------------------------|-----------------------|-----------------------|
| #1 | A user, given a valid session, can never retrieve, modify, or delete another user's flashcard via any exposed route, even by guessing/crafting IDs | "the endpoint checks the user is logged in" is not "the endpoint checks the user owns this row" — authentication ≠ authorization | ownership-check location (RLS policy vs. app-level WHERE clause vs. both), session/auth shape from middleware | integration (two distinct authenticated users, assert cross-access rejected) | happy-path-only (never attempting cross-user access); mocking out RLS/Supabase entirely |
| #2 | After a rating, the card's due-date moves in the direction/rough magnitude the rating implies, and a rated card never resurfaces in the same session | a 200 response does not mean the schedule was recalculated correctly | due-state persistence and read-back, date/timezone handling, ordering guarantee across cards | unit (scheduling calc) + integration (rate → re-fetch due list → assert) | asserting against the implementation's own output (oracle problem); happy-path-only (only "Good", never "Again") |
| #3 | When the AI provider errors, times out, or returns malformed output, the user sees a clear actionable error and never a silently empty/corrupted proposal list | "the AI call didn't throw" does not mean the returned proposals are well-formed | external boundary (provider call), response parsing/validation, retry/timeout behavior, partial-failure state | integration (mock the provider edge only) | over-mocking past the response-validation code; testing only successful generation |
| #4 | An unauthenticated request to a `PROTECTED_ROUTES` page is redirected to `/auth/signin`; an unauthenticated request to any flashcard API route (`/api/**`, not covered by `PROTECTED_ROUTES`) is rejected with a 401 JSON body; an authenticated user is never blocked from either | "the page-level redirect works" does not mean API routes are protected — `/api/**` never matches `PROTECTED_ROUTES` and relies entirely on each handler's own auth check; page and API gating are two independent mechanisms with different observable outcomes (302 redirect vs. 401 JSON), not one shared code path | which routes are covered by `PROTECTED_ROUTES` vs. which rely on per-handler guards, what middleware does with an absent/expired session, redirect target, and the exact status/body shape for API rejections | integration — two separate test groups: one exercising a `PROTECTED_ROUTES` page, one exercising a flashcard API route (no/expired session vs. valid session in each) | testing one protected route and assuming it generalizes to the other mechanism; asserting status code without checking redirect destination (pages) or response body shape (API) |
| #5 | After an edit, delete, or create — including a failed one — the list shown matches what is actually persisted, with no stuck stale card or phantom entry | "the UI updated immediately" does not mean the server accepted the change | rollback path on mutation failure, pagination bookkeeping after delete | integration/component test on the hook (simulate a failing mutation, assert rollback) | testing only the successful-mutation path |
| #6 | An oversized, malformed, or boundary-violating payload sent directly to an API route (bypassing the UI) is rejected and never persisted | "the UI form prevents bad input" does not mean the API route independently validates it | validation boundary (zod schemas) per route, exact limits, behavior on validation failure (partial write vs. clean rejection) | integration (POST directly to the route with adversarial payloads) | testing only through the UI; copying the validation logic itself into the test as the expected value |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|---|---|---|---|---|---|
| 1 | Critical-path coverage | Bootstrap the test runner and defend the two access-control risks first | #1, #4 | unit + integration | complete | `context/archive/2026-09-09-testing-critical-path-coverage/` |
| 2 | Core flow correctness | Defend the two must-have flows: the study loop and AI generation | #2, #3 | unit + integration | not started | — |
| 3 | Client-state & input hardening | Defend UI-state integrity after mutations and server-side input validation | #5, #6 | integration + component | not started | — |
| 4 | Quality-gates wiring | Add the test suite to CI alongside the existing lint + build gates | cross-cutting | gates | not started | — |

**Status vocabulary** (fixed — parser literals): `not started` →
`change opened` → `researched` → `planned` → `implementing` → `complete`.

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.

| Layer | Tool | Version | Notes |
|---|---|---|---|
| unit + integration | none yet — see Phase 1 | — | Vitest is the leading candidate; `@cloudflare/vitest-pool-workers` (confirmed current via Context7, checked 2026-09-09) runs tests inside the actual Workers runtime, matching this project's Cloudflare Workers deployment target |
| API mocking | none yet — see Phase 3 | — | mock only at the network edge (external AI provider HTTP call); never mock internal modules per AGENTS.md conventions |
| e2e | none yet | — | not currently justified by any top risk under cost × signal; revisit only if a risk emerges that unit/integration cannot catch |
| accessibility | none yet | — | out of scope — no top risk currently points at it |
| (optional) AI-native | none | n/a | explicitly out of scope per interview Q5 (no over-investment in test infrastructure, no look-and-feel testing) |

If a row reads "none yet — see Phase N", that gap is addressed by the
named rollout phase.

**Stack grounding tools (current session):**
- Docs: Context7 — confirmed `@cloudflare/vitest-pool-workers` exists as a custom Vitest pool for running tests inside the Workers runtime; checked: 2026-09-09
- Search: Exa.ai — available, not used this pass (no ambiguous/current-status question required it); checked: 2026-09-09
- Runtime/browser: Chrome browser automation (claude-in-chrome) — available; possible aid for manual verification, not adopted as a default test layer; checked: 2026-09-09
- Provider/platform: none available in this session (no GitHub/Cloudflare/Supabase MCP); checked: 2026-09-09

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required for §3 Phase N" means the gate is enforced once that rollout
phase lands; before that, the gate is `planned`.

| Gate | Where | Required? | Catches |
|---|---|---|---|
| lint + typecheck | local + CI | required (already wired) | syntactic / type drift |
| build | local + CI | required (already wired) | build-breaking regressions |
| unit + integration | local + CI | required after §3 Phase 1 | logic and access-control regressions |
| component tests on client hooks | local + CI | required after §3 Phase 3 | optimistic-update/rollback regressions |
| test suite in CI | CI on PR | required after §3 Phase 4 | regressions reaching `master` unverified |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase N."

### 6.1 Adding a unit test

- TBD — see §3 Phase 1 (test-runner bootstrap) for scheduling-calculation unit tests, and §3 Phase 2 for FSRS-specific patterns.

### 6.2 Adding an integration test for an API route

- TBD — see §3 Phase 1 for the cross-user-access and auth-gating pattern (Risks #1, #4).

### 6.3 Adding an e2e test

- Not planned — no top risk currently justifies e2e under cost × signal. Reconsider only if a future risk requires the full deployed shape (auth + cookie + handler crossing).

### 6.4 Adding a test for the AI generation pipeline

- TBD — see §3 Phase 2 for the provider-error/malformed-output pattern (Risk #3).

### 6.5 Adding a test for a client-state hook (optimistic update)

- TBD — see §3 Phase 3 for the rollback-on-failure pattern (Risk #5).

### 6.6 Per-rollout-phase notes

(Filled in as each phase lands.)

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **UI look-and-feel / visual regressions** — cosmetic, subjective, high false-positive rate for snapshot tests. Re-evaluate if a design system or public marketing surface is added. (Source: Phase 2 interview Q5.)
- **The test configuration itself** — the test framework's own tests already cover config correctness; asserting a config file's shape duplicates that. (Source: Phase 2 interview Q5.)
- **Elaborate test infrastructure ahead of need** — solo, after-hours project; infrastructure should follow a real suite, not precede it. (Source: Phase 2 interview Q5.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-09-09
- Stack versions last verified: 2026-09-09
- AI-native tool references last verified: 2026-09-09

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
