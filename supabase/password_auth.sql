/**
 * Пароль профиля (PBKDF2 hash, клиент) — восстановление user_id по username.
 * Run in Supabase SQL Editor after profiles.sql.
 */

alter table public.profiles
  add column if not exists password_hash text;

comment on column public.profiles.password_hash is
  'PBKDF2-SHA256 hash (base64 salt+hash), задаётся клиентом при сохранении профиля.';
