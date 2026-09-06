/**
 * Shared entity and DTO types for the 10xCards domain model.
 */

/** Lifecycle status of a flashcard: AI-proposed, user-accepted, or user-rejected. */
export type FlashcardStatus = "pending" | "accepted" | "rejected";

/** FSRS review state: 0=New, 1=Learning, 2=Review, 3=Relearning. */
export type ReviewState = 0 | 1 | 2 | 3;

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
  due: string;
  stability: number;
  difficulty: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: ReviewState;
  last_review: string | null;
}

/** Request body for `POST /api/flashcards/generate`. */
export interface GenerateFlashcardsRequest {
  sourceText: string;
}

/** Request body for `POST /api/flashcards`. */
export interface CreateFlashcardRequest {
  front: string;
  back: string;
}

/** Response body for `POST /api/flashcards/generate`. */
export interface GenerateFlashcardsResponse {
  flashcards: Flashcard[];
}

/** Request body for `PATCH /api/flashcards/[id]`. */
export interface UpdateFlashcardRequest {
  status?: "accepted" | "rejected";
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

/** Response body for `GET /api/flashcards/due`. */
export interface DueFlashcardsResponse {
  flashcards: Flashcard[];
}

/** Request body for `POST /api/flashcards/[id]/review`. */
export interface SubmitReviewRequest {
  rating: 1 | 2 | 3 | 4;
}
