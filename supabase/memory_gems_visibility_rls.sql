/**
 * P0: memory_gems visibility RLS + store-and-forward block enforcement.
 *
 * Root cause (gems):
 *   harden_rls_policies.sql SELECT still uses legacy is_private.
 *   visibility = 'family' is stored with is_private = false, so Postgres
 *   treats family gems as public. canViewGem() is only a client filter.
 *
 * Data model (investigated):
 *   - user_peer_relations.relation is only 'trusted' | 'blocked'
 *   - blocked_users is a Play-compliance block list (owner-readable)
 *   - Contacts / address book live in IndexedDB (not queryable by RLS)
 *   - There is no reciprocal family / household graph
 *
 * Therefore family FAILS CLOSED (owner only) rather than leaking to every
 * authenticated user or to merely-trusted peers.
 *
 * To enable family sharing later:
 *   1. Add a server-side membership table (e.g. family_members) or a
 *      dedicated 'family' relation that is DISTINCT from 'trusted'
 *   2. Require reciprocal consent (both users must opt in)
 *   3. Replace memory_gem_is_visible_to() family branch with that check
 *   4. Do NOT use local contacts or unidirectional trusted for RLS
 *
 * Public audience: authenticated users (same as current signed-in map).
 * Anonymous SELECT is limited to visibility = 'public'.
 *
 * ── DEPLOY (Supabase Dashboard → SQL Editor) ──────────────────────────────
 *   Paste and run THIS ENTIRE FILE once. Safe to re-run (idempotent).
 *   Prerequisite: memory_gems table exists (memory_gems.sql +
 *   memory_gems_unified.sql). Auth must be enabled.
 *   Do not re-run older harden_rls_policies.sql afterwards without this
 *   file — that script's memory_gems SELECT was updated to match, but
 *   historical copies would restore the leaky is_private policy.
 */

-- ── ensure visibility types / columns (no-op if already applied) ───────────
do $$ begin
  create type public.gem_visibility as enum ('private', 'family', 'public');
exception
  when duplicate_object then null;
end $$;

alter table public.memory_gems
  add column if not exists user_id text;

alter table public.memory_gems
  add column if not exists visibility public.gem_visibility;

alter table public.memory_gems
  add column if not exists is_private boolean default false;

-- Backfill visibility from legacy is_private where still unset.
update public.memory_gems
set visibility = case
  when is_private is true then 'private'::public.gem_visibility
  else 'public'::public.gem_visibility
end
where visibility is null;

-- Keep is_private aligned so older clients / scripts stay consistent.
update public.memory_gems
set is_private = (visibility = 'private'::public.gem_visibility)
where is_private is distinct from (visibility = 'private'::public.gem_visibility);

create or replace function public.auth_uid_text()
returns text
language sql
stable
as $$
  select auth.uid()::text;
$$;

revoke all on function public.auth_uid_text() from public;
grant execute on function public.auth_uid_text() to anon, authenticated;

-- Resolved visibility: column first, then legacy is_private, else public.
create or replace function public.memory_gem_resolved_visibility(
  p_visibility text,
  p_is_private boolean
)
returns text
language sql
immutable
as $$
  select case
    when p_visibility in ('private', 'family', 'public') then p_visibility
    when p_is_private is true then 'private'
    else 'public'
  end;
$$;

revoke all on function public.memory_gem_resolved_visibility(text, boolean) from public;
grant execute on function public.memory_gem_resolved_visibility(text, boolean) to anon, authenticated;

/**
 * Who may read a memory_gems row.
 *   private / family → owner only (family fail-closed; see header)
 *   public           → any authenticated user; anon also allowed
 */
create or replace function public.memory_gem_is_visible_to(
  p_user_id text,
  p_visibility text,
  p_is_private boolean
)
returns boolean
language sql
stable
as $$
  select
    (p_user_id is not null and p_user_id = public.auth_uid_text())
    or public.memory_gem_resolved_visibility(p_visibility, p_is_private) = 'public';
$$;

revoke all on function public.memory_gem_is_visible_to(text, text, boolean) from public;
grant execute on function public.memory_gem_is_visible_to(text, text, boolean) to anon, authenticated;

comment on function public.memory_gem_is_visible_to(text, text, boolean) is
  'RLS helper: private+family = owner only (family fail-closed); public = all viewers';

alter table public.memory_gems enable row level security;

drop policy if exists "memory_gems_select_anon" on public.memory_gems;
drop policy if exists "memory_gems_select_public_or_owner" on public.memory_gems;
drop policy if exists "memory_gems_select_by_visibility" on public.memory_gems;

create policy "memory_gems_select_by_visibility"
  on public.memory_gems for select
  to anon, authenticated
  using (
    public.memory_gem_is_visible_to(
      user_id::text,
      visibility::text,
      is_private
    )
  );

