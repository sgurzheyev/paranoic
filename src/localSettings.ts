/**
 * Per-conversation local settings — stored in IndexedDB (localforage).
 * Tracks muted + hidden (removed-from-list) conversation IDs.
 */
import localforage from 'localforage';

const db = localforage.createInstance({
  name: 'paranoic',
  storeName: 'local_settings',
});

const MUTED_KEY = 'muted-conversations';
const HIDDEN_KEY = 'hidden-conversations';

/** In-memory cache so notify/ingest paths can check mute without a stale React snapshot. */
let mutedCache = new Set<string>();
let hiddenCache = new Set<string>();

function rememberMuted(ids: Set<string>): Set<string> {
  mutedCache = new Set(ids);
  return new Set(mutedCache);
}

function rememberHidden(ids: Set<string>): Set<string> {
  hiddenCache = new Set(ids);
  return new Set(hiddenCache);
}

export function isConversationMuted(convId: string | null | undefined): boolean {
  return Boolean(convId) && mutedCache.has(convId as string);
}

export function isConversationHidden(convId: string | null | undefined): boolean {
  return Boolean(convId) && hiddenCache.has(convId as string);
}

export async function loadMutedIds(): Promise<Set<string>> {
  const arr = await db.getItem<string[]>(MUTED_KEY);
  return rememberMuted(new Set(arr ?? []));
}

export async function saveMutedIds(ids: Set<string>): Promise<void> {
  rememberMuted(ids);
  await db.setItem(MUTED_KEY, [...ids]);
}

export async function muteConversation(convId: string): Promise<Set<string>> {
  const ids = await loadMutedIds();
  ids.add(convId);
  await saveMutedIds(ids);
  return ids;
}

export async function unmuteConversation(convId: string): Promise<Set<string>> {
  const ids = await loadMutedIds();
  ids.delete(convId);
  await saveMutedIds(ids);
  return ids;
}

export async function loadHiddenIds(): Promise<Set<string>> {
  const arr = await db.getItem<string[]>(HIDDEN_KEY);
  return rememberHidden(new Set(arr ?? []));
}

export async function saveHiddenIds(ids: Set<string>): Promise<void> {
  rememberHidden(ids);
  await db.setItem(HIDDEN_KEY, [...ids]);
}

/** Remove a conversation from the chats list until new activity or the user opens it again. */
export async function hideConversation(convId: string): Promise<Set<string>> {
  const ids = await loadHiddenIds();
  ids.add(convId);
  await saveHiddenIds(ids);
  return ids;
}

export async function unhideConversation(convId: string): Promise<Set<string>> {
  const ids = await loadHiddenIds();
  ids.delete(convId);
  await saveHiddenIds(ids);
  return ids;
}

export async function clearHiddenConversations(): Promise<void> {
  await saveHiddenIds(new Set());
}
