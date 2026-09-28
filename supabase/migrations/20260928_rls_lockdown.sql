-- 20260928_rls_lockdown.sql
-- Run in the Supabase SQL Editor AFTER migrations/20260927_admin_hardening.sql (needs public.is_admin()).
-- Safe to run more than once (drop policy if exists / create or replace / guarded DO blocks).
--
-- What this migration does
--
--   A. profiles: hide secret columns.
--      * anon + authenticated lose table-level SELECT on public.profiles and get SELECT back only
--        on an explicit list of public columns (everything the app reads: PROFILE_PUBLIC_COLUMNS,
--        presence, geo, is_premium). profiles.password and profiles.fcm_token (and any other column
--        not in the list) can no longer be read through the API.
--      * INSERT / UPDATE stay granted to authenticated, so the owner can still upsert their profile,
--        send presence heartbeats and save their own fcm_token (RLS keeps it owner-only).
--        Note: an upsert that writes a hidden column fails (Postgres needs SELECT on columns written
--        via ON CONFLICT DO UPDATE); the client no longer upserts profiles.password (see src/profile.ts).
--      * anon (no session at all) loses INSERT / UPDATE / DELETE on profiles (anonymous sign-ins use
--        the authenticated role, so nothing in the app depends on it).
--
--   B. profiles: remove legacy "login by reading the password hash" code paths.
--      * drops policies profiles_delete_anon, profiles_login_select_anon, profiles_select_anon,
--        profiles_upsert_anon, profiles_update_anon, and re-creates the owner-only policies.
--      * drops the RPC login_profile_by_username(text) (it returned password hashes to anon).
--      * revokes EXECUTE from anon/authenticated on any other SECURITY DEFINER function in public that
--        returns a password column or whole profiles rows (a NOTICE lists each one).
--      * supabase/profiles.sql and supabase/password_auth.sql no longer re-create any of these.
--
--   C. map_gems: owner-only writes.
--      * drops map_gems_insert_anon / map_gems_update_anon / map_gems_delete_anon (using (true)).
--      * INSERT: author_id = auth.uid(). UPDATE / DELETE: author or public.is_admin().
--        (The app no longer writes map_gems from the client; admins delete via admin_delete_capsule.)
--      * storage: map_gems_anon_update and avatars_anon_update (anyone could overwrite any file)
--        become owner-only (storage.objects.owner_id = auth.uid()); anon uploads to these buckets are
--        replaced by authenticated-only uploads. The app stores media in R2, not Supabase Storage.
--      * also drops legacy using (true) policies on messages / call_sessions / memory_gems, but only
--        when the participant/owner replacement policies from 20260321 / 20260913 are present.
--
--   D. Ban enforcement in the database.
--      * public.is_banned_user(): true when the caller's profile has is_banned = true.
--      * RESTRICTIVE policies (AND-ed with the existing ones) block banned users from INSERT on
--        messages, groups, group_members, memory_gems, map_gems, gem_comments, gem_likes,
--        call_sessions and storage.objects, and from UPDATE on memory_gems / map_gems.
--        Reports, blocked_users and user_peer_relations are left open so a banned user can still
--        report / block and so appeals are possible.
--
-- Verification: run the query at the bottom of this file (after COMMIT). Every row should say ok = true.

begin;

-- ── 0. Prerequisite ───────────────────────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'public.is_admin() is missing: run migrations/20260927_admin_hardening.sql first';
  end if;
end $$;

-- ── A. profiles column-level SELECT ───────────────────────────────────────────
do $$
declare
  -- Columns the app reads (src/profile.ts PROFILE_PUBLIC_COLUMNS, src/presence.ts, src/admin.ts,
  -- src/mapGems.ts, src/groups.ts, src/callSignaling.ts). Missing ones are skipped.
  allow text[] := array[
    'id', 'name', 'color', 'avatar_url', 'theme_fon', 'username', 'role', 'is_banned',
    'is_online', 'last_seen', 'presence_status', 'latitude', 'longitude', 'is_premium',
    'created_at', 'updated_at'
  ];
  cols text;
  hidden text;
begin
  -- Table-level REVOKE also removes any column-level SELECT grants.
  revoke select on table public.profiles from public, anon, authenticated;

  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position)
    into cols
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'profiles'
    and c.column_name = any (allow);

  execute format('grant select (%s) on table public.profiles to anon, authenticated', cols);

  select string_agg(c.column_name, ', ' order by c.ordinal_position)
    into hidden
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'profiles'
    and not (c.column_name = any (allow));

  raise notice 'profiles: readable by anon/authenticated: %', cols;
  raise notice 'profiles: NOT readable via API (write-only / server-only): %', coalesce(hidden, '(none)');
end $$;

-- Owner writes (RLS keeps them owner-only; profiles_guard_privileged protects role / is_banned).
grant insert, update, delete on table public.profiles to authenticated;
revoke insert, update, delete on table public.profiles from anon;

-- ── B. profiles legacy policies + password RPCs ───────────────────────────────
alter table public.profiles enable row level security;

