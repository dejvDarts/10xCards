import type { SupabaseClient } from "@supabase/supabase-js";
import type { Flashcard, ListFlashcardsResponse } from "@/types";

const FLASHCARDS_PAGE_SIZE = 20;
const RANGE_NOT_SATISFIABLE = "PGRST103";

function baseQuery(supabase: SupabaseClient, userId: string) {
  return supabase.from("flashcards").select("*", { count: "exact" }).eq("user_id", userId).eq("status", "accepted");
}

function countTotal(supabase: SupabaseClient, userId: string) {
  return supabase
    .from("flashcards")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "accepted");
}

export async function listFlashcards(
  supabase: SupabaseClient,
  userId: string,
  page: number,
): Promise<ListFlashcardsResponse> {
  const limit = FLASHCARDS_PAGE_SIZE;
  const offset = (page - 1) * limit;

  const { data, count, error } = await baseQuery(supabase, userId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    // PostgREST returns a 416/PGRST103 (not an empty page) when the requested
    // offset is past the last row. Requesting a page beyond the last page is
    // valid usage for this endpoint (see plan Definitions: "browse" (pagination)),
    // so treat it as an empty page rather than an error.
    if (error.code === RANGE_NOT_SATISFIABLE) {
      const { count: totalOnly, error: countError } = await countTotal(supabase, userId);
      if (countError) {
        throw countError;
      }
      const total = totalOnly ?? 0;
      return {
        flashcards: [],
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      };
    }
    throw error;
  }

  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return {
    flashcards: data as Flashcard[],
    page,
    limit,
    total,
    totalPages,
  };
}
