import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { POST as reviewRoute } from "@/pages/api/flashcards/[id]/review";
import { GET as dueRoute } from "@/pages/api/flashcards/due";
import { createTestUser, deleteTestUser, signedInClient, type TestUser } from "./helpers/users";
import { apiContext, cookieHeaderFor } from "./helpers/session";
import { resetFlashcards, seedFlashcard } from "./helpers/db";

const DAY_MS = 86_400_000;
const pastISO = () => new Date(Date.now() - 60_000).toISOString();

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

interface Row {
  id: string;
  reps: number;
  lapses: number;
  state: number;
  due: string;
}

async function rowById(id: string): Promise<Row | null> {
  const { data } = await client.from("flashcards").select("*").eq("id", id).maybeSingle();
  return data as Row | null;
}

async function dueListIds(): Promise<string[]> {
  const res = await dueRoute(apiContext({ method: "GET", path: "/api/flashcards/due", cookieHeader: cookie }));
  expect(res.status).toBe(200);
  const body = (await res.json()) as { flashcards: { id: string }[] };
  return body.flashcards.map((f) => f.id);
}

function review(cardId: string, rating: 1 | 2 | 3 | 4) {
  return reviewRoute(
    apiContext({
      method: "POST",
      path: `/api/flashcards/${cardId}/review`,
      params: { id: cardId },
      cookieHeader: cookie,
      body: { rating },
    }),
  );
}

describe("Risk #2 — study loop against real Supabase", () => {
  it("rating Good advances the schedule and removes the card from the due list", async () => {
    const card = await seedFlashcard(client, user.id, { due: pastISO() });
    expect(await dueListIds()).toContain(card.id);

    const res = await review(card.id, 3);
    expect(res.status).toBe(200);
    const updated = (await res.json()) as Row;
    expect(updated.reps).toBe(1);
    expect(updated.state).toBe(2);
    expect(new Date(updated.due).getTime()).toBeGreaterThan(Date.now());

    expect(await dueListIds()).not.toContain(card.id);
  });

  it("rating Again also removes the card from the due list (no in-session requeue)", async () => {
    const card = await seedFlashcard(client, user.id, { due: pastISO() });

    const res = await review(card.id, 1);
    expect(res.status).toBe(200);
    const updated = (await res.json()) as Row;
    expect(new Date(updated.due).getTime()).toBeGreaterThan(Date.now());

    expect(await dueListIds()).not.toContain(card.id);
  });

  it("due date advances further for higher ratings: Again < Hard < Good < Easy", async () => {
    const cards = await Promise.all([0, 1, 2, 3].map(() => seedFlashcard(client, user.id, { due: pastISO() })));
    const dues: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await review(cards[i].id, (i + 1) as 1 | 2 | 3 | 4);
      expect(res.status).toBe(200);
      dues.push(new Date(((await res.json()) as Row).due).getTime());
    }

    expect(dues[0]).toBeLessThan(dues[1]);
    expect(dues[1]).toBeLessThan(dues[2]);
    expect(dues[2]).toBeLessThan(dues[3]);
  });

  it("a second review rated Again increments lapses and stays scheduled about a day out", async () => {
    const card = await seedFlashcard(client, user.id, { due: pastISO() });

    expect((await review(card.id, 3)).status).toBe(200);

    const res = await review(card.id, 1);
    expect(res.status).toBe(200);
    const updated = (await res.json()) as Row;
    expect(updated.lapses).toBe(1);
    expect(new Date(updated.due).getTime() - Date.now()).toBeGreaterThanOrEqual(DAY_MS - 60_000);
  });

  it("two racing reviews: the optimistic-concurrency guard prevents a lost update", async () => {
    const card = await seedFlashcard(client, user.id, { due: pastISO() });

    const [a, b] = await Promise.all([review(card.id, 3), review(card.id, 3)]);
    const statuses = [a.status, b.status].sort((x, y) => x - y);
    const back = await rowById(card.id);

    // Hold regardless of interleaving: no crash, at least one success, at most one rejection.
    expect(statuses).not.toContain(500);
    expect(statuses[0]).toBe(200);
    expect([200, 404]).toContain(statuses[1]);

    if (statuses[1] === 404) {
      // Interleaved (the expected outcome): the stale second write matched zero rows.
      expect(back?.reps).toBe(1);
    } else {
      // Did not interleave under Vitest — both reviews ran sequentially and both
      // are legitimate. The guard's contract is proven by the Phase-1 unit test.
      // eslint-disable-next-line no-console
      console.warn(`[review race] handlers did not interleave (statuses ${statuses.join("/")})`);
      expect(back?.reps).toBe(2);
    }
  });

  it("due list is ordered by due asc, then id asc on a tie", async () => {
    const earlier = new Date(Date.now() - 3 * DAY_MS).toISOString();
    const tied = new Date(Date.now() - DAY_MS).toISOString();
    const idLow = "aaaaaaaa-0000-4000-8000-000000000001";
    const idHigh = "aaaaaaaa-0000-4000-8000-000000000002";

    const cEarlier = await seedFlashcard(client, user.id, { due: earlier });
    await seedFlashcard(client, user.id, { due: tied, id: idHigh });
    await seedFlashcard(client, user.id, { due: tied, id: idLow });

    const ids = await dueListIds();

    expect(ids).toEqual(expect.arrayContaining([cEarlier.id, idLow, idHigh]));
    expect(ids.indexOf(cEarlier.id)).toBeLessThan(ids.indexOf(idLow));
    expect(ids.indexOf(idLow)).toBeLessThan(ids.indexOf(idHigh));
  });
});
