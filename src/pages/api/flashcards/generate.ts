import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { generateFlashcardProposals, FlashcardGenerationError } from "@/lib/services/flashcard-generation";
import type { GenerateFlashcardsResponse, Flashcard } from "@/types";

export const prerender = false;

const requestSchema = z.object({
  sourceText: z
    .string()
    .min(100, "sourceText must be at least 100 characters")
    .max(10000, "sourceText must be at most 10,000 characters"),
});

export const POST: APIRoute = async (context) => {
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

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return jsonError("Request body must be valid JSON", 400);
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid request body", 400);
  }

  let proposals;
  try {
    proposals = await generateFlashcardProposals(parsed.data.sourceText);
  } catch (error) {
    const message = error instanceof FlashcardGenerationError ? error.message : "Flashcard generation failed";
    return jsonError(message, 502);
  }

  const rowsToInsert = proposals.map((proposal) => ({
    user_id: user.id,
    front: proposal.front,
    back: proposal.back,
    source_text: parsed.data.sourceText,
    status: "pending" as const,
  }));

  const { data: inserted, error: insertError } = await supabase.from("flashcards").insert(rowsToInsert).select();

  if (insertError) {
    return jsonError("Failed to save generated flashcards", 500);
  }

  const responseBody: GenerateFlashcardsResponse = { flashcards: inserted as Flashcard[] };
  return new Response(JSON.stringify(responseBody), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
};

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
