import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { listFlashcards } from "@/lib/services/flashcards";
import type { Flashcard } from "@/types";

export const prerender = false;

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
});

const createSchema = z
  .object({
    front: z.string().trim().min(1, "front must not be empty").max(1000, "front must be at most 1,000 characters"),
    back: z.string().trim().min(1, "back must not be empty").max(1000, "back must be at most 1,000 characters"),
  })
  .strict();

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

  const parsed = querySchema.safeParse({
    page: context.url.searchParams.get("page") ?? undefined,
  });
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid query parameters", 400);
  }

  try {
    const result = await listFlashcards(supabase, user.id, parsed.data.page);
    return Response.json(result);
  } catch {
    return jsonError("Failed to load flashcards", 500);
  }
};

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

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid request body", 400);
  }

  const { data: inserted, error: insertError } = (await supabase
    .from("flashcards")
    .insert({
      user_id: user.id,
      front: parsed.data.front,
      back: parsed.data.back,
      source_text: null,
      status: "accepted",
    })
    .select()
    .single()) as { data: Flashcard | null; error: unknown };

  if (insertError || !inserted) {
    return jsonError("Failed to create flashcard", 500);
  }

  return Response.json(inserted, { status: 201 });
};

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}
