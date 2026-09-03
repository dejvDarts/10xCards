import { useState } from "react";
import type { Flashcard, GenerateFlashcardsResponse, UpdateFlashcardRequest } from "@/types";

interface ApiError {
  error?: string;
}

async function readResponse<T>(response: Response): Promise<T> {
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body === "object" && body !== null ? (body as ApiError).error : undefined;
    throw new Error(message ?? "The request could not be completed");
  }
  return body as T;
}

export function useFlashcardProposals() {
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [canRetryGeneration, setCanRetryGeneration] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [updatingCardId, setUpdatingCardId] = useState<string | null>(null);

  async function generate(sourceText: string) {
    setError(null);
    setCanRetryGeneration(false);
    setIsGenerating(true);

    try {
      const response = await fetch("/api/flashcards/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceText }),
      });
      const result = await readResponse<GenerateFlashcardsResponse>(response);
      setFlashcards(result.flashcards);
    } catch (requestError) {
      setCanRetryGeneration(true);
      setError(requestError instanceof Error ? requestError.message : "Flashcard generation failed");
    } finally {
      setIsGenerating(false);
    }
  }

  function editFlashcard(id: string, field: "front" | "back", value: string) {
    setFlashcards((current) => current.map((card) => (card.id === id ? { ...card, [field]: value } : card)));
  }

  async function updateFlashcard(card: Flashcard, status: UpdateFlashcardRequest["status"]) {
    const cardIndex = flashcards.findIndex((current) => current.id === card.id);
    if (cardIndex === -1) return;

    setError(null);
    setCanRetryGeneration(false);
    setUpdatingCardId(card.id);
    setFlashcards((current) => current.filter((currentCard) => currentCard.id !== card.id));

    try {
      const response = await fetch(`/api/flashcards/${card.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, front: card.front, back: card.back }),
      });
      await readResponse<Flashcard>(response);
    } catch (requestError) {
      setFlashcards((current) => [...current.slice(0, cardIndex), card, ...current.slice(cardIndex)]);
      setError(requestError instanceof Error ? requestError.message : "Flashcard update failed");
    } finally {
      setUpdatingCardId(null);
    }
  }

  return {
    canRetryGeneration,
    editFlashcard,
    error,
    flashcards,
    generate,
    isGenerating,
    updateFlashcard,
    updatingCardId,
  };
}
