import localforage from 'localforage';

/** Сообщение в IndexedDB (без object URL — создаётся при загрузке). */
export type StoredMessage = {
  id: string;
  sender: string;
  time: string;
  mine: boolean;
  kind: 'text' | 'media' | 'file-pending';
  text?: string;
  mediaMime?: string;
  mediaName?: string;
  mediaSize?: number;
  /** Ключ blob в mediaStore после принятия файла. */
  mediaKey?: string;
};

const messagesDb = localforage.createInstance({
  name: 'paranoic',
  storeName: 'messages',
});

const mediaDb = localforage.createInstance({
  name: 'paranoic',
  storeName: 'media',
});

const HISTORY_KEY = 'chat-history';

export async function loadChatHistory(): Promise<StoredMessage[]> {
  const rows = await messagesDb.getItem<StoredMessage[]>(HISTORY_KEY);
  return rows ?? [];
}

export async function saveChatHistory(messages: StoredMessage[]): Promise<void> {
  await messagesDb.setItem(HISTORY_KEY, messages);
}

export async function appendStoredMessage(message: StoredMessage): Promise<void> {
  const history = await loadChatHistory();
  history.push(message);
  await saveChatHistory(history);
}

export async function updateStoredMessage(
  id: string,
  patch: Partial<StoredMessage>
): Promise<void> {
  const history = await loadChatHistory();
  const idx = history.findIndex((m) => m.id === id);
  if (idx < 0) return;
  history[idx] = { ...history[idx], ...patch };
  await saveChatHistory(history);
}

export async function saveMediaBlob(key: string, blob: Blob): Promise<void> {
  await mediaDb.setItem(key, blob);
}

export async function loadMediaBlob(key: string): Promise<Blob | null> {
  return mediaDb.getItem<Blob>(key);
}

export function mediaStorageKey(messageId: string): string {
  return `media-${messageId}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}
