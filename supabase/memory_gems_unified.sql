/**
 * Unified memory_gems — single source for map pins + visibility.
 * Run in Supabase SQL Editor after memory_gems.sql.
 */

do $$ begin
  create type public.gem_visibility as enum ('private', 'family', 'public');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.memory_gem_type as enum ('photo', 'video', 'text');
exception
  when duplicate_object then null;
end $$;

alter table public.memory_gems
  add column if not exists user_id text,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists gem_type public.memory_gem_type,
  add column if not exists visibility public.gem_visibility not null default 'public',
  add column if not exists is_private boolean default false;

-- Backfill coordinates from legacy lat/lng columns.
update public.memory_gems
set
  latitude = coalesce(latitude, lat),
  longitude = coalesce(longitude, lng)
where latitude is null or longitude is null;

-- Migrate legacy is_private → visibility.
update public.memory_gems
set visibility = case when is_private is true then 'private'::public.gem_visibility else 'public'::public.gem_visibility end
where visibility is null or (is_private is true and visibility = 'public'::public.gem_visibility);

-- Import legacy map_gems rows (one-time merge).
insert into public.memory_gems (
  id, user_id, latitude, longitude, lat, lng, title, address, media_urls, gem_type, visibility, created_at, metadata
)
select
  g.id,
  g.author_id,
  g.lat,
  g.lng,
  g.lat,
  g.lng,
  g.content,
  null,
  case when g.media_url is not null then array[g.media_url] else '{}'::text[] end,
  g.type::text::public.memory_gem_type,
  'public'::public.gem_visibility,
  g.created_at,
  jsonb_build_object('migrated_from', 'map_gems')
from public.map_gems g
where not exists (select 1 from public.memory_gems m where m.id = g.id)
on conflict (id) do nothing;

create index if not exists memory_gems_user_created
  on public.memory_gems (user_id, created_at desc);

create index if not exists memory_gems_visibility
  on public.memory_gems (visibility);

comment on column public.memory_gems.visibility is
  'private = owner only; family = owner + contacts; public = everyone';
