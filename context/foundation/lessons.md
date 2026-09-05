# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## New Supabase migrations must be pushed to the cloud project, not just applied locally

- **Context**: `supabase/migrations/*.sql`, `.github/workflows/ci.yml` (`deploy` job).
- **Problem**: `npx supabase start` auto-applies migrations to the local Docker Postgres, so `npm run dev`/`wrangler dev` work fine — but the cloud project used in production (`SUPABASE_URL`/`SUPABASE_KEY` Workers Secrets) never receives them unless someone explicitly runs `supabase db push` against it. The `flashcards` table (added 2026-09-03/04) was never pushed after the initial Cloudflare deploy (2026-08-26), so every flashcard-creating request in production 500'd with "relation does not exist" until diagnosed and fixed manually on 2026-09-05 via `supabase link --project-ref <ref>` + `supabase db push`.
- **Rule**: Every new/changed file under `supabase/migrations/` must be pushed to the linked cloud project before (or as part of) the next deploy — never assume local application is enough. `.github/workflows/ci.yml`'s `deploy` job now runs `supabase db push --project-ref <ref> --yes` (ref derived from the `SUPABASE_URL` secret) before `wrangler deploy`, so this is enforced automatically on every push to `master` — requires the `SUPABASE_ACCESS_TOKEN` GitHub secret (a personal/service access token from https://supabase.com/dashboard/account/tokens) to be set. If that secret is ever missing, migrations silently won't apply and the deploy step will fail loudly (a good outcome) or the whole `db push` step needs re-adding after any workflow rewrite.
- **Applies to**: Any plan/implementation that adds or edits a file in `supabase/migrations/`, and any change to `.github/workflows/ci.yml`'s `deploy` job.
