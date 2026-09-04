/**
 * Shared entity and DTO types for the 10xCards domain model.
 */

/** Lifecycle status of a flashcard: AI-proposed, user-accepted, or user-rejected. */
export type FlashcardStatus = "pending" | "accepted" | "rejected";

/** A flashcard row as stored in the `flashcards` table. */
export interface Flashcard {
  id: string;
  user_id: string;
  front: string;
  back: string;
  source_text: string | null;
  status: FlashcardStatus;
  created_at: string;
  updated_at: string;
}

/** Request body for `POST /api/flashcards/generate`. */
export interface GenerateFlashcardsRequest {
  sourceText: string;
}

/** Response body for `POST /api/flashcards/generate`. */
export interface GenerateFlashcardsResponse {
  flashcards: Flashcard[];
}

/** Request body for `PATCH /api/flashcards/[id]`. */
export interface UpdateFlashcardRequest {
  status: "accepted" | "rejected";
  front?: string;
  back?: string;
}

/** Response body for `GET /api/flashcards`. */
export interface ListFlashcardsResponse {
  flashcards: Flashcard[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
