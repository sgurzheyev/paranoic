/**
 * FCM device token on profiles for incoming-call pushes.
 *
 * Run in Supabase SQL Editor after profiles.sql.
 */

alter table public.profiles
  add column if not exists fcm_token text;

comment on column public.profiles.fcm_token is
  'FCM / APNs device token for native incoming-call push notifications.';
