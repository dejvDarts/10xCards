import { useState } from "react";
import { readJsonResponse } from "@/lib/http";
import type { CreateFlashcardRequest, Flashcard, ListFlashcardsResponse } from "@/types";

export function useFlashcardList(initialData: ListFlashcardsResponse | null, initialError?: string) {
  const [flashcards, setFlashcards] = useState<Flashcard[]>(initialData?.flashcards ?? []);
  const [page, setPage] = useState(initialData?.page ?? 1);
  const [limit, setLimit] = useState(initialData?.limit ?? 20);
  const [totalPages, setTotalPages] = useState(initialData?.totalPages ?? 1);
  const [total, setTotal] = useState(initialData?.total ?? 0);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [isLoading, setIsLoading] = useState(false);
  const [mutatingCardIds, setMutatingCardIds] = useState<Set<string>>(new Set());
  const [isCreating, setIsCreating] = useState(false);

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

    const deleteState = { willBeEmpty: false };
    setFlashcards((current) => {
      const next = current.filter((c) => c.id !== card.id);
      deleteState.willBeEmpty = next.length === 0;
      return next;
    });

    let newTotal = total;
    setTotal((t) => {
      newTotal = t - 1;
      return newTotal;
    });
    setTotalPages(Math.max(1, Math.ceil(newTotal / limit)));

    try {
      const response = await fetch(`/api/flashcards/${card.id}`, { method: "DELETE" });
      await readJsonResponse<null>(response);
      if (deleteState.willBeEmpty && page > 1) {
        await goToPage(page - 1);
      }
    } catch (requestError) {
      setFlashcards((current) => [...current.slice(0, cardIndex), card, ...current.slice(cardIndex)]);
      let restoredTotal = newTotal;
      setTotal((t) => {
        restoredTotal = t + 1;
        return restoredTotal;
      });
      setTotalPages(Math.max(1, Math.ceil(restoredTotal / limit)));
      setError(requestError instanceof Error ? requestError.message : "Flashcard delete failed");
    } finally {
      stopMutating(card.id);
    }
  }

  async function createFlashcard(input: CreateFlashcardRequest) {
    setError(null);
    setIsCreating(true);

    try {
      const response = await fetch("/api/flashcards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const created = await readJsonResponse<Flashcard>(response);

      if (page !== 1) {
        await goToPage(1);
      } else {
        setFlashcards((current) => [created, ...current].slice(0, limit));
        const newTotal = total + 1;
        setTotal(newTotal);
        setTotalPages(Math.max(1, Math.ceil(newTotal / limit)));
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Flashcard creation failed");
      throw requestError;
    } finally {
      setIsCreating(false);
    }
  }

  return {
    createFlashcard,
    deleteFlashcard,
    editFlashcard,
    error,
    flashcards,
    goToPage,
    isCreating,
    isLoading,
    mutatingCardIds,
    page,
    retry,
    total,
    totalPages,
  };
}
