/**
 * Presence heartbeat columns on profiles.
 * Run in Supabase SQL Editor after profiles.sql / harden_rls_policies.sql.
 *
 * Client heartbeats every 15s while the tab is visible.
 * Stale last_seen (>45s) is treated as offline by the app.
 */

alter table public.profiles
  add column if not exists is_online boolean not null default false;

alter table public.profiles
  add column if not exists last_seen timestamptz;

alter table public.profiles
  add column if not exists presence_status text not null default 'offline';

comment on column public.profiles.is_online is
  'True while heartbeat is fresh (visible tab / in call).';
comment on column public.profiles.last_seen is
  'Last heartbeat timestamp (UTC).';
comment on column public.profiles.presence_status is
  'online | away | offline | in_call';

-- Optional check; ignore if already constrained differently.
do $$
begin
  alter table public.profiles
    add constraint profiles_presence_status_check
    check (presence_status in ('online', 'away', 'offline', 'in_call'));
exception
  when duplicate_object then null;
end $$;

create index if not exists profiles_last_seen_idx
  on public.profiles (last_seen desc nulls last);

create index if not exists profiles_is_online_idx
  on public.profiles (is_online)
  where is_online = true;
