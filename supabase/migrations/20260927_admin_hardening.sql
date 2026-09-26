-- 20260927_admin_hardening.sql  (DRAFT from admin audit — review before running)
-- Goals:
--   1. Stop self-promotion: non-admin API callers can no longer change profiles.role / is_banned.
--   2. One server-side admin check (role only, no username fallback).
--   3. Admin writes go through SECURITY DEFINER RPCs that fail loudly on 0 rows and write an audit log
--      (with a JSON snapshot of deleted rows, so a delete can be restored by hand).
--   4. Remove the anon "delete any profile" policy that supabase/admin.sql re-creates.

begin;

-- ── 1. Admin check ─────────────────────────────────────────────────────────────
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id::text = auth.uid()::text
      and p.role = 'admin'
      and not coalesce(p.is_banned, false)
  );
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- ── 2. Guard privileged profile columns ───────────────────────────────────────
-- API callers (JWT role anon/authenticated):
--   * INSERT: role is forced to 'user'.
--   * UPDATE: role can never change via the API; is_banned only by an admin.
--   * DELETE: a banned user cannot delete (and re-create) their own row to shed the ban.
-- SQL editor / service_role (auth.role() not anon/authenticated) are unaffected.
create or replace function public.profiles_guard_privileged()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  api_caller boolean := coalesce(auth.role(), '') in ('anon', 'authenticated');
begin
  if not api_caller then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.role := 'user';
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.role is distinct from old.role then
      raise exception 'profiles.role can only be changed in the SQL editor' using errcode = '42501';
    end if;
    if new.is_banned is distinct from old.is_banned and not public.is_admin() then
      raise exception 'only admins can change profiles.is_banned' using errcode = '42501';
    end if;
    return new;
  end if;

  -- DELETE
  if coalesce(old.is_banned, false) and not public.is_admin() then
    raise exception 'banned profiles cannot be deleted by the user' using errcode = '42501';
  end if;
  return old;
end;
$$;

drop trigger if exists profiles_guard_privileged on public.profiles;
create trigger profiles_guard_privileged
  before insert or update or delete on public.profiles
  for each row execute function public.profiles_guard_privileged();

-- ── 3. Remove dangerous legacy policy (supabase/admin.sql re-creates it) ──────
drop policy if exists "profiles_delete_anon" on public.profiles;

-- ── 4. Audit log ──────────────────────────────────────────────────────────────
create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_id text not null,
  action text not null,           -- ban | unban | delete_capsule | resolve_report
  target_type text not null,      -- profile | memory_gems | map_gems | report
  target_id text not null,
  details jsonb not null default '{}'::jsonb,  -- row snapshot for deletes
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_log_created_at on public.admin_audit_log (created_at desc);
alter table public.admin_audit_log enable row level security;

drop policy if exists "admin_audit_log_select_admin" on public.admin_audit_log;
create policy "admin_audit_log_select_admin"
  on public.admin_audit_log for select
  to authenticated
  using (public.is_admin());
-- No insert/update/delete policies: rows are written only by the RPCs below (append-only for clients).

-- ── 5. Admin RPCs ─────────────────────────────────────────────────────────────
create or replace function public.admin_set_ban(p_target text, p_banned boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_target = auth.uid()::text then
    raise exception 'cannot ban yourself';
  end if;
  update public.profiles set is_banned = p_banned where id::text = p_target;
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'profile % not found', p_target using errcode = 'P0002';
  end if;
  insert into public.admin_audit_log (actor_id, action, target_type, target_id)
  values (auth.uid()::text, case when p_banned then 'ban' else 'unban' end, 'profile', p_target);
end;
$$;

create or replace function public.admin_delete_capsule(p_source text, p_id text)
returns text  -- media_url of the deleted row (client then removes the file)
language plpgsql
security definer
set search_path = public
as $$
declare
  snap jsonb;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_source = 'memory_gems' then
    delete from public.memory_gems g where g.id::text = p_id returning to_jsonb(g.*) into snap;
  elsif p_source = 'map_gems' then
    delete from public.map_gems g where g.id::text = p_id returning to_jsonb(g.*) into snap;
  else
    raise exception 'unknown capsule source %', p_source;
  end if;
  if snap is null then
    raise exception 'capsule % not found', p_id using errcode = 'P0002';
  end if;
  insert into public.admin_audit_log (actor_id, action, target_type, target_id, details)
  values (auth.uid()::text, 'delete_capsule', p_source, p_id, snap);
  return snap ->> 'media_url';
end;
$$;

create or replace function public.admin_resolve_report(p_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  update public.reports set resolved_at = now()
  where id::text = p_id and resolved_at is null;
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'report % not found or already resolved', p_id using errcode = 'P0002';
  end if;
  insert into public.admin_audit_log (actor_id, action, target_type, target_id)
  values (auth.uid()::text, 'resolve_report', 'report', p_id);
end;
$$;

revoke all on function public.admin_set_ban(text, boolean) from public, anon;
revoke all on function public.admin_delete_capsule(text, text) from public, anon;
revoke all on function public.admin_resolve_report(text) from public, anon;
grant execute on function public.admin_set_ban(text, boolean) to authenticated;
grant execute on function public.admin_delete_capsule(text, text) to authenticated;
grant execute on function public.admin_resolve_report(text) to authenticated;

-- ── 6. Reports policies: role-only admin check (drop username fallback) ───────
drop policy if exists "reports_admin_select" on public.reports;
create policy "reports_admin_select"
  on public.reports for select
  to authenticated
  using (reporter_id::text = auth.uid()::text or public.is_admin());

drop policy if exists "reports_admin_update" on public.reports;
create policy "reports_admin_update"
  on public.reports for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "reports_admin_delete" on public.reports;
create policy "reports_admin_delete"
  on public.reports for delete
  to authenticated
  using (public.is_admin());

commit;

-- ── 7. One-time, run by hand in the SQL editor AFTER the migration ────────────
-- Make the owner an admin by role (the username fallback is gone):
--   update public.profiles set role = 'admin' where lower(username) = 'sgurzheyev';
-- Check that nobody else has already promoted themselves:
--   select id, username, role from public.profiles where role = 'admin';
--   -- demote anything unexpected:  update public.profiles set role = 'user' where id = '<id>';
