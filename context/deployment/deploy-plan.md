---
project: 10x-cards
plan_for: First production deployment — Cloudflare Workers + Pages
derived_from: context/foundation/infrastructure.md
repository: dejvDarts/10xCards
created_at: 2026-08-24
status: deployed — live on Cloudflare Workers (CI auto-deploy on master)
deployed_url: https://10x-cards.dawid-kwiatkowski.workers.dev
deployed_version_id: ec359bc0-042c-4cb2-82ba-4f58245d4db3
deployed_at: 2026-08-26
tech_stack:
  framework: Astro 6 (SSR, output "server") + React 19 islands
  adapter: "@astrojs/cloudflare ^13.5.0 (build verified green with Astro 6)"
  runtime: Cloudflare Workers (workerd), nodejs_compat enabled
  build_node: 22.14.0 (.nvmrc)
external_integrations:
  - Supabase (SSR auth via cookies + WebCrypto)
  - AI provider (flashcard generation — NOT yet implemented; fetch-based client required)
---

# Cloudflare Deployment Plan — 10x-cards

Read-only plan reviewed **before** any mutation hits Cloudflare. Nothing here is executed
until a human ticks the approval gate in Phase 0. The platform decision itself is already
made (`infrastructure.md`); this plan covers **how** we ship, not **where**.

## Progress legend

- `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked / needs human
- 🔒 = human-only (irreversible or secret-touching) — agent must stop and hand off
- 🌐 = touches an external integration (Supabase / AI provider) — verify after change
- ⚠️ = known edge case with extra support steps below

## Phase status overview

| Phase | Title | Owner | Status |
|---|---|---|---|
| **Pre** | **Prerequisites — CLI & Supabase config** | **human + agent** | **`[x]`** |
| 0 | Pre-flight & approval gate | human + agent | `[x]` |
| 1 | Local parity & config hardening | agent | `[x]` |
| 2 | Cloudflare account & scoped token 🔒 | human | `[x]` |
| 3 | First manual deploy (staging-style) 🔒 | human-approved | `[x]` |
| 4 | Runtime secrets & external integrations 🌐🔒 | human | `[~]` |
| 5 | Smoke tests & verification 🌐 | agent | `[x]` |
| 6 | CI/CD auto-deploy | agent + human | `[x]` |
| 7 | Rollback & operational runbook | agent | `[x]` |
| 8 | Post-deploy hardening & sign-off | human | `[x]` |

---

## Prerequisites — CLI & Supabase configuration

Everything here is **local/account setup** with no production impact (except creating a cloud
Supabase project, which is free). Complete this before the Phase 0 approval gate.

### P.1 — Toolchain (local machine)

- [x] **Node 22.14.0** via fnm (see Phase 1 / E10) — already aligned.
- [x] **Wrangler CLI** — already a dev dependency (`wrangler ^4.90.0`); invoke with
      `npx wrangler`. No global install needed. Verify: `npx wrangler --version`.
- [x] **Supabase CLI** — already a dev dependency (`supabase ^2.23.4`); invoke with
      `npx supabase`. No global install needed. Verify: `npx supabase --version`.
- [ ] **Docker Desktop** — required only for the *local* Supabase stack (`npx supabase start`).
      Not needed if you develop straight against a cloud Supabase project. Verify: `docker ps`.
- [ ] Optional: **GitHub CLI** (`gh`) for reading CI logs (`gh run view`) in Phase 6/7.

### P.2 — Cloudflare CLI configuration

- [x] Authenticate wrangler. **Done 2026-08-24: logged in via OAuth as
      `dawid.kwiatkowski@tueuropa.pl`, Account ID `f08f5aa156b7386f0122efae9ea58c3c`
      (`npx wrangler whoami` OK; scopes include workers/workers_kv/pages/workers_tail/
      secrets_store write).** Options for reference:
      - Interactive (local dev): `npx wrangler login` (opens browser OAuth). ← used.
      - Non-interactive (CI / scripted): export `CLOUDFLARE_API_TOKEN` (+ `CLOUDFLARE_ACCOUNT_ID`)
        — the **scoped** token created in Phase 2. 🔒
- [x] Verify without mutating: `npx wrangler whoami` → shows account + token scopes.
- [ ] ⚠️ The current local session is the broad-scope **OAuth login** — fine for local dev, but
      CI (Phase 6) must use a **separate scoped API token** (least privilege), not this account.
      Save `CLOUDFLARE_ACCOUNT_ID=f08f5aa156b7386f0122efae9ea58c3c` for the CI config.
- [ ] ⚠️ Do **not** commit tokens. Local scripted use goes through the shell env or `.dev.vars`;
      CI uses GitHub Secrets (Phase 6). → see Edge case E7.

### P.3 — Supabase configuration

The repo already has `supabase/config.toml` (`project_id = "10x-astro-starter"`). Two tracks —
do **P.3a** for day-to-day local dev and **P.3b** before shipping to Cloudflare.

`SUPABASE_URL` + `SUPABASE_KEY` are read via `astro:env/server` (see `src/lib/supabase.ts`).
⚠️ **`SUPABASE_KEY` must be the `anon` / publishable key, never the `service_role` / secret
key.** The anon key is safe for the SSR client because Row Level Security enforces access; the
service key bypasses RLS and must never reach client-reachable code. → see Edge case E11.

#### P.3a — Local Supabase (Docker)

- [ ] Start the local stack: `npx supabase start` (first run pulls images; needs Docker).
- [ ] Read local credentials: `npx supabase status` → copy **API URL**
      (`http://127.0.0.1:54321`) and **anon key**.
