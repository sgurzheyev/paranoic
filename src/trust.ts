/** Доверенные и заблокированные peer id — local cache + Supabase sync. */

import {
  readLocalRelations,
  setCloudRelation,
  syncRelationsFromCloud,
  type PeerRelations,
} from './trustSync';

export type { PeerRelations };

export function loadTrustedIds(): Set<string> {
  return readLocalRelations().trusted;
}

export function loadBlockedIds(): Set<string> {
  return readLocalRelations().blocked;
}

export function isTrusted(userId: string): boolean {
  if (!userId) return false;
  return loadTrustedIds().has(userId);
}

export function isBlocked(userId: string): boolean {
  if (!userId) return false;
  return loadBlockedIds().has(userId);
}

/** Pull relations from Supabase on login / bootstrap. */
export async function bootstrapPeerRelations(): Promise<PeerRelations> {
  return syncRelationsFromCloud();
}

/** Жёстко закрепить контакт как доверенный; снять блок, если был. */
export async function trustUser(userId: string): Promise<Set<string>> {
  const next = await setCloudRelation(userId, 'trusted');
  return next.trusted;
}

export async function untrustUser(userId: string): Promise<Set<string>> {
  const next = await setCloudRelation(userId, null);
  return next.trusted;
}

export async function blockUser(userId: string): Promise<Set<string>> {
  const next = await setCloudRelation(userId, 'blocked');
  return next.blocked;
}

export async function unblockUser(userId: string): Promise<Set<string>> {
  const next = await setCloudRelation(userId, null);
  return next.blocked;
}
