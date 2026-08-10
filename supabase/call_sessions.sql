/**
 * Call sessions — статус звонка в Supabase (ringing / cancelled / …).
 * Run in Supabase SQL Editor after profiles.sql.
 */

create table if not exists public.call_sessions (
  call_id text primary key,
  from_user_id text not null,
  to_user_id text not null,
  status text not null check (status in ('ringing', 'accepted', 'cancelled', 'rejected', 'ended')),
  updated_at timestamptz not null default now()
);

create index if not exists call_sessions_to_status
  on public.call_sessions (to_user_id, status, updated_at desc);

alter table public.call_sessions enable row level security;

drop policy if exists "call_sessions_select_anon" on public.call_sessions;
create policy "call_sessions_select_anon"
  on public.call_sessions for select
  to anon, authenticated
  using (true);

drop policy if exists "call_sessions_upsert_anon" on public.call_sessions;
create policy "call_sessions_upsert_anon"
  on public.call_sessions for insert
  to anon, authenticated
  with check (true);

drop policy if exists "call_sessions_update_anon" on public.call_sessions;
create policy "call_sessions_update_anon"
  on public.call_sessions for update
  to anon, authenticated
  using (true)
  with check (true);
