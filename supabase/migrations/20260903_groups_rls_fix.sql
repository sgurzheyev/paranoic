/**
 * Fix infinite recursion in groups / group_members RLS.
 *
 * Safe to run on DBs that already applied 20260903_groups.sql with the
 * old self-referencing policies. Idempotent: replaces helpers + policies only.
 */

-- ── helpers (bypass RLS; do not recurse into policies) ───────────────────────
create or replace function public.is_group_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = auth.uid()
  );
$$;

create or replace function public.is_group_admin(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = auth.uid()
      and gm.role = 'admin'
  );
$$;

create or replace function public.is_group_creator(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.groups g
    where g.id = p_group_id
      and g.created_by = auth.uid()
  );
$$;

revoke all on function public.is_group_member(uuid) from public;
revoke all on function public.is_group_admin(uuid) from public;
revoke all on function public.is_group_creator(uuid) from public;
grant execute on function public.is_group_member(uuid) to authenticated;
grant execute on function public.is_group_admin(uuid) to authenticated;
grant execute on function public.is_group_creator(uuid) to authenticated;

-- ── groups ───────────────────────────────────────────────────────────────────
drop policy if exists "groups_select_member" on public.groups;
create policy "groups_select_member"
  on public.groups for select
  to authenticated
  using (
    created_by = auth.uid()
    or public.is_group_member(id)
  );

drop policy if exists "groups_update_admin" on public.groups;
create policy "groups_update_admin"
  on public.groups for update
  to authenticated
  using (public.is_group_admin(id))
  with check (public.is_group_admin(id));

drop policy if exists "groups_delete_admin" on public.groups;
create policy "groups_delete_admin"
  on public.groups for delete
  to authenticated
  using (public.is_group_admin(id));

-- ── group_members ────────────────────────────────────────────────────────────
drop policy if exists "group_members_select_peer" on public.group_members;
create policy "group_members_select_peer"
  on public.group_members for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_group_member(group_id)
  );

drop policy if exists "group_members_insert_admin_or_self" on public.group_members;
create policy "group_members_insert_admin_or_self"
  on public.group_members for insert
  to authenticated
  with check (
    user_id = auth.uid()
    or public.is_group_admin(group_id)
    or public.is_group_creator(group_id)
  );

drop policy if exists "group_members_delete_admin_or_self" on public.group_members;
create policy "group_members_delete_admin_or_self"
  on public.group_members for delete
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_group_admin(group_id)
  );

drop policy if exists "group_members_update_admin" on public.group_members;
create policy "group_members_update_admin"
  on public.group_members for update
  to authenticated
  using (public.is_group_admin(group_id))
  with check (public.is_group_admin(group_id));
