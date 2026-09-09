import { afterEach, afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OPENROUTER_API_KEY } from "astro:env/server";
import { POST as generateRoute } from "@/pages/api/flashcards/generate";
import { createTestUser, deleteTestUser, signedInClient, type TestUser } from "./helpers/users";
import { apiContext, cookieHeaderFor } from "./helpers/session";
import { resetFlashcards } from "./helpers/db";

// The handler makes TWO kinds of outbound calls: Supabase auth (getUser) and
// the OpenRouter provider. We mock ONLY the network edge that matters —
// openrouter.ai — and let everything else hit the real local Supabase. Mocking
// astro:env/server is avoided on purpose (it would null SUPABASE_* and break the
// real DB insert). Relies on .dev.vars carrying OPENROUTER_API_KEY.
const realFetch = globalThis.fetch.bind(globalThis);
const suite = OPENROUTER_API_KEY ? describe : describe.skip;

const SOURCE = "x".repeat(200);
const OPENROUTER = "openrouter.ai";

const urlOf = (input: RequestInfo | URL): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

const envelope = (content: string) => JSON.stringify({ choices: [{ message: { content } }] });
const proposalsResponse = (n: number) =>
  new Response(
    envelope(
      JSON.stringify({
        flashcards: Array.from({ length: n }, (_, i) => ({ front: `Q${String(i)}`, back: `A${String(i)}` })),
      }),
    ),
    { status: 200 },
  );

let user: TestUser;
let client: SupabaseClient;
let cookie: string;
let fetchSpy: ReturnType<typeof vi.spyOn>;

/** Intercept openrouter.ai with `handler`; pass every other request through. */
function mockProvider(handler: () => Promise<Response> | Response) {
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    if (urlOf(input).includes(OPENROUTER)) return Promise.resolve(handler());
    return realFetch(input, init);
  });
}

const providerCalled = () =>
  fetchSpy.mock.calls.some(([input]) => urlOf(input as RequestInfo | URL).includes(OPENROUTER));

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

function callGenerate(body: unknown, withCookie = true) {
  return generateRoute(
    apiContext({
      method: "POST",
      path: "/api/flashcards/generate",
      cookieHeader: withCookie ? cookie : undefined,
      body,
    }),
  );
}

async function ownRows() {
  const { data } = await client.from("flashcards").select("*").eq("source_text", SOURCE);
  return (data ?? []) as { status: string; source_text: string }[];
}

suite("Risk #3 — generate route smoke", () => {
  it("happy path: 201 and persists pending rows", async () => {
    mockProvider(() => proposalsResponse(2));

    const res = await callGenerate({ sourceText: SOURCE });

    expect(res.status).toBe(201);
    expect(((await res.json()) as { flashcards: unknown[] }).flashcards).toHaveLength(2);

    const rows = await ownRows();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === "pending")).toBe(true);
    expect(rows.every((r) => r.source_text === SOURCE)).toBe(true);
  });

  it("provider failure passes through as 502 and persists nothing", async () => {
    mockProvider(() => Promise.reject(new TypeError("boom")));

    const res = await callGenerate({ sourceText: SOURCE });

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Failed to reach the AI provider" });
    expect(await ownRows()).toHaveLength(0);
  });

  it("rejects too-short sourceText with 400 and never calls the provider", async () => {
    mockProvider(() => proposalsResponse(1));

    const res = await callGenerate({ sourceText: "too short" });

    expect(res.status).toBe(400);
    expect(providerCalled()).toBe(false);
  });

  it("rejects an unauthenticated request with 401 and never calls the provider", async () => {
    mockProvider(() => proposalsResponse(1));

    const res = await callGenerate({ sourceText: SOURCE }, false);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(providerCalled()).toBe(false);
  });

  it("restores the real fetch between tests (no mock leak)", () => {
    expect(vi.isMockFunction(globalThis.fetch)).toBe(false);
  });
});
