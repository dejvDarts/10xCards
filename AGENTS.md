# Repository Guidelines

10xCards is an Astro 6 SSR web app (React 19 islands, Tailwind 4, Supabase auth, shadcn/ui) deployed to Cloudflare Workers. `@CLAUDE.md` holds the full architecture and auth-flow detail; this file is the quick agent contract.

## Hard rules

- API routes under `src/pages/api/` must export `const prerender = false` — the app is full SSR (`output: "server"` in `@astro.config.mjs`); pages default to server-rendered.
- API handlers export uppercase `GET`/`POST` and validate input with zod. No `"use client"` or other Next.js directives — this is Astro, not Next.
- Read `SUPABASE_URL`/`SUPABASE_KEY` only via `astro:env/server` (server-only secrets); never expose them to client code. Local secrets live in `.dev.vars` (gitignored), not `.env` committed.
- Enable RLS on every new Supabase table with granular per-operation, per-role policies. Migrations go in `supabase/migrations/` named `YYYYMMDDHHmmss_short_description.sql`.

## Project structure

- `src/pages/` routes (`api/` endpoints, `auth/` sign-in/up pages); `src/components/` (`ui/` shadcn, `auth/`); `src/layouts/`; `src/lib/` services/helpers; `src/middleware.ts` resolves the user and guards `PROTECTED_ROUTES`. Path alias `@/*` → `./src/*` (see `@tsconfig.json`).
- Shared entity/DTO types go in `src/types.ts`; React hooks in `src/components/hooks/`; extracted business logic in `src/lib/services/`.

## Commands

- `npm run dev` — dev server (Cloudflare workerd). `npm run build` — SSR production build. `npm run preview` — preview build.
- `npm run lint` / `npm run lint:fix` — ESLint (type-checked). `npm run format` — Prettier. Full script list: `@package.json`.
- Local Supabase: `npx supabase start` (needs Docker). Deploy: `npx wrangler deploy`.

## Coding style

- Node 22.14.0 (`.nvmrc`); TypeScript strict (`astro/tsconfigs/strict`). Astro components for static/layout, React only where interactivity is needed.
- Merge Tailwind classes with `cn()` from `@/lib/utils` (clsx + tailwind-merge) — do not concatenate class strings. Add shadcn/ui components via `npx shadcn@latest add <name>` (new-york variant).
- husky + lint-staged run `eslint --fix` on `*.{ts,tsx,astro}` and `prettier --write` on `*.{json,css,md}` pre-commit.

## Testing, commits & CI

- No test framework is configured yet; if you add one, wire it into CI before relying on it.
- CI (`@.github/workflows/ci.yml`) runs `npm ci` → `astro sync` → lint → build on push/PR to `master`, and needs `SUPABASE_URL`/`SUPABASE_KEY` repository secrets. Keep both green before merge.
- Commit convention is not yet established — the repo has no history; agree a prefix style (e.g. Conventional Commits) before the first batch of commits.