drop policy if exists "profiles_delete_anon" on public.profiles;
drop policy if exists "profiles_login_select_anon" on public.profiles;
drop policy if exists "profiles_select_anon" on public.profiles;
drop policy if exists "profiles_upsert_anon" on public.profiles;
drop policy if exists "profiles_update_anon" on public.profiles;

-- Row visibility stays public (column privileges above decide WHAT can be read).
drop policy if exists "profiles_select_public" on public.profiles;
create policy "profiles_select_public"
  on public.profiles for select
  to anon, authenticated
  using (true);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert
  to authenticated
  with check (id::text = auth.uid()::text);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (id::text = auth.uid()::text)
  with check (id::text = auth.uid()::text);

drop policy if exists "profiles_delete_own" on public.profiles;
create policy "profiles_delete_own"
  on public.profiles for delete
  to authenticated
  using (id::text = auth.uid()::text);

drop function if exists public.login_profile_by_username(text);

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and (
        p.prorettype = 'public.profiles'::regtype
        or exists (
          select 1
          from unnest(
            coalesce(p.proargnames, '{}'::text[]),
            coalesce(p.proargmodes, '{}'::"char"[])
          ) as a(arg_name, arg_mode)
          where a.arg_mode in ('o', 'b', 't')
            and a.arg_name ilike '%password%'
        )
      )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    raise notice 'revoked EXECUTE on % (returns password / full profiles rows)', r.sig;
  end loop;
end $$;

-- ── C. map_gems owner-only writes ─────────────────────────────────────────────
alter table public.map_gems enable row level security;

drop policy if exists "map_gems_insert_anon" on public.map_gems;
drop policy if exists "map_gems_update_anon" on public.map_gems;
drop policy if exists "map_gems_delete_anon" on public.map_gems;

drop policy if exists "map_gems_insert_author" on public.map_gems;
create policy "map_gems_insert_author"
  on public.map_gems for insert
  to authenticated
  with check (author_id::text = auth.uid()::text);

drop policy if exists "map_gems_update_author" on public.map_gems;
create policy "map_gems_update_author"
  on public.map_gems for update
  to authenticated
  using (author_id::text = auth.uid()::text or public.is_admin())
  with check (author_id::text = auth.uid()::text or public.is_admin());

drop policy if exists "map_gems_delete_author" on public.map_gems;
create policy "map_gems_delete_author"
  on public.map_gems for delete
  to authenticated
  using (author_id::text = auth.uid()::text or public.is_admin());

-- Storage: map-gems + avatars buckets (public read stays; writes owner-only).
drop policy if exists "map_gems_anon_update" on storage.objects;
drop policy if exists "map_gems_owner_update" on storage.objects;
create policy "map_gems_owner_update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'map-gems' and owner_id = auth.uid()::text)
  with check (bucket_id = 'map-gems' and owner_id = auth.uid()::text);

drop policy if exists "map_gems_anon_upload" on storage.objects;
drop policy if exists "map_gems_authenticated_upload" on storage.objects;
create policy "map_gems_authenticated_upload"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'map-gems');

drop policy if exists "avatars_anon_update" on storage.objects;
drop policy if exists "avatars_owner_update" on storage.objects;
create policy "avatars_owner_update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'avatars' and owner_id = auth.uid()::text)
  with check (bucket_id = 'avatars' and owner_id = auth.uid()::text);

drop policy if exists "avatars_anon_upload" on storage.objects;
drop policy if exists "avatars_authenticated_upload" on storage.objects;
create policy "avatars_authenticated_upload"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'avatars');

-- Legacy using (true) policies from messages.sql / call_sessions.sql / memory_gems.sql.
-- Dropped only when the hardened replacement exists, so messaging never ends up with no policy.
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'messages'
             and policyname = 'messages_select_participants') then
    drop policy if exists "messages_select_anon" on public.messages;
    drop policy if exists "messages_insert_anon" on public.messages;
    drop policy if exists "messages_update_anon" on public.messages;
    drop policy if exists "messages_delete_anon" on public.messages;
  else
    raise notice 'messages: hardened policies missing, legacy anon policies left in place (run 20260321_harden_rls_policies.sql)';
  end if;

  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'call_sessions'
             and policyname = 'call_sessions_select_participants') then
    drop policy if exists "call_sessions_select_anon" on public.call_sessions;
    drop policy if exists "call_sessions_upsert_anon" on public.call_sessions;
    drop policy if exists "call_sessions_update_anon" on public.call_sessions;
  else
    raise notice 'call_sessions: hardened policies missing, legacy anon policies left in place';
  end if;

  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'memory_gems'
             and policyname = 'memory_gems_select_by_visibility') then
    drop policy if exists "memory_gems_select_anon" on public.memory_gems;
  else
    raise notice 'memory_gems: visibility policy missing, memory_gems_select_anon left in place';
  end if;
end $$;

-- ── D. Ban enforcement ────────────────────────────────────────────────────────
create or replace function public.is_banned_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select coalesce(p.is_banned, false)
       from public.profiles p
      where p.id::text = auth.uid()::text
      limit 1),
    false
  );
