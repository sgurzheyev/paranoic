/**
 * Fix RLS for store-and-forward messages + offline-transfers.
 *
 * Run in Supabase SQL Editor (production).
 *
 * Client writes:
 *   messages.from_user_id = auth.uid()::text
 *   storage path = '{auth.uid()}/{to_user_id}/{id}.bin'
 *
 * Legacy paths '{to_user_id}/{id}.bin' remain readable by the recipient folder rule.
 */

create or replace function public.auth_uid_text()
returns text
language sql
stable
as $$
  select auth.uid()::text;
$$;

revoke all on function public.auth_uid_text() from public;
grant execute on function public.auth_uid_text() to anon, authenticated;

-- ── messages ──────────────────────────────────────────────────────────────────
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

-- INSERT only as yourself (from_user_id = auth.uid())
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

-- ── Storage: offline-transfers ────────────────────────────────────────────────
drop policy if exists "offline_transfers_select" on storage.objects;
drop policy if exists "offline_transfers_insert" on storage.objects;
drop policy if exists "offline_transfers_update" on storage.objects;
drop policy if exists "offline_transfers_delete" on storage.objects;
drop policy if exists "offline_transfers_select_auth" on storage.objects;
drop policy if exists "offline_transfers_insert_auth" on storage.objects;
drop policy if exists "offline_transfers_update_auth" on storage.objects;
drop policy if exists "offline_transfers_delete_auth" on storage.objects;

-- Read: own folder (sender) OR legacy recipient folder OR path listed for me in messages
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

-- Write only into your own folder: {auth.uid()}/...
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

-- Delete: own objects OR objects addressed to me (ZK purge after decrypt)
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
