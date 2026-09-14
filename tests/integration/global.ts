import { applyLocalEnv, clearStatusCache, readLocalStatus, writeStatusCache } from "./helpers/local-env";
import { deleteAllTestUsers } from "./helpers/users";

// Registered as the integration project's `globalSetup`. Reads `supabase
// status` once for the whole run and caches it (see helpers/local-env.ts) so
// each test file's setup.ts doesn't shell out to the CLI itself.
export function setup(): void {
  writeStatusCache(readLocalStatus());
}

// Per-suite `afterAll` hooks already delete their own users; this is a
// belt-and-braces sweep of any `test+cpc-*` stragglers left by a crashed or
// interrupted run.
export async function teardown(): Promise<void> {
  try {
    applyLocalEnv(readLocalStatus());
    await deleteAllTestUsers();
  } catch {
    // Local stack already stopped — nothing to sweep.
  } finally {
    clearStatusCache();
  }
}
