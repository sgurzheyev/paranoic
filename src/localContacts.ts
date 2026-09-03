/**
 * Private address book — stored only in IndexedDB (localforage), never sent to Supabase.
 * Lets users assign a custom First Name, Last Name, and a Private Note to any peer ID.
 */
import localforage from 'localforage';

export type LocalContact = {
  /** peer user ID */
  id: string;
  firstName: string;
  lastName: string;
  /** Private note visible only to the owner of this device. */
  note: string;
  updatedAt: string;
};

/** Derived display name: "First Last" or just whichever parts are filled in. */
export function localContactDisplayName(lc: LocalContact): string {
  const parts = [lc.firstName.trim(), lc.lastName.trim()].filter(Boolean);
  return parts.join(' ');
}

const db = localforage.createInstance({
  name: 'paranoic',
  storeName: 'local_contacts',
});

export async function loadLocalContact(peerId: string): Promise<LocalContact | null> {
  return db.getItem<LocalContact>(peerId);
}

export async function saveLocalContact(lc: Omit<LocalContact, 'updatedAt'>): Promise<LocalContact> {
  const row: LocalContact = { ...lc, updatedAt: new Date().toISOString() };
  await db.setItem(lc.id, row);
  return row;
}

export async function deleteLocalContact(peerId: string): Promise<void> {
  await db.removeItem(peerId);
}

export async function loadAllLocalContacts(): Promise<LocalContact[]> {
  const result: LocalContact[] = [];
  await db.iterate<LocalContact, void>((val) => {
    result.push(val);
  });
  return result;
}
