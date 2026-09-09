import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient, anonClient } from "./clients";

/** Every harness-created user carries this email prefix so teardown can find them. */
export const TEST_EMAIL_PREFIX = "test+cpc-";

export interface TestUser {
  id: string;
  email: string;
  password: string;
}

export async function createTestUser(): Promise<TestUser> {
  const email = `${TEST_EMAIL_PREFIX}${randomUUID()}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await adminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) {
    throw new Error(`createTestUser failed: ${error.message}`);
  }
  return { id: data.user.id, email, password };
}

export async function deleteTestUser(id: string): Promise<void> {
  await adminClient().auth.admin.deleteUser(id);
}

/** Best-effort sweep of any leftover harness users (prefix-matched). */
export async function deleteAllTestUsers(): Promise<void> {
  const admin = adminClient();
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) return;
  await Promise.all(
    data.users.filter((u) => u.email?.startsWith(TEST_EMAIL_PREFIX)).map((u) => admin.auth.admin.deleteUser(u.id)),
  );
}

/** A supabase-js client signed in as `user` — RLS applies as that user. */
export async function signedInClient(user: TestUser): Promise<SupabaseClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (error) {
    throw new Error(`signedInClient: sign-in failed for ${user.email}: ${error.message}`);
  }
  return client;
}
