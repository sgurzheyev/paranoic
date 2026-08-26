/**
 * Google Play / App Store safety: Block & Report.
 * Run in Supabase SQL Editor after profiles.sql + Auth are live.
 *
 * Tables:
 *   - blocked_users  — who blocked whom
 *   - reports        — user-submitted abuse reports
 */

-- ── blocked_users ──────────────────────────────────────────────────────────
create table if not exists public.blocked_users (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  blocked_user_id text not null,
  created_at timestamptz not null default now(),
  constraint blocked_users_unique_pair unique (user_id, blocked_user_id),
  constraint blocked_users_no_self check (user_id::text <> blocked_user_id)
);

create index if not exists blocked_users_user_idx
  on public.blocked_users (user_id, created_at desc);

create index if not exists blocked_users_blocked_idx
  on public.blocked_users (blocked_user_id);

alter table public.blocked_users enable row level security;

drop policy if exists "blocked_users_select_own" on public.blocked_users;
create policy "blocked_users_select_own"
  on public.blocked_users for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "blocked_users_insert_own" on public.blocked_users;
create policy "blocked_users_insert_own"
  on public.blocked_users for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "blocked_users_delete_own" on public.blocked_users;
create policy "blocked_users_delete_own"
  on public.blocked_users for delete
  to authenticated
  using (user_id = auth.uid());

comment on table public.blocked_users is
  'Play-compliance block list: reporter cannot see or message blocked peers.';

-- ── reports ────────────────────────────────────────────────────────────────
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users (id) on delete cascade,
  reported_id text not null,
  reason text not null check (
    char_length(trim(reason)) >= 2
    and char_length(reason) <= 500
  ),
  created_at timestamptz not null default now(),
  constraint reports_no_self check (reporter_id::text <> reported_id)
);

create index if not exists reports_reporter_idx
  on public.reports (reporter_id, created_at desc);

create index if not exists reports_reported_idx
  on public.reports (reported_id, created_at desc);

alter table public.reports enable row level security;

-- Reporters can insert and read their own reports only.
drop policy if exists "reports_select_own" on public.reports;
create policy "reports_select_own"
  on public.reports for select
  to authenticated
  using (reporter_id = auth.uid());

drop policy if exists "reports_insert_own" on public.reports;
create policy "reports_insert_own"
  on public.reports for insert
  to authenticated
  with check (reporter_id = auth.uid());

-- No update/delete for reporters (audit trail). Admins use service role.

comment on table public.reports is
  'User abuse reports for moderation / Play Store compliance.';
