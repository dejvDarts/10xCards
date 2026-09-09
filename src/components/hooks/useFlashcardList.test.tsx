import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Flashcard, ListFlashcardsResponse } from "@/types";
import { useFlashcardList } from "@/components/hooks/useFlashcardList";

function makeCard(id: string, over: Partial<Flashcard> = {}): Flashcard {
  return {
    id,
    user_id: "u1",
    front: `front-${id}`,
    back: `back-${id}`,
    source_text: null,
    status: "accepted",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    due: "2026-01-01T00:00:00.000Z",
    stability: 0,
    difficulty: 0,
    scheduled_days: 0,
    learning_steps: 0,
    reps: 0,
    lapses: 0,
    state: 0,
    last_review: null,
    ...over,
  };
}

function listData(cards: Flashcard[], over: Partial<ListFlashcardsResponse> = {}): ListFlashcardsResponse {
  return { flashcards: cards, page: 1, limit: 20, total: cards.length, totalPages: 1, ...over };
}

const err500 = () => new Response(JSON.stringify({ error: "Boom" }), { status: 500 });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useFlashcardList — optimistic rollback", () => {
  it("editFlashcard: a failed PATCH rolls front/back back and surfaces an error", async () => {
    const cardA = makeCard("a");
    const cardB = makeCard("b");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(err500());
    const { result } = renderHook(() => useFlashcardList(listData([cardA, cardB])));

    await act(async () => {
      await result.current.editFlashcard(cardA, { front: "NEW", back: "NEW" });
    });

    const rolledBack = result.current.flashcards.find((c) => c.id === "a");
    expect(rolledBack?.front).toBe(cardA.front);
    expect(rolledBack?.back).toBe(cardA.back);
    expect(result.current.flashcards).toHaveLength(2);
    expect(result.current.total).toBe(2);
    expect(result.current.totalPages).toBe(1);
    expect(result.current.error).toBeTruthy();
    expect(result.current.mutatingCardIds.has("a")).toBe(false);
  });

  it("deleteFlashcard: a failed DELETE re-inserts the card at its index and restores counters", async () => {
    const cards = [makeCard("a"), makeCard("b"), makeCard("c")];
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("network down"));
    const { result } = renderHook(() => useFlashcardList(listData(cards, { total: 3 })));

    await act(async () => {
      await result.current.deleteFlashcard(cards[1]);
    });

    expect(result.current.flashcards.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(result.current.total).toBe(3);
    expect(result.current.totalPages).toBe(1);
    expect(result.current.error).toBeTruthy();
    expect(result.current.mutatingCardIds.has("b")).toBe(false);
  });

  it("deleteFlashcard: removing the last card of page > 1 navigates back a page on success", async () => {
    const only = makeCard("only");
    const page1: ListFlashcardsResponse = {
      flashcards: [makeCard("p1a"), makeCard("p1b")],
      page: 1,
      limit: 20,
      total: 20,
      totalPages: 1,
    };
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      // A macrotask delay on the DELETE so React flushes the optimistic
      // `setFlashcards` (which sets `willBeEmpty`) before the hook checks it —
      // mirrors a real network round-trip.
      if (init?.method === "DELETE") {
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve(new Response(null, { status: 204 }));
          }, 0);
        });
      }
      return Promise.resolve(new Response(JSON.stringify(page1), { status: 200 }));
    });
    const { result } = renderHook(() => useFlashcardList(listData([only], { page: 2, total: 21, totalPages: 2 })));

    // Kick off the delete in a sync act so React flushes the optimistic
    // `setFlashcards` (which sets the hook's internal `willBeEmpty` flag) BEFORE
    // the DELETE resolves — otherwise the flag is still false when the hook
    // decides whether to navigate back a page. In a browser the network latency
    // covers this; here we stage it explicitly.
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.deleteFlashcard(only);
    });
    await act(async () => {
      await pending;
    });

    expect(result.current.page).toBe(1);
    expect(result.current.flashcards.map((c) => c.id)).toEqual(["p1a", "p1b"]);
    expect(result.current.error).toBeNull();
  });

  it("createFlashcard: rejects on failure and adds no phantom row", async () => {
    const cards = [makeCard("a"), makeCard("b")];
    vi.spyOn(globalThis, "fetch").mockResolvedValue(err500());
    const { result } = renderHook(() => useFlashcardList(listData(cards, { total: 2 })));

    await act(async () => {
      await expect(result.current.createFlashcard({ front: "x", back: "y" })).rejects.toThrow();
    });

    expect(result.current.flashcards).toHaveLength(2);
    expect(result.current.total).toBe(2);
    expect(result.current.error).toBeTruthy();
  });
});
