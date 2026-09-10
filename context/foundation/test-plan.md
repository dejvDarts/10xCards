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
3. **Risks are scenarios, not code locations.** This plan documents _what
   could fail_ and _why we believe it's likely_ — drawn from documents,
   interview, and codebase _signal_ (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/migrations/`
(21 commits/30d — sufficient signal).

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the _evidence that surfaced
this risk_ — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| #   | Risk (failure scenario)                                                                                                       | Impact | Likelihood | Source (evidence — not anchor)                                                                                                                                                                                                                                                                                                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A user can retrieve, modify, or delete another user's flashcards                                                              | High   | High       | interview Q1; PRD §Success Criteria guardrail (data never visible cross-user); hot-spot dir `src/pages/api` (10 commits/30d)                                                                                                                                                                                                                                        |
| 2   | FSRS review-session scheduling recalculates due-dates incorrectly (card stuck, skipped, or resurfaces in the same session)    | High   | High       | interview Q3; PRD FR-009; roadmap S-05; hot-spot dir `src/lib/services` (5 commits/30d)                                                                                                                                                                                                                                                                             |
| 3   | AI generation pipeline fails or returns malformed output without a clear error to the user                                    | High   | Medium     | PRD FR-003; PRD NFR "odczuwalny czas generowania"; tech-stack.md `has_ai: true`; hot-spot dir `src/lib/services` (5 commits/30d)                                                                                                                                                                                                                                    |
| 4   | Auth/session gating regresses on a protected route or API endpoint                                                            | High   | Medium     | hot-spot: `src/middleware.ts` (3 commits/30d — the actual `PROTECTED_ROUTES` gate) and `src/pages/api` (7 commits/30d — independently self-guarded, not covered by middleware); AGENTS.md protected-route rule; corrected via research.md (2026-09-09) — original citation of `src/components/auth`/`src/pages/auth` pointed at auth UI pages, not the gating logic |
| 5   | Optimistic-update rollback drift leaves the flashcard list showing stale or incorrect state after a failed edit/delete/create | Medium | High       | interview Q3 ("deck"); hot-spot dir `src/components/hooks` (11 commits/30d)                                                                                                                                                                                                                                                                                         |
| 6   | Untrusted input reaching an API route bypasses server-side validation (oversized text, malformed payload)                     | Medium | Medium     | AGENTS.md zod-validation rule; archived slice `reviewed-ai-flashcards` plan (100–10,000 char / 15-card limits); hot-spot dir `src/pages/api` (10 commits/30d)                                                                                                                                                                                                       |

**Impact × Likelihood rubric.** Score both axes on a coarse High / Medium /
Low scale so two readers agree on the same row. Do not invent finer
gradations — the goal is ordering, not false precision.

| Rating | Impact                                                          | Likelihood                                               |
| ------ | --------------------------------------------------------------- | -------------------------------------------------------- |
| High   | user loses access, data, or money; failure is publicly visible  | area changes weekly, or we have already been burned here |
| Medium | feature degrades, a workaround exists, only some users affected | touched occasionally, has been a source of bugs          |
| Low    | cosmetic, easily reverted, no data effect                       | stable code, rarely touched                              |

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

| Risk | What would prove protection                                                                                                                                                                                                                                                        | Must challenge                                                                                                                                                                                                                                                                                                        | Context `/10x-research` must ground                                                                                                                                                                           | Likely cheapest layer                                                                                                                                                 | Anti-pattern to avoid                                                                                                                                                            |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1   | A user, given a valid session, can never retrieve, modify, or delete another user's flashcard via any exposed route, even by guessing/crafting IDs                                                                                                                                 | "the endpoint checks the user is logged in" is not "the endpoint checks the user owns this row" — authentication ≠ authorization                                                                                                                                                                                      | ownership-check location (RLS policy vs. app-level WHERE clause vs. both), session/auth shape from middleware                                                                                                 | integration (two distinct authenticated users, assert cross-access rejected)                                                                                          | happy-path-only (never attempting cross-user access); mocking out RLS/Supabase entirely                                                                                          |
| #2   | After a rating, the card's due-date moves in the direction/rough magnitude the rating implies, and a rated card never resurfaces in the same session                                                                                                                               | a 200 response does not mean the schedule was recalculated correctly                                                                                                                                                                                                                                                  | due-state persistence and read-back, date/timezone handling, ordering guarantee across cards                                                                                                                  | unit (scheduling calc) + integration (rate → re-fetch due list → assert)                                                                                              | asserting against the implementation's own output (oracle problem); happy-path-only (only "Good", never "Again")                                                                 |
| #3   | When the AI provider errors, times out, or returns malformed output, the user sees a clear actionable error and never a silently empty/corrupted proposal list                                                                                                                     | "the AI call didn't throw" does not mean the returned proposals are well-formed                                                                                                                                                                                                                                       | external boundary (provider call), response parsing/validation, retry/timeout behavior, partial-failure state                                                                                                 | integration (mock the provider edge only)                                                                                                                             | over-mocking past the response-validation code; testing only successful generation                                                                                               |
| #4   | An unauthenticated request to a `PROTECTED_ROUTES` page is redirected to `/auth/signin`; an unauthenticated request to any flashcard API route (`/api/**`, not covered by `PROTECTED_ROUTES`) is rejected with a 401 JSON body; an authenticated user is never blocked from either | "the page-level redirect works" does not mean API routes are protected — `/api/**` never matches `PROTECTED_ROUTES` and relies entirely on each handler's own auth check; page and API gating are two independent mechanisms with different observable outcomes (302 redirect vs. 401 JSON), not one shared code path | which routes are covered by `PROTECTED_ROUTES` vs. which rely on per-handler guards, what middleware does with an absent/expired session, redirect target, and the exact status/body shape for API rejections | integration — two separate test groups: one exercising a `PROTECTED_ROUTES` page, one exercising a flashcard API route (no/expired session vs. valid session in each) | testing one protected route and assuming it generalizes to the other mechanism; asserting status code without checking redirect destination (pages) or response body shape (API) |
| #5   | After an edit, delete, or create — including a failed one — the list shown matches what is actually persisted, with no stuck stale card or phantom entry                                                                                                                           | "the UI updated immediately" does not mean the server accepted the change                                                                                                                                                                                                                                             | rollback path on mutation failure, pagination bookkeeping after delete                                                                                                                                        | integration/component test on the hook (simulate a failing mutation, assert rollback)                                                                                 | testing only the successful-mutation path                                                                                                                                        |
| #6   | An oversized, malformed, or boundary-violating payload sent directly to an API route (bypassing the UI) is rejected and never persisted                                                                                                                                            | "the UI form prevents bad input" does not mean the API route independently validates it                                                                                                                                                                                                                               | validation boundary (zod schemas) per route, exact limits, behavior on validation failure (partial write vs. clean rejection)                                                                                 | integration (POST directly to the route with adversarial payloads)                                                                                                    | testing only through the UI; copying the validation logic itself into the test as the expected value                                                                             |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| #   | Phase name                     | Goal (one line)                                                            | Risks covered | Test types              | Status      | Change folder                                                |
| --- | ------------------------------ | -------------------------------------------------------------------------- | ------------- | ----------------------- | ----------- | ------------------------------------------------------------ |
| 1   | Critical-path coverage         | Bootstrap the test runner and defend the two access-control risks first    | #1, #4        | unit + integration      | complete    | `context/archive/2026-09-09-testing-critical-path-coverage/` |
| 2   | Core flow correctness          | Defend the two must-have flows: the study loop and AI generation           | #2, #3        | unit + integration      | complete    | `context/archive/2026-09-09-core-flow-correctness/`          |
| 3   | Client-state & input hardening | Defend UI-state integrity after mutations and server-side input validation | #5, #6        | integration + component | not started | —                                                            |
| 4   | Quality-gates wiring           | Add the test suite to CI alongside the existing lint + build gates         | cross-cutting | gates                   | not started | —                                                            |

**Status vocabulary** (fixed — parser literals): `not started` →
`change opened` → `researched` → `planned` → `implementing` → `complete`.

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.

| Layer                | Tool                   | Version | Notes                                                                                                                                                                                                                              |
| -------------------- | ---------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unit + integration   | none yet — see Phase 1 | —       | Vitest is the leading candidate; `@cloudflare/vitest-pool-workers` (confirmed current via Context7, checked 2026-09-09) runs tests inside the actual Workers runtime, matching this project's Cloudflare Workers deployment target |
| API mocking          | none yet — see Phase 3 | —       | mock only at the network edge (external AI provider HTTP call); never mock internal modules per AGENTS.md conventions                                                                                                              |
| e2e                  | none yet               | —       | not currently justified by any top risk under cost × signal; revisit only if a risk emerges that unit/integration cannot catch                                                                                                     |
| accessibility        | none yet               | —       | out of scope — no top risk currently points at it                                                                                                                                                                                  |
| (optional) AI-native | none                   | n/a     | explicitly out of scope per interview Q5 (no over-investment in test infrastructure, no look-and-feel testing)                                                                                                                     |

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

| Gate                            | Where      | Required?                 | Catches                                  |
| ------------------------------- | ---------- | ------------------------- | ---------------------------------------- |
| lint + typecheck                | local + CI | required (already wired)  | syntactic / type drift                   |
| build                           | local + CI | required (already wired)  | build-breaking regressions               |
| unit + integration              | local + CI | required after §3 Phase 1 | logic and access-control regressions     |
| component tests on client hooks | local + CI | required after §3 Phase 3 | optimistic-update/rollback regressions   |
| test suite in CI                | CI on PR   | required after §3 Phase 4 | regressions reaching `master` unverified |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase N."

### 6.1 Adding a unit test

- **Where:** co-locate as `src/<module>.test.ts`. The `unit` project globs
  `src/**/*.test.ts` and runs with `npm test` (also `npm run test:watch`). No
  Docker, no network — `npm test` must stay green offline.
- **Config:** `vitest.config.ts` is built with `getViteConfig()` from
  `astro/config`, so `astro:*` virtual modules and the `@/*` alias resolve.
  `environment: "node"` (required by Astro v6 for anything touching Astro
  internals).
- **Import test globals explicitly** from `vitest` (`describe`, `it`, `expect`,
  `vi`) — `globals` is not enabled.
- **Mock at the module seam, not the network.** Example: `src/middleware.test.ts`
  does `vi.mock("@/lib/supabase")` so `createClient` returns a stub whose
  `auth.getUser()` is set per case, then calls the exported
  `onRequest(context, next)` with a hand-built context object and `vi.fn()`
  spies for `redirect` / `next`. This keeps page-gating logic (redirect vs.
  pass-through, `PROTECTED_ROUTES` prefix match, `locals.user` population)
  under test with zero external dependencies.
- **Lint:** the strict type-checked ESLint config applies to test files; a
  scoped override in `eslint.config.js` turns off the `@typescript-eslint/no-unsafe-*`
  family for `tests/**` and `src/**/*.test.*` (noise from loosely-typed test
  fixtures). Everything else (prettier, unused vars, void-expression) still bites.
- Scheduling-calculation / FSRS-specific unit tests arrive with rollout Phase 2.

### 6.2 Adding an integration test for an API route

Pattern shipped in rollout Phase 1 (archived at
`context/archive/2026-09-09-testing-critical-path-coverage/`), covering Risks
#1 and #4.

- **Where:** `tests/integration/<area>.<concern>.test.ts`. The `integration`
  project globs `tests/integration/**/*.test.ts`, runs with
  `npm run test:integration`, and needs a running local Supabase
  (`npx supabase start` — Docker). `fileParallelism` is off (one shared DB).
- **Call the handler directly.** Route handlers are plain `APIRoute` functions —
  `import { PATCH } from "@/pages/api/flashcards/[id]"` and invoke with a crafted
  context. No dev server, no HTTP.
- **Harness (`tests/integration/helpers/`, plus `setup.ts` / `global.ts`):**
  - `setup.ts` (setupFile) reads the local URL/keys from `npx supabase status`,
    asserts the handler-visible `SUPABASE_URL` (from `astro:env/server` /
    `.dev.vars`) matches the running stack, and health-checks `/auth/v1/health`
    — fails fast with a clear message if the stack is down. `global.ts`
    (globalSetup) sweeps stray `test+cpc-*` users after the run.
  - `users.ts` — `createTestUser()` / `deleteTestUser(id)` via the **service-role**
    `auth.admin` API (service-role is used _only_ for user management — the
    `flashcards` table grants privileges to `authenticated` only, so a
    service-role client cannot touch it via PostgREST). `signedInClient(user)`
    returns a session-scoped `supabase-js` client — RLS applies as that user.
  - `session.ts` — `cookieHeaderFor(user)` signs in through `@supabase/ssr`
    bound to an in-memory cookie jar and serializes it into one `Cookie:` header
    (chunked `sb-…-auth-token.N` cookies handled for free).
    `apiContext({ method, path, cookieHeader?, body?, params? })` builds the
    minimal `APIContext` the handlers actually read (`request`, `cookies`,
    `params`, `url`).
  - `db.ts` — `seedFlashcard(ownerClient, userId, overrides?)` inserts via the
    owner's session client (RLS permits own-row insert; FSRS columns fall back to
    DB defaults; set `status: "accepted"` to be visible to list/due/review).
    `resetFlashcards(clients[])` deletes each client's own rows — call in
    `afterEach`.
- **Lifecycle:** `beforeAll` creates user(s) + `signedInClient`s + cookie
  headers; `afterEach` calls `resetFlashcards`; `afterAll` calls
  `deleteTestUser` for each.
- **Assert the right shape:**
  - Cross-user access (Risk #1) is denied as **404**, never 403 — for `PATCH` /
    `DELETE` / `POST review`; a cross-user `GET` list simply omits the other
    user's rows.
  - API-route auth gating (Risk #4) is **401 `{"error":"Unauthorized"}`** with
    **no** `Location` header — never a redirect. `/api/**` is not in
    `PROTECTED_ROUTES`; each handler self-guards. Page gating (302 →
    `/auth/signin`) is the separate mechanism, unit-tested via
    `middleware.onRequest`.
  - Always include a **positive control** (the owner _can_ do the operation) so a
    blanket-deny bug can't pass.
- **Layer awareness:** a handler-level cross-user test cannot tell whether RLS or
  the app-level `.eq("user_id", …)` filter did the enforcing — removing the app
  filter still passes while RLS stands (see §6.6). `flashcards.rls.test.ts` pins
  the RLS layer directly using two session-scoped clients hitting the DB with no
  handler in the loop.

### 6.3 Adding an e2e test

- Not planned — no top risk currently justifies e2e under cost × signal. Reconsider only if a future risk requires the full deployed shape (auth + cookie + handler crossing).

### 6.4 Adding a test for the AI generation pipeline

Pattern shipped in rollout Phase 2 (`context/changes/core-flow-correctness/`),
covering Risk #3.

- **Where:** unit-test the service directly — `src/lib/services/<name>.test.ts`,
  `unit` project, `npm test`. `generateFlashcardProposals` is a pure function
  whose only side effect is one `fetch(OPENROUTER_URL, …)`, so DB-free unit tests
  give full branch coverage.
- **Mock the network edge only:** `vi.spyOn(globalThis, "fetch")` with
  `afterEach(() => vi.restoreAllMocks())`. Per test:
  `.mockResolvedValueOnce(new Response(body, { status }))` or
  `.mockRejectedValueOnce(new TypeError("fetch failed"))`. No `msw` (one
  hard-coded URL, one call site).
- **Control `astro:env/server`** for the missing-key branch:
  `const { mockEnv } = vi.hoisted(() => ({ mockEnv: { OPENROUTER_API_KEY:
"test-key" as string | undefined, OPENROUTER_MODEL: "test/model" } }));
vi.mock("astro:env/server", () => mockEnv);` then flip
  `mockEnv.OPENROUTER_API_KEY = undefined` in the one test that needs it.
- **Envelope shape:** the service expects
  `{"choices":[{"message":{"content":"<JSON string>"}}]}` where the string parses
  to `{"flashcards":[{"front":…,"back":…}]}` (1–15 items). One test per throw
  path (missing key, unreachable, non-OK status, non-JSON body, missing/empty
  content, content-not-JSON, wrong shape / empty / >15 / blank field), each
  asserting the exact `FlashcardGenerationError` message; plus a happy path
  asserting the parsed proposals and the `Authorization: Bearer …` header.
- **No timeout test:** there is no `AbortController` / application-level deadline
  in the generation path — a hung provider is bounded only by the Cloudflare
  Workers platform CPU limit. Record that as a file comment, not a skipped test.
- **Route smoke (integration):** one file hitting `POST /api/flashcards/generate`
  for wiring only — happy → 201 with `status:"pending"` rows, mocked failure →
  502 passthrough, bad input → 400, no session → 401. In the `integration`
  project **do not** `vi.mock("astro:env/server")` (it nulls `SUPABASE_*` and
  500s the DB insert). Mock `fetch` with a conditional implementation that
  intercepts only `openrouter.ai` and passes Supabase auth (`getUser`) calls
  through to the real local stack. `describe.skip` when `.dev.vars` has no
  `OPENROUTER_API_KEY`.

### 6.5 Adding a test for a client-state hook (optimistic update)

Pattern shipped in rollout Phase 3 (`context/changes/client-state-and-input-hardening/`),
covering Risk #5.

- **Where:** co-locate as `src/components/hooks/<name>.test.tsx` (note the
  `.tsx`). The `components` Vitest project globs `src/**/*.test.tsx`, runs under
  `happy-dom`, and is invoked with `npm run test:components`. No Docker, no DB —
  `fetch` is the only seam. `npm test` (the `unit` project) globs `*.test.ts`
  and never loads these, so the fast loop stays DOM-free.
- **Config:** the `components` project is **standalone** — it does _not_
  `extends: true`. `getViteConfig()` wires React for Astro's SSR island
  pipeline, which leaves `renderHook` with a null dispatcher ("invalid hook
  call"). The project carries its own `plugins: [react()]`
  (`@vitejs/plugin-react`, an explicit devDep), a `resolve.alias` for `@/`, and
  `dedupe: ["react", "react-dom"]`. Hook files only need the alias — they never
  import `astro:*`.
- **Lint:** `eslint.config.js` has a `src/**/*.test.tsx` override turning off
  `react-hooks/rules-of-hooks`, `react-hooks/exhaustive-deps`, and
  `react-compiler/react-compiler` — `renderHook(() => useThing(x))` calls a hook
  from an anonymous arrow that is neither a component nor a `use*` function.
- **Drive the hook:** `renderHook(() => useThing(initialData))` from
  `@testing-library/react`; every state-mutating call goes through
  `await act(async () => { await result.current.<fn>(...) })`. Assert on
  `result.current.*` _after_ the `act` resolves — the rollback hooks
  (`editFlashcard`, `deleteFlashcard`, `updateFlashcard`, `submitRating`) catch
  their own errors and do not rethrow. The one exception is
  `useFlashcardList.createFlashcard`, which **rethrows**: wrap it as
  `await expect(result.current.createFlashcard(...)).rejects.toThrow()` inside
  the `act` callback.
- **Inject failure at `fetch`:** `vi.spyOn(globalThis, "fetch")` per test,
  `afterEach(() => vi.restoreAllMocks())`. Either
  `.mockResolvedValue(new Response(JSON.stringify({ error: "Boom" }), { status: 500 }))`
  or `.mockRejectedValue(new TypeError("network down"))` — both reach the same
  `catch`. happy-dom supplies `location` (`http://localhost/`) so the hooks'
  relative-URL `fetch` calls resolve before the spy sees them.
- **Assert the rollback contract, not the wording:** the optimistic mutation is
  undone (list length / order / counters back to their pre-call values), the
  hook's `error` field is truthy, and the per-row "mutating" flag
  (`mutatingCardIds` / `updatingCardId`) is cleared.
- **Seeding a hook with no `initialData`:** `useFlashcardProposals` is populated
  by a mocked-success `generate("<100+ chars>")` whose `fetch` resolves a
  `GenerateFlashcardsResponse` (`{ flashcards: [...] }` — the route's response
  shape, **not** the OpenRouter `{ choices: [...] }` envelope), then the mock is
  swapped to a failure before exercising the rollback path.
- **A branch that needs a real network round-trip:** the `deleteFlashcard`
  success-pagination case (delete the last row of page > 1 → navigate back a
  page) only fires if React flushes the optimistic `setFlashcards` before the
  DELETE resolves. Stage it: kick the delete off in a _synchronous_ `act`
  (`act(() => { pending = result.current.deleteFlashcard(only); })`), then
  `await act(async () => { await pending; })`, and give the DELETE mock a
  `setTimeout(0)` macrotask delay. An instant mock resolves before the flush and
  the navigation never happens.

### 6.6 Per-rollout-phase notes

**Phase 1 — Critical-path coverage (Risks #1, #4)** — complete, archived
2026-09-09 at `context/archive/2026-09-09-testing-critical-path-coverage/`.

- **Runner:** Vitest 3 via `getViteConfig()`; `unit` + `integration` projects;
  scripts `test`, `test:watch`, `test:integration`. `@cloudflare/vitest-pool-workers`
  was **not** adopted — Node environment for now; the workerd pool stays deferred
  to Phase 4. A spike confirmed `astro:env/server` and `astro:middleware` resolve
  under `getViteConfig()` with no `resolve.alias` shim needed.
- **Env plumbing:** the route handlers read Supabase config from `.dev.vars` via
  `astro:env/server` at Vite-config load (not runtime `process.env`); the harness
  reads its own clients' URL/keys from `npx supabase status` and asserts the two
  agree.
- **Service-role limitation:** `supabase/migrations/20260903000000_create_flashcards.sql`
  grants `flashcards` privileges to `authenticated` only, so seed / reset /
  re-read run through session-scoped user clients, not a service-role client.
  Service-role is confined to `auth.admin` user management.
- **Known coverage limit (Risk #1):** the handler-level cross-user tests prove
  the outcome (cross-user access denied) but cannot detect removal of a
  handler's app-level `.eq("user_id", …)` filter while RLS stands — RLS masks it.
  `flashcards.rls.test.ts` pins the RLS layer directly; the app-level filter has
  no independent regression test and is accepted as belt-and-braces.
- **CI:** `test:integration` needs Docker + a running local Supabase and is
  **not** wired into `.github/workflows/ci.yml` — that is Phase 4.

**Phase 2 — Core flow correctness (Risks #2, #3)** — complete, archived
2026-09-09 at `context/archive/2026-09-09-core-flow-correctness/`.

- **FSRS scheduling (Risk #2):** all scheduling lives in
  `src/lib/services/reviews.ts`; `ts-fsrs@5.4.2` is deterministic for a fixed
  `(card, now, rating)` (fuzz off by default). `toFsrsCard` / `toRowUpdate` /
  `scheduler` were given `export` **for unit tests only** (visibility change, no
  behavior change; annotated with `// exported for unit tests`). Diverges from
  the private-internals sibling `flashcards.ts` — the comment marks intent.
- **Oracle-safe assertions** (structurally enforced by ts-fsrs, parameter-
  independent — safe across a `^5.4.2` minor bump): strict interval ordering
  `Again < Hard < Good < Easy`, `reps += 1` per review, `state 0 → 2`,
  `scheduled_days ≥ 1`, `due` strictly `> now`. **Never** assert an exact `due`,
  `stability`, or `difficulty` (parameter-dependent — the oracle problem).
- **`seedFlashcard` extension:** `tests/integration/helpers/db.ts`'s
  `seedFlashcard` gained optional `due` / `state` / `reps` / `stability` / `id`
  overrides (options object, additive — existing callers unaffected). Needed for
  the due-list ordering-tie test (control two rows to an identical past `due`).
- **Concurrency guard:** proven by a deterministic unit test that stubs the
  injected `supabase` argument and models the `.eq("updated_at", …)` clause —
  removing that clause from `recordReview` turns the "lost the race" test red.
  The `Promise.all` two-review integration test is a best-effort supplement
  (asserts a weaker invariant if the handlers don't interleave under Vitest).
- **Generated rows are `status:"pending"`** (`generate.ts`), so a card created
  via `/generate` is invisible to `getDueFlashcards` / `recordReview` (both
  filter `status = 'accepted'`) until promoted — cross-flow tests must bridge
  that seam explicitly. No such cross-flow test is in this phase.

**Phase 3 — Client-state & input hardening (Risks #5, #6)** — in progress,
`context/changes/client-state-and-input-hardening/`.

- **`components` Vitest project:** a third project alongside `unit` /
  `integration`, standalone (not `extends: true`), `happy-dom` env, glob
  `src/**/*.test.tsx`, script `test:components`. It carries its own
  `@vitejs/plugin-react` + `@/` alias + React dedupe because `getViteConfig()`'s
  Astro-SSR React wiring gives `renderHook` a null dispatcher. Devtime-only
  deps: `@testing-library/react`, `@testing-library/dom`, `happy-dom`,
  `@vitejs/plugin-react`. **Not** wired into CI — that is Phase 4.
- **Risk #5 scope is hook-only** (`renderHook`, no component render). Three
  component-level UI-buffer behaviours are **accepted as untested**: the edit
  form's local draft state, the delete-confirmation dialog gate, and the
  proposal list's in-place accept/reject buffering. They are thin wrappers over
  the hook contracts that _are_ covered; a render-test layer for them is not
  worth the happy-dom surface area at this stage.
- **Risk #6 sweep asserts behaviour, never zod wording:** each adversarial
  payload check is `status` (400, or the pinned 200/201) + an `error` property
  on the body + a `rowCount` / re-read proving nothing was persisted or mutated.
  The single allowed message-string assertion is the create over-max boundary
  (`/at most 1,?000/`). One representative payload per validation cell-class per
  write route, plus the universal cells (non-JSON body, malformed `[id]`).
- **Three pinned schema gaps** — asserted as _current behaviour_, each with an
  inline `// PINNED:` comment, not endorsed:
  1. `PATCH /api/flashcards/[id]` has no `.max` on `front` / `back` (create caps
     both at 1,000) — a 5,000-char `front` is accepted with 200.
  2. `POST /api/flashcards/generate` schema is a bare `z.object` with no
     `.strict()` — unknown keys pass silently (201).
  3. That same schema has no `.trim()` — a 150-space `sourceText` validates and
     is stored verbatim (201).
     **Follow-up:** tighten these three schemas (add `.max` to PATCH, `.strict()` +
     `.trim()` to generate) in a production-code change; the pinned tests flip to
     the new contract at that point. Not done here — a coverage phase ships no
     production behaviour change.
- **Shared provider mock:** `mockProvider` / `providerCalled` moved to
  `tests/integration/helpers/mock-provider.ts` (was file-local in
  `flashcards.generate.test.ts`) so the generate boundary-pass cells in the
  input-validation sweep reuse the conditional-`fetch` interceptor.

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
