import localforage from 'localforage';

/** Статус доставки исходящего сообщения. */
export type DeliveryStatus = 'sending' | 'delivered' | 'read';

/** Сообщение в IndexedDB (без object URL — создаётся при загрузке). */
export type StoredMessage = {
  id: string;
  sender: string;
  time: string;
  mine: boolean;
  kind: 'text' | 'media' | 'file-pending' | 'file-transfer';
  text?: string;
  mediaMime?: string;
  mediaName?: string;
  mediaSize?: number;
  /** file | video-circle | voice note. */
  mediaKind?: 'file' | 'circle' | 'voice';
  /** Ключ blob в mediaStore после принятия файла. */
  mediaKey?: string;
  /** Только для своих текстовых сообщений. */
  deliveryStatus?: DeliveryStatus;
  /** epoch ms — для эфемерной очистки. */
  createdAt?: number;
  /** Лайк ❤️ (двойной тап). */
  hearted?: boolean;
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

/** Стабильный id диалога для пары пользователей (сортированный). */
export function conversationId(a: string, b: string): string {
  return [a, b].filter(Boolean).sort().join(':');
}

function historyKey(convId: string): string {
  return `chat:${convId}`;
}

/** Разбор ключа `chat:idA:idB` → пара id или null. */
function parseChatKey(key: string): [string, string] | null {
  if (!key.startsWith('chat:')) return null;
  const body = key.slice('chat:'.length);
  const parts = body.split(':').filter(Boolean);
  if (parts.length !== 2) return null;
  return [parts[0]!, parts[1]!];
}

export async function loadChatHistory(convId: string): Promise<StoredMessage[]> {
  if (!convId) return [];
  const rows = await messagesDb.getItem<StoredMessage[]>(historyKey(convId));
  return rows ?? [];
}

export async function saveChatHistory(
  convId: string,
  messages: StoredMessage[]
): Promise<void> {
  if (!convId) return;
  await messagesDb.setItem(historyKey(convId), messages);
}

export async function appendStoredMessage(
  convId: string,
  message: StoredMessage
): Promise<void> {
  if (!convId) return;
  const history = await loadChatHistory(convId);
  history.push({
    ...message,
    createdAt: message.createdAt ?? Date.now(),
  });
  await saveChatHistory(convId, history);
}

export async function updateStoredMessage(
  convId: string,
  id: string,
  patch: Partial<StoredMessage>
): Promise<void> {
  if (!convId) return;
  const history = await loadChatHistory(convId);
  const idx = history.findIndex((m) => m.id === id);
  if (idx < 0) return;
  history[idx] = { ...history[idx], ...patch };
  await saveChatHistory(convId, history);
}

/**
 * Чистит старые/тестовые ключи истории:
 * - глобальный `chat-history`
 * - само-чат `chat:me:me`
 * - несортированные / битые `chat:*`
 * - прочие legacy-ключи
 */
export async function purgeLegacyGlobalHistory(selfId?: string): Promise<void> {
  try {
    await messagesDb.removeItem(LEGACY_HISTORY_KEY);

    const keys = await messagesDb.keys();
    for (const raw of keys) {
      const key = String(raw);

      if (
        key === LEGACY_HISTORY_KEY ||
        key === 'messages' ||
        key === 'history' ||
        key.startsWith('history:') ||
        key.startsWith('room:')
      ) {
        await messagesDb.removeItem(key);
        continue;
      }

      if (!key.startsWith('chat:')) continue;

      const pair = parseChatKey(key);
      if (!pair) {
        await messagesDb.removeItem(key);
        continue;
      }

      const [a, b] = pair;
      // Тестовый диалог «я ↔ я»
      if (a === b) {
        await messagesDb.removeItem(key);
        continue;
      }
      if (selfId && a === selfId && b === selfId) {
        await messagesDb.removeItem(key);
        continue;
      }

      // Ключ должен быть отсортирован — иначе это мусор/legacy
      const canonical = conversationId(a, b);
      if (key !== historyKey(canonical)) {
        await messagesDb.removeItem(key);
      }
    }
  } catch {
    /* */
  }
}

export const EPHEMERAL_TTL_MS = 24 * 60 * 60 * 1000;

function messageAgeMs(row: StoredMessage, now: number): number | null {
  if (typeof row.createdAt === 'number' && Number.isFinite(row.createdAt)) {
    return now - row.createdAt;
  }
  // Legacy без createdAt — не трогаем.
  return null;
}

/**
 * Удаляет сообщения старше maxAgeMs во всех `chat:idA:idB`.
 * Возвращает число удалённых и список затронутых conversationId.
 */
export async function purgeExpiredMessages(
  maxAgeMs = EPHEMERAL_TTL_MS
): Promise<{ removed: number; conversationIds: string[] }> {
  const now = Date.now();
  let removed = 0;
  const touched = new Set<string>();

  try {
    const keys = await messagesDb.keys();
    for (const raw of keys) {
      const key = String(raw);
      const pair = parseChatKey(key);
      if (!pair) continue;

      const history = (await messagesDb.getItem<StoredMessage[]>(key)) ?? [];
      const kept: StoredMessage[] = [];
      const droppedMedia: string[] = [];

      for (const row of history) {
        const age = messageAgeMs(row, now);
        if (age != null && age > maxAgeMs) {
          removed += 1;
          touched.add(conversationId(pair[0], pair[1]));
          if (row.mediaKey) droppedMedia.push(row.mediaKey);
          continue;
        }
        kept.push(row);
      }

      if (kept.length !== history.length) {
        await messagesDb.setItem(key, kept);
        for (const mk of droppedMedia) {
          try {
            await mediaDb.removeItem(mk);
          } catch {
            /* */
          }
        }
      }
    }
  } catch {
    /* */
  }

  return { removed, conversationIds: [...touched] };
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
