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

/** Старый глобальный ключ — больше не используем (изоляция диалогов). */
const LEGACY_HISTORY_KEY = 'chat-history';

/** Стабильный id диалога для пары пользователей. */
export function conversationId(a: string, b: string): string {
  return [a, b].sort().join(':');
}

function historyKey(conversationId: string): string {
  return `chat:${conversationId}`;
}

export async function loadChatHistory(conversationId: string): Promise<StoredMessage[]> {
  if (!conversationId) return [];
  const rows = await messagesDb.getItem<StoredMessage[]>(historyKey(conversationId));
  return rows ?? [];
}

export async function saveChatHistory(
  conversationId: string,
  messages: StoredMessage[]
): Promise<void> {
  if (!conversationId) return;
  await messagesDb.setItem(historyKey(conversationId), messages);
}

export async function appendStoredMessage(
  conversationId: string,
  message: StoredMessage
): Promise<void> {
  if (!conversationId) return;
  const history = await loadChatHistory(conversationId);
  history.push(message);
  await saveChatHistory(conversationId, history);
}

export async function updateStoredMessage(
  conversationId: string,
  id: string,
  patch: Partial<StoredMessage>
): Promise<void> {
  if (!conversationId) return;
  const history = await loadChatHistory(conversationId);
  const idx = history.findIndex((m) => m.id === id);
  if (idx < 0) return;
  history[idx] = { ...history[idx], ...patch };
  await saveChatHistory(conversationId, history);
}

/** Одноразово чистит старую общую историю «я ↔ я». */
export async function purgeLegacyGlobalHistory(): Promise<void> {
  try {
    await messagesDb.removeItem(LEGACY_HISTORY_KEY);
  } catch {
    /* */
  }
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
