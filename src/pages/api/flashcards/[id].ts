import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import type { Flashcard, UpdateFlashcardRequest } from "@/types";

export const prerender = false;

const requestSchema = z
  .object({
    status: z.enum(["accepted", "rejected"]),
    front: z.string().trim().min(1, "front must not be empty").optional(),
    back: z.string().trim().min(1, "back must not be empty").optional(),
  })
  .strict();

export const PATCH: APIRoute = async (context) => {
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

  const cardId = context.params.id;
  if (!cardId || !z.uuid().safeParse(cardId).success) {
    return jsonError("Invalid flashcard ID", 400);
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

  const update: UpdateFlashcardRequest = parsed.data;
  const result = (await supabase
    .from("flashcards")
    .update({
      status: update.status,
      ...(update.front !== undefined && { front: update.front }),
      ...(update.back !== undefined && { back: update.back }),
      updated_at: new Date().toISOString(),
    })
    .eq("id", cardId)
    .eq("user_id", user.id)
    .select()
    .maybeSingle()) as { data: Flashcard | null; error: unknown };

  if (result.error) {
    return jsonError("Failed to update flashcard", 500);
  }
  if (!result.data) {
    return jsonError("Flashcard not found", 404);
  }

  return Response.json(result.data);
};

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}
