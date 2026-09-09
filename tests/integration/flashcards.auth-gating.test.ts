import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GET as listRoute, POST as createRoute } from "@/pages/api/flashcards/index";
import { PATCH, DELETE } from "@/pages/api/flashcards/[id]";
import { POST as reviewRoute } from "@/pages/api/flashcards/[id]/review";
import { GET as dueRoute } from "@/pages/api/flashcards/due";
import { createTestUser, deleteTestUser, signedInClient, type TestUser } from "./helpers/users";
import { apiContext, cookieHeaderFor } from "./helpers/session";
import { resetFlashcards, seedFlashcard } from "./helpers/db";

let user: TestUser;
let client: SupabaseClient;
let cookie: string;

beforeAll(async () => {
  user = await createTestUser();
  client = await signedInClient(user);
  cookie = await cookieHeaderFor(user);
});

afterEach(async () => {
  await resetFlashcards([client]);
});

afterAll(async () => {
  await deleteTestUser(user.id);
});

interface RouteCase {
  name: string;
  needsCard: boolean;
  okStatus: number;
  call: (opts: { cookieHeader?: string; cardId?: string }) => Promise<Response>;
}

// `/api/**` is NOT covered by PROTECTED_ROUTES — each of these handlers repeats
// its own `getUser()` guard, so every route is an independent regression point.
const routes: RouteCase[] = [
  {
    name: "GET /api/flashcards",
    needsCard: false,
    okStatus: 200,
    call: ({ cookieHeader }) =>
      Promise.resolve(listRoute(apiContext({ method: "GET", path: "/api/flashcards", cookieHeader }))),
  },
  {
    name: "POST /api/flashcards",
    needsCard: false,
    okStatus: 201,
    call: ({ cookieHeader }) =>
      Promise.resolve(
        createRoute(
          apiContext({ method: "POST", path: "/api/flashcards", cookieHeader, body: { front: "F", back: "B" } }),
        ),
      ),
  },
  {
    name: "PATCH /api/flashcards/[id]",
    needsCard: true,
    okStatus: 200,
    call: ({ cookieHeader, cardId }) =>
      Promise.resolve(
        PATCH(
          apiContext({
            method: "PATCH",
            path: `/api/flashcards/${cardId ?? ""}`,
            params: { id: cardId ?? "" },
            cookieHeader,
            body: { front: "updated" },
          }),
        ),
      ),
  },
  {
    name: "DELETE /api/flashcards/[id]",
    needsCard: true,
    okStatus: 204,
    call: ({ cookieHeader, cardId }) =>
      Promise.resolve(
        DELETE(
          apiContext({
            method: "DELETE",
            path: `/api/flashcards/${cardId ?? ""}`,
            params: { id: cardId ?? "" },
            cookieHeader,
          }),
        ),
      ),
  },
  {
    name: "POST /api/flashcards/[id]/review",
    needsCard: true,
    okStatus: 200,
    call: ({ cookieHeader, cardId }) =>
      Promise.resolve(
        reviewRoute(
          apiContext({
            method: "POST",
            path: `/api/flashcards/${cardId ?? ""}/review`,
            params: { id: cardId ?? "" },
            cookieHeader,
            body: { rating: 3 },
          }),
        ),
      ),
  },
  {
    name: "GET /api/flashcards/due",
    needsCard: false,
    okStatus: 200,
    call: ({ cookieHeader }) =>
      Promise.resolve(dueRoute(apiContext({ method: "GET", path: "/api/flashcards/due", cookieHeader }))),
  },
];

describe("Risk #4 — flashcard API route auth gating", () => {
  describe.each(routes)("$name", (route) => {
    it("rejects an unauthenticated request with a 401 JSON body and no redirect", async () => {
      const res = await route.call({ cookieHeader: undefined });

      expect(res.status).toBe(401);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(await res.json()).toEqual({ error: "Unauthorized" });
      // Not a redirect — this is the API mechanism, not the page mechanism.
      expect(res.headers.get("location")).toBeNull();
      expect([301, 302, 303, 307, 308]).not.toContain(res.status);
    });

    it("does not block an authenticated request", async () => {
      let cardId: string | undefined;
      if (route.needsCard) {
        cardId = (await seedFlashcard(client, user.id)).id;
      }

      const res = await route.call({ cookieHeader: cookie, cardId });

      expect(res.status).not.toBe(401);
      expect(res.status).toBe(route.okStatus);
    });
  });

  it("GET /api/flashcards without a session returns 401 — not a 302 to /auth/signin", async () => {
    const res = await listRoute(apiContext({ method: "GET", path: "/api/flashcards" }));

    expect(res.status).toBe(401);
    expect(res.status).not.toBe(302);
    expect(res.headers.get("location")).toBeNull();
  });
});
