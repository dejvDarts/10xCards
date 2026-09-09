import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Flashcard, GenerateFlashcardsResponse } from "@/types";
import { useFlashcardProposals } from "@/components/hooks/useFlashcardProposals";

function makeCard(id: string): Flashcard {
  return {
    id,
    user_id: "u1",
    front: `front-${id}`,
    back: `back-${id}`,
    source_text: "src",
    status: "pending",
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

describe("useFlashcardProposals — updateFlashcard rollback", () => {
  it("re-inserts the proposal at its original index when the PATCH fails", async () => {
    const proposals = [makeCard("0"), makeCard("1")];
    // The hook has no initialData — seed via a mocked-success generate().
    // generate reads readJsonResponse<GenerateFlashcardsResponse> = { flashcards }.
    const genBody: GenerateFlashcardsResponse = { flashcards: proposals };
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(genBody), { status: 201 }));

    const { result } = renderHook(() => useFlashcardProposals());
    await act(async () => {
      await result.current.generate("x".repeat(150));
    });
    expect(result.current.flashcards.map((c) => c.id)).toEqual(["0", "1"]);

    fetchSpy.mockRejectedValueOnce(new TypeError("network down"));
    await act(async () => {
      await result.current.updateFlashcard(proposals[0], "accepted");
    });

    expect(result.current.flashcards.map((c) => c.id)).toEqual(["0", "1"]);
    expect(result.current.error).toBeTruthy();
    expect(result.current.updatingCardId).toBeNull();
  });
});
