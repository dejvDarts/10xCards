import { fsrs, generatorParameters, type Card, type Grade } from "ts-fsrs";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Flashcard } from "@/types";

// enable_short_term: false schedules every rating directly on the day-scale
// curve instead of ts-fsrs's default minute-scale learning steps — this is
// what makes "no in-session requeue" true (see plan.md's Critical
// Implementation Details / Definitions: in-session "Again" requeue).
const scheduler = fsrs(generatorParameters({ enable_short_term: false }));

function toFsrsCard(row: Flashcard): Card {
  return {
    due: new Date(row.due),
    stability: row.stability,
    difficulty: row.difficulty,
    // ts-fsrs still requires this deprecated field on the Card type, but it's
    // unused by FSRS-6 scheduling and intentionally not persisted (see
    // context/changes/choose-review-algorithm/codebase-compatibility-review.md).
    elapsed_days: 0,
    scheduled_days: row.scheduled_days,
    learning_steps: row.learning_steps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
    last_review: row.last_review ? new Date(row.last_review) : undefined,
  };
}

function toRowUpdate(card: Card) {
  return {
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review ? card.last_review.toISOString() : null,
    updated_at: new Date().toISOString(),
  };
}

export async function getDueFlashcards(supabase: SupabaseClient, userId: string): Promise<Flashcard[]> {
  const { data, error } = await supabase
    .from("flashcards")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "accepted")
    .lte("due", new Date().toISOString())
    .order("due", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    throw error;
  }

  return data as Flashcard[];
}

export async function recordReview(
  supabase: SupabaseClient,
  userId: string,
  flashcardId: string,
  rating: Grade,
): Promise<Flashcard | null> {
  const fetchResult = (await supabase
    .from("flashcards")
    .select("*")
    .eq("id", flashcardId)
    .eq("user_id", userId)
    .eq("status", "accepted")
    .maybeSingle()) as { data: Flashcard | null; error: unknown };

  if (fetchResult.error) {
    throw new Error("Failed to load flashcard for review");
  }
  if (!fetchResult.data) {
    return null;
  }

  const { card: nextCard } = scheduler.next(toFsrsCard(fetchResult.data), new Date(), rating);

  // Optimistic concurrency: only apply this update if the row is still in the
  // state we just read. A concurrent review of the same card (double-click,
  // duplicate retry, two tabs) moves updated_at first and wins the race; this
  // write then matches zero rows and returns null, same as a not-found card.
  const updateResult = (await supabase
    .from("flashcards")
    .update(toRowUpdate(nextCard))
    .eq("id", flashcardId)
    .eq("user_id", userId)
    .eq("updated_at", fetchResult.data.updated_at)
    .select()
    .maybeSingle()) as { data: Flashcard | null; error: unknown };

  if (updateResult.error) {
    throw new Error("Failed to persist review");
  }

  return updateResult.data;
}