-- Owner write policies (recreate if missing; do not loosen).
drop policy if exists "memory_gems_insert_owner" on public.memory_gems;
create policy "memory_gems_insert_owner"
  on public.memory_gems for insert
  to authenticated
  with check (user_id::text = public.auth_uid_text());

drop policy if exists "memory_gems_update_owner" on public.memory_gems;
create policy "memory_gems_update_owner"
  on public.memory_gems for update
  to authenticated
  using (user_id::text = public.auth_uid_text())
  with check (user_id::text = public.auth_uid_text());

drop policy if exists "memory_gems_delete_owner" on public.memory_gems;
create policy "memory_gems_delete_owner"
  on public.memory_gems for delete
  to authenticated
  using (user_id::text = public.auth_uid_text());

comment on column public.memory_gems.visibility is
  'private = owner only; family = owner only until a reciprocal family graph exists; public = authenticated (and anon) viewers';

-- Social rows must not leak family/private gems by id.
create or replace function public.gem_row_visible(p_gem_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1
      from public.memory_gems m
      where m.id = p_gem_id
        and public.memory_gem_is_visible_to(m.user_id::text, m.visibility::text, m.is_private)
    )
    or exists (
      select 1
      from public.map_gems g
      where g.id = p_gem_id
    );
$$;

revoke all on function public.gem_row_visible(uuid) from public;
grant execute on function public.gem_row_visible(uuid) to authenticated;

do $$ begin
  if to_regclass('public.gem_likes') is not null then
    execute 'drop policy if exists "gem_likes_select" on public.gem_likes';
    execute $p$
      create policy "gem_likes_select"
        on public.gem_likes for select
        to authenticated
        using (public.gem_row_visible(gem_id))
    $p$;
    execute 'drop policy if exists "gem_likes_insert" on public.gem_likes';
    execute $p$
      create policy "gem_likes_insert"
        on public.gem_likes for insert
        to authenticated
        with check (
          user_id = public.auth_uid_text()
          and public.gem_row_visible(gem_id)
        )
    $p$;
  end if;

  if to_regclass('public.gem_comments') is not null then
    execute 'drop policy if exists "gem_comments_select" on public.gem_comments';
    execute $p$
      create policy "gem_comments_select"
        on public.gem_comments for select
        to authenticated
        using (public.gem_row_visible(gem_id))
    $p$;
    execute 'drop policy if exists "gem_comments_insert" on public.gem_comments';
    execute $p$
      create policy "gem_comments_insert"
        on public.gem_comments for insert
        to authenticated
        with check (
          user_id = public.auth_uid_text()
          and char_length(trim(content)) between 1 and 500
          and public.gem_row_visible(gem_id)
        )
    $p$;
  end if;
end $$;

-- ── SAF: refuse new 1:1 pending rows when either side blocked the other ─────
create or replace function public.direct_pair_is_blocked(a text, b text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if a is null or b is null or a = b or length(trim(a)) = 0 or length(trim(b)) = 0 then
    return false;
  end if;

  if to_regclass('public.blocked_users') is not null then
    if exists (
      select 1
      from public.blocked_users bu
      where (bu.user_id::text = a and bu.blocked_user_id = b)
         or (bu.user_id::text = b and bu.blocked_user_id = a)
    ) then
      return true;
    end if;
  end if;

  if to_regclass('public.user_peer_relations') is not null then
    if exists (
      select 1
      from public.user_peer_relations r
      where r.relation = 'blocked'
        and (
          (r.owner_id::text = a and r.peer_id = b)
          or (r.owner_id::text = b and r.peer_id = a)
        )
    ) then
      return true;
    end if;
  end if;

  return false;
end;
$$;

revoke all on function public.direct_pair_is_blocked(text, text) from public;
grant execute on function public.direct_pair_is_blocked(text, text) to authenticated;

comment on function public.direct_pair_is_blocked(text, text) is
  'True when either user blocked the other (blocked_users or user_peer_relations)';

do $$
declare
  has_group boolean;
begin
  if to_regclass('public.messages') is null then
    return;
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'messages'
      and column_name = 'group_id'
  ) into has_group;

  execute 'alter table public.messages enable row level security';
  execute 'drop policy if exists "messages_insert_sender" on public.messages';

  -- Group fan-out still writes one row per member (to_user_id = member).
  -- Block enforcement applies to 1:1 pending rows only.
  if has_group then
    execute $p$
      create policy "messages_insert_sender"
        on public.messages for insert
        to authenticated
        with check (
          from_user_id::text = public.auth_uid_text()
          and (
            group_id is not null
            or not public.direct_pair_is_blocked(from_user_id::text, to_user_id::text)
          )
        )
    $p$;
  else
    execute $p$
      create policy "messages_insert_sender"
        on public.messages for insert
        to authenticated
        with check (
          from_user_id::text = public.auth_uid_text()
          and not public.direct_pair_is_blocked(from_user_id::text, to_user_id::text)
        )
    $p$;
  end if;
end $$;
