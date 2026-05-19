-- Patch for existing Supabase projects created before 2026-05-19.
-- Fixes blind_recovery_responses inserts failing because the insert policy
-- checked study_tokens through normal RLS-visible table access.

create or replace function is_valid_study_submission(
  request_token_hash text,
  request_annotator_id text,
  request_assignment_id text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from study_tokens st
    where st.token_hash = request_token_hash
      and st.annotator_id = request_annotator_id
      and st.assignment_id = request_assignment_id
      and st.active = true
  )
$$;

grant execute on function is_valid_study_submission(text, text, text) to anon;
grant execute on function is_valid_study_submission(text, text, text) to authenticated;

drop policy if exists allow_valid_token_inserts on blind_recovery_responses;
create policy allow_valid_token_inserts
on blind_recovery_responses
for insert
to anon, authenticated
with check (
  is_valid_study_submission(token_hash, annotator_id, assignment_id)
);
