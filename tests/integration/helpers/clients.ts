import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Values are populated by tests/integration/setup.ts from `supabase status`.
function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — tests/integration/setup.ts should have populated it.`);
  }
  return value;
}

export const supabaseUrl = (): string => env("SUPABASE_URL");
export const anonKey = (): string => env("SUPABASE_ANON_KEY");
export const serviceRoleKey = (): string => env("SUPABASE_SERVICE_ROLE_KEY");

/** Service-role client — used ONLY for auth.admin user management. The
 *  flashcards table grants privileges to `authenticated` only, so this client
 *  cannot read/write flashcards via PostgREST (by design). */
export function adminClient(): SupabaseClient {
  return createClient(supabaseUrl(), serviceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Anonymous client, not yet signed in. */
export function anonClient(): SupabaseClient {
  return createClient(supabaseUrl(), anonKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
