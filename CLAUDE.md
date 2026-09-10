# Rules for AI

This file provides guidance to AI Agent when working with code in this repository.

## Commands

- `npm run dev` — start dev server (Cloudflare workerd runtime)
- `npm run build` — production build (SSR via `@astrojs/cloudflare`)
- `npm run preview` — preview production build
- `npm run lint` — ESLint with type-checked rules
- `npm run lint:fix` — auto-fix lint issues
- `npm run format` — Prettier (includes prettier-plugin-astro + prettier-plugin-tailwindcss)
- `npm run typecheck` — `tsc --noEmit` (run `npx astro sync` first if `astro:*` types are stale)
- `npm test` — Vitest `unit` project (fast, no Docker)
- `npm run test:components` — Vitest `components` project (React hook tests, happy-dom)
- `npm run test:integration` — Vitest `integration` project (needs `npx supabase start`)

## Automated checks

Three layers, cheapest first.

### Per-edit agent hooks

`.claude/settings.json` → `.claude/hooks/*.sh`, `PostToolUse` on `Write|Edit`. Each parses the edited file path from the hook stdin JSON with `node` (no `jq` in the Windows shell) and exits **2** on failure so the error is fed back to the agent.

- **`lint-file.sh`** — `eslint --fix` on the edited file only (`.ts/.tsx/.astro/.js/.jsx/.mjs/.cjs`).
- **`typecheck.sh`** — project-wide `tsc --noEmit` when a `.ts/.tsx/.astro` file changed. If it feels slow, delete its block from `.claude/settings.json`; pre-commit + CI still typecheck.
- **`related-tests.sh`** — `vitest related <file> --run` scoped to the edited file: `unit` + `components` always, plus the `integration` project when the file is under `src/pages/api/**` or is `src/middleware.ts` (Risk #1 / #4 in `context/foundation/test-plan.md`) **and** local Supabase answers a health check. Exports `AI_AGENT=1` (no-op until Vitest ≥ 4.1).

### Pre-commit

husky + lint-staged. Run `npm install` once so the `prepare` script wires `core.hooksPath`.

- lint-staged: `*.{ts,tsx}` → `eslint --fix` + `vitest related --run` (`unit`, `components`); `*.astro` → `eslint --fix`; `*.{json,css,md}` → `prettier --write`
- then project-wide `tsc --noEmit` when any `.ts/.tsx/.astro` file is staged

`.prettierignore` keeps the `@przeprogramowani/10x-cli`-generated files (`.github/.10x-cli-manifest.json`, `.github/copilot-instructions.md`) byte-identical to the tool output.

## Architecture

**Astro 6 SSR app** with React 19 islands, Tailwind 4, Supabase auth, and shadcn/ui components. Deployed to Cloudflare Workers.

### Rendering mode

Full server-side rendering (`output: "server"` in astro.config.mjs). All pages are server-rendered by default. API routes must export `const prerender = false`.

### Auth flow

- `src/lib/supabase.ts` — creates a Supabase SSR client using `@supabase/ssr` with cookie-based sessions. Uses `astro:env/server` for `SUPABASE_URL` and `SUPABASE_KEY` (server-only secrets declared in astro.config.mjs `env.schema`).
- `src/middleware.ts` — runs on every request, resolves the current user, attaches to `context.locals.user`. Redirects unauthenticated users away from routes listed in `PROTECTED_ROUTES`.
- API endpoints: `src/pages/api/auth/{signin,signup,signout}.ts`
- Auth pages: `src/pages/auth/{signin,signup,confirm-email}.astro`
- Protected page example: `src/pages/dashboard.astro`

### Key conventions

- **Path alias**: `@/*` maps to `./src/*` (tsconfig paths).
- **Astro components** for static content/layout; **React components** only when interactivity is needed.
- **Tailwind class merging**: use the `cn()` helper from `@/lib/utils` (clsx + tailwind-merge) for conditional/merged class names. Do not concatenate class strings manually.
- **shadcn/ui**: components live in `src/components/ui/`, "new-york" style variant. Install new ones with `npx shadcn@latest add [name]`.
- **API routes**: use uppercase `GET`, `POST` exports; validate input with zod.
- **Supabase migrations**: `supabase/migrations/` using naming format `YYYYMMDDHHmmss_short_description.sql`. Always enable RLS on new tables with granular per-operation, per-role policies.
- **React**: no Next.js directives ("use client" etc.). Extract hooks to `src/components/hooks/`.
- **Services/helpers** go in `src/lib/` (or `src/lib/services/` for extracted business logic).
- **Shared types** (entities, DTOs) go in `src/types.ts`.

### Environment

- Node.js v22.14.0 (see `.nvmrc`)
- Env vars: `SUPABASE_URL`, `SUPABASE_KEY` (copy `.env.example` to `.env` for Node, or `.dev.vars` for Cloudflare local dev)
- Local Supabase: `npx supabase start` (requires Docker)
- Cloudflare local dev: secrets go in `.dev.vars` (gitignored)
- Deploy: `npx wrangler deploy` (requires Cloudflare account + `wrangler` auth)

## CI

GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every push and PR to master:

- `ci` — `typecheck` + lint + build. Requires `SUPABASE_URL` and `SUPABASE_KEY` repository secrets for the build step.
- `test` — Vitest `unit` + `components` projects (Docker-free, no secrets).
- `test-integration` — Vitest `integration` project against a local Supabase started with `npx supabase start`. Uses the well-known static local keys and a dummy `OPENROUTER_API_KEY`, so it needs no repository secrets (and runs on fork PRs).

`deploy` runs only after `ci`, `test`, and `test-integration` all pass.
