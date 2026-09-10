import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { APIContext } from "astro";
import { OPENROUTER_API_KEY } from "astro:env/server";
import { POST as createRoute } from "@/pages/api/flashcards/index";
import { PATCH as patchRoute } from "@/pages/api/flashcards/[id]";
import { POST as reviewRoute } from "@/pages/api/flashcards/[id]/review";
import { POST as generateRoute } from "@/pages/api/flashcards/generate";
import { createTestUser, deleteTestUser, signedInClient, type TestUser } from "./helpers/users";
import { apiContext, cookieHeaderFor } from "./helpers/session";
import { resetFlashcards, seedFlashcard, type SeededFlashcard } from "./helpers/db";
import { mockProvider, providerCalled } from "./helpers/mock-provider";

// Risk #6 — one representative adversarial payload per validation cell-class per
// write route, plus the universal cells (non-JSON body, malformed [id]) and the
// three PINNED schema gaps. Assertions check BEHAVIOUR only — HTTP status + an
// `error` property + nothing persisted — never zod's message wording.

let user: TestUser;
let client: SupabaseClient;
let cookie: string;

beforeAll(async () => {
  user = await createTestUser();
  client = await signedInClient(user);
  cookie = await cookieHeaderFor(user);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await resetFlashcards([client]);
});

afterAll(async () => {
  await deleteTestUser(user.id);
});

async function rowCount(): Promise<number> {
  const { count } = await client.from("flashcards").select("*", { count: "exact", head: true }).eq("user_id", user.id);
  return count ?? 0;
}

async function ownRows<T extends Record<string, unknown> = Record<string, unknown>>(cols = "*"): Promise<T[]> {
  const { data } = await client.from("flashcards").select(cols).eq("user_id", user.id);
  return (data ?? []) as T[];
}

/** Route call with a raw (unstringified) request body — the only way to feed a
 *  handler a body that `request.json()` rejects. `apiContext` always
 *  JSON.stringifies, so it can't produce this case. */
function rawContext(method: string, path: string, raw: string, params: Record<string, string> = {}): APIContext {
  const url = new URL(`http://localhost${path}`);
  const headers = new Headers({ "Content-Type": "application/json", Cookie: cookie });
  return {
    request: new Request(url, { method, headers, body: raw }),
    url,
    params,
    cookies: {
      get: () => undefined,
      has: () => false,
      set: () => undefined,
      delete: () => undefined,
      headers: () => [][Symbol.iterator](),
      merge: () => undefined,
    },
    locals: {},
  } as unknown as APIContext;
}

const create = (body: unknown) =>
  createRoute(apiContext({ method: "POST", path: "/api/flashcards", cookieHeader: cookie, body }));

const patch = (id: string, body: unknown) =>
  patchRoute(
    apiContext({ method: "PATCH", path: `/api/flashcards/${id}`, params: { id }, cookieHeader: cookie, body }),
  );

const review = (id: string, body: unknown) =>
  reviewRoute(
    apiContext({ method: "POST", path: `/api/flashcards/${id}/review`, params: { id }, cookieHeader: cookie, body }),
  );

const generate = (body: unknown) =>
  generateRoute(apiContext({ method: "POST", path: "/api/flashcards/generate", cookieHeader: cookie, body }));

/** 400 + a JSON `{ error }` envelope, without pinning the message string. */
async function expectRejected(res: Response): Promise<void> {
  expect(res.status).toBe(400);
  expect(await res.json()).toHaveProperty("error");
}