- [ ] Put them in `.dev.vars` (gitignored) for `wrangler dev`, and/or `.env` for `astro dev`:
      ```
      SUPABASE_URL=http://127.0.0.1:54321
      SUPABASE_KEY=<anon key from `supabase status`>
      ```
- [ ] Open local Studio (`http://127.0.0.1:54323`) to inspect tables/auth.
- [ ] Stop when done: `npx supabase stop`.

#### P.3b — Cloud Supabase (production backend)

- [ ] 🔒 Create a project at https://supabase.com (free tier is fine for MVP). Pick a region
      close to your users.
- [ ] 🔒 From **Project Settings → API**, copy: **Project URL** → `SUPABASE_URL`, and the
      **anon / publishable** key → `SUPABASE_KEY`. (These become Workers Secrets in Phase 4 and
      GitHub Secrets in Phase 6 — not committed.)
- [ ] Link the CLI to the cloud project (needed to push migrations):
      `npx supabase login` then `npx supabase link --project-ref <project-ref>`.
- [ ] Apply schema to the cloud DB: `npx supabase db push` (runs `supabase/migrations/*`).
      ⚠️ There are **no migrations yet** — add them as the schema grows, named
      `YYYYMMDDHHmmss_short_description.sql`, and **enable RLS on every new table** with
      per-operation, per-role policies (project hard rule). → see Edge case E11.
- [ ] ⚠️🌐 **Auth redirect URLs.** `config.toml` `site_url` is local
      (`http://127.0.0.1:3000`) and does **not** apply to the cloud project. In the Supabase
      dashboard (**Authentication → URL Configuration**) set **Site URL** and **Additional
      Redirect URLs** to the deployed Cloudflare origin (e.g. `https://10x-cards.<acct>.workers.dev`
      and any custom domain). Otherwise the sign-up **email confirmation** link
      (`signup.ts` → `/auth/confirm-email`) points at localhost and breaks in production.
      → see Edge case E12.
- [ ] ⚠️ Confirm email confirmations match the code path. `signup.ts` redirects to
      `/auth/confirm-email`, i.e. the app expects **email confirmation enabled**. Keep
      Authentication → Providers → Email → "Confirm email" **on** in the cloud project (or
      change the flow deliberately). → see Edge case E12.

### P.4 — Prerequisite verification

- [x] `npx wrangler whoami` succeeds (Cloudflare auth OK). **Re-verified 2026-08-25.**
- [x] `npx supabase status` (local) **or** dashboard keys in hand (cloud) — `SUPABASE_URL` +
      anon `SUPABASE_KEY` available. **2026-08-25: cloud keys in `.dev.vars` (P.3b track).**
- [x] `.dev.vars` present locally; `npx wrangler dev` boots and `/auth/signin` renders with auth
      enabled (no "Supabase is not configured" notice from `config-status.ts`).
      **Verified 2026-08-25 on workerd (port 8788): `/` → 200, `/auth/signin` → 200 (no
      missing-config banner), `/dashboard` → 302 → `/auth/signin` (middleware guard OK).
      SUPABASE_URL/SUPABASE_KEY bindings loaded from `.dev.vars`.**

