import { useState } from "react";
import { readJsonResponse } from "@/lib/http";
import type { DueFlashcardsResponse, Flashcard, SubmitReviewRequest } from "@/types";

export function useReviewSession(initialData: DueFlashcardsResponse | null, initialError?: string) {
  const [queue] = useState<Flashcard[]>(initialData?.flashcards ?? []);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isRevealed, setIsRevealed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);

  const currentCard: Flashcard | null = currentIndex < queue.length ? queue[currentIndex] : null;
  const remainingCount = Math.max(0, queue.length - currentIndex);
  const isSessionComplete = remainingCount === 0;

  function reveal() {
    setIsRevealed(true);
  }

  async function submitRating(rating: SubmitReviewRequest["rating"]) {
    if (!currentCard) return;
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/flashcards/${currentCard.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating } satisfies SubmitReviewRequest),
      });
      await readJsonResponse<Flashcard>(response);
      setCurrentIndex((index) => index + 1);
      setIsRevealed(false);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to record review");
    } finally {
      setIsSubmitting(false);
    }
  }

  return {
    currentCard,
    isRevealed,
    reveal,
    submitRating,
    isSubmitting,
    error,
    remainingCount,
    isSessionComplete,
  };
}
