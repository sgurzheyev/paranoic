/** Доверенные и заблокированные peer id — localStorage. */

const TRUSTED_KEY = 'paranoic-trusted-ids-v1';
const BLOCKED_KEY = 'paranoic-blocked-ids-v1';

function readIdSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === 'string' && id.length > 0));
  } catch {
    return new Set();
  }
}

function writeIdSet(key: string, ids: Set<string>): void {
  localStorage.setItem(key, JSON.stringify([...ids]));
}

export function loadTrustedIds(): Set<string> {
  return readIdSet(TRUSTED_KEY);
}

export function loadBlockedIds(): Set<string> {
  return readIdSet(BLOCKED_KEY);
}

export function isTrusted(userId: string): boolean {
  if (!userId) return false;
  return loadTrustedIds().has(userId);
}

export function isBlocked(userId: string): boolean {
  if (!userId) return false;
  return loadBlockedIds().has(userId);
}

/** Жёстко закрепить контакт как доверенный; снять блок, если был. */
export function trustUser(userId: string): Set<string> {
  const trusted = loadTrustedIds();
  trusted.add(userId);
  writeIdSet(TRUSTED_KEY, trusted);

  const blocked = loadBlockedIds();
  if (blocked.delete(userId)) writeIdSet(BLOCKED_KEY, blocked);

  return trusted;
}

export function untrustUser(userId: string): Set<string> {
  const trusted = loadTrustedIds();
  trusted.delete(userId);
  writeIdSet(TRUSTED_KEY, trusted);
  return trusted;
}

export function blockUser(userId: string): Set<string> {
  const blocked = loadBlockedIds();
  blocked.add(userId);
  writeIdSet(BLOCKED_KEY, blocked);

  const trusted = loadTrustedIds();
  if (trusted.delete(userId)) writeIdSet(TRUSTED_KEY, trusted);

  return blocked;
}

export function unblockUser(userId: string): Set<string> {
  const blocked = loadBlockedIds();
  blocked.delete(userId);
  writeIdSet(BLOCKED_KEY, blocked);
  return blocked;
}
