/**
 * Email/password Auth for Paranoic (real email + verification).
 *
 * Required Dashboard settings:
 *   Authentication → Providers → Email → Enable Email
 *   Authentication → Providers → Email → Confirm email = ON (verification flow)
 *
 * After confirm, client sets profiles.username from email local-part
 * (e.g. user@gmail.com → username "user").
 *
 * Fake domain @paranoic.local is no longer used.
 */

-- No schema changes; Auth users live in auth.users.
-- profiles.username is upserted by the client after confirmed sign-in.
