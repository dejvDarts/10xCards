import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PATCH, DELETE } from "@/pages/api/flashcards/[id]";
import { GET as listRoute } from "@/pages/api/flashcards/index";
import { POST as reviewRoute } from "@/pages/api/flashcards/[id]/review";
import { createTestUser, deleteTestUser, signedInClient, type TestUser } from "./helpers/users";
import { apiContext, cookieHeaderFor } from "./helpers/session";
import { resetFlashcards, seedFlashcard } from "./helpers/db";

let userA: TestUser;
let userB: TestUser;
let clientA: SupabaseClient;
let clientB: SupabaseClient;
let cookieA: string;
let cookieB: string;

beforeAll(async () => {
  userA = await createTestUser();
  userB = await createTestUser();
  [clientA, clientB] = await Promise.all([signedInClient(userA), signedInClient(userB)]);
  [cookieA, cookieB] = await Promise.all([cookieHeaderFor(userA), cookieHeaderFor(userB)]);
});

afterEach(async () => {
  await resetFlashcards([clientA, clientB]);
});

afterAll(async () => {
  await Promise.all([deleteTestUser(userA.id), deleteTestUser(userB.id)]);
});

async function rowById(client: SupabaseClient, id: string) {
  const { data } = await client.from("flashcards").select("*").eq("id", id).maybeSingle();
  return data as { id: string; status: string; front: string; due: string; reps: number } | null;
}

describe("Risk #1 — cross-user flashcard access via route handlers", () => {
  describe("user B cannot reach user A's card", () => {
    it("PATCH another user's card → 404, row untouched", async () => {
      const card = await seedFlashcard(clientA, userA.id, { front: "A-front" });

      const res = await PATCH(
        apiContext({
          method: "PATCH",
          path: `/api/flashcards/${card.id}`,
          params: { id: card.id },
          cookieHeader: cookieB,
          body: { status: "rejected", front: "hacked" },
        }),
      );

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Flashcard not found" });

      const still = await rowById(clientA, card.id);
      expect(still?.status).toBe("accepted");
      expect(still?.front).toBe("A-front");
    });

    it("DELETE another user's card → 404, row still present", async () => {
      const card = await seedFlashcard(clientA, userA.id);

      const res = await DELETE(
        apiContext({
          method: "DELETE",
          path: `/api/flashcards/${card.id}`,
          params: { id: card.id },
          cookieHeader: cookieB,
        }),
      );

      expect(res.status).toBe(404);
      expect(await rowById(clientA, card.id)).not.toBeNull();
    });

    it("POST review on another user's card → 404, schedule untouched", async () => {
      const card = await seedFlashcard(clientA, userA.id);
      const before = await rowById(clientA, card.id);

      const res = await reviewRoute(
        apiContext({
          method: "POST",
          path: `/api/flashcards/${card.id}/review`,
          params: { id: card.id },
          cookieHeader: cookieB,
          body: { rating: 3 },
        }),
      );

      expect(res.status).toBe(404);

      const after = await rowById(clientA, card.id);
      expect(after?.reps).toBe(before?.reps);
      expect(after?.due).toBe(before?.due);
    });

    it("GET list as B excludes A's cards", async () => {
      const aCard = await seedFlashcard(clientA, userA.id);
      const bCard = await seedFlashcard(clientB, userB.id);

      const res = await listRoute(apiContext({ method: "GET", path: "/api/flashcards", cookieHeader: cookieB }));

      expect(res.status).toBe(200);
      const body = (await res.json()) as { flashcards: { id: string }[] };
      const ids = body.flashcards.map((f) => f.id);
      expect(ids).toContain(bCard.id);
      expect(ids).not.toContain(aCard.id);
    });
  });

  describe("positive control — user A operates on their own card", () => {
    it("PATCH own card → 200 and the change persists", async () => {
      const card = await seedFlashcard(clientA, userA.id, { front: "before" });

      const res = await PATCH(
        apiContext({
          method: "PATCH",
          path: `/api/flashcards/${card.id}`,
          params: { id: card.id },
          cookieHeader: cookieA,
          body: { front: "after" },
        }),
      );

      expect(res.status).toBe(200);
      expect((await rowById(clientA, card.id))?.front).toBe("after");
    });

    it("DELETE own card → 204 and the row is gone", async () => {
      const card = await seedFlashcard(clientA, userA.id);

      const res = await DELETE(
        apiContext({
          method: "DELETE",
          path: `/api/flashcards/${card.id}`,
          params: { id: card.id },
          cookieHeader: cookieA,
        }),
      );

      expect(res.status).toBe(204);
      expect(await rowById(clientA, card.id)).toBeNull();
    });

    it("POST review own card → 200 and the schedule advances", async () => {
      const card = await seedFlashcard(clientA, userA.id);
      const before = await rowById(clientA, card.id);

      const res = await reviewRoute(
        apiContext({
          method: "POST",
          path: `/api/flashcards/${card.id}/review`,
          params: { id: card.id },
          cookieHeader: cookieA,
          body: { rating: 3 },
        }),
      );

      expect(res.status).toBe(200);
      expect((await rowById(clientA, card.id))?.reps).toBe((before?.reps ?? 0) + 1);
    });

    it("GET list as A includes A's card", async () => {
      const aCard = await seedFlashcard(clientA, userA.id);

      const res = await listRoute(apiContext({ method: "GET", path: "/api/flashcards", cookieHeader: cookieA }));

      expect(res.status).toBe(200);
      const body = (await res.json()) as { flashcards: { id: string }[] };
      expect(body.flashcards.map((f) => f.id)).toContain(aCard.id);
    });
  });
});
