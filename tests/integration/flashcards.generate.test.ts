import { afterEach, afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OPENROUTER_API_KEY } from "astro:env/server";
import { POST as generateRoute } from "@/pages/api/flashcards/generate";
import { createTestUser, deleteTestUser, signedInClient, type TestUser } from "./helpers/users";
import { apiContext, cookieHeaderFor } from "./helpers/session";
import { resetFlashcards } from "./helpers/db";
import { mockProvider, providerCalled } from "./helpers/mock-provider";

// The generate handler makes TWO kinds of outbound calls: Supabase auth
// (getUser) and the OpenRouter provider. `mockProvider` (see
// ./helpers/mock-provider) intercepts ONLY openrouter.ai and lets everything
// else hit the real local Supabase. Relies on .dev.vars carrying
// OPENROUTER_API_KEY.
const suite = OPENROUTER_API_KEY ? describe : describe.skip;

const SOURCE = "x".repeat(200);

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
