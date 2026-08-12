import localforage from 'localforage';
import { looksLikeUsername, isValidUuid } from './identity';
import { hasSupabaseConfig } from './lib/supabase';
import {
  fetchProfileByUsername,
  fetchRemoteProfile,
  looksLikeUuid,
  resolveHandleToUserId,
} from './profile';
import { isTrusted, trustUser } from './trust';

export type ContactSource = 'magic' | 'hello' | 'manual' | 'trust' | 'call';

export type Contact = {
  id: string;
  name: string;
  color: string;
  avatarUrl?: string;
  /** Публичный username, если известен (для резолва при смене id). */
  username?: string;
  /** Явно доверенный (дублирует localStorage trusted-ids). */
  trusted?: boolean;
  source?: ContactSource;
  addedAt: string;
};

export type ContactValidation =
  | { ok: true; contact: Contact; idChanged: boolean; skipped?: boolean }
  | { ok: false; reason: 'missing' | 'self' };

const contactsDb = localforage.createInstance({
  name: 'paranoic',
  storeName: 'contacts',
});

const CONTACTS_KEY = 'contact-list';

export async function loadContacts(): Promise<Contact[]> {
  const rows = await contactsDb.getItem<Contact[]>(CONTACTS_KEY);
  const list = rows ?? [];
  // Синхронизируем флаг trusted из localStorage.
  return list.map((c) => ({
    ...c,
    trusted: Boolean(c.trusted) || isTrusted(c.id),
  }));
}

export async function saveContacts(contacts: Contact[]): Promise<void> {
  await contactsDb.setItem(CONTACTS_KEY, contacts);
}

export async function upsertContact(
  contact: Omit<Contact, 'addedAt'> & { addedAt?: string }
): Promise<Contact[]> {
  const list = await loadContacts();
  const idx = list.findIndex((c) => c.id === contact.id);
  const trusted = Boolean(contact.trusted) || isTrusted(contact.id);
  const row: Contact = {
    id: contact.id,
    name: contact.name,
    color: contact.color,
    avatarUrl: contact.avatarUrl ?? '',
    username: contact.username,
    trusted,
    source: contact.source,
    addedAt: contact.addedAt ?? new Date().toISOString(),
  };
  if (idx >= 0) {
    list[idx] = {
      ...list[idx],
      ...row,
      addedAt: list[idx]!.addedAt,
      avatarUrl: row.avatarUrl || list[idx]!.avatarUrl,
      username: row.username || list[idx]!.username,
      trusted: trusted || Boolean(list[idx]!.trusted),
      source: row.source || list[idx]!.source,
    };
  } else {
    list.push(row);
  }
  list.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  await saveContacts(list);
  return list;
}

export async function removeContact(id: string): Promise<Contact[]> {
  // Доверенные контакты не удаляются из книжки.
  if (isTrusted(id)) {
    return loadContacts();
  }
  const list = (await loadContacts()).filter((c) => c.id !== id);
  await saveContacts(list);
  return list;
}

/** Доверять: localStorage + запись в книжку (контакт не пропадает). */
export async function trustAndUpsertContact(
  contact: Omit<Contact, 'addedAt' | 'trusted' | 'source'> & {
    addedAt?: string;
    username?: string;
  }
): Promise<Contact[]> {
  trustUser(contact.id);
  return upsertContact({
    ...contact,
    trusted: true,
    source: 'trust',
  });
}

function isPeerIdWithoutRequiredProfile(id: string): boolean {
  return looksLikeUuid(id) || isValidUuid(id) || (!looksLikeUsername(id) && id.length >= 8);
}

/** Найти контакт в локальной записной книжке (id / username). */
export async function findLocalContact(
  contactId: string,
  hint?: { username?: string; name?: string }
): Promise<Contact | null> {
  const list = await loadContacts();
  const usernameHint =
    (hint?.username && looksLikeUsername(hint.username) ? hint.username : '') ||
    (hint?.name && looksLikeUsername(hint.name) ? hint.name : '') ||
    (looksLikeUsername(contactId) ? contactId : '');

  return (
    list.find(
      (c) =>
        c.id === contactId ||
        (usernameHint &&
          c.username &&
          c.username.toLowerCase() === usernameHint.toLowerCase())
    ) ?? null
  );
}

