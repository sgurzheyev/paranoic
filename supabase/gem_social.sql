/**
 * Memory Gem likes + comments.
 * Run in Supabase SQL Editor after map_gems / map_gems_auth_uid.sql.
 *
 * gem_id → public.map_gems(id)
 * user_id matches profiles.id / auth.uid()::text (text, same as map_gems.author_id).
 *
 * Family Mode contacts live on the client; SELECT is therefore authenticated
 * (same visibility as map_gems). INSERT/DELETE only for the signed-in user.
 */

create table if not exists public.gem_likes (
  id uuid primary key default gen_random_uuid(),
  gem_id uuid not null references public.map_gems (id) on delete cascade,
  user_id text not null,
  created_at timestamptz not null default now(),
  constraint gem_likes_unique_user unique (gem_id, user_id)
);

create table if not exists public.gem_comments (
  id uuid primary key default gen_random_uuid(),
  gem_id uuid not null references public.map_gems (id) on delete cascade,
  user_id text not null,
  content text not null,
  created_at timestamptz not null default now(),
  constraint gem_comments_content_len check (char_length(trim(content)) between 1 and 500)
);

create index if not exists gem_likes_gem_idx on public.gem_likes (gem_id, created_at desc);
create index if not exists gem_likes_user_idx on public.gem_likes (user_id);
create index if not exists gem_comments_gem_idx on public.gem_comments (gem_id, created_at asc);

comment on table public.gem_likes is 'Likes on Family Mode memory gems';
comment on table public.gem_comments is 'Comments on Family Mode memory gems';

alter table public.gem_likes enable row level security;
alter table public.gem_comments enable row level security;

-- Realtime DELETE payloads need full row identity.
alter table public.gem_likes replica identity full;
alter table public.gem_comments replica identity full;

drop policy if exists "gem_likes_select" on public.gem_likes;
create policy "gem_likes_select"
  on public.gem_likes for select
  to authenticated
  using (
    exists (select 1 from public.map_gems g where g.id = gem_id)
  );

drop policy if exists "gem_likes_insert" on public.gem_likes;
create policy "gem_likes_insert"
  on public.gem_likes for insert
  to authenticated
  with check (user_id = auth.uid()::text);

drop policy if exists "gem_likes_delete" on public.gem_likes;
create policy "gem_likes_delete"
  on public.gem_likes for delete
  to authenticated
  using (user_id = auth.uid()::text);

drop policy if exists "gem_comments_select" on public.gem_comments;
create policy "gem_comments_select"
  on public.gem_comments for select
  to authenticated
  using (
    exists (select 1 from public.map_gems g where g.id = gem_id)
  );

drop policy if exists "gem_comments_insert" on public.gem_comments;
create policy "gem_comments_insert"
  on public.gem_comments for insert
  to authenticated
  with check (
    user_id = auth.uid()::text
    and char_length(trim(content)) between 1 and 500
  );

drop policy if exists "gem_comments_delete" on public.gem_comments;
create policy "gem_comments_delete"
  on public.gem_comments for delete
  to authenticated
  using (user_id = auth.uid()::text);

do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.gem_likes';
  exception
    when duplicate_object then null;
  end;
  begin
    execute 'alter publication supabase_realtime add table public.gem_comments';
  exception
    when duplicate_object then null;
  end;
end $$;
