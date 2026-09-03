import { type SubmitEvent, useState } from "react";
import { Check, LoaderCircle, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useFlashcardProposals } from "@/components/hooks/useFlashcardProposals";

const MIN_SOURCE_LENGTH = 100;
const MAX_SOURCE_LENGTH = 10000;

export default function FlashcardGenerator() {
  const { editFlashcard, error, flashcards, generate, isGenerating, updateFlashcard, updatingCardId } =
    useFlashcardProposals();
  const [sourceText, setSourceText] = useState("");
  const sourceTextError =
    sourceText.length > 0 && sourceText.length < MIN_SOURCE_LENGTH
      ? `Add at least ${MIN_SOURCE_LENGTH - sourceText.length} more characters.`
      : null;

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sourceText.length < MIN_SOURCE_LENGTH || sourceText.length > MAX_SOURCE_LENGTH) return;
    await generate(sourceText);
  }

  return (
    <div className="space-y-8">
      <form onSubmit={handleSubmit} className="border-y border-white/10 py-6">
        <label htmlFor="source-text" className="mb-2 block text-sm font-medium text-blue-100">
          Source text
        </label>
        <Textarea
          id="source-text"
          value={sourceText}
          onChange={(event) => {
            setSourceText(event.target.value);
          }}
          placeholder="Paste the material you want to learn..."
          className="min-h-48 border-white/20 bg-white/10 text-white placeholder:text-white/40 focus-visible:border-blue-300 focus-visible:ring-blue-300/30"
          aria-invalid={Boolean(sourceTextError)}
          disabled={isGenerating}
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className={sourceTextError ? "text-amber-200" : "text-blue-100/60"}>
            {sourceTextError ??
              `${sourceText.length.toLocaleString()} / ${MAX_SOURCE_LENGTH.toLocaleString()} characters`}
          </p>
          <Button
            type="submit"
            disabled={isGenerating || sourceText.length < MIN_SOURCE_LENGTH || sourceText.length > MAX_SOURCE_LENGTH}
            className="bg-blue-300 text-slate-950 hover:bg-blue-200"
          >
            {isGenerating ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
            {isGenerating ? "Generating" : "Generate flashcards"}
          </Button>
        </div>
      </form>

      {error && (
        <div role="alert" className="border border-red-300/40 bg-red-950/40 px-4 py-3 text-sm text-red-100">
          {error}
        </div>
      )}

      {flashcards.length > 0 && (
        <section aria-labelledby="proposals-heading">
          <div className="mb-4 flex items-baseline justify-between gap-4">
            <h2 id="proposals-heading" className="text-xl font-semibold text-white">
              Review proposals
            </h2>
            <span className="text-sm text-blue-100/60">{flashcards.length} remaining</span>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {flashcards.map((card, index) => {
              const isUpdating = updatingCardId === card.id;
              return (
                <Card
                  key={card.id}
                  className="gap-4 rounded-lg border-white/15 bg-white/10 py-5 text-white shadow-none"
                >
                  <CardHeader className="px-5">
                    <CardTitle className="text-sm text-blue-100/70">Proposal {index + 1}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4 px-5">
                    <div>
                      <label htmlFor={`${card.id}-front`} className="mb-1.5 block text-sm font-medium text-blue-100">
                        Question
                      </label>
                      <Textarea
                        id={`${card.id}-front`}
                        value={card.front}
                        onChange={(event) => {
                          editFlashcard(card.id, "front", event.target.value);
                        }}
                        className="min-h-20 border-white/20 bg-slate-950/30 text-white"
                        disabled={isUpdating}
                      />
                    </div>
                    <div>
                      <label htmlFor={`${card.id}-back`} className="mb-1.5 block text-sm font-medium text-blue-100">
                        Answer
                      </label>
                      <Textarea
                        id={`${card.id}-back`}
                        value={card.back}
                        onChange={(event) => {
                          editFlashcard(card.id, "back", event.target.value);
                        }}
                        className="min-h-24 border-white/20 bg-slate-950/30 text-white"
                        disabled={isUpdating}
                      />
                    </div>
                  </CardContent>
                  <CardFooter className="justify-end gap-2 px-5">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={isUpdating || !card.front.trim() || !card.back.trim()}
                      onClick={() => {
                        void updateFlashcard(card, "rejected");
                      }}
                      className="border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white"
                    >
                      <X />
                      Reject
                    </Button>
                    <Button
                      type="button"
                      disabled={isUpdating || !card.front.trim() || !card.back.trim()}
                      onClick={() => {
                        void updateFlashcard(card, "accepted");
                      }}
                      className="bg-emerald-300 text-emerald-950 hover:bg-emerald-200"
                    >
                      {isUpdating ? <LoaderCircle className="animate-spin" /> : <Check />}
                      Accept
                    </Button>
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
