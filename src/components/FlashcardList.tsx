import { ChevronLeft, ChevronRight, LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useFlashcardList } from "@/components/hooks/useFlashcardList";
import type { ListFlashcardsResponse } from "@/types";

interface FlashcardListProps {
  initialData: ListFlashcardsResponse | null;
  initialError?: string;
}

export default function FlashcardList({ initialData, initialError }: FlashcardListProps) {
  const { error, flashcards, goToPage, isLoading, page, retry, total, totalPages } = useFlashcardList(
    initialData,
    initialError,
  );

  return (
    <div className="space-y-8">
      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 border border-red-300/40 bg-red-950/40 px-4 py-3 text-sm text-red-100"
        >
          <span>{error}</span>
          <Button
            type="button"
            variant="outline"
            disabled={isLoading}
            onClick={() => {
              void retry();
            }}
            className="border-red-200/40 bg-transparent text-red-50 hover:bg-red-200/10 hover:text-white"
          >
            {isLoading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
            Retry
          </Button>
        </div>
      )}

      {!error && total === 0 && (
        <div className="border-y border-white/10 py-10 text-center">
          <p className="text-blue-100/75">You haven&apos;t saved any flashcards yet.</p>
          <Button asChild className="mt-4 bg-blue-300 text-slate-950 hover:bg-blue-200">
            <a href="/generate">Generate flashcards</a>
          </Button>
        </div>
      )}

      {flashcards.length > 0 && (
        <section aria-labelledby="flashcards-heading">
          <div className="mb-4 flex items-baseline justify-between gap-4">
            <h2 id="flashcards-heading" className="text-xl font-semibold text-white">
              Your flashcards
            </h2>
            <span className="text-sm text-blue-100/60">{total} saved</span>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {flashcards.map((card) => (
              <Card key={card.id} className="gap-4 rounded-lg border-white/15 bg-white/10 py-5 text-white shadow-none">
                <CardHeader className="px-5">
                  <CardTitle className="text-sm text-blue-100/70">Question</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 px-5">
                  <p>{card.front}</p>
                  <div>
                    <p className="mb-1 text-sm font-medium text-blue-100">Answer</p>
                    <p className="text-blue-100/80">{card.back}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="mt-6 flex items-center justify-center gap-4">
            <Button
              type="button"
              variant="outline"
              disabled={page <= 1 || isLoading}
              onClick={() => {
                void goToPage(page - 1);
              }}
              className="border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white"
            >
              <ChevronLeft />
              Previous
            </Button>
            <span className="text-sm text-blue-100/70">
              Page {page} of {totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              disabled={page >= totalPages || isLoading}
              onClick={() => {
                void goToPage(page + 1);
              }}
              className="border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white"
            >
              Next
              <ChevronRight />
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
