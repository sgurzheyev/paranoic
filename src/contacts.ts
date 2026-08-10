import localforage from 'localforage';
import { looksLikeUsername, isValidUuid } from './identity';
import { hasSupabaseConfig } from './lib/supabase';
import { fetchProfileByUsername, fetchRemoteProfile, looksLikeUuid } from './profile';

export type Contact = {
  id: string;
  name: string;
  color: string;
  avatarUrl?: string;
  /** Публичный username, если известен (для резолва при смене id). */
  username?: string;
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
  return rows ?? [];
}

export async function saveContacts(contacts: Contact[]): Promise<void> {
  await contactsDb.setItem(CONTACTS_KEY, contacts);
}

export async function upsertContact(
  contact: Omit<Contact, 'addedAt'> & { addedAt?: string }
): Promise<Contact[]> {
  const list = await loadContacts();
  const idx = list.findIndex((c) => c.id === contact.id);
  const row: Contact = {
    id: contact.id,
    name: contact.name,
    color: contact.color,
    avatarUrl: contact.avatarUrl ?? '',
    username: contact.username,
    addedAt: contact.addedAt ?? new Date().toISOString(),
  };
  if (idx >= 0) {
    list[idx] = {
      ...list[idx],
      ...row,
      addedAt: list[idx]!.addedAt,
      avatarUrl: row.avatarUrl || list[idx]!.avatarUrl,
      username: row.username || list[idx]!.username,
    };
  } else {
    list.push(row);
  }
  list.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  await saveContacts(list);
  return list;
}

export async function removeContact(id: string): Promise<Contact[]> {
  const list = (await loadContacts()).filter((c) => c.id !== id);
  await saveContacts(list);
  return list;
}

function isPeerIdWithoutRequiredProfile(id: string): boolean {
  return looksLikeUuid(id) || isValidUuid(id) || (!looksLikeUsername(id) && id.length >= 8);
}

/**
 * Перед звонком: сверить контакт с Supabase.
 * - self → блок
 * - missing → ok:false (UI предложит удалить из книжки)
 * - найден → обновить кэш (в т.ч. если id сменился через username)
 * Без Supabase / UUID без профиля — пропускаем жёсткую проверку (legacy/гость).
 */
export async function validateContactForCall(
  contactId: string,
  myUserId: string,
  hint?: { name?: string; username?: string; color?: string; avatarUrl?: string }
): Promise<ContactValidation> {
  if (!contactId || contactId === myUserId) {
    return { ok: false, reason: 'self' };
  }

  const fallbackContact = (): Contact => ({
    id: contactId,
    name: hint?.name || 'Контакт',
    color: hint?.color || '#60a5fa',
    avatarUrl: hint?.avatarUrl || '',
    username: hint?.username,
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
    // Username известен, но профиля нет — точно stale.
    if (usernameHint) {
      return { ok: false, reason: 'missing' };
    }
    // Голый UUID/legacy id без строки profiles — звонок по id всё ещё возможен.
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
    addedAt: new Date().toISOString(),
  };

  const idChanged = contact.id !== contactId;
  if (idChanged) {
    await removeContact(contactId);
  }
  await upsertContact(contact);

  return { ok: true, contact, idChanged };
}
