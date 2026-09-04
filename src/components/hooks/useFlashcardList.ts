import { useState } from "react";
import { readJsonResponse } from "@/lib/http";
import type { Flashcard, ListFlashcardsResponse } from "@/types";

export function useFlashcardList(initialData: ListFlashcardsResponse | null, initialError?: string) {
  const [flashcards, setFlashcards] = useState<Flashcard[]>(initialData?.flashcards ?? []);
  const [page, setPage] = useState(initialData?.page ?? 1);
  const [limit, setLimit] = useState(initialData?.limit ?? 20);
  const [totalPages, setTotalPages] = useState(initialData?.totalPages ?? 1);
  const [total, setTotal] = useState(initialData?.total ?? 0);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [isLoading, setIsLoading] = useState(false);
  const [mutatingCardIds, setMutatingCardIds] = useState<Set<string>>(new Set());

  async function goToPage(nextPage: number) {
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch(`/api/flashcards?page=${nextPage}`);
      const result = await readJsonResponse<ListFlashcardsResponse>(response);
      setFlashcards(result.flashcards);
      setPage(result.page);
      setLimit(result.limit);
      setTotalPages(result.totalPages);
      setTotal(result.total);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to load flashcards");
    } finally {
      setIsLoading(false);
    }
  }

  async function retry() {
    await goToPage(page);
  }

  function startMutating(cardId: string) {
    setMutatingCardIds((current) => new Set(current).add(cardId));
  }

  function stopMutating(cardId: string) {
    setMutatingCardIds((current) => {
      const next = new Set(current);
      next.delete(cardId);
      return next;
    });
  }

  async function editFlashcard(card: Flashcard, updates: { front: string; back: string }) {
    setError(null);
    startMutating(card.id);
    setFlashcards((current) => current.map((c) => (c.id === card.id ? { ...c, ...updates } : c)));

    try {
      const response = await fetch(`/api/flashcards/${card.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      await readJsonResponse<Flashcard>(response);
    } catch (requestError) {
      setFlashcards((current) =>
        current.map((c) => (c.id === card.id ? { ...c, front: card.front, back: card.back } : c)),
      );
      setError(requestError instanceof Error ? requestError.message : "Flashcard update failed");
    } finally {
      stopMutating(card.id);
    }
  }

  async function deleteFlashcard(card: Flashcard) {
    const cardIndex = flashcards.findIndex((current) => current.id === card.id);
    if (cardIndex === -1) return;

    setError(null);
    startMutating(card.id);
    const remaining = flashcards.length - 1;
    const newTotal = total - 1;
    setFlashcards((current) => current.filter((c) => c.id !== card.id));
    setTotal(newTotal);
    setTotalPages(Math.max(1, Math.ceil(newTotal / limit)));

    try {
      const response = await fetch(`/api/flashcards/${card.id}`, { method: "DELETE" });
      await readJsonResponse<null>(response);
      if (remaining === 0 && page > 1) {
        await goToPage(page - 1);
      }
    } catch (requestError) {
      setFlashcards((current) => [...current.slice(0, cardIndex), card, ...current.slice(cardIndex)]);
      setTotal(total);
      setTotalPages(Math.max(1, Math.ceil(total / limit)));
      setError(requestError instanceof Error ? requestError.message : "Flashcard delete failed");
    } finally {
      stopMutating(card.id);
    }
  }

  return {
    deleteFlashcard,
    editFlashcard,
    error,
    flashcards,
    goToPage,
    isLoading,
    mutatingCardIds,
    page,
    retry,
    total,
    totalPages,
  };
}
