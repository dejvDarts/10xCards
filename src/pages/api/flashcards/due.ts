import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { getDueFlashcards } from "@/lib/services/reviews";
import type { DueFlashcardsResponse } from "@/types";

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonError("Supabase is not configured", 500);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonError("Unauthorized", 401);
  }

  try {
    const flashcards = await getDueFlashcards(supabase, user.id);
    return Response.json({ flashcards } satisfies DueFlashcardsResponse);
  } catch {
    return jsonError("Failed to load due flashcards", 500);
  }
};

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}
