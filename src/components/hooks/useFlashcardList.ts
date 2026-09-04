import { useState } from "react";
import { readJsonResponse } from "@/lib/http";
import type { Flashcard, ListFlashcardsResponse } from "@/types";

export function useFlashcardList(initialData: ListFlashcardsResponse | null, initialError?: string) {
  const [flashcards, setFlashcards] = useState<Flashcard[]>(initialData?.flashcards ?? []);
  const [page, setPage] = useState(initialData?.page ?? 1);
  const [totalPages, setTotalPages] = useState(initialData?.totalPages ?? 1);
  const [total, setTotal] = useState(initialData?.total ?? 0);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [isLoading, setIsLoading] = useState(false);

  async function goToPage(nextPage: number) {
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch(`/api/flashcards?page=${nextPage}`);
      const result = await readJsonResponse<ListFlashcardsResponse>(response);
      setFlashcards(result.flashcards);
      setPage(result.page);
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

  return {
    error,
    flashcards,
    goToPage,
    isLoading,
    page,
    retry,
    total,
    totalPages,
  };
}
