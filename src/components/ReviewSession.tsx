import { LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useReviewSession } from "@/components/hooks/useReviewSession";
import type { DueFlashcardsResponse } from "@/types";

const RATING_BUTTONS = [
  { rating: 1, label: "Again", className: "bg-red-300 text-red-950 hover:bg-red-200" },
  { rating: 2, label: "Hard", className: "bg-amber-300 text-amber-950 hover:bg-amber-200" },
  { rating: 3, label: "Good", className: "bg-emerald-300 text-emerald-950 hover:bg-emerald-200" },
  { rating: 4, label: "Easy", className: "bg-blue-300 text-slate-950 hover:bg-blue-200" },
] as const;

interface ReviewSessionProps {
  initialData: DueFlashcardsResponse | null;
  initialError?: string;
}

export default function ReviewSession({ initialData, initialError }: ReviewSessionProps) {
  const {
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
  } = useReviewSession(initialData, initialError);

  return (
    <div className="space-y-6">
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

      {!error && isSessionComplete && (
        <div className="border-y border-white/10 py-10 text-center">
          <p className="text-blue-100/75">No cards due right now. Come back later.</p>
          <div className="mt-4">
            <Button asChild className="bg-blue-300 text-slate-950 hover:bg-blue-200">
              <a href="/flashcards">Back to your flashcards</a>
            </Button>
          </div>
        </div>
      )}

      {currentCard && (
        <>
          <p className="text-sm text-blue-100/60">{remainingCount} card(s) left in this session</p>
          <Card className="gap-4 rounded-lg border-white/15 bg-white/10 py-5 text-white shadow-none">
            <CardHeader className="px-5">
              <CardTitle className="text-sm text-blue-100/70">Question</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-5">
              <p>{currentCard.front}</p>
              {isRevealed && (
                <div>
                  <p className="mb-1 text-sm font-medium text-blue-100">Answer</p>
                  <p className="text-blue-100/80">{currentCard.back}</p>
                </div>
              )}
            </CardContent>
            <CardFooter className="justify-end gap-2 px-5">
              {isRevealed ? (
                RATING_BUTTONS.map(({ rating, label, className }) => (
                  <Button
                    key={rating}
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => {
                      void submitRating(rating);
                    }}
                    className={className}
                  >
                    {isSubmitting ? <LoaderCircle className="animate-spin" /> : null}
                    {label}
                  </Button>
                ))
              ) : (
                <Button type="button" onClick={reveal} className="bg-blue-300 text-slate-950 hover:bg-blue-200">
                  Show answer
                </Button>
              )}
            </CardFooter>
          </Card>
        </>
      )}
    </div>
  );
}
