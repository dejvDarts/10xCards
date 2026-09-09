import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DueFlashcardsResponse, Flashcard } from "@/types";
import { useReviewSession } from "@/components/hooks/useReviewSession";

function makeCard(id: string): Flashcard {
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
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useReviewSession — submitRating does not advance on failure", () => {
  it("keeps the current card, queue and reveal state when the review POST fails", async () => {
    const data: DueFlashcardsResponse = { flashcards: [makeCard("a"), makeCard("b")] };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "Boom" }), { status: 500 }));
    const { result } = renderHook(() => useReviewSession(data));

    act(() => {
      result.current.reveal();
    });
    expect(result.current.currentCard?.id).toBe("a");
    expect(result.current.isRevealed).toBe(true);

    await act(async () => {
      await result.current.submitRating(3);
    });

    expect(result.current.currentCard?.id).toBe("a");
    expect(result.current.remainingCount).toBe(2);
    expect(result.current.isRevealed).toBe(true);
    expect(result.current.error).toBeTruthy();
    expect(result.current.isSubmitting).toBe(false);
  });
});
