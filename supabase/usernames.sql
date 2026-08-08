/**
 * Usernames for short magic links (?u=gurgini).
 * Run in Supabase SQL Editor after profiles.sql.
 */

alter table public.profiles
  add column if not exists username text;

-- Unique among non-null usernames (case-insensitive via lower()).
create unique index if not exists profiles_username_unique
  on public.profiles (lower(username))
  where username is not null and length(trim(username)) > 0;

comment on column public.profiles.username is
  'Short public handle for magic links (?u=username), a-z0-9_, 3–24 chars';
