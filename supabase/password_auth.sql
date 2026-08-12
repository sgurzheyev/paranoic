/**
 * Пароль профиля (PBKDF2 hash, клиент) — восстановление user_id по username.
 * Run in Supabase SQL Editor after profiles.sql.
 */

alter table public.profiles
  add column if not exists password_hash text;

comment on column public.profiles.password_hash is
  'PBKDF2-SHA256 hash (base64 salt+hash), задаётся клиентом при сохранении профиля.';

-- Явный SELECT для входа (anon) — на случай урезанных политик RLS в проде.
drop policy if exists "profiles_login_select_anon" on public.profiles;
create policy "profiles_login_select_anon"
  on public.profiles for select
  to anon, authenticated
  using (true);

-- SECURITY DEFINER: чтение профиля по username для клиентской проверки пароля.
create or replace function public.login_profile_by_username(p_username text)
returns table (
  id text,
  name text,
  color text,
  avatar_url text,
  theme_fon text,
  username text,
  password_hash text,
  updated_at timestamptz,
  role text,
  is_banned boolean,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.id,
    p.name,
    p.color,
    p.avatar_url,
    p.theme_fon,
    p.username,
    p.password_hash,
    p.updated_at,
    p.role,
    p.is_banned,
    p.created_at
  from public.profiles p
  where lower(trim(p.username)) = lower(trim(p_username))
  limit 1;
$$;

revoke all on function public.login_profile_by_username(text) from public;
grant execute on function public.login_profile_by_username(text) to anon, authenticated;