---

## Phase 0 — Pre-flight & approval gate

- [x] Confirm this plan matches the current state of `infrastructure.md` (recommendation:
      Cloudflare Workers + Pages, runner-up Vercel). **Verified 2026-08-24 — aligned.**
- [x] Confirm baseline is green: `npm ci` → `npx astro sync` → `npm run build` all succeed
      locally. **(Verified 2026-08-24: build completes on Node 22.14.0, adapter
      `@astrojs/cloudflare` v13.5 is compatible with Astro 6 — the "v14" note in
      `infrastructure.md` is not a blocker.)** **Re-verified 2026-08-25: `npm ci` →
      `npx astro sync` → `npm run build` all green on Node 22.14.0; wrangler OAuth session
      still valid (`whoami` OK).**
- [x] ⚠️ `npm run lint` baseline. **Verified 2026-08-24: build is green but local lint reports
      ~1022 `prettier/prettier: Delete ⏎` errors — a Windows CRLF artifact, NOT a code defect.**
      Root cause: `git core.autocrlf=true` + no `.gitattributes`, so the working tree is CRLF
      while `.prettierrc.json` defaults `endOfLine: lf`. CI runs on Ubuntu (LF) so **lint passes
      in CI** and the deploy path is unaffected. → see Edge case E13 for the optional local fix.
- [x] Human reads Phases 2–4 and acknowledges the 🔒 items are manual. **Acknowledged 2026-08-24.**
- [x] **APPROVAL GATE 🔒 — human explicitly approves proceeding past this line.**
      **Approved 2026-08-24: proceed to Phase 1 (local hardening) and prep Phase 2/3.**
      No `wrangler deploy`, no `secret put`, no token creation before this box is ticked.

---

## Phase 1 — Local parity & config hardening (agent, no prod impact)

- [x] Bump local Node so `EBADENGINE` clears. **Resolved 2026-08-24: aligned DOWN to the pinned
      22.14.0.** No repo files changed (`.nvmrc`=22.14.0, `ci.yml`=Node 22 both untouched).
      Installed `fnm` (winget `Schniz.fnm`) and wired `fnm env --use-on-cd` into the PowerShell
      profile so every shell auto-switches to the `.nvmrc` version on `cd`. Verified: fresh
      shell in project → `node -v` = **v22.14.0**, and `npm run build` is green on it. Node
      24.19.0 remains available globally for other projects. → see Edge case E10.
- [x] Create local `.dev.vars` (gitignored — confirmed in `.gitignore`) for `wrangler dev`:
      ```
      SUPABASE_URL=...
      SUPABASE_KEY=...
      ```
      **2026-08-24: placeholder `.dev.vars` created (empty values) so `wrangler dev` boots.
      2026-08-25: filled with real CLOUD Supabase creds (P.3b) — project URL
      `https://cjamijurudvnpuoopgjc.supabase.co` + `sb_publishable_…` key (anon/publishable,
      RLS-safe — NOT `service_role`). Verified auth enabled locally (P.4).**
      Do **not** create/commit `.env`; secrets are read via `astro:env/server`.
- [x] ⚠️ Decide the **Worker name** in `wrangler.jsonc`. **Done 2026-08-24: renamed
      `10x-astro-starter` → `10x-cards`** (matches `infrastructure.md` project). This sets the
      `10x-cards.<account>.workers.dev` subdomain. → see Edge case E1.
- [x] ⚠️ Verify runtime bindings the adapter auto-enables. **Checked 2026-08-24: the app does
      NOT use `Astro.session` (auth is Supabase cookies via `middleware.ts`), so the
      auto-enabled `SESSION` KV binding is unused — no KV namespace needed for MVP. The `IMAGES`
      binding is platform-provided (no setup).** Revisit only if `Astro.session` is adopted.
      → see Edge case E2.
- [ ] Minor (optional, deferred): silence the sitemap warning by setting `site` in
      `astro.config.mjs`. Deferred until the final prod URL/custom domain is known; not a
      deploy blocker.
