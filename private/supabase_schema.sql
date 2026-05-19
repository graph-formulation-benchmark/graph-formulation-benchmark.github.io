create extension if not exists pgcrypto;

create table if not exists study_tokens (
  token_hash text primary key,
  annotator_id text not null,
  assignment_id text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists blind_recovery_responses (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null references study_tokens(token_hash),
  annotator_id text not null,
  assignment_id text not null,
  human_item_id text not null,
  response_json jsonb not null,
  client_version text not null,
  submitted_at timestamptz not null default now()
);

create table if not exists formulation_ab_responses (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null references study_tokens(token_hash),
  annotator_id text not null,
  assignment_id text not null,
  formulation_pair_id text not null,
  human_item_id text,
  response_json jsonb not null,
  client_version text not null,
  submitted_at timestamptz not null default now()
);

create table if not exists survey_assignments (
  token_hash text primary key references study_tokens(token_hash),
  assignment_json jsonb not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table study_tokens enable row level security;
alter table blind_recovery_responses enable row level security;
alter table formulation_ab_responses enable row level security;
alter table survey_assignments enable row level security;

drop policy if exists allow_valid_token_assignment_selects on survey_assignments;

create or replace function get_survey_assignment(request_token_hash text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select sa.assignment_json
  from survey_assignments sa
  join study_tokens st on st.token_hash = sa.token_hash
  where sa.token_hash = request_token_hash
    and sa.active = true
    and st.active = true
  limit 1
$$;

grant execute on function get_survey_assignment(text) to anon;
grant execute on function get_survey_assignment(text) to authenticated;

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

drop policy if exists allow_valid_token_inserts on formulation_ab_responses;
create policy allow_valid_token_inserts
on formulation_ab_responses
for insert
to anon, authenticated
with check (
  is_valid_study_submission(token_hash, annotator_id, assignment_id)
);
