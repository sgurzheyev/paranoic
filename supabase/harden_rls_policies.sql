/**
 * Harden RLS: profiles, messages, call_sessions, memory_gems (+ offline-transfers).
 *
 * Production-aligned copy (explicit ::text casts).
 * Run in Supabase SQL Editor AFTER enabling
 * Authentication → Providers → Anonymous Sign-Ins.
 *
 * Column mapping:
 *   messages / call_sessions: from_user_id, to_user_id
 *   Client identity.id must equal auth.uid()::text
 */

-- ── helpers ───────────────────────────────────────────────────────────────────
create or replace function public.auth_uid_text()
returns text
language sql
stable
as $$
  select auth.uid()::text;
$$;

revoke all on function public.auth_uid_text() from public;
grant execute on function public.auth_uid_text() to anon, authenticated;

-- ── profiles ──────────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_anon" on public.profiles;
drop policy if exists "profiles_upsert_anon" on public.profiles;
drop policy if exists "profiles_update_anon" on public.profiles;
drop policy if exists "profiles_delete_anon" on public.profiles;
drop policy if exists "profiles_login_select_anon" on public.profiles;
drop policy if exists "profiles_select_public" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_delete_own" on public.profiles;

create policy "profiles_select_public"
  on public.profiles for select
  to anon, authenticated
  using (true);

create policy "profiles_insert_own"
  on public.profiles for insert
  to authenticated
  with check (id::text = public.auth_uid_text());

create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (id::text = public.auth_uid_text())
  with check (id::text = public.auth_uid_text());

create policy "profiles_delete_own"
  on public.profiles for delete
  to authenticated
  using (id::text = public.auth_uid_text());

-- ── messages (store-and-forward) ───────────────────────────────────────────────
alter table public.messages enable row level security;

drop policy if exists "messages_select_anon" on public.messages;
drop policy if exists "messages_insert_anon" on public.messages;
drop policy if exists "messages_update_anon" on public.messages;
drop policy if exists "messages_delete_anon" on public.messages;
drop policy if exists "messages_select_participants" on public.messages;
drop policy if exists "messages_insert_sender" on public.messages;
drop policy if exists "messages_update_participants" on public.messages;
drop policy if exists "messages_delete_participants" on public.messages;

create policy "messages_select_participants"
  on public.messages for select
  to authenticated
  using (
    from_user_id::text = public.auth_uid_text()
    or to_user_id::text = public.auth_uid_text()
  );

create policy "messages_insert_sender"
  on public.messages for insert
  to authenticated
  with check (from_user_id::text = public.auth_uid_text());

create policy "messages_update_participants"
  on public.messages for update
  to authenticated
  using (
    from_user_id::text = public.auth_uid_text()
    or to_user_id::text = public.auth_uid_text()
  )
  with check (
    from_user_id::text = public.auth_uid_text()
    or to_user_id::text = public.auth_uid_text()
  );

create policy "messages_delete_participants"
  on public.messages for delete
  to authenticated
  using (
    from_user_id::text = public.auth_uid_text()
    or to_user_id::text = public.auth_uid_text()
  );

-- Storage: offline-transfers
-- Path convention: {auth.uid()}/{to_user_id}/{id}.bin (see storeForward.ts)
drop policy if exists "offline_transfers_select" on storage.objects;
drop policy if exists "offline_transfers_insert" on storage.objects;
drop policy if exists "offline_transfers_update" on storage.objects;
drop policy if exists "offline_transfers_delete" on storage.objects;
drop policy if exists "offline_transfers_select_auth" on storage.objects;
drop policy if exists "offline_transfers_insert_auth" on storage.objects;
drop policy if exists "offline_transfers_update_auth" on storage.objects;
drop policy if exists "offline_transfers_delete_auth" on storage.objects;