- [x] Local end-to-end dry run against the real runtime:
      `npm run build && npx wrangler dev` → exercise `/`, `/auth/signin`, `/dashboard`.
      **Verified 2026-08-24 on workerd (port 8788): `/`, `/auth/signin`, `/auth/signup` → 200;
      `/dashboard` → 302 → `/auth/signin` (middleware guard works). No workerd runtime errors —
      Node-vs-workerd gap risk (E3) not observed for current deps.** → see Edge case E3.
- [x] Run `npm run lint` and `npm run build` one more time; both must be green.
      **2026-08-24: build green. Lint = local CRLF noise only (E13); clean in CI.**

---

## Phase 2 — Cloudflare account & scoped API token 🔒 (human-only)

- [x] 🔒 Create/verify a Cloudflare account (free tier is fine for MVP — $0, 100k req/day).
- [x] 🔒 Capture `CLOUDFLARE_ACCOUNT_ID` (dashboard → Workers & Pages → Account ID).
      `f08f5aa156b7386f0122efae9ea58c3c`.
- [x] 🔒 Create a **scoped** API token (least privilege — do **not** use the Global API Key):
      - Permission: `Account → Workers Scripts → Edit`
      - Permission: `Account → Workers KV Storage → Edit` (only if E2/KV is used)
      - Zone/DNS/Billing: **none**.
      Store as the GitHub secret `CLOUDFLARE_API_TOKEN` (Phase 6), never in the repo or chat.
- [x] 🔒 Local auth choice: either `npx wrangler login` (interactive OAuth) **or** export
      `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` in the shell for non-interactive use.
      Used `wrangler login` (OAuth).
- [x] Verify auth without mutating anything: `npx wrangler whoami`. Confirmed.

---

## Phase 3 — First manual deploy 🔒 (human-approved, agent may draft commands)

> Deploy is intentionally **manual first**, then automated in Phase 6 once proven.

- [x] Build fresh: `npm run build`.
- [x] 🔒 Deploy: `npx wrangler deploy`. (Starter already has `main`, `assets`, and
      `compatibility_flags: ["nodejs_compat"]` in `wrangler.jsonc` — no adapter swap needed.)
- [x] Record the returned `*.workers.dev` preview/prod URL and the `Version ID`
      (needed for rollback in Phase 7).
      - URL: `https://10x-cards.dawid-kwiatkowski.workers.dev`
      - Version ID: `438a09fd-d827-418a-9f56-40e7cef16752` (deployed 2026-08-25)
      - Note: required a one-time `workers.dev` subdomain registration via the dashboard onboarding.
- [x] ⚠️ At this point the app is live but Supabase secrets are **not yet set** — auth will be
      cleanly disabled (`createClient` returns `null`, `config-status.ts` surfaces the notice).
      This is expected; secrets come next in Phase 4.

---

## Phase 4 — Runtime secrets & external integrations 🌐🔒 (human-only)

- [x] 🔒🌐 Set Supabase secrets as **Workers Secrets** (encrypted, not in `wrangler.jsonc`).
      ⚠️ `SUPABASE_KEY` = the **anon / publishable** key, never `service_role` (→ E11):
      ```
      npx wrangler secret put SUPABASE_URL
      npx wrangler secret put SUPABASE_KEY
      ```
      Done 2026-08-25 (anon/publishable key used).
- [ ] 🔒🌐 When the AI flashcard integration lands, add its key the same way
      (e.g. `npx wrangler secret put OPENROUTER_API_KEY`) **and** declare it in
      `astro.config.mjs` `env.schema` as a `server`/`secret` field so `astro:env/server`
      can read it. → see Edge case E4.
- [ ] 🔒 If E2/KV sessions are used: create + bind the namespace
      `npx wrangler kv namespace create SESSION` then add the binding to `wrangler.jsonc`,
      and re-deploy.
- [x] Redeploy so secrets are picked up: `npx wrangler deploy`.
      Version ID `0af3ff4f-1f71-4123-895e-d0ffdf9cbe2e` (2026-08-25).
- [x] Confirm the secret **names** (not values) are present: `npx wrangler secret list`.
      Confirmed: `SUPABASE_URL`, `SUPABASE_KEY`.

---

## Phase 5 — Smoke tests & verification 🌐 (agent, read-only against prod)

