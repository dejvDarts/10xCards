import type { SupabaseClient } from "@supabase/supabase-js";

const IMPOSSIBLE_UUID = "00000000-0000-0000-0000-000000000000";

export interface SeededFlashcard {
  id: string;
  user_id: string;
  front: string;
  back: string;
  status: string;
  due: string;
  reps: number;
}

interface SeedOverrides {
  front?: string;
  back?: string;
  status?: string;
  /** Schedule-column overrides — omit to take the DB default. */
  id?: string;
  due?: string;
  state?: number;
  reps?: number;
  stability?: number;
}

/** Insert a flashcard owned by `userId` through that user's own client (RLS
 *  permits own-row insert). Any FSRS column not overridden falls back to its
 *  DB default. */
export async function seedFlashcard(
  ownerClient: SupabaseClient,
  userId: string,
  overrides: SeedOverrides = {},
): Promise<SeededFlashcard> {
  const row: Record<string, unknown> = {
    user_id: userId,
    front: overrides.front ?? "Question?",
    back: overrides.back ?? "Answer.",
    status: overrides.status ?? "accepted",
  };
  if (overrides.id !== undefined) row.id = overrides.id;
  if (overrides.due !== undefined) row.due = overrides.due;
  if (overrides.state !== undefined) row.state = overrides.state;
  if (overrides.reps !== undefined) row.reps = overrides.reps;
  if (overrides.stability !== undefined) row.stability = overrides.stability;

  const { data, error } = await ownerClient.from("flashcards").insert(row).select().single();
  if (error || !data) {
    throw new Error(`seedFlashcard failed: ${error?.message ?? "no row returned"}`);
  }
  return data as SeededFlashcard;
}

/** Delete every flashcard visible to each client. RLS scopes each delete to
 *  that client's own rows, so passing both users' clients clears the table. */
export async function resetFlashcards(clients: SupabaseClient[]): Promise<void> {
  for (const client of clients) {
    const { error } = await client.from("flashcards").delete().neq("id", IMPOSSIBLE_UUID);
    if (error) {
      throw new Error(`resetFlashcards failed: ${error.message}`);
    }
  }
}