describe("Risk #6 — create (POST /api/flashcards) input validation", () => {
  it("front over 1,000 chars → 400 and persists nothing", async () => {
    const res = await create({ front: "a".repeat(1001), back: "ok" });
    expect(res.status).toBe(400);
    // The one message-string check the plan allows — the over-max boundary.
    expect((await res.json()).error).toMatch(/at most 1,?000/);
    expect(await rowCount()).toBe(0);
  });

  it("front at exactly 1,000 chars → 201", async () => {
    const res = await create({ front: "a".repeat(1000), back: "ok" });
    expect(res.status).toBe(201);
    expect(await rowCount()).toBe(1);
  });

  it("empty front → 400 and persists nothing", async () => {
    await expectRejected(await create({ front: "", back: "ok" }));
    expect(await rowCount()).toBe(0);
  });

  it("whitespace-only front → 400 and persists nothing", async () => {
    await expectRejected(await create({ front: "   ", back: "ok" }));
    expect(await rowCount()).toBe(0);
  });

  it("front is trimmed before persistence (boundary pass)", async () => {
    const res = await create({ front: "  hi  ", back: "  there  " });
    expect(res.status).toBe(201);
    const [row] = await ownRows<{ front: string; back: string }>("front, back");
    expect(row.front).toBe("hi");
    expect(row.back).toBe("there");
  });

  it("non-string front → 400 and persists nothing", async () => {
    await expectRejected(await create({ front: 123, back: "ok" }));
    expect(await rowCount()).toBe(0);
  });

  it("missing front → 400 and persists nothing", async () => {
    await expectRejected(await create({ back: "ok" }));
    expect(await rowCount()).toBe(0);
  });

  it("unknown key → 400 (.strict) and persists nothing", async () => {
    await expectRejected(await create({ front: "ok", back: "ok", extra: 1 }));
    expect(await rowCount()).toBe(0);
  });

  it("non-JSON body → 400 and persists nothing", async () => {
    const res = await createRoute(rawContext("POST", "/api/flashcards", "not json {"));
    await expectRejected(res);
    expect(await rowCount()).toBe(0);
  });
});

