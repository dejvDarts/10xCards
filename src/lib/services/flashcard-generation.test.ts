// NOTE: no AbortController/timeout — a hung provider is bounded only by the
// Cloudflare Workers platform CPU limit. There is no application-level deadline
// to assert, so the "times out" case has no test (see test-plan.md §6.4).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockEnv } = vi.hoisted(() => {
  const env: { OPENROUTER_API_KEY: string | undefined; OPENROUTER_MODEL: string | undefined } = {
    OPENROUTER_API_KEY: "test-key",
    OPENROUTER_MODEL: "test/model",
  };
  return { mockEnv: env };
});
vi.mock("astro:env/server", () => mockEnv);

import { FlashcardGenerationError, generateFlashcardProposals } from "./flashcard-generation";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const SOURCE = "x".repeat(200);

/** Wrap a `content` string into OpenRouter's chat-completions envelope. */
const envelope = (content: string) => JSON.stringify({ choices: [{ message: { content } }] });
const jsonResponse = (body: string, status = 200) =>
  new Response(body, { status, headers: { "Content-Type": "application/json" } });

const spyOnFetch = () => vi.spyOn(globalThis, "fetch");
let fetchSpy: ReturnType<typeof spyOnFetch>;

beforeEach(() => {
  mockEnv.OPENROUTER_API_KEY = "test-key";
  fetchSpy = spyOnFetch();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("generateFlashcardProposals — error branches", () => {
  it("branch 1: throws when OPENROUTER_API_KEY is not configured (no fetch)", async () => {
    mockEnv.OPENROUTER_API_KEY = undefined;
    await expect(generateFlashcardProposals(SOURCE)).rejects.toThrow("OPENROUTER_API_KEY is not configured");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("branch 2: throws when the provider is unreachable (fetch rejects)", async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(generateFlashcardProposals(SOURCE)).rejects.toThrow("Failed to reach the AI provider");
  });

  it("branch 3: throws on a non-OK provider status", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("rate limited", { status: 429 }));
    await expect(generateFlashcardProposals(SOURCE)).rejects.toThrow("AI provider returned an error (status 429)");
  });

  it("branch 4: throws when the response body is not JSON", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("<html>bad gateway</html>", { status: 200 }));
    await expect(generateFlashcardProposals(SOURCE)).rejects.toThrow("AI provider returned an invalid JSON response");
  });

  it("branch 5: throws when choices is empty", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(JSON.stringify({ choices: [] })));
    await expect(generateFlashcardProposals(SOURCE)).rejects.toThrow(
      "AI provider response was missing message content",
    );
  });

  it("branch 5: throws when message content is an empty string", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(envelope("")));
    await expect(generateFlashcardProposals(SOURCE)).rejects.toThrow(
      "AI provider response was missing message content",
    );
  });

  it("branch 6: throws when content is not valid JSON", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(envelope("here are your flashcards!")));
    await expect(generateFlashcardProposals(SOURCE)).rejects.toThrow("AI provider content was not valid JSON");
  });

  it("branch 7: throws when the flashcards array is empty", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(envelope(JSON.stringify({ flashcards: [] }))));
    await expect(generateFlashcardProposals(SOURCE)).rejects.toThrow(
      "AI provider output did not match the expected flashcard shape",
    );
  });

  it("branch 7: throws when there are more than 15 flashcards", async () => {
    const flashcards = Array.from({ length: 16 }, (_, i) => ({ front: `q${String(i)}`, back: `a${String(i)}` }));
    fetchSpy.mockResolvedValueOnce(jsonResponse(envelope(JSON.stringify({ flashcards }))));
    await expect(generateFlashcardProposals(SOURCE)).rejects.toThrow(
      "AI provider output did not match the expected flashcard shape",
    );
  });

  it("branch 7: throws when a flashcard field is blank", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(envelope(JSON.stringify({ flashcards: [{ front: "", back: "a" }] }))));
    await expect(generateFlashcardProposals(SOURCE)).rejects.toThrow(
      "AI provider output did not match the expected flashcard shape",
    );
  });

  it("every failure is a FlashcardGenerationError", async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(generateFlashcardProposals(SOURCE)).rejects.toBeInstanceOf(FlashcardGenerationError);
  });
});

describe("generateFlashcardProposals — happy path", () => {
  it("returns the parsed proposals and calls the provider with a Bearer header", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(envelope(JSON.stringify({ flashcards: [{ front: "Q", back: "A" }] }))));

    const result = await generateFlashcardProposals(SOURCE);

    expect(result).toEqual([{ front: "Q", back: "A" }]);
    expect(fetchSpy).toHaveBeenCalledWith(
      OPENROUTER_URL,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
      }),
    );
  });
});