/**
 * ?u=handle → peer id: Supabase, затем локальная записная книжка.
 * Для контактов из local storage не показываем «не найден» из‑за сбоя сети.
 */
export async function resolvePeerHandle(handle: string): Promise<string | null> {
  const trimmed = handle.trim();
  if (!trimmed) return null;

  const remote = await resolveHandleToUserId(trimmed);
  if (remote) return remote;

  const local = await findLocalContact(trimmed, {
    username: looksLikeUsername(trimmed) ? trimmed : undefined,
    name: looksLikeUsername(trimmed) ? trimmed : undefined,
  });
  return local?.id ?? null;
}

/**
 * Перед звонком: сверить контакт с Supabase.
 * - self → блок
 * - missing → ok:false (только для абсолютно новых пользователей)
 * - найден → обновить кэш (в т.ч. если id сменился через username)
 * Локальная записная книжка имеет приоритет — Supabase не блокирует чат/звонок.
 */
export async function validateContactForCall(
  contactId: string,
  myUserId: string,
  hint?: { name?: string; username?: string; color?: string; avatarUrl?: string }
): Promise<ContactValidation> {
  if (!contactId || contactId === myUserId) {
    return { ok: false, reason: 'self' };
  }

  const local = await findLocalContact(contactId, hint);
  if (local) {
    return { ok: true, contact: local, idChanged: false, skipped: true };
  }

  const fallbackContact = (): Contact => ({
    id: contactId,
    name: hint?.name || 'Контакт',
    color: hint?.color || '#60a5fa',
    avatarUrl: hint?.avatarUrl || '',
    username: hint?.username,
    trusted: isTrusted(contactId),
    addedAt: new Date().toISOString(),
  });

  if (!hasSupabaseConfig()) {
    return { ok: true, contact: fallbackContact(), idChanged: false, skipped: true };
  }

  let remote = await fetchRemoteProfile(contactId);

  const usernameHint =
    (hint?.username && looksLikeUsername(hint.username) ? hint.username : '') ||
    (hint?.name && looksLikeUsername(hint.name) ? hint.name : '') ||
    (looksLikeUsername(contactId) ? contactId : '');

  if (!remote && usernameHint) {
    remote = await fetchProfileByUsername(usernameHint);
  }

  if (!remote) {
    if (isPeerIdWithoutRequiredProfile(contactId)) {
      return { ok: true, contact: fallbackContact(), idChanged: false, skipped: true };
    }
    return { ok: false, reason: 'missing' };
  }

  if (remote.id === myUserId) {
    return { ok: false, reason: 'self' };
  }

  const contact: Contact = {
    id: remote.id,
    name: remote.name || hint?.name || remote.username || 'Контакт',
    color: remote.color || hint?.color || '#60a5fa',
    avatarUrl: remote.avatar_url || hint?.avatarUrl || '',
    username: remote.username || usernameHint || undefined,
    trusted: isTrusted(remote.id),
    source: 'call',
    addedAt: new Date().toISOString(),
  };

  const idChanged = contact.id !== contactId;
  if (idChanged) {
    await removeContact(contactId);
  }
  await upsertContact(contact);

  return { ok: true, contact, idChanged };
}

/**
 * Цепная реакция Magic Link: сохранить хоста в книжку гостя сразу при резолве.
 */
export async function captureHostFromMagicLink(opts: {
  hostId: string;
  myUserId: string;
  urlHandle?: string | null;
}): Promise<Contact | null> {
  const { hostId, myUserId, urlHandle } = opts;
  if (!hostId || hostId === myUserId) return null;

  let remote = await fetchRemoteProfile(hostId);
  if (!remote && urlHandle && looksLikeUsername(urlHandle)) {
    remote = await fetchProfileByUsername(urlHandle);
  }

  const username =
    remote?.username ||
    (urlHandle && looksLikeUsername(urlHandle) ? urlHandle : undefined);

  const contact: Contact = {
    id: remote?.id || hostId,
    name: remote?.name || username || 'Контакт',
    color: remote?.color || '#60a5fa',
    avatarUrl: remote?.avatar_url || '',
    username,
    trusted: isTrusted(remote?.id || hostId),
    source: 'magic',
    addedAt: new Date().toISOString(),
  };

  await upsertContact(contact);
  return contact;
}