$$;
revoke all on function public.is_banned_user() from public;
grant execute on function public.is_banned_user() to anon, authenticated;

do $$
declare
  t text;
begin
  -- INSERT: content tables users write to.
  foreach t in array array[
    'messages', 'groups', 'group_members', 'memory_gems', 'map_gems',
    'gem_comments', 'gem_likes', 'call_sessions'
  ]
  loop
    if to_regclass('public.' || t) is null then
      raise notice 'ban enforcement: table public.% not found, skipped', t;
      continue;
    end if;
    execute format('drop policy if exists %I on public.%I', t || '_block_banned_insert', t);
    execute format(
      'create policy %I on public.%I as restrictive for insert to anon, authenticated '
      'with check (not public.is_banned_user())',
      t || '_block_banned_insert', t
    );
  end loop;

  -- UPDATE: user content that can be edited in place.
  foreach t in array array['memory_gems', 'map_gems']
  loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format('drop policy if exists %I on public.%I', t || '_block_banned_update', t);
    execute format(
      'create policy %I on public.%I as restrictive for update to anon, authenticated '
      'using (not public.is_banned_user()) with check (not public.is_banned_user())',
      t || '_block_banned_update', t
    );
  end loop;
end $$;

-- Storage uploads (all buckets).
drop policy if exists "storage_block_banned_insert" on storage.objects;
create policy "storage_block_banned_insert"
  on storage.objects
  as restrictive
  for insert
  to anon, authenticated
  with check (not public.is_banned_user());

commit;

-- ── Verification (run after the migration; every row should be ok = true) ─────
select check_name, ok
from (
  -- secret columns are not readable
  select format('%s cannot SELECT profiles.%s', r.role_name, c.column_name) as check_name,
         not has_column_privilege(r.role_name, 'public.profiles', c.column_name, 'SELECT') as ok
  from information_schema.columns c
  cross join (values ('anon'), ('authenticated')) as r(role_name)
  where c.table_schema = 'public' and c.table_name = 'profiles'
    and c.column_name in ('password', 'fcm_token')

  union all
  -- public columns are still readable
  select format('%s can SELECT profiles.%s', r.role_name, c.column_name),
         has_column_privilege(r.role_name, 'public.profiles', c.column_name, 'SELECT')
  from information_schema.columns c
  cross join (values ('anon'), ('authenticated')) as r(role_name)
  where c.table_schema = 'public' and c.table_name = 'profiles'
    and c.column_name in ('id', 'name', 'username', 'avatar_url', 'is_online', 'last_seen')

  union all
  -- owner can still write fcm_token
  select 'authenticated can UPDATE profiles.fcm_token',
         has_column_privilege('authenticated', 'public.profiles', 'fcm_token', 'UPDATE')
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'profiles' and c.column_name = 'fcm_token'

  union all
  select 'login_profile_by_username(text) is gone',
         to_regprocedure('public.login_profile_by_username(text)') is null

  union all
  select 'legacy anon profile policies are gone',
         not exists (
           select 1 from pg_policies
           where schemaname = 'public' and tablename = 'profiles'
             and policyname in ('profiles_delete_anon', 'profiles_login_select_anon', 'profiles_select_anon',
                                'profiles_upsert_anon', 'profiles_update_anon')
         )

  union all
  select 'no UPDATE/DELETE/ALL policy with using (true) in public or storage',
         not exists (
           select 1 from pg_policies
           where schemaname in ('public', 'storage')
             and cmd in ('UPDATE', 'DELETE', 'ALL')
             and coalesce(qual, 'true') = 'true'
         )
  union all
  select format('  -> using (true) %s policy still present: %s.%s.%s', cmd, schemaname, tablename, policyname), false
  from pg_policies
  where schemaname in ('public', 'storage')
    and cmd in ('UPDATE', 'DELETE', 'ALL')
    and coalesce(qual, 'true') = 'true'

  union all
  select 'map_gems has no anon write policies',
         not exists (
           select 1 from pg_policies
           where schemaname = 'public' and tablename = 'map_gems'
             and policyname in ('map_gems_insert_anon', 'map_gems_update_anon', 'map_gems_delete_anon')
         )

  union all
  select 'storage anon update policies are gone',
         not exists (
           select 1 from pg_policies
           where schemaname = 'storage' and tablename = 'objects'
             and policyname in ('map_gems_anon_update', 'avatars_anon_update')
         )

  union all
  select 'is_banned_user() exists', to_regprocedure('public.is_banned_user()') is not null

  union all
  select format('restrictive ban policy on %s.%s (%s)', schemaname, tablename, policyname), true
  from pg_policies
  where permissive = 'RESTRICTIVE' and policyname like '%block_banned%'
) v
order by ok, check_name;

-- Extra manual checks:
--   -- any SECURITY DEFINER function that still returns a password column:
--   select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.prosecdef and p.proargnames::text ilike '%password%';
--   -- all policies on the touched tables:
--   select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
--   from pg_policies
--   where tablename in ('profiles', 'map_gems', 'messages', 'memory_gems', 'objects')
--   order by tablename, cmd, policyname;
