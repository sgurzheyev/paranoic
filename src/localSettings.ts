/**
 * Per-conversation local settings — stored in IndexedDB (localforage).
 * Currently tracks muted conversation IDs.
 */
import localforage from 'localforage';

const db = localforage.createInstance({
  name: 'paranoic',
  storeName: 'local_settings',
});

const MUTED_KEY = 'muted-conversations';

/** In-memory cache so notify/ingest paths can check mute without a stale React snapshot. */
let mutedCache = new Set<string>();

function rememberMuted(ids: Set<string>): Set<string> {
  mutedCache = new Set(ids);
  return new Set(mutedCache);
}

export function isConversationMuted(convId: string | null | undefined): boolean {
  return Boolean(convId) && mutedCache.has(convId as string);
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