- [x] Open the prod URL; confirm `/` renders (SSR) with no 5xx. Verified (200, SSR).
- [x] 🌐 Supabase auth happy path: sign up → confirm-email flow → sign in → `/dashboard`
      loads (protected route via `middleware.ts`) → sign out. ⚠️ The confirmation email link
      must point at the live origin, not localhost (→ E12).
      Verified manually 2026-08-26: account created, sign-in works, dashboard loads.
      Protected-route guard confirmed via agent (`/dashboard` → 302 `/auth/signin`).
- [x] ⚠️🌐 Auth session/cookie check: log in, refresh several times / open a second tab.
      Watch for spurious logouts — the isolate token-refresh race called out in the risk
      register. → see Edge case E5. No spurious logouts observed.
- [x] Stream logs live during the smoke test: `npx wrangler tail` (add `| jq` to filter).
      Watch specifically for `Error: ... is not supported in the Workers runtime` (Node API
      gaps) and `Worker exceeded CPU time limit`. No runtime/CPU errors seen.
- [x] ⚠️ CPU budget check: note render latency of the heaviest SSR page. Free tier caps CPU
      at ~10 ms/request. If `wrangler tail` shows `CPU exceeded`, plan the $5/mo Paid move.
      → see Edge case E6. Well within budget (cpuTime ~1 ms observed).
- [x] Record results (URL, version ID, any warnings) back into this file's overview table.
      URL `https://10x-cards.dawid-kwiatkowski.workers.dev`, Version `0af3ff4f-1f71-4123-895e-d0ffdf9cbe2e`.
      Note: `/api/auth/*` endpoints parse form-encoded bodies; a request with a wrong
      Content-Type (e.g. JSON) yields an unhandled 500 — cosmetic, real form flow works.

---

## Phase 6 — CI/CD auto-deploy (agent drafts, human approves secrets)

Current `.github/workflows/ci.yml` runs `npm ci → astro sync → lint → build` on push/PR to
`master` but does **not** deploy. Add a deploy job gated on `master` push only.

- [x] 🔒 Add GitHub repo secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and
      (already required by the build) `SUPABASE_URL`, `SUPABASE_KEY`.
      All four set via `gh secret set` on 2026-08-26.
- [x] Add a `deploy` job that runs only after `ci` succeeds and only on `push` to `master`,
      using the official action. Draft:
      ```yaml
      deploy:
        needs: ci
        if: github.event_name == 'push' && github.ref == 'refs/heads/master'
        runs-on: ubuntu-latest
        steps:
          - uses: actions/checkout@v4
          - uses: actions/setup-node@v4
            with: { node-version: 22, cache: npm }
          - run: npm ci
          - run: npm run build
            env:
              SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
              SUPABASE_KEY: ${{ secrets.SUPABASE_KEY }}
          - uses: cloudflare/wrangler-action@v4
            with:
              apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
              accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
              command: deploy
              # Optional: sync Worker secrets from CI in one shot
              # secrets: |
              #   SUPABASE_URL
              #   SUPABASE_KEY
              # env:
              #   SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
              #   SUPABASE_KEY: ${{ secrets.SUPABASE_KEY }}
      ```
- [x] ⚠️🌐 Verify the GitHub Secrets → `wrangler deploy` mapping actually works with a
      throwaway commit and a smoke test (the "secrets not wired" risk in the register).
      → see Edge case E7. **Verified 2026-08-26**: push to `master` ran `ci` + `deploy`
      (run 32905055249, both green); CI published version `ec359bc0-042c-4cb2-82ba-4f58245d4db3`.
- [ ] ⚠️ Fork-PR preview limitation: PRs from forks cannot read repo secrets, so their
      preview builds have no Supabase/AI keys. Keep deploy on `push`-to-`master` only, or use
      trusted branches. → see Edge case E8.

---

## Phase 7 — Rollback & operational runbook (agent)

- [x] Document the rollback path (verify commands exist for the installed wrangler 4.90):
      - List versions: `npx wrangler versions list`
      - Roll back: `npx wrangler rollback [VERSION_ID]`
      **Verified 2026-08-26** on wrangler 4.90: both commands present; `rollback` supports
      `-m/--message` (reason) and `-y/--yes` (non-interactive). Current live version:
      `ec359bc0-042c-4cb2-82ba-4f58245d4db3`.

      **Runbook — rollback a bad prod deploy:**
      1. `npx wrangler versions list` — find the last-known-good `Version ID`.
      2. `npx wrangler rollback <GOOD_VERSION_ID> -m "reason"` (add `-y` to skip the prompt).
      3. Confirm: `npx wrangler deployments list` shows the rolled-back version at 100%.
      4. Re-run the Phase 5 smoke checks against the prod URL.
      Note: CI auto-deploys `master`, so **also revert the offending commit** (`git revert`),
      otherwise the next push re-deploys the broken version.
