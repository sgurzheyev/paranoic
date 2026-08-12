/**
 * Supabase setup for Paranoic profiles + avatars.
 *
 * Run in Supabase SQL Editor (Dashboard → SQL).
 * Then create a public Storage bucket named `avatars` (or rely on the insert below).
 *
 * PRODUCTION SCHEMA (source of truth):
 *   id, avatar_url, username, is_banned, role, color, name, theme_fon, password
 */

-- Profiles table
create table if not exists public.profiles (
  id text primary key,
  name text not null default 'Я',
  color text not null default '#34d399',
  avatar_url text,
  theme_fon text,
  username text,
  role text not null default 'user',
  is_banned boolean not null default false,
  password text
);

create unique index if not exists profiles_username_unique
  on public.profiles (lower(username))
  where username is not null and length(trim(username)) > 0;

alter table public.profiles enable row level security;

-- Demo policies: anon read/upsert (no auth in the app yet).
drop policy if exists "profiles_select_anon" on public.profiles;
create policy "profiles_select_anon"
  on public.profiles for select
  to anon
  using (true);

drop policy if exists "profiles_upsert_anon" on public.profiles;
create policy "profiles_upsert_anon"
  on public.profiles for insert
  to anon
  with check (true);

drop policy if exists "profiles_update_anon" on public.profiles;
create policy "profiles_update_anon"
  on public.profiles for update
  to anon
  using (true)
  with check (true);

drop policy if exists "profiles_delete_anon" on public.profiles;
create policy "profiles_delete_anon"
  on public.profiles for delete
  to anon
  using (true);

-- Storage bucket
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'avatars');

drop policy if exists "avatars_anon_upload" on storage.objects;
create policy "avatars_anon_upload"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'avatars');

drop policy if exists "avatars_anon_update" on storage.objects;
create policy "avatars_anon_update"
  on storage.objects for update
  to anon, authenticated
  using (bucket_id = 'avatars')
  with check (bucket_id = 'avatars');
