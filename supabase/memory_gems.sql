/**
 * Memory GEMs — импортированные капсулы с массивом media_urls.
 * Run in Supabase SQL Editor.
 *
 * Координаты: колонки lat/lng или metadata { "lat", "lng" }.
 */

create table if not exists public.memory_gems (
  id uuid primary key default gen_random_uuid(),
  title text,
  address text,
  media_urls text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  lat double precision,
  lng double precision,
  created_at timestamptz not null default now(),
  constraint memory_gems_lat_check check (lat is null or (lat >= -90 and lat <= 90)),
  constraint memory_gems_lng_check check (lng is null or (lng >= -180 and lng <= 180))
);

create index if not exists memory_gems_created
  on public.memory_gems (created_at desc);

alter table public.memory_gems enable row level security;

drop policy if exists "memory_gems_select_anon" on public.memory_gems;
create policy "memory_gems_select_anon"
  on public.memory_gems for select
  to anon, authenticated
  using (true);

comment on table public.memory_gems is
  'Imported Memory GEM capsules; first media_urls[] item used as map marker preview';
