/**
 * Group chats (up to 20 members).
 * Run in Supabase SQL Editor after profiles.sql + messages.sql.
 *
 * Also adds optional messages.group_id for store-and-forward fan-out.
 *
 * RLS note: membership checks go through SECURITY DEFINER helpers so
 * policies never self-query group_members (avoids infinite recursion).
 */

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  created_by uuid not null references auth.users (id) on delete cascade,
  avatar_url text,
  created_at timestamptz not null default now()
);

create index if not exists groups_created_by_idx on public.groups (created_by);

create table if not exists public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'member')) default 'member',
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index if not exists group_members_user_idx on public.group_members (user_id);

alter table public.messages
  add column if not exists group_id uuid references public.groups (id) on delete set null;

create index if not exists messages_group_pending_idx
  on public.messages (group_id, pending_delivery, created_at)
  where group_id is not null;

alter table public.groups enable row level security;
alter table public.group_members enable row level security;

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

-- Members (or creator) can read their groups.
drop policy if exists "groups_select_member" on public.groups;
create policy "groups_select_member"
  on public.groups for select
  to authenticated
  using (
    created_by = auth.uid()
    or public.is_group_member(id)
  );

-- Any authenticated user can create a group (must add themselves as admin next).
drop policy if exists "groups_insert_auth" on public.groups;
create policy "groups_insert_auth"
  on public.groups for insert
  to authenticated
  with check (created_by = auth.uid());

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

-- Own row always visible; peers visible via definer membership check (no self-join).
drop policy if exists "group_members_select_peer" on public.group_members;
create policy "group_members_select_peer"
  on public.group_members for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_group_member(group_id)
  );

-- Self-join as member; creator/admin can add others (definer — no recursion).
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

comment on table public.groups is 'Multi-user chat rooms (max 20 members enforced client-side).';
comment on table public.group_members is 'Membership + role for groups.';
comment on function public.is_group_member(uuid) is
  'RLS helper: true if auth.uid() is a member of the group (bypasses RLS).';
comment on function public.is_group_admin(uuid) is
  'RLS helper: true if auth.uid() is an admin of the group (bypasses RLS).';
comment on function public.is_group_creator(uuid) is
  'RLS helper: true if auth.uid() created the group (bypasses RLS).';
