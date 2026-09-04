import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { listFlashcards } from "@/lib/services/flashcards";

export const prerender = false;

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
});

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

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}
