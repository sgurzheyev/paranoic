/**
 * map_gems + Auth: author_id = auth.uid(), без клиентского upsert в profiles.
 * Run in Supabase SQL Editor.
 *
 * Профиль создаётся триггером на auth.users (или вручную при регистрации),
 * не из Drop a Gem на фронте.
 */

-- Убрать обязательный FK на profiles (если мешает auth.uid() без строки profiles).
alter table public.map_gems
  drop constraint if exists map_gems_author_id_fkey;

-- При необходимости: автор = auth.users
-- (раскомментируйте, если author_id уже uuid и совпадает с auth.users.id)
-- alter table public.map_gems
--   add constraint map_gems_author_id_fkey
--   foreign key (author_id) references auth.users (id) on delete cascade;

alter table public.map_gems enable row level security;

drop policy if exists "map_gems_select_anon" on public.map_gems;
drop policy if exists "map_gems_insert_anon" on public.map_gems;
drop policy if exists "map_gems_insert_author" on public.map_gems;

create policy "map_gems_select_authenticated"
  on public.map_gems for select
  to authenticated
  using (true);

-- INSERT только от своего auth.uid()
create policy "map_gems_insert_author"
  on public.map_gems for insert
  to authenticated
  with check (author_id::text = auth.uid()::text);

drop policy if exists "map_gems_delete_anon" on public.map_gems;
drop policy if exists "map_gems_delete_author" on public.map_gems;
create policy "map_gems_delete_author"
  on public.map_gems for delete
  to authenticated
  using (author_id::text = auth.uid()::text);

-- Storage: authenticated upload в map-gems
drop policy if exists "map_gems_authenticated_upload" on storage.objects;
create policy "map_gems_authenticated_upload"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'map-gems');
