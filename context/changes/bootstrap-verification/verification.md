---
bootstrapped_at: 2026-08-16T11:16:00Z
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: 10x-cards
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: 10x-cards
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
```

A solo learner shipping the 10xCards MVP in three weeks of after-hours work needs a battle-tested, agent-friendly starter that ships auth and a database out of the box so the short timeline goes toward the product, not plumbing. The 10x Astro Starter (Astro + React + TypeScript + Tailwind + Supabase + Cloudflare) is the recommended default for `(web, js)` and clears all four agent-friendly gates. Supabase covers accounts and login (FR-001/FR-002) with no extra wiring, while TypeScript and Zod boundaries give the AI flashcard generation (FR-003) explicit contracts to validate model output against. Deployment targets Cloudflare Pages — the starter's native platform — with GitHub Actions auto-deploying on merge, matching a solo shipping-first workflow. Payments and realtime are out of scope per the PRD non-goals, so those flags stay false; background jobs are not needed because generation runs inline. Bootstrapper confidence is first-class, so scaffolding should be smooth with only minor manual steps.

## Pre-scaffold verification

| Signal      | Value                                                         | Severity | Notes                                            |
| ----------- | ------------------------------------------------------------- | -------- | ------------------------------------------------ |
| npm package | not run                                                       | —        | cmd_template is `git clone`; no npm CLI to check |
| GitHub repo | przeprogramowani/10x-astro-starter last pushed 2026-05-17     | aged     | from card.docs_url (~3 months old, not stale)    |

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone
**Exit code**: 0
**Files moved**: 31536
**Conflicts (.scaffold siblings)**: none
**.gitignore handling**: moved silently (cwd had no pre-existing .gitignore)
**.bootstrap-scaffold cleanup**: deleted

Notes: the cloned `.git/` was deleted before the move-up so the upstream starter history does not leak. The scaffold contained no `context/` directory, so the cwd `context/` (prd.md, shape-notes.md, tech-stack.md, README.md) was untouched. The scaffold's `.github/workflows/ci.yml` merged alongside the existing `.github/` skills without collision. `npm install` completed with 773 packages added; several EBADENGINE warnings appeared (local Node v22.12.0 vs some packages requiring >=22.13.0 / >=24) — non-fatal, but consider upgrading Node.

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 1 CRITICAL, 13 HIGH, 7 MODERATE, 2 LOW
**Direct vs transitive**: 0/2/6/0 direct of total 1/13/7/2 (CRITICAL/HIGH/MODERATE/LOW)

#### CRITICAL findings

- **tar** (transitive) — advisory in the `tar` dependency chain; update the depending package once an upstream fix ships.

#### HIGH findings

- **astro** (direct) — meta-framework core; update to the latest patched Astro release.
- **miniflare** (direct) — Cloudflare Workers local runtime.
- **brace-expansion** (transitive)
- **devalue** (transitive)
- **fast-uri** (transitive)
- **js-yaml** (transitive)
- **nanoid** (transitive)
- **postcss** (transitive)
- **sharp** (transitive)
- **svgo** (transitive)
- **undici** (transitive)
- **vite** (transitive)
- **ws** (transitive)

#### MODERATE findings

- **@astrojs/language-server** (direct)
- **@cloudflare/vite-plugin** (direct)
- **supabase** (direct)
- **volar-service-yaml** (direct)
- **wrangler** (direct)
- **yaml-language-server** (direct)
- **yaml** (transitive)

#### LOW / INFO findings

- **@babel/core** (transitive)
- **esbuild** (transitive)

Run `npm audit` for the full advisory chains and `npm audit fix` to attempt automated remediation. Bootstrapper does not auto-patch — remediation is your decision per the project's risk tolerance.

## Hints recorded but not acted on

| Hint                    | Value              |
| ----------------------- | ------------------ |
| bootstrapper_confidence | first-class        |
| quality_override        | false              |
| path_taken              | standard           |
| self_check_answers      | null               |
| team_size               | solo               |
| deployment_target       | cloudflare-pages   |
| ci_provider             | github-actions     |
| ci_default_flow         | auto-deploy-on-merge |
| has_auth                | true               |
| has_payments            | false              |
| has_realtime            | false              |
| has_ai                  | true               |
| has_background_jobs     | false              |

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` (if you have not already) to start your own repo history.
- Review any `.scaffold` siblings the conflict policy created and decide which version of each file to keep. (This run created none.)
- Address audit findings per your project's risk tolerance — the full breakdown is in this log.
- Consider upgrading local Node to satisfy the starter's engine requirements (>=22.13.0).
- Copy `.env.example` to `.env` and fill in your Supabase / Cloudflare credentials.
