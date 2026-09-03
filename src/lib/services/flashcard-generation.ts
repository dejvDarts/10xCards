import { OPENROUTER_API_KEY, OPENROUTER_MODEL } from "astro:env/server";
import { z } from "zod";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "openrouter/auto";
const MAX_PROPOSALS = 15;

export interface FlashcardProposal {
  front: string;
  back: string;
}

const proposalSchema = z.object({
  front: z.string().min(1),
  back: z.string().min(1),
});

const proposalsSchema = z.object({
  flashcards: z.array(proposalSchema).min(1).max(MAX_PROPOSALS),
});

export class FlashcardGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlashcardGenerationError";
  }
}

const SYSTEM_PROMPT = `You are a flashcard generation assistant. Given source text, produce concise
question/answer flashcard pairs that test understanding of the key facts and concepts in the text.
Respond ONLY with a JSON object of the exact shape {"flashcards": [{"front": string, "back": string}]}.
Produce at most ${MAX_PROPOSALS} flashcards. Do not include any prose outside the JSON object.`;

export async function generateFlashcardProposals(sourceText: string): Promise<FlashcardProposal[]> {
  if (!OPENROUTER_API_KEY) {
    throw new FlashcardGenerationError("OPENROUTER_API_KEY is not configured");
  }

  const model: string = OPENROUTER_MODEL ?? DEFAULT_MODEL;
  let response: Response;

  try {
    response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: sourceText },
        ],
        response_format: { type: "json_object" },
      }),
    });
  } catch {
    throw new FlashcardGenerationError("Failed to reach the AI provider");
  }

  if (!response.ok) {
    throw new FlashcardGenerationError(`AI provider returned an error (status ${response.status})`);
  }

  let payload: unknown;
  try {
    const responsePayload: unknown = await response.json();
    payload = responsePayload;
  } catch {
    throw new FlashcardGenerationError("AI provider returned an invalid JSON response");
  }

  const content = extractMessageContent(payload);
  if (!content) {
    throw new FlashcardGenerationError("AI provider response was missing message content");
  }

  let parsedContent: unknown;
  try {
    parsedContent = JSON.parse(content);
  } catch {
    throw new FlashcardGenerationError("AI provider content was not valid JSON");
  }

  const result = proposalsSchema.safeParse(parsedContent);
  if (!result.success) {
    throw new FlashcardGenerationError("AI provider output did not match the expected flashcard shape");
  }

  return result.data.flashcards.slice(0, MAX_PROPOSALS);
}

const openRouterResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable().optional(),
        }),
      }),
    )
    .min(1),
});

function extractMessageContent(payload: unknown): string | null {
  const parsed = openRouterResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return null;
  }
  return parsed.data.choices[0]?.message.content ?? null;
}
