import { describe, expect, it } from "vitest";
import type { Card } from "ts-fsrs";
import type { Flashcard } from "@/types";
import { recordReview, scheduler, toFsrsCard, toRowUpdate } from "./reviews";

// Fixed clock — scheduler.next takes `now` as an argument, so no fake timers.
const NOW = new Date("2026-01-01T00:00:00.000Z");
const DAY_MS = 86_400_000;

const RATINGS = [1, 2, 3, 4] as const;
type RatingLiteral = (typeof RATINGS)[number];

const nextCard = (card: Card, now: Date, r: RatingLiteral): Card => scheduler.next(card, now, r).card;

function freshRow(overrides: Partial<Flashcard> = {}): Flashcard {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    user_id: "22222222-2222-2222-2222-222222222222",
    front: "Q",
    back: "A",
    source_text: null,
    status: "accepted",
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    // FSRS column defaults from 20260906000000_add_review_state_to_flashcards.sql
    due: NOW.toISOString(),
    stability: 0,
    difficulty: 0,
    scheduled_days: 0,
    learning_steps: 0,
    reps: 0,
    lapses: 0,
    state: 0,
    last_review: null,
    ...overrides,
  };
}

describe("toFsrsCard / toRowUpdate mapping", () => {
  it("maps every FSRS field from row to Card and hard-codes elapsed_days", () => {
    const row = freshRow({
      due: "2026-02-01T00:00:00.000Z",
      stability: 3.5,
      difficulty: 6.1,
      scheduled_days: 4,
      learning_steps: 1,
      reps: 2,
      lapses: 1,
      state: 2,
      last_review: "2026-01-28T00:00:00.000Z",
    });

    const card = toFsrsCard(row);

    expect(card.due).toEqual(new Date(row.due));
    expect(card.stability).toBe(3.5);
    expect(card.difficulty).toBe(6.1);
    expect(card.scheduled_days).toBe(4);
    expect(card.learning_steps).toBe(1);
    expect(card.reps).toBe(2);
    expect(card.lapses).toBe(1);
    expect(card.state).toBe(2);
    expect(card.last_review).toEqual(new Date("2026-01-28T00:00:00.000Z"));
    // toFsrsCard hard-codes the deprecated elapsed_days rather than reading it
    // from the row — assert that on purpose.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    expect(card.elapsed_days).toBe(0);
  });

  it("maps a null last_review to undefined", () => {
    expect(toFsrsCard(freshRow({ last_review: null })).last_review).toBeUndefined();
  });

  it("serializes a Card back to ISO strings and sets updated_at", () => {
    const card = toFsrsCard(freshRow({ last_review: "2026-01-28T00:00:00.000Z" }));
    const update = toRowUpdate(card);

    expect(update.due).toBe(card.due.toISOString());
    expect(update.last_review).toBe("2026-01-28T00:00:00.000Z");
    expect(typeof update.updated_at).toBe("string");
    expect(Number.isNaN(Date.parse(update.updated_at))).toBe(false);
  });

  it("writes last_review null when the Card has none", () => {
    expect(toRowUpdate(toFsrsCard(freshRow({ last_review: null }))).last_review).toBeNull();
  });

  it("round-trips the FSRS fields through toFsrsCard -> toRowUpdate", () => {
    const row = freshRow({
      due: "2026-02-01T00:00:00.000Z",
      stability: 3.5,
      difficulty: 6.1,
      scheduled_days: 4,
      learning_steps: 1,
      reps: 2,
      lapses: 1,
      state: 2,
    });

    const update = toRowUpdate(toFsrsCard(row));

    expect(update.due).toBe(new Date(row.due).toISOString());
    expect(update.stability).toBe(row.stability);
    expect(update.difficulty).toBe(row.difficulty);
    expect(update.scheduled_days).toBe(row.scheduled_days);
    expect(update.learning_steps).toBe(row.learning_steps);
    expect(update.reps).toBe(row.reps);
    expect(update.lapses).toBe(row.lapses);
    expect(update.state).toBe(row.state);
  });
});

describe("scheduler.next structural properties (fresh card)", () => {
  it.each(RATINGS)(
    "rating %i: due strictly after now, scheduled_days >= 1, reps -> 1, state -> Review(2)",
    (rating) => {
      const card = nextCard(toFsrsCard(freshRow()), NOW, rating);

      expect(card.due.getTime()).toBeGreaterThan(NOW.getTime());
      expect(card.scheduled_days).toBeGreaterThanOrEqual(1);
      expect(card.reps).toBe(1);
      expect(card.state).toBe(2);
    },
  );

  it("interval ordering is strict: due(Again) < due(Hard) < due(Good) < due(Easy)", () => {
    const dues = RATINGS.map((r) => nextCard(toFsrsCard(freshRow()), NOW, r).due.getTime());

    expect(dues[0]).toBeLessThan(dues[1]);
    expect(dues[1]).toBeLessThan(dues[2]);
    expect(dues[2]).toBeLessThan(dues[3]);
  });
});

describe("enable_short_term: false is in effect (no in-session requeue)", () => {
  it("Again on a fresh card schedules at least one full day out", () => {
    const card = nextCard(toFsrsCard(freshRow()), NOW, 1);

    // If reviews.ts flips to enable_short_term: true, Again reschedules ~1 minute
    // out and this fails — that is the whole point of this test.
    expect(card.due.getTime() - NOW.getTime()).toBeGreaterThanOrEqual(DAY_MS);
  });
});

describe("second review rated Again", () => {
  it("increments lapses by one and still schedules at least a day out", () => {
    const afterGood = nextCard(toFsrsCard(freshRow()), NOW, 3);
    expect(afterGood.lapses).toBe(0);

    const secondReviewAt = afterGood.due;
    const afterAgain = nextCard(afterGood, secondReviewAt, 1);

    expect(afterAgain.lapses).toBe(afterGood.lapses + 1);
    expect(afterAgain.due.getTime() - secondReviewAt.getTime()).toBeGreaterThanOrEqual(DAY_MS);
  });
});

describe("recordReview optimistic-concurrency guard contract", () => {
  // Stub the injected `supabase` argument (dependency injection at the external
  // boundary) — not a vi.mock of an internal module.
  function stubSupabase(opts: { selectRow: Flashcard | null; updateRow: Flashcard | null }) {
    let isUpdate = false;
    const chain: Record<string, unknown> = {
      from: () => {
        isUpdate = false;
        return chain;
      },
      select: () => chain,
      update: () => {
        isUpdate = true;
        return chain;
      },
      eq: () => chain,
      maybeSingle: () =>
        Promise.resolve(isUpdate ? { data: opts.updateRow, error: null } : { data: opts.selectRow, error: null }),
    };
    return chain as unknown as Parameters<typeof recordReview>[0];
  }

  it("returns null when the guarded update matches zero rows (lost the race)", async () => {
    const row = freshRow();
    const result = await recordReview(stubSupabase({ selectRow: row, updateRow: null }), row.user_id, row.id, 3);
    expect(result).toBeNull();
  });

  it("returns null when the row is not found / not owned / not accepted", async () => {
    const result = await recordReview(stubSupabase({ selectRow: null, updateRow: null }), "someone", "missing", 3);
    expect(result).toBeNull();
  });

  it("returns the updated row when the guarded update succeeds", async () => {
    const row = freshRow();
    const updated = freshRow({ reps: 1, state: 2, updated_at: "2026-01-01T00:00:01.000Z" });
    const result = await recordReview(stubSupabase({ selectRow: row, updateRow: updated }), row.user_id, row.id, 3);
    expect(result).toEqual(updated);
  });
});
