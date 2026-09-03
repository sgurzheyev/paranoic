/**
 * Group chats (up to 20 members).
 * Run in Supabase SQL Editor after profiles.sql + messages.sql.
 *
 * Also adds optional messages.group_id for store-and-forward fan-out.
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

-- Members can read groups they belong to.
drop policy if exists "groups_select_member" on public.groups;
create policy "groups_select_member"
  on public.groups for select
  to authenticated
  using (
    exists (
      select 1 from public.group_members gm
      where gm.group_id = groups.id and gm.user_id = auth.uid()
    )
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
  using (
    exists (
      select 1 from public.group_members gm
      where gm.group_id = groups.id
        and gm.user_id = auth.uid()
        and gm.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.group_members gm
      where gm.group_id = groups.id
        and gm.user_id = auth.uid()
        and gm.role = 'admin'
    )
  );

drop policy if exists "groups_delete_admin" on public.groups;
create policy "groups_delete_admin"
  on public.groups for delete
  to authenticated
  using (
    exists (
      select 1 from public.group_members gm
      where gm.group_id = groups.id
        and gm.user_id = auth.uid()
        and gm.role = 'admin'
    )
  );

-- Members can see roster of their groups.
drop policy if exists "group_members_select_peer" on public.group_members;
create policy "group_members_select_peer"
  on public.group_members for select
  to authenticated
  using (
    exists (
      select 1 from public.group_members me
      where me.group_id = group_members.group_id and me.user_id = auth.uid()
    )
  );

-- Creator / admin can add members; users can insert themselves as admin on create.
drop policy if exists "group_members_insert_admin_or_self" on public.group_members;
create policy "group_members_insert_admin_or_self"
  on public.group_members for insert
  to authenticated
  with check (
    user_id = auth.uid()
    or exists (
      select 1 from public.group_members me
      where me.group_id = group_members.group_id
        and me.user_id = auth.uid()
        and me.role = 'admin'
    )
    or exists (
      select 1 from public.groups g
      where g.id = group_members.group_id and g.created_by = auth.uid()
    )
  );

drop policy if exists "group_members_delete_admin_or_self" on public.group_members;
create policy "group_members_delete_admin_or_self"
  on public.group_members for delete
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.group_members me
      where me.group_id = group_members.group_id
        and me.user_id = auth.uid()
        and me.role = 'admin'
    )
  );

drop policy if exists "group_members_update_admin" on public.group_members;
create policy "group_members_update_admin"
  on public.group_members for update
  to authenticated
  using (
    exists (
      select 1 from public.group_members me
      where me.group_id = group_members.group_id
        and me.user_id = auth.uid()
        and me.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.group_members me
      where me.group_id = group_members.group_id
        and me.user_id = auth.uid()
        and me.role = 'admin'
    )
  );

comment on table public.groups is 'Multi-user chat rooms (max 20 members enforced client-side).';
comment on table public.group_members is 'Membership + role for groups.';