create policy "offline_transfers_select_auth"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'offline-transfers'
    and (
      (storage.foldername(name))[1]::text = public.auth_uid_text()
      or name like public.auth_uid_text() || '/%'
      or exists (
        select 1
        from public.messages m
        where m.storage_path = name
          and m.to_user_id::text = public.auth_uid_text()
      )
    )
  );

create policy "offline_transfers_insert_auth"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'offline-transfers'
    and (storage.foldername(name))[1]::text = public.auth_uid_text()
  );

create policy "offline_transfers_update_auth"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'offline-transfers'
    and (storage.foldername(name))[1]::text = public.auth_uid_text()
  )
  with check (
    bucket_id = 'offline-transfers'
    and (storage.foldername(name))[1]::text = public.auth_uid_text()
  );

create policy "offline_transfers_delete_auth"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'offline-transfers'
    and (
      (storage.foldername(name))[1]::text = public.auth_uid_text()
      or exists (
        select 1
        from public.messages m
        where m.storage_path = name
          and m.to_user_id::text = public.auth_uid_text()
      )
    )
  );

-- ── call_sessions ─────────────────────────────────────────────────────────────
alter table public.call_sessions enable row level security;

drop policy if exists "call_sessions_select_anon" on public.call_sessions;
drop policy if exists "call_sessions_upsert_anon" on public.call_sessions;
drop policy if exists "call_sessions_update_anon" on public.call_sessions;
drop policy if exists "call_sessions_select_participants" on public.call_sessions;
drop policy if exists "call_sessions_insert_participants" on public.call_sessions;
drop policy if exists "call_sessions_update_participants" on public.call_sessions;
drop policy if exists "call_sessions_delete_participants" on public.call_sessions;

create policy "call_sessions_select_participants"
  on public.call_sessions for select
  to authenticated
  using (
    from_user_id::text = public.auth_uid_text()
    or to_user_id::text = public.auth_uid_text()
  );

create policy "call_sessions_insert_participants"
  on public.call_sessions for insert
  to authenticated
  with check (
    from_user_id::text = public.auth_uid_text()
    or to_user_id::text = public.auth_uid_text()
  );

create policy "call_sessions_update_participants"
  on public.call_sessions for update
  to authenticated
  using (
    from_user_id::text = public.auth_uid_text()
    or to_user_id::text = public.auth_uid_text()
  )
  with check (
    from_user_id::text = public.auth_uid_text()
    or to_user_id::text = public.auth_uid_text()
  );

create policy "call_sessions_delete_participants"
  on public.call_sessions for delete
  to authenticated
  using (
    from_user_id::text = public.auth_uid_text()
    or to_user_id::text = public.auth_uid_text()
  );

-- ── memory_gems ───────────────────────────────────────────────────────────────
alter table public.memory_gems
  add column if not exists user_id text;

alter table public.memory_gems
  add column if not exists is_private boolean not null default false;

create index if not exists memory_gems_user_id
  on public.memory_gems (user_id);

alter table public.memory_gems enable row level security;

drop policy if exists "memory_gems_select_anon" on public.memory_gems;
drop policy if exists "memory_gems_select_public_or_owner" on public.memory_gems;
drop policy if exists "memory_gems_insert_owner" on public.memory_gems;
drop policy if exists "memory_gems_update_owner" on public.memory_gems;
drop policy if exists "memory_gems_delete_owner" on public.memory_gems;

create policy "memory_gems_select_public_or_owner"
  on public.memory_gems for select
  to anon, authenticated
  using (
    coalesce(is_private, false) = false
    or user_id::text = public.auth_uid_text()
  );

create policy "memory_gems_insert_owner"
  on public.memory_gems for insert
  to authenticated
  with check (user_id::text = public.auth_uid_text());

create policy "memory_gems_update_owner"
  on public.memory_gems for update
  to authenticated
  using (user_id::text = public.auth_uid_text())
  with check (user_id::text = public.auth_uid_text());

create policy "memory_gems_delete_owner"
  on public.memory_gems for delete
  to authenticated
  using (user_id::text = public.auth_uid_text());
