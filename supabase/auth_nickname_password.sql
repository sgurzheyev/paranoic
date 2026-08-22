/**
 * Email/password + Google OAuth for Paranoic.
 *
 * Required Dashboard settings:
 *   Authentication → Providers → Email → Enable Email
 *   Authentication → Providers → Email → Confirm email = ON (or OFF)
 *   Authentication → Providers → Google → Enable + Client ID/Secret
 *   Authentication → URL Configuration → Redirect URLs: include app origin
 *
 * After confirm / OAuth return:
 *   profiles.username = email local-part
 *   profiles.name prefers user_metadata.full_name (Google), then email
 *
 * Fake domain @paranoic.local is no longer used.
 */

-- No schema changes; Auth users live in auth.users.
-- profiles row is upserted by the client after confirmed sign-in / OAuth return.
