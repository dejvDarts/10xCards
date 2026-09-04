-- Add a composite index to support the personal flashcard list query.
--
-- The list query filters on (user_id, status) and orders by
-- (created_at desc, id desc) — this index matches that access pattern
-- exactly so it's an index scan rather than a full table scan.

create index if not exists flashcards_user_status_created_idx
  on flashcards (user_id, status, created_at desc, id desc);
