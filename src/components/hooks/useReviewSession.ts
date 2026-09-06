import { useState } from "react";
import { readJsonResponse } from "@/lib/http";
import type { DueFlashcardsResponse, Flashcard, SubmitReviewRequest } from "@/types";

export function useReviewSession(initialData: DueFlashcardsResponse | null, initialError?: string) {
  const [queue, setQueue] = useState<Flashcard[]>(initialData?.flashcards ?? []);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isRevealed, setIsRevealed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);

  const currentCard: Flashcard | null = currentIndex < queue.length ? queue[currentIndex] : null;
  const remainingCount = Math.max(0, queue.length - currentIndex);
  const isSessionComplete = remainingCount === 0;

  function reveal() {
    setIsRevealed(true);
  }

  // Re-fetches the due-list from scratch. This is the only retry path that
  // needs to reset currentIndex — a mid-session submitRating failure leaves
  // currentIndex untouched on purpose, so the user can just retry the same
  // card's rating without losing their place in the queue.
  async function retry() {
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch("/api/flashcards/due");
      const result = await readJsonResponse<DueFlashcardsResponse>(response);
      setQueue(result.flashcards);
      setCurrentIndex(0);
      setIsRevealed(false);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to load due flashcards");
    } finally {
      setIsLoading(false);
    }
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
    retry,
    isLoading,
  };
}
