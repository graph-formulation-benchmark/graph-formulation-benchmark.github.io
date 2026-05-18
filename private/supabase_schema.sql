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

create table if not exists survey_assignments (
  token_hash text primary key references study_tokens(token_hash),
  assignment_json jsonb not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table study_tokens enable row level security;
alter table blind_recovery_responses enable row level security;
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

drop policy if exists allow_valid_token_inserts on blind_recovery_responses;
create policy allow_valid_token_inserts
on blind_recovery_responses
for insert
to anon
with check (
  exists (
    select 1 from study_tokens
    where study_tokens.token_hash = blind_recovery_responses.token_hash
      and study_tokens.active = true
  )
);
