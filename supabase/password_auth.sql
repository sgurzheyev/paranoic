/**
 * Пароль профиля (PBKDF2 hash, клиент) — восстановление user_id по username.
 * Run in Supabase SQL Editor after profiles.sql.
 *
 * Production column name: password (not password_hash).
 */

alter table public.profiles
  add column if not exists password text;

comment on column public.profiles.password is
  'PBKDF2-SHA256 hash (base64 salt+hash) or plain text, задаётся клиентом.';

-- Removed (see migrations/20260928_rls_lockdown.sql): the anon "login select" policy and the
-- SECURITY DEFINER RPC login_profile_by_username(), which returned password hashes to anyone.
-- Login uses Supabase Auth (signInWithPassword); profiles.password is legacy and not readable via the API.
drop policy if exists "profiles_login_select_anon" on public.profiles;
drop function if exists public.login_profile_by_username(text);
