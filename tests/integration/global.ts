import { applyLocalEnv, readLocalStatus } from "./helpers/local-env";
import { deleteAllTestUsers } from "./helpers/users";

// Registered as the integration project's `globalSetup`. Per-suite `afterAll`
// hooks already delete their own users; this is a belt-and-braces sweep of any
// `test+cpc-*` stragglers left by a crashed or interrupted run.
export async function teardown(): Promise<void> {
  try {
    applyLocalEnv(readLocalStatus());
    await deleteAllTestUsers();
  } catch {
    // Local stack already stopped — nothing to sweep.
  }
}
