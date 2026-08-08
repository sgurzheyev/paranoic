/**
 * Spatial Memory Gems — капсулы памяти на Family Mode карте.
 * Run in Supabase SQL Editor after profiles.sql.
 *
 * Приложение пока без Supabase Auth: demo-политики для anon.
 * Когда появится auth — замените anon-политики на authenticated (см. комментарии).
 */

do $$ begin
  create type public.map_gem_type as enum ('photo', 'video', 'text');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.map_gems (
  id uuid primary key default gen_random_uuid(),
  -- text: совпадает с profiles.id (короткие id приложения, не обязательно UUID).
  author_id text not null references public.profiles (id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  type public.map_gem_type not null,
  media_url text,
  content text,
  created_at timestamptz not null default now(),
  constraint map_gems_lat_check check (lat >= -90 and lat <= 90),
  constraint map_gems_lng_check check (lng >= -180 and lng <= 180)
);

create index if not exists map_gems_author_created
  on public.map_gems (author_id, created_at desc);

create index if not exists map_gems_geo
  on public.map_gems (lat, lng);

alter table public.map_gems enable row level security;

-- Demo (нет Auth): Family Mode фильтрует gems на клиенте по контактам.
drop policy if exists "map_gems_select_anon" on public.map_gems;
create policy "map_gems_select_anon"
  on public.map_gems for select
  to anon, authenticated
  using (true);

drop policy if exists "map_gems_insert_anon" on public.map_gems;
create policy "map_gems_insert_anon"
  on public.map_gems for insert
  to anon, authenticated
  with check (true);

drop policy if exists "map_gems_update_anon" on public.map_gems;
create policy "map_gems_update_anon"
  on public.map_gems for update
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "map_gems_delete_anon" on public.map_gems;
create policy "map_gems_delete_anon"
  on public.map_gems for delete
  to anon, authenticated
  using (true);

/*
 * Целевые политики после включения Supabase Auth + JWT claim user_id:
 *
 * drop policy "map_gems_select_anon" on public.map_gems;
 * create policy "map_gems_select_family"
 *   on public.map_gems for select to authenticated
 *   using (
 *     author_id = auth.jwt() ->> 'user_id'
 *     or author_id in (
 *       select contact_id from public.family_contacts
 *       where owner_id = auth.jwt() ->> 'user_id'
 *     )
 *   );
 *
 * create policy "map_gems_insert_author"
 *   on public.map_gems for insert to authenticated
 *   with check (author_id = auth.jwt() ->> 'user_id');
 */

comment on table public.map_gems is
  'Spatial Memory Gems: photo/video/text capsules pinned to GPS on Family Mode map';

-- Media for gems (public read, anon upload — как avatars).
insert into storage.buckets (id, name, public)
values ('map-gems', 'map-gems', true)
on conflict (id) do update set public = true;

drop policy if exists "map_gems_public_read" on storage.objects;
create policy "map_gems_public_read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'map-gems');

drop policy if exists "map_gems_anon_upload" on storage.objects;
create policy "map_gems_anon_upload"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'map-gems');

drop policy if exists "map_gems_anon_update" on storage.objects;
create policy "map_gems_anon_update"
  on storage.objects for update
  to anon, authenticated
  using (bucket_id = 'map-gems')
  with check (bucket_id = 'map-gems');