- [x] ⚠️ **Code rollback does NOT revert Supabase migrations.** DB migrations in
      `supabase/migrations/` must be versioned and rolled back separately and deliberately.
      → see Edge case E9.
- [x] Document the read-only agent-safe commands (no approval needed):
      `wrangler tail`, `wrangler versions list`, `wrangler deployments list`,
      `wrangler secret list`, `wrangler whoami`, dry-run/`npm run build`,
      `gh run list` / `gh run view` for CI logs.
- [x] Document human-only actions: production publish approval, primary-key rotation
      (Supabase service key, AI keys), Cloudflare API-token rotation, KV/DB destructive ops
      (`kv namespace delete`, `wrangler delete`, dropping Supabase tables), and running
      `wrangler rollback` against prod.

---

## Phase 8 — Post-deploy hardening & sign-off (human)

- [x] 🔒 Confirm the API token is scoped (no DNS/Billing), and secrets live only in
      Workers Secrets + GitHub Secrets (never committed).
      **Confirmed by human 2026-08-26**: CI `CLOUDFLARE_API_TOKEN` reduced to least-privilege
      scope; CI re-run still deployed successfully. Secrets only in Workers + GitHub Secrets.
- [x] Confirm `observability.enabled: true` (already set in `wrangler.jsonc`) surfaces logs
      in the dashboard. Verified present in `wrangler.jsonc` and logs seen via `wrangler tail`.
- [x] Update `infrastructure.md` / this file's frontmatter `status` → `deployed` with the
      live URL and version ID. Done: `status: deployed`, URL + version ID in frontmatter.
- [x] 🔒 Final human sign-off. **Signed off 2026-08-26** — least-privilege token confirmed,
      CI auto-deploy verified, new version live on Cloudflare.

---

## Edge cases & extra support steps

**E1 — Worker name / subdomain collision.** `wrangler.jsonc.name` is the starter default
`10x-astro-starter`; it becomes `<name>.<account>.workers.dev`. If the name is taken or you
rename after launch, existing URLs break. Fix: choose the final name in Phase 1 before first
deploy; if a custom domain is wanted later, add a route/`custom_domain` — out of MVP scope.

**E2 — Auto-enabled IMAGES / SESSION bindings.** The adapter logs enabling a Cloudflare
`IMAGES` binding and a `SESSION` KV binding at build. `IMAGES` is platform-provided and needs
no setup. `SESSION` KV, however, needs a real KV namespace bound in `wrangler.jsonc` if Astro
Sessions are actually used, otherwise session writes silently no-op/error in prod. If sessions
are NOT used, ignore it. Support step: `npx wrangler kv namespace create SESSION`, then bind
and redeploy. Confirm whether the app relies on `Astro.session` before shipping.

**E3 — workerd ≠ Node.js.** `nodejs_compat` is already on. Any dependency that imports
`node:*` APIs not covered by compat will fail at build (`Could not resolve "..."`) or at
runtime. Support step: prefer `fetch`-based clients; run `npx wrangler dev` (real workerd)
before integrating anything new; if a package needs raw Node APIs, find a fetch-based
alternative rather than polyfilling under time pressure.

**E4 — AI provider (fetch-only).** Flashcard generation is not implemented yet. When added,
use an HTTP/`fetch` client (OpenAI/Anthropic/OpenRouter all expose plain REST) — avoid SDKs
that assume a Node runtime. Declare the key in `astro.config.mjs` `env.schema` (server/secret)
and set it via `wrangler secret put`. Validate on `wrangler dev` before wiring into a page.

**E5 — Supabase token-refresh race across isolates.** Concurrent isolates refreshing the same
session can cause rare, hard-to-reproduce logouts. Support step: keep all session handling in
`middleware.ts` via `Astro.cookies` (as it is today), rely on Supabase's short refresh window,
and add an explicit login/refresh test to the smoke suite. Reproduce with multi-tab refresh.

