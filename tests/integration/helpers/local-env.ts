import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export interface SupabaseStatus {
  API_URL: string;
  ANON_KEY: string;
  PUBLISHABLE_KEY?: string;
  SERVICE_ROLE_KEY: string;
}

/** Read the running local Supabase stack's URL and keys from `supabase status`. */
export function readLocalStatus(): SupabaseStatus {
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

/** Publish the local stack's URL/keys into process.env for the harness clients. */
export function applyLocalEnv(status: SupabaseStatus): void {
  process.env.SUPABASE_URL = status.API_URL;
  process.env.SUPABASE_ANON_KEY = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = status.SERVICE_ROLE_KEY;
}
