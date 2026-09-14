import { applyLocalEnv, readLocalStatus, readStatusCache } from "./helpers/local-env";

// Integration tests run against a real local Supabase (`npx supabase start`).
// Keys are read from `supabase status` once by the integration project's
// `globalSetup` (global.ts) and cached; each file reads that cache here
// instead of shelling out to the CLI itself, which avoids concurrent `npx
// supabase status` calls racing each other. Falls back to a direct call if
// the cache is somehow missing.
//
// The route handlers under test get their own SUPABASE_URL / SUPABASE_KEY from
// `astro:env/server`, resolved from `.dev.vars` at Vite-config load. The env
// vars set here are for the harness's own supabase-js clients (admin +
// per-user sessions).

const status = readStatusCache() ?? readLocalStatus();
applyLocalEnv(status);

// The route handlers read SUPABASE_URL from `astro:env/server` (resolved from
// `.dev.vars`). If that points somewhere other than the running local stack,
// the handlers and this harness target different backends — fail loudly here
// rather than with confusing auth errors mid-suite.
const { SUPABASE_URL: handlerSupabaseUrl } = await import("astro:env/server");
if (handlerSupabaseUrl && handlerSupabaseUrl !== status.API_URL) {
  throw new Error(
    `Integration env mismatch: route handlers use ${handlerSupabaseUrl} (from .dev.vars), ` +
      `but the running local Supabase is ${status.API_URL}. Point .dev.vars at the local stack.`,
  );
}

const health = await fetch(`${status.API_URL}/auth/v1/health`);
if (!health.ok) {
  throw new Error(`Local Supabase auth health check failed (${String(health.status)}).`);
}
