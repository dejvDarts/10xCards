import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Integration tests run against a real local Supabase (`npx supabase start`).
// Rather than hard-code instance keys, read them from `supabase status` at
// startup so the harness always matches whatever local stack is running.
//
// The route handlers under test get their own SUPABASE_URL / SUPABASE_KEY from
// `astro:env/server`, resolved from `.dev.vars` at Vite-config load — which
// already points at this same local instance. The env vars set here are for the
// harness's own supabase-js clients (admin + per-user sessions).

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

interface SupabaseStatus {
  API_URL: string;
  ANON_KEY: string;
  PUBLISHABLE_KEY?: string;
  SERVICE_ROLE_KEY: string;
}

function readLocalStatus(): SupabaseStatus {
  let raw: string;
  try {
    raw = execSync("npx supabase status -o json", {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error("Local Supabase is not reachable. Run `npx supabase start` before `npm run test:integration`.");
  }
  const match = /\{[\s\S]*\}/.exec(raw);
  if (!match) {
    throw new Error(`Could not parse \`supabase status\` output:\n${raw}`);
  }
  return JSON.parse(match[0]) as SupabaseStatus;
}

const status = readLocalStatus();

process.env.SUPABASE_URL = status.API_URL;
process.env.SUPABASE_ANON_KEY = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
process.env.SUPABASE_SERVICE_ROLE_KEY = status.SERVICE_ROLE_KEY;

const health = await fetch(`${status.API_URL}/auth/v1/health`);
if (!health.ok) {
  throw new Error(`Local Supabase auth health check failed (${String(health.status)}).`);
}
