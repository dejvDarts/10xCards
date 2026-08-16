---
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
---

## Why this stack

A solo learner shipping the 10xCards MVP in three weeks of after-hours work needs a battle-tested, agent-friendly starter that ships auth and a database out of the box so the short timeline goes toward the product, not plumbing. The 10x Astro Starter (Astro + React + TypeScript + Tailwind + Supabase + Cloudflare) is the recommended default for `(web, js)` and clears all four agent-friendly gates. Supabase covers accounts and login (FR-001/FR-002) with no extra wiring, while TypeScript and Zod boundaries give the AI flashcard generation (FR-003) explicit contracts to validate model output against. Deployment targets Cloudflare Pages — the starter's native platform — with GitHub Actions auto-deploying on merge, matching a solo shipping-first workflow. Payments and realtime are out of scope per the PRD non-goals, so those flags stay false; background jobs are not needed because generation runs inline. Bootstrapper confidence is first-class, so scaffolding should be smooth with only minor manual steps.
