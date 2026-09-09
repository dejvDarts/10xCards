import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestUser, deleteTestUser, signedInClient, type TestUser } from "./helpers/users";
import { resetFlashcards, seedFlashcard } from "./helpers/db";

// Pins the RLS layer directly, independent of the route handlers. The handler
// tests prove the composite outcome but can't tell which layer enforced it —
// RLS alone returns empty/0-rows even if a handler's app-level `user_id` filter
// is removed. If RLS on `flashcards` is disabled (or a service-role client is
// swapped in), these assertions fail even while the app filter still stands.

let userA: TestUser;
let userB: TestUser;
let clientA: SupabaseClient;
let clientB: SupabaseClient;

beforeAll(async () => {
  userA = await createTestUser();
  userB = await createTestUser();
  [clientA, clientB] = await Promise.all([signedInClient(userA), signedInClient(userB)]);
});

afterEach(async () => {
  await resetFlashcards([clientA, clientB]);
});

afterAll(async () => {
  await Promise.all([deleteTestUser(userA.id), deleteTestUser(userB.id)]);
});

describe("Risk #1 — RLS layer (direct DB, no route handler)", () => {
  it("user B's client SELECTs zero of user A's rows", async () => {
    const card = await seedFlashcard(clientA, userA.id);

    const { data, error } = await clientB.from("flashcards").select("*").eq("id", card.id);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("user B's client UPDATE on A's row affects 0 rows; A's row unchanged", async () => {
    const card = await seedFlashcard(clientA, userA.id, { front: "original" });

    const { data } = await clientB.from("flashcards").update({ front: "tampered" }).eq("id", card.id).select();

    expect(data).toEqual([]);

    const { data: still } = await clientA.from("flashcards").select("front").eq("id", card.id).single();
    expect((still as { front: string }).front).toBe("original");
  });

  it("user B's client DELETE on A's row affects 0 rows; A's row survives", async () => {
    const card = await seedFlashcard(clientA, userA.id);

    const { data } = await clientB.from("flashcards").delete().eq("id", card.id).select();
    expect(data).toEqual([]);

    const { data: still } = await clientA.from("flashcards").select("id").eq("id", card.id).maybeSingle();
    expect(still).not.toBeNull();
  });

  it("user B's client INSERT as user A is rejected by the WITH CHECK policy", async () => {
    const { data, error } = await clientB
      .from("flashcards")
      .insert({ user_id: userA.id, front: "q", back: "a", status: "accepted" })
      .select();

    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it("positive control — user A's client reads, updates, and deletes its own row", async () => {
    const card = await seedFlashcard(clientA, userA.id, { front: "mine" });

    const read = await clientA.from("flashcards").select("front").eq("id", card.id).single();
    expect((read.data as { front: string }).front).toBe("mine");

    const upd = await clientA.from("flashcards").update({ front: "mine-edited" }).eq("id", card.id).select();
    expect(upd.data).toHaveLength(1);

    const del = await clientA.from("flashcards").delete().eq("id", card.id).select();
    expect(del.data).toHaveLength(1);
  });
});
