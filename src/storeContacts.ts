/**
 * Локальная записная книжка + чаты (IndexedDB).
 * Используется при смене Auth-сессии (новый auth.uid()).
 */

import localforage from 'localforage';

const contactsDb = localforage.createInstance({
  name: 'paranoic',
  storeName: 'contacts',
});

const messagesDb = localforage.createInstance({
  name: 'paranoic',
  storeName: 'messages',
});

const mediaDb = localforage.createInstance({
  name: 'paranoic',
  storeName: 'media',
});

const CONTACTS_KEY = 'contact-list';

/**
 * Полный сброс локальных чатов и контактов.
 * Вызывать, когда identity.id больше не совпадает с session.user.id.
 */
export async function clearLocalChatsAndContacts(): Promise<void> {
  try {
    await contactsDb.setItem(CONTACTS_KEY, []);
  } catch (e) {
    console.warn('[storeContacts] clear contacts', e);
  }

  try {
    await messagesDb.clear();
  } catch (e) {
    console.warn('[storeContacts] clear messages', e);
  }

  try {
    await mediaDb.clear();
  } catch (e) {
    console.warn('[storeContacts] clear media', e);
  }

  console.log('[storeContacts] local chats/contacts cleared (auth uid changed)');
}
