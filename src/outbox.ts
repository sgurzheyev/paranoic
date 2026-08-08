import localforage from 'localforage';

/** Исходящее сообщение, ждущее P2P-канал. */
export type OutboxItem = {
  id: string;
  conversationId: string;
  /** Кому предназначалось (userId пира). */
  peerUserId: string;
  createdAt: number;
  text: string;
  /** Готовый зашифрованный JSON для DataChannel. */
  packet: string;
};

const outboxDb = localforage.createInstance({
  name: 'paranoic',
  storeName: 'outbox',
});

const OUTBOX_KEY = 'pending-messages';

async function loadAll(): Promise<OutboxItem[]> {
  const rows = await outboxDb.getItem<OutboxItem[]>(OUTBOX_KEY);
  return rows ?? [];
}

async function saveAll(items: OutboxItem[]): Promise<void> {
  await outboxDb.setItem(OUTBOX_KEY, items);
}

export async function enqueueOutbox(item: OutboxItem): Promise<void> {
  const list = await loadAll();
  const idx = list.findIndex((x) => x.id === item.id);
  if (idx >= 0) list[idx] = item;
  else list.push(item);
  list.sort((a, b) => a.createdAt - b.createdAt);
  await saveAll(list);
}

export async function listOutbox(peerUserId?: string): Promise<OutboxItem[]> {
  const list = await loadAll();
  if (!peerUserId) return list;
  return list.filter((x) => x.peerUserId === peerUserId);
}

export async function listOutboxForConversation(conversationId: string): Promise<OutboxItem[]> {
  const list = await loadAll();
  return list.filter((x) => x.conversationId === conversationId);
}

export async function removeOutbox(id: string): Promise<void> {
  const list = (await loadAll()).filter((x) => x.id !== id);
  await saveAll(list);
}

export async function removeOutboxMany(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const drop = new Set(ids);
  const list = (await loadAll()).filter((x) => !drop.has(x.id));
  await saveAll(list);
}
