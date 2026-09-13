# 10xCards

Paste source text, get AI-generated flashcard proposals, review and accept the
ones worth keeping, then study them in a spaced-repetition session — from raw
notes to a study-ready deck in minutes instead of hours.

## What it does

- **Paste text, generate flashcards.** An LLM (via [OpenRouter](https://openrouter.ai/))
  turns pasted source text into question/answer flashcard proposals.
- **Review before it's yours.** Each proposal can be edited, accepted, or
  rejected — only accepted cards join your personal collection.
- **Manual creation too.** Don't have source text? Create a flashcard from
  scratch.
- **Study with spaced repetition.** Accepted cards feed a review session
  scheduled by [`ts-fsrs`](https://github.com/open-spaced-repetition/ts-fsrs)
  (the FSRS algorithm) — rate how well you remembered each card and the
  schedule adapts.
- **Private by default.** Every flashcard and pasted text is scoped to its
  owner (Supabase Auth + row-level security) — nothing is visible across
  accounts.

## Tech Stack

- [Astro](https://astro.build/) v6 - Server-first web framework (SSR)
- [React](https://react.dev/) v19 - Interactive islands (generator, flashcard list, review session)
- [TypeScript](https://www.typescriptlang.org/) v5 - Type-safe JavaScript
- [Tailwind CSS](https://tailwindcss.com/) v4 - Utility-first CSS framework
- [Supabase](https://supabase.com/) - Auth + Postgres, with per-user row-level security
- [OpenRouter](https://openrouter.ai/) - LLM provider for flashcard generation
- [`ts-fsrs`](https://github.com/open-spaced-repetition/ts-fsrs) - Free Spaced Repetition Scheduler
- [Cloudflare Workers](https://workers.cloudflare.com/) - Edge deployment runtime

## Prerequisites

- Node.js v22.14.0 (as specified in `.nvmrc`)
- npm (comes with Node.js)
- An [OpenRouter](https://openrouter.ai/) API key (for AI flashcard generation)

## Getting Started

1. Clone the repository:

```bash
git clone https://github.com/dejvDarts/10xCards.git
cd 10xCards
```

2. Install dependencies:

```bash
npm install
```

3. Set up Supabase and configure environment variables — see [Supabase Configuration](#supabase-configuration) below.

4. Create a `.dev.vars` file for local Cloudflare dev secrets, then fill in `SUPABASE_URL`, `SUPABASE_KEY`, and `OPENROUTER_API_KEY`:

```bash
cp .env.example .dev.vars
```

5. Run the development server:

```bash
npm run dev
```

## Available Scripts

- `npm run dev` - Start development server (Cloudflare workerd runtime)
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint with type-checked rules
- `npm run lint:fix` - Auto-fix ESLint issues
- `npm run format` - Run Prettier
- `npm run typecheck` - Run `tsc --noEmit`
- `npm test` - Run unit tests (Vitest, no external dependencies)
- `npm run test:watch` - Run unit tests in watch mode
- `npm run test:components` - Run React hook/component tests (Vitest, happy-dom)
- `npm run test:integration` - Run integration tests (requires a running local Supabase)
- `npm run test:e2e` - Run Playwright end-to-end tests (requires the dev server + local Supabase)

## Testing

Unit tests live next to the code as `src/**/*.test.ts` and run with no external
dependencies:

```bash
npm test
```

Integration tests live in `tests/integration/` and exercise the real API route
handlers against a **local Supabase** instance (access-control coverage for
cross-user isolation and auth gating). Start the stack first:

```bash
npx supabase start        # Docker required — see Supabase Configuration below
npm run test:integration
```

The integration harness reads the local Supabase URL and keys from
`npx supabase status`; if the stack is not running the suite fails fast with a
clear message. Test users are created and torn down per run (email prefix
`test+cpc-`), so no manual cleanup is needed.

Component tests (`src/**/*.test.tsx`, React hooks under happy-dom) run with
`npm run test:components` — no Docker, no browser.

End-to-end tests (`tests/e2e/`) drive a real Chromium browser against the dev
server with Playwright. They auto-start `npm run dev` and also need a running
local Supabase:

```bash
npx supabase start
npm run test:e2e
```

`context/foundation/test-plan.md` documents the risks each test suite is
meant to catch.

## Project Structure

```md
.
├── src/
│ ├── layouts/ # Astro layouts
│ ├── pages/ # Astro pages (incl. api/ endpoints, flashcards/review)
│ ├── components/ # UI components (Astro & React), hooks/ for client state
│ ├── lib/
│ │ ├── services/ # Business logic (AI generation, FSRS scheduling, flashcards CRUD)
│ │ └── supabase.ts # Server-side Supabase client
│ ├── middleware.ts # Auth guard for protected routes
│ └── assets/ # Static assets
├── supabase/migrations/ # Database schema (flashcards table, RLS policies)
├── tests/ # integration/ and e2e/ suites
├── public/ # Public assets
├── wrangler.jsonc # Cloudflare Workers config
```

## Supabase Configuration

This project uses [Supabase](https://supabase.com/) for authentication and as the datastore for flashcards. Environment variables are declared via Astro's `astro:env` schema and are treated as **server-only secrets** — they are never exposed to the client.

AI flashcard generation additionally needs an [OpenRouter](https://openrouter.ai/) API key: set `OPENROUTER_API_KEY` (and optionally `OPENROUTER_MODEL`, default `openrouter/auto`) in `.env`/`.dev.vars` alongside the Supabase variables below.

### First-time setup (local, no cloud project needed)

Requires [Docker](https://www.docker.com/) and ~7 GB RAM.

1. Create your `.env` file:

```bash
cp .env.example .env
```

2. Initialize the local Supabase project (creates a `supabase/` config folder):

```bash
npx supabase init
```

3. Start the local stack (downloads Docker images on first run):

```bash
npx supabase start
```

4. Copy the credentials printed by the CLI into your `.env` and `.dev.vars`:

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_KEY=<anon key from CLI output>
```

5. To stop the stack when done:

```bash
npx supabase stop
```

The local Studio UI is available at `http://localhost:54323`.

Database migrations live in `supabase/migrations/` and apply automatically when you run `npx supabase start` (or `npx supabase db reset`). They currently add a `flashcards` table (with per-user row-level security) on top of Supabase Auth's built-in `auth.users` table.

### Using a cloud Supabase project instead

If you prefer to use a hosted Supabase project, add these variables to your `.env` and `.dev.vars` files:

| Variable       | Description                                                |
| -------------- | ---------------------------------------------------------- |
| `SUPABASE_URL` | Project URL from Supabase dashboard → Settings → API       |
| `SUPABASE_KEY` | `anon` public key from Supabase dashboard → Settings → API |

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_KEY=<anon-key>
```

### Email confirmation in local development

By default Supabase requires email confirmation before a user can sign in. To skip this during local development:

1. Open the Supabase dashboard for your project
2. Go to **Authentication → Email → Confirm email**
3. Toggle it **off**

Users can then sign in immediately after sign-up without clicking a confirmation link.

### Routes

| Route                 | Description                                                             |
| --------------------- | ----------------------------------------------------------------------- |
| `/auth/signin`        | Email/password sign-in form                                             |
| `/auth/signup`        | Email/password sign-up form                                             |
| `/auth/confirm-email` | Post-signup "check your inbox" page                                     |
| `/dashboard`          | Protected landing page (redirects to `/auth/signin` if unauthenticated) |
| `/generate`           | Paste source text, generate and review AI flashcard proposals           |
| `/flashcards`         | Your saved (accepted) flashcards — edit, delete, or create one manually |
| `/flashcards/review`  | Study session: due cards, spaced-repetition ratings (FSRS)              |

`/dashboard`, `/generate`, and `/flashcards` are protected — route protection is handled in `src/middleware.ts`. Add paths to the `PROTECTED_ROUTES` array there to require authentication.

## Deployment

This project deploys to [Cloudflare Workers](https://workers.cloudflare.com/).

1. Build the project:

```bash
npm run build
```

2. Deploy with Wrangler:

```bash
npx wrangler deploy
```

Set `SUPABASE_URL`, `SUPABASE_KEY`, and `OPENROUTER_API_KEY` as secrets in your Cloudflare dashboard or via `npx wrangler secret put`.

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs on every push and PR to `master`:

- `ci` — typecheck, lint, build (needs `SUPABASE_URL`/`SUPABASE_KEY` repository secrets)
- `test` — unit + component tests (no secrets, no Docker)
- `test-integration` — integration tests against a local Supabase started in CI (no secrets required)
- `deploy` — runs only after the three jobs above pass; pushes Supabase migrations and deploys to Cloudflare Workers

End-to-end tests are not currently part of CI — run `npm run test:e2e` locally.

## License

MIT
