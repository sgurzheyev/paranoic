/**
 * Store-and-Forward: encrypted offline messages + files.
 *
 * Run in Supabase SQL Editor after profiles.sql.
 * Creates table `messages` and private Storage bucket `offline-transfers`.
 */

create table if not exists public.messages (
  id text primary key,
  from_user_id text not null,
  to_user_id text not null,
  conversation_id text not null,
  /** Подсказка для PBKDF2: обычно inbox-{to_user_id}. */
  room_id text not null,
  kind text not null check (kind in ('text', 'media')),
  pending_delivery boolean not null default true,
  /** AES-GCM ciphertext (text) или null для media (тело в Storage). */
  cipher text,
  iv text not null,
  sender_name text,
  media_mime text,
  media_name text,
  media_size bigint,
  storage_path text,
  created_at timestamptz not null default now()
);

create index if not exists messages_to_pending_created
  on public.messages (to_user_id, pending_delivery, created_at);

alter table public.messages enable row level security;

-- Demo: anon CRUD (нет auth в приложении; полезная нагрузка E2EE).
drop policy if exists "messages_select_anon" on public.messages;
create policy "messages_select_anon"
  on public.messages for select
  to anon, authenticated
  using (true);

drop policy if exists "messages_insert_anon" on public.messages;
create policy "messages_insert_anon"
  on public.messages for insert
  to anon, authenticated
  with check (true);

drop policy if exists "messages_update_anon" on public.messages;
create policy "messages_update_anon"
  on public.messages for update
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "messages_delete_anon" on public.messages;
create policy "messages_delete_anon"
  on public.messages for delete
  to anon, authenticated
  using (true);

-- Private bucket for encrypted blobs (Zero-Knowledge: delete after client decrypt).
-- Path: {auth.uid()}/{to_user_id}/{id}.bin — see messages_rls_fix.sql for production RLS.
insert into storage.buckets (id, name, public)
values ('offline-transfers', 'offline-transfers', false)
on conflict (id) do update set public = false;

drop policy if exists "offline_transfers_select" on storage.objects;
create policy "offline_transfers_select"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'offline-transfers');

drop policy if exists "offline_transfers_insert" on storage.objects;
create policy "offline_transfers_insert"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'offline-transfers');

drop policy if exists "offline_transfers_update" on storage.objects;
create policy "offline_transfers_update"
  on storage.objects for update
  to anon, authenticated
  using (bucket_id = 'offline-transfers')
  with check (bucket_id = 'offline-transfers');

drop policy if exists "offline_transfers_delete" on storage.objects;
create policy "offline_transfers_delete"
  on storage.objects for delete
  to anon, authenticated
  using (bucket_id = 'offline-transfers');

-- NOTE: For production auth RLS, run messages_rls_fix.sql (or harden_rls_policies.sql)
-- after enabling authenticated sessions. Demo policies above are open for local/dev.