-- Add FSRS review-state columns to flashcards for the spaced-repetition
-- session (S-05). Every column has a default matching ts-fsrs's
-- createEmptyCard() output, so both the historical backfill and every
-- future INSERT get correct initial state with zero application changes.

alter table flashcards
  add column due timestamptz not null default now(),
  add column stability double precision not null default 0,
  add column difficulty double precision not null default 0,
  add column scheduled_days integer not null default 0,
  add column learning_steps integer not null default 0,
  add column reps integer not null default 0,
  add column lapses integer not null default 0,
  add column state smallint not null default 0 check (state in (0, 1, 2, 3)),
  add column last_review timestamptz;

create index if not exists flashcards_due_idx
  on flashcards (user_id, due)
  where status = 'accepted';
