/**
 * Fix RLS for Drop a Gem (map_gems + storage map-gems).
 * Run in Supabase SQL Editor if INSERT / upload fails with RLS.
 *
 * App identity uses local profiles.id (not auth.uid()).
 * Demo policies allow anon + authenticated INSERT with author_id present on client.
 */

-- Table policies
alter table public.map_gems enable row level security;

drop policy if exists "map_gems_select_anon" on public.map_gems;
create policy "map_gems_select_anon"
  on public.map_gems for select
  to anon, authenticated
  using (true);

-- Writes are owner-only (see migrations/20260928_rls_lockdown.sql); no using (true) update/delete.
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
  using (author_id::text = auth.uid()::text)
  with check (author_id::text = auth.uid()::text);

drop policy if exists "map_gems_delete_author" on public.map_gems;
create policy "map_gems_delete_author"
  on public.map_gems for delete
  to authenticated
  using (author_id::text = auth.uid()::text);

-- Storage bucket
insert into storage.buckets (id, name, public)
values ('map-gems', 'map-gems', true)
on conflict (id) do update set public = true;

drop policy if exists "map_gems_public_read" on storage.objects;
create policy "map_gems_public_read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'map-gems');

drop policy if exists "map_gems_anon_upload" on storage.objects;
drop policy if exists "map_gems_authenticated_upload" on storage.objects;
create policy "map_gems_authenticated_upload"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'map-gems');

drop policy if exists "map_gems_anon_update" on storage.objects;
drop policy if exists "map_gems_owner_update" on storage.objects;
create policy "map_gems_owner_update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'map-gems' and owner_id = auth.uid()::text)
  with check (bucket_id = 'map-gems' and owner_id = auth.uid()::text);
