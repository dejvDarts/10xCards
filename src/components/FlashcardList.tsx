import { type SubmitEvent, useState } from "react";
import { ChevronLeft, ChevronRight, LoaderCircle, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useFlashcardList } from "@/components/hooks/useFlashcardList";
import type { Flashcard, ListFlashcardsResponse } from "@/types";

const MAX_FIELD_LENGTH = 1000;

function fieldCounter(value: string): { text: string; isWarning: boolean } {
  const trimmedLength = value.trim().length;
  if (trimmedLength > MAX_FIELD_LENGTH) {
    return {
      text: `${(trimmedLength - MAX_FIELD_LENGTH).toLocaleString()} characters over the limit.`,
      isWarning: true,
    };
  }
  return {
    text: `${trimmedLength.toLocaleString()} / ${MAX_FIELD_LENGTH.toLocaleString()} characters`,
    isWarning: false,
  };
}

function isFieldValid(value: string): boolean {
  const trimmedLength = value.trim().length;
  return trimmedLength > 0 && trimmedLength <= MAX_FIELD_LENGTH;
}

interface FlashcardListProps {
  initialData: ListFlashcardsResponse | null;
  initialError?: string;
}

export default function FlashcardList({ initialData, initialError }: FlashcardListProps) {
  const {
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
  } = useFlashcardList(initialData, initialError);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [draftFront, setDraftFront] = useState("");
  const [draftBack, setDraftBack] = useState("");
  const [isCreateFormOpen, setIsCreateFormOpen] = useState(false);
  const [createFront, setCreateFront] = useState("");
  const [createBack, setCreateBack] = useState("");
  const canCreateSave = isFieldValid(createFront) && isFieldValid(createBack);

  async function handleCreateSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canCreateSave) return;
    try {
      await createFlashcard({ front: createFront, back: createBack });
      setCreateFront("");
      setCreateBack("");
    } catch {
      // Draft intentionally left in place; the hook already surfaced the error banner.
    }
  }

  function startEditing(card: Flashcard) {
    setEditingCardId(card.id);
    setDraftFront(card.front);
    setDraftBack(card.back);
  }

  function cancelEditing() {
    setEditingCardId(null);
  }

  async function saveEditing(card: Flashcard) {
    await editFlashcard(card, { front: draftFront, back: draftBack });
    setEditingCardId(null);
  }

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

      <section aria-labelledby="create-flashcard-heading">
        {isCreateFormOpen ? (
          <form onSubmit={handleCreateSubmit} className="border-y border-white/10 py-6">
            <h2 id="create-flashcard-heading" className="sr-only">
              New flashcard
            </h2>
            <div className="space-y-4">
              <div>
                <label htmlFor="create-front" className="mb-1.5 block text-sm font-medium text-blue-100">
                  Question
                </label>
                <Textarea
                  id="create-front"
                  value={createFront}
                  onChange={(event) => {
                    setCreateFront(event.target.value);
                  }}
                  placeholder="Front of the card..."
                  className="min-h-20 border-white/20 bg-white/10 text-white placeholder:text-white/40"
                  disabled={isCreating}
                />
                <p
                  className={`mt-1 text-xs ${fieldCounter(createFront).isWarning ? "text-amber-200" : "text-blue-100/60"}`}
                >
                  {fieldCounter(createFront).text}
                </p>
              </div>
              <div>
                <label htmlFor="create-back" className="mb-1.5 block text-sm font-medium text-blue-100">
                  Answer
                </label>
                <Textarea
                  id="create-back"
                  value={createBack}
                  onChange={(event) => {
                    setCreateBack(event.target.value);
                  }}
                  placeholder="Back of the card..."
                  className="min-h-24 border-white/20 bg-white/10 text-white placeholder:text-white/40"
                  disabled={isCreating}
                />
                <p
                  className={`mt-1 text-xs ${fieldCounter(createBack).isWarning ? "text-amber-200" : "text-blue-100/60"}`}
                >
                  {fieldCounter(createBack).text}
                </p>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={isCreating}
                onClick={() => {
                  setIsCreateFormOpen(false);
                }}
                className="border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isCreating || !canCreateSave}
                className="bg-blue-300 text-slate-950 hover:bg-blue-200"
              >
                {isCreating ? <LoaderCircle className="animate-spin" /> : <Plus />}
                Save
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex justify-end border-y border-white/10 py-4">
            <Button
              type="button"
              onClick={() => {
                setIsCreateFormOpen(true);
              }}
              className="bg-blue-300 text-slate-950 hover:bg-blue-200"
            >
              <Plus />
              New flashcard
            </Button>
          </div>
        )}
      </section>

      {!error && total === 0 && (
        <div className="border-y border-white/10 py-10 text-center">
          <p className="text-blue-100/75">You haven&apos;t saved any flashcards yet.</p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            <Button asChild className="bg-blue-300 text-slate-950 hover:bg-blue-200">
              <a href="/generate">Generate flashcards</a>
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setIsCreateFormOpen(true);
              }}
              className="border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white"
            >
              Create manually
            </Button>
          </div>
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
            {flashcards.map((card) => {
              const isMutating = mutatingCardIds.has(card.id);
              const isEditing = editingCardId === card.id;
              const canSave = draftFront.trim().length > 0 && draftBack.trim().length > 0;

              return (
                <Card
                  key={card.id}
                  className="gap-4 rounded-lg border-white/15 bg-white/10 py-5 text-white shadow-none"
                >
                  <CardHeader className="px-5">
                    <CardTitle className="text-sm text-blue-100/70">Question</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 px-5">
                    {isEditing ? (
                      <>
                        <Textarea
                          value={draftFront}
                          onChange={(event) => {
                            setDraftFront(event.target.value);
                          }}
                          className="min-h-20 border-white/20 bg-slate-950/30 text-white"
                          disabled={isMutating}
                        />
                        <div>
                          <p className="mb-1 text-sm font-medium text-blue-100">Answer</p>
                          <Textarea
                            value={draftBack}
                            onChange={(event) => {
                              setDraftBack(event.target.value);
                            }}
                            className="min-h-24 border-white/20 bg-slate-950/30 text-white"
                            disabled={isMutating}
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        <p>{card.front}</p>
                        <div>
                          <p className="mb-1 text-sm font-medium text-blue-100">Answer</p>
                          <p className="text-blue-100/80">{card.back}</p>
                        </div>
                      </>
                    )}
                  </CardContent>
                  <CardFooter className="justify-end gap-2 px-5">
                    {isEditing ? (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={isMutating}
                          onClick={cancelEditing}
                          className="border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white"
                        >
                          <X />
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          disabled={isMutating || !canSave}
                          onClick={() => {
                            void saveEditing(card);
                          }}
                          className="bg-emerald-300 text-emerald-950 hover:bg-emerald-200"
                        >
                          {isMutating ? <LoaderCircle className="animate-spin" /> : null}
                          Save
                        </Button>
                      </>
                    ) : (
                      <>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              type="button"
                              variant="outline"
                              disabled={isMutating}
                              className="border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white"
                            >
                              <Trash2 />
                              Delete
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete this flashcard?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This permanently removes the flashcard. This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                variant="destructive"
                                onClick={() => {
                                  void deleteFlashcard(card);
                                }}
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                        <Button
                          type="button"
                          disabled={isMutating}
                          onClick={() => {
                            startEditing(card);
                          }}
                          className="bg-blue-300 text-slate-950 hover:bg-blue-200"
                        >
                          <Pencil />
                          Edit
                        </Button>
                      </>
                    )}
                  </CardFooter>
                </Card>
              );
            })}
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