describe("Risk #6 — PATCH (PATCH /api/flashcards/[id]) input validation", () => {
  let card: SeededFlashcard;

  beforeEach(async () => {
    card = await seedFlashcard(client, user.id, { front: "Question?", back: "Answer.", status: "accepted" });
  });

  async function reread(): Promise<{ front: string; status: string }> {
    const { data } = await client.from("flashcards").select("front, status").eq("id", card.id).single();
    return data as { front: string; status: string };
  }

  it("empty patch body → 400 and leaves the row unchanged", async () => {
    await expectRejected(await patch(card.id, {}));
    expect(await reread()).toEqual({ front: "Question?", status: "accepted" });
  });

  it("valid single-field patch → 200", async () => {
    const res = await patch(card.id, { front: "x" });
    expect(res.status).toBe(200);
    expect((await reread()).front).toBe("x");
  });

  it("empty front → 400 and leaves the row unchanged", async () => {
    await expectRejected(await patch(card.id, { front: "" }));
    expect((await reread()).front).toBe("Question?");
  });

  it("status outside the enum → 400 and leaves the row unchanged", async () => {
    await expectRejected(await patch(card.id, { status: "maybe" }));
    expect(await reread()).toEqual({ front: "Question?", status: "accepted" });
  });

  it("non-string front → 400", async () => {
    await expectRejected(await patch(card.id, { front: 123 }));
  });

  it("unknown key → 400 (.strict)", async () => {
    await expectRejected(await patch(card.id, { status: "accepted", extra: 1 }));
  });

  it("PINNED: no .max on PATCH front/back — a 5,000-char front is accepted (200)", async () => {
    // PINNED: the PATCH schema has .trim().min(1) but NO .max, while create caps
    // front/back at 1,000. This asserts current behaviour, not endorsement —
    // see context/foundation/test-plan.md §6.6 (Phase 3) follow-up.
    const huge = "x".repeat(5000);
    const res = await patch(card.id, { front: huge });
    expect(res.status).toBe(200);
    expect((await reread()).front).toBe(huge);
  });

  it("malformed [id] → 400 before the body is parsed", async () => {
    const res = await patch("not-a-uuid", { front: "x" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid flashcard ID");
    // The seeded row is untouched.
    expect((await reread()).front).toBe("Question?");
  });

  it("well-formed but nonexistent [id] → 404", async () => {
    const res = await patch("11111111-1111-4111-8111-111111111111", { front: "x" });
    expect(res.status).toBe(404);
  });

  it("non-JSON body → 400", async () => {
    const res = await patchRoute(rawContext("PATCH", `/api/flashcards/${card.id}`, "not json {", { id: card.id }));
    await expectRejected(res);
    expect((await reread()).front).toBe("Question?");
  });
});

describe("Risk #6 — review (POST /api/flashcards/[id]/review) input validation", () => {
  let card: SeededFlashcard;

  beforeEach(async () => {
    card = await seedFlashcard(client, user.id);
  });

  async function reps(): Promise<number> {
    const { data } = await client.from("flashcards").select("reps").eq("id", card.id).single();
    return (data as { reps: number }).reps;
  }

  it("valid rating → 200", async () => {
    const res = await review(card.id, { rating: 1 });
    expect(res.status).toBe(200);
  });

  it("rating below the allowed set → 400 and leaves the schedule unchanged", async () => {
    await expectRejected(await review(card.id, { rating: 0 }));
    expect(await reps()).toBe(0);
  });

  it("non-integer rating → 400", async () => {
    await expectRejected(await review(card.id, { rating: 3.5 }));
    expect(await reps()).toBe(0);
  });

  it("string rating → 400", async () => {
    await expectRejected(await review(card.id, { rating: "3" }));
  });

  it("missing rating → 400", async () => {
    await expectRejected(await review(card.id, {}));
  });

  it("unknown key → 400 (.strict)", async () => {
    await expectRejected(await review(card.id, { rating: 3, extra: 1 }));
  });

  it("malformed [id] → 400", async () => {
    const res = await review("abc", { rating: 3 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid flashcard ID");
  });

  it("non-JSON body → 400", async () => {
    const res = await reviewRoute(
      rawContext("POST", `/api/flashcards/${card.id}/review`, "not json {", { id: card.id }),
    );
    await expectRejected(res);
    expect(await reps()).toBe(0);
  });
});

const generateSuite = OPENROUTER_API_KEY ? describe : describe.skip;

generateSuite("Risk #6 — generate (POST /api/flashcards/generate) input validation", () => {
  const VALID = "s".repeat(200);
  const envelope = (content: string) => JSON.stringify({ choices: [{ message: { content } }] });
  const proposals = (n: number) =>
    new Response(
      envelope(
        JSON.stringify({
          flashcards: Array.from({ length: n }, (_, i) => ({ front: `Q${String(i)}`, back: `A${String(i)}` })),
        }),
      ),
      { status: 200 },
    );

  it("sourceText below 100 chars → 400, provider never called, nothing persisted", async () => {
    mockProvider(() => proposals(1));
    await expectRejected(await generate({ sourceText: "s".repeat(99) }));
    expect(providerCalled()).toBe(false);
    expect(await rowCount()).toBe(0);
  });

  it("sourceText at exactly 100 chars → provider called → 201", async () => {
    mockProvider(() => proposals(2));
    const res = await generate({ sourceText: "s".repeat(100) });
    expect(res.status).toBe(201);
    expect(providerCalled()).toBe(true);
    expect(await rowCount()).toBe(2);
  });

  it("sourceText over 10,000 chars → 400", async () => {
    mockProvider(() => proposals(1));
    await expectRejected(await generate({ sourceText: "s".repeat(10001) }));
    expect(providerCalled()).toBe(false);
  });

  it("non-string sourceText → 400", async () => {
    mockProvider(() => proposals(1));
    await expectRejected(await generate({ sourceText: 42 }));
  });

  it("missing sourceText → 400", async () => {
    mockProvider(() => proposals(1));
    await expectRejected(await generate({}));
  });

  it("PINNED: no .strict() on generate — an unknown key is ignored (201)", async () => {
    // PINNED: the generate schema is a bare z.object with no .strict(), so extra
    // keys pass silently. Current behaviour, not endorsement — see
    // context/foundation/test-plan.md §6.6 (Phase 3) follow-up.
    mockProvider(() => proposals(1));
    const res = await generate({ sourceText: VALID, junk: true });
    expect(res.status).toBe(201);
    const rows = await ownRows<{ source_text: string }>("source_text");
    expect(rows.every((r) => r.source_text === VALID)).toBe(true);
  });

  it("PINNED: no .trim() on generate — 150 spaces is a valid sourceText (201)", async () => {
    // PINNED: the generate schema has no .trim(), so a whitespace-only string of
    // length >= 100 passes and is stored verbatim. Current behaviour, not
    // endorsement — see context/foundation/test-plan.md §6.6 (Phase 3) follow-up.
    const spaces = " ".repeat(150);
    mockProvider(() => proposals(1));
    const res = await generate({ sourceText: spaces });
    expect(res.status).toBe(201);
    expect(providerCalled()).toBe(true);
    const rows = await ownRows<{ source_text: string }>("source_text");
    expect(rows.every((r) => r.source_text === spaces)).toBe(true);
  });

  it("non-JSON body → 400 and provider never called", async () => {
    mockProvider(() => proposals(1));
    const res = await generateRoute(rawContext("POST", "/api/flashcards/generate", "not json {"));
    await expectRejected(res);
    expect(providerCalled()).toBe(false);
  });
});
