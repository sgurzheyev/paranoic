/**
 * map_gems: owner UPDATE (move pin / edit content).
 * Run if UPDATE fails with RLS after map_gems_auth_uid.sql.
 */

alter table public.map_gems enable row level security;

drop policy if exists "map_gems_update_anon" on public.map_gems;
drop policy if exists "map_gems_update_author" on public.map_gems;

create policy "map_gems_update_author"
  on public.map_gems for update
  to authenticated
  using (author_id::text = auth.uid()::text)
  with check (author_id::text = auth.uid()::text);
