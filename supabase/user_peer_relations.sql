/**
 * Cloud-synced trust & block lists (replaces localStorage-only paranoic-trusted/blocked-ids).
 * Run in Supabase SQL Editor after profiles.sql + auth.
 */

create table if not exists public.user_peer_relations (
  owner_id uuid not null references auth.users (id) on delete cascade,
  peer_id text not null,
  relation text not null check (relation in ('trusted', 'blocked')),
  created_at timestamptz not null default now(),
  primary key (owner_id, peer_id)
);

create index if not exists user_peer_relations_owner
  on public.user_peer_relations (owner_id, relation);

alter table public.user_peer_relations enable row level security;

drop policy if exists "user_peer_relations_select_own" on public.user_peer_relations;
create policy "user_peer_relations_select_own"
  on public.user_peer_relations for select
  to authenticated
  using (owner_id = auth.uid());

drop policy if exists "user_peer_relations_insert_own" on public.user_peer_relations;
create policy "user_peer_relations_insert_own"
  on public.user_peer_relations for insert
  to authenticated
  with check (owner_id = auth.uid());

drop policy if exists "user_peer_relations_update_own" on public.user_peer_relations;
create policy "user_peer_relations_update_own"
  on public.user_peer_relations for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "user_peer_relations_delete_own" on public.user_peer_relations;
create policy "user_peer_relations_delete_own"
  on public.user_peer_relations for delete
  to authenticated
  using (owner_id = auth.uid());

comment on table public.user_peer_relations is
  'Per-user trusted/blocked peer ids; synced across devices on login';
