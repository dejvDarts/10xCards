-- Create flashcards table with per-user row-level security.
--
-- Purpose: persist AI-generated flashcard proposals (and, in future slices,
-- manually created flashcards) scoped strictly to the owning user. Every
-- policy is written per-operation with the correct clause:
--   - select/delete: USING only (row must already belong to the caller)
--   - insert:        WITH CHECK only (new row must belong to the caller)
--   - update:        USING (can only touch own rows) AND WITH CHECK
--                    (cannot re-assign the row to someone else)

create table if not exists flashcards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  front text not null,
  back text not null,
  source_text text,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table flashcards enable row level security;

grant select, insert, update, delete on flashcards to authenticated;

create policy "flashcards_select_own"
  on flashcards
  for select
  to authenticated
  using (user_id = auth.uid());

create policy "flashcards_insert_own"
  on flashcards
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "flashcards_update_own"
  on flashcards
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "flashcards_delete_own"
  on flashcards
  for delete
  to authenticated
  using (user_id = auth.uid());
