import localforage from 'localforage';

export type Contact = {
  id: string;
  name: string;
  color: string;
  avatarUrl?: string;
  addedAt: string;
};

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
    addedAt: contact.addedAt ?? new Date().toISOString(),
  };
  if (idx >= 0) {
    list[idx] = {
      ...list[idx],
      ...row,
      addedAt: list[idx]!.addedAt,
      avatarUrl: row.avatarUrl || list[idx]!.avatarUrl,
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
