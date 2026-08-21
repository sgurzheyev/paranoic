/**
 * Allow gem_likes / gem_comments on both map_gems and memory_gems.
 * Run after gem_social.sql + harden_rls_policies.sql.
 */

-- Drop hard FK to map_gems only (gem_id may point at memory_gems).
alter table public.gem_likes
  drop constraint if exists gem_likes_gem_id_fkey;

alter table public.gem_comments
  drop constraint if exists gem_comments_gem_id_fkey;

create or replace function public.gem_row_exists(p_gem_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (select 1 from public.map_gems g where g.id = p_gem_id)
    or exists (select 1 from public.memory_gems m where m.id = p_gem_id);
$$;

revoke all on function public.gem_row_exists(uuid) from public;
grant execute on function public.gem_row_exists(uuid) to authenticated;

drop policy if exists "gem_likes_select" on public.gem_likes;
create policy "gem_likes_select"
  on public.gem_likes for select
  to authenticated
  using (public.gem_row_exists(gem_id));

drop policy if exists "gem_comments_select" on public.gem_comments;
create policy "gem_comments_select"
  on public.gem_comments for select
  to authenticated
  using (public.gem_row_exists(gem_id));