**E6 — 10 ms CPU free-tier cap.** Heavy React 19 SSR can exceed the free-tier CPU budget,
producing intermittent `CPU exceeded`. Support step: measure CPU/request early via
`wrangler tail`; budget $5/mo for the Paid plan; reduce heavy server-side rendering / move
work client-side where possible. This is a known, accepted risk in the register.

**E7 — Secrets not wired in CI.** The single most likely deploy-day failure. Support step:
after adding GitHub secrets, push a trivial commit and confirm the `deploy` job's build has
`SUPABASE_*` and that `wrangler-action` authenticates (`command: whoami` as a `preCommand`
gives a fast auth check). Follow with a live smoke test.

**E8 — Fork-PR previews lack secrets.** Preview deploys for PRs from forks can't access repo
secrets, so server features (auth) won't work there. Support step: restrict auto-deploy to
`push`→`master`; for sensitive previews use trusted branches and optionally Cloudflare Access.

**E9 — Rollback ≠ DB rollback.** `wrangler rollback` reverts code in seconds but leaves
Supabase schema where the failed release left it. Support step: never couple a risky code
release with an irreversible migration; keep migrations forward-compatible; roll DB back
manually and deliberately, separate from the code rollback.

**E10 — Local/CI Node version divergence.** *Resolved 2026-08-24.* Local had drifted to Node
24.19.0 (installed system-wide via winget) while `.nvmrc`/CI pin Node 22 — and no version
manager was present, so `nvm use` was not possible. Fix applied: installed **fnm** (lightweight,
reads `.nvmrc`) and added `fnm env --use-on-cd` to the PowerShell profile, so all three
(`.nvmrc`, `ci.yml`, local shell) now resolve to **22.14.0** without touching repo files. Node
24 stays available globally. Ongoing rule: keep the runtime aligned across `.nvmrc`,
`.github/workflows/ci.yml`, and the local shell — never let them silently diverge. If Node is
ever reinstalled directly (not via fnm), re-check with `node -v` inside the project dir.

**E11 — Wrong Supabase key / missing RLS.** `SUPABASE_KEY` must be the **anon / publishable**
key. Using the `service_role` key would bypass Row Level Security from an internet-reachable
Worker — a critical data-exposure bug. Support step: copy the key labelled *anon/publishable*
from Project Settings → API; treat `service_role` as human-only, backend-batch-only, and never
put it in Workers Secrets that the request path can read. Every new table must have RLS enabled
with granular per-operation, per-role policies before it ships.

**E12 — Prod auth redirect / email-confirmation mismatch.** The sign-up flow (`signup.ts` →
`/auth/confirm-email`) relies on Supabase email confirmation, and confirmation links use the
project's **Site URL / Additional Redirect URLs**. `config.toml`'s local `site_url` does **not**
configure the cloud project, so out of the box a prod confirmation email links to localhost and
the user can't complete sign-up. Support step: in the cloud dashboard set Site URL + Additional
Redirect URLs to the live Cloudflare origin (and custom domain), keep "Confirm email" enabled
to match the code, and smoke-test the full sign-up → email → confirm → sign-in loop in Phase 5.

**E13 — Windows CRLF vs Prettier `lf` (local-only lint noise).** `git core.autocrlf=true` with
no `.gitattributes` gives a CRLF working tree on Windows, so `npm run lint` reports ~1022
`Delete ⏎` errors locally while CI (Ubuntu/LF) passes. Build and deploy are unaffected. Optional
fixes (repo-scope, beyond deploy — do only if the noisy local lint bothers you): (a) add a
`.gitattributes` with `* text=auto eol=lf` and renormalize (`git add --renormalize .`), the
durable team fix; or (b) set `"endOfLine": "auto"` in `.prettierrc.json`. Do **not** mass-run
`prettier --write` under autocrlf — it fights the checkout filter and produces a giant diff.

---

## Traceability to the Risk Register (`infrastructure.md`)

| Risk (infrastructure.md) | Covered by |
|---|---|
| SSR exceeds 10 ms CPU | Phase 5 CPU check · E6 |
| npm dep assumes Node API | Phase 1 `wrangler dev` · E3 · E4 |
| Supabase token-refresh race | Phase 5 session check · E5 |
| Hard edge debugging | Phase 5 `wrangler tail` · E3 |
| Secrets mis-wired in CI | Phase 6 · E7 |
| Vendor lock-in (CF bindings) | E2 (introduce KV/R2/D1 only on real need) |
