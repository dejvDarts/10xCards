import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { recordReview } from "@/lib/services/reviews";

export const prerender = false;

const requestSchema = z
  .object({
    rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  })
  .strict();

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

  try {
    const updated = await recordReview(supabase, user.id, cardId, parsed.data.rating);
    if (!updated) {
      return jsonError("Flashcard not found", 404);
    }
    return Response.json(updated);
  } catch {
    return jsonError("Failed to record review", 500);
  }
};

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}
