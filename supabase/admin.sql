/**
 * Admin roles + ban flags for Paranoic.
 * Run in Supabase SQL Editor after profiles.sql / usernames.sql.
 *
 * Promote yourself:
 *   update public.profiles set role = 'admin' where id = 'YOUR_USER_ID';
 */

alter table public.profiles
  add column if not exists role text not null default 'user';

alter table public.profiles
  add column if not exists is_banned boolean not null default false;

alter table public.profiles
  add column if not exists created_at timestamptz not null default now();

-- Backfill registration time for older rows.
update public.profiles
set created_at = coalesce(created_at, updated_at, now())
where created_at is null;

comment on column public.profiles.role is
  'Access role: user | admin. Admins see Admin Panel.';
comment on column public.profiles.is_banned is
  'When true, client must block call_offer and P2P connections.';
comment on column public.profiles.created_at is
  'Approximate registration time (first profile upsert).';

drop policy if exists "profiles_delete_anon" on public.profiles;
create policy "profiles_delete_anon"
  on public.profiles for delete
  to anon
  using (true);
