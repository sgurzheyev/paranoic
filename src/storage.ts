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

/** Conversation id for a group chat (`group:{uuid}`). */
export function groupConversationId(groupId: string): string {
  return `group:${groupId}`;
}

export function parseGroupConversationId(convId: string): string | null {
  if (!convId.startsWith('group:')) return null;
  const id = convId.slice('group:'.length).trim();
  return id || null;
}

function historyKey(convId: string): string {
  return `chat:${convId}`;
}

/** Разбор ключа `chat:idA:idB` → пара id или null. */
function parseChatKey(key: string): [string, string] | null {
  if (!key.startsWith('chat:')) return null;
  const body = key.slice('chat:'.length);
  if (body.startsWith('group:')) return null;
  const parts = body.split(':').filter(Boolean);
  if (parts.length !== 2) return null;
  return [parts[0]!, parts[1]!];
}

/** Разбор `chat:group:{uuid}` → groupId. */
function parseGroupChatKey(key: string): string | null {
  if (!key.startsWith('chat:group:')) return null;
  const id = key.slice('chat:group:'.length).trim();
  return id || null;
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

      // Group histories: chat:group:{uuid}
      if (parseGroupChatKey(key)) continue;

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
 * Удаляет сообщения старше maxAgeMs во всех `chat:idA:idB` и `chat:group:*`.
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
      const groupId = parseGroupChatKey(key);
      const pair = groupId ? null : parseChatKey(key);
      if (!groupId && !pair) continue;

      const history = (await messagesDb.getItem<StoredMessage[]>(key)) ?? [];
      const kept: StoredMessage[] = [];
      const droppedMedia: string[] = [];

      for (const row of history) {
        const age = messageAgeMs(row, now);
        if (age != null && age > maxAgeMs) {
          removed += 1;
          if (groupId) touched.add(groupConversationId(groupId));
          else if (pair) touched.add(conversationId(pair[0], pair[1]));
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

export type LastMessagePreview = {
  peerId: string;
  snippet: string;
  timeLabel: string;
  createdAt: number;
};

/** Короткий сниппет последнего сообщения — как в Telegram. */
export function formatMessageSnippet(row: StoredMessage): string {
  if (row.kind === 'text') {
    const text = (row.text || '').replace(/\s+/g, ' ').trim();
    return text || 'Сообщение';
  }
  if (row.mediaKind === 'voice' || row.mediaMime?.startsWith('audio/')) return '🎤 Голос';
  if (row.mediaKind === 'circle') return '📹 Видео';
  if (row.mediaMime?.startsWith('image/')) return '📷 Фото';
  if (row.mediaMime?.startsWith('video/')) return '📹 Видео';
  return '📎 Файл';
}

function previewTimeLabel(row: StoredMessage): string {
  if (typeof row.createdAt === 'number' && Number.isFinite(row.createdAt)) {
    const d = new Date(row.createdAt);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  }
  return row.time;
}

const URL_IN_TEXT_RE = /https?:\/\/[^\s<>"'`]+/i;

/** Категории поисковой выдачи в чатах. */
export type ChatSearchFilter = 'all' | 'media' | 'links' | 'files' | 'voice';

export type ChatMessageCategory = 'media' | 'links' | 'files' | 'voice' | 'text';

export type ChatSearchHit = {
  peerId: string;
  conversationId: string;
  message: StoredMessage;
  category: ChatMessageCategory;
  snippet: string;
  timeLabel: string;
  createdAt: number;
};

/** Классификация сообщения для фильтров Все / Медиа / Ссылки / Файлы / Голосовые. */
export function classifyMessageCategory(row: StoredMessage): ChatMessageCategory {
  if (row.kind === 'media' || row.kind === 'file-pending' || row.kind === 'file-transfer') {
    const name = row.mediaName || '';
    if (
      row.mediaKind === 'voice' ||
      name.startsWith('voice-') ||
      Boolean(row.mediaMime?.startsWith('audio/'))
    ) {
      return 'voice';
    }
    if (
      row.mediaKind === 'file' ||
      (row.mediaMime &&
        !row.mediaMime.startsWith('image/') &&
        !row.mediaMime.startsWith('video/') &&
        !row.mediaMime.startsWith('audio/'))
    ) {
      return 'files';
    }
    return 'media';
  }
  if (row.kind === 'text' && row.text && URL_IN_TEXT_RE.test(row.text)) return 'links';
  return 'text';
}

function messageMatchesQuery(row: StoredMessage, query: string): boolean {
  if (!query) return true;
  const hay = [row.text, row.mediaName, formatMessageSnippet(row)]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
  return hay.includes(query);
}

/**
 * Мгновенный поиск по локальной истории IndexedDB с фильтром по типу контента.
 * Пустой query + фильтр ≠ all → вся медиатека чатов этого типа.
 */
export async function searchLocalChatMessages(
  selfId: string,
  opts: { query?: string; filter?: ChatSearchFilter; limit?: number } = {}
): Promise<ChatSearchHit[]> {
  const query = (opts.query || '').trim().toLowerCase();
  const filter = opts.filter ?? 'all';
  const limit = opts.limit ?? 80;
  const out: ChatSearchHit[] = [];
  if (!selfId) return out;

  try {
    const keys = await messagesDb.keys();
    for (const raw of keys) {
      const key = String(raw);
      const pair = parseChatKey(key);
      if (!pair) continue;
      const [a, b] = pair;
      const peerId = a === selfId ? b : b === selfId ? a : null;
      if (!peerId) continue;
      const convId = conversationId(a, b);
      const history = (await messagesDb.getItem<StoredMessage[]>(key)) ?? [];
      for (let i = history.length - 1; i >= 0; i--) {
        const message = history[i]!;
        const category = classifyMessageCategory(message);
        if (filter !== 'all' && category !== filter) continue;
        if (!messageMatchesQuery(message, query)) continue;
        out.push({
          peerId,
          conversationId: convId,
          message,
          category,
          snippet: formatMessageSnippet(message),
          timeLabel: previewTimeLabel(message),
          createdAt:
            typeof message.createdAt === 'number' ? message.createdAt : 0,
        });
        if (out.length >= limit) return out;
      }
    }
  } catch {
    /* */
  }

  out.sort((a, b) => b.createdAt - a.createdAt);
  return out;
}

/** Последнее сообщение по каждому собеседнику / группе (IndexedDB). */
export async function loadLastMessagePreviews(
  selfId: string
): Promise<Record<string, LastMessagePreview>> {
  const out: Record<string, LastMessagePreview> = {};
  if (!selfId) return out;
  try {
    const keys = await messagesDb.keys();
    for (const raw of keys) {
      const key = String(raw);
      const groupId = parseGroupChatKey(key);
      if (groupId) {
        const history = (await messagesDb.getItem<StoredMessage[]>(key)) ?? [];
        const last = history[history.length - 1];
        if (!last) continue;
        const snippet = formatMessageSnippet(last);
        const peerId = groupConversationId(groupId);
        out[peerId] = {
          peerId,
          snippet: last.mine ? `Вы: ${snippet}` : snippet,
          timeLabel: previewTimeLabel(last),
          createdAt: typeof last.createdAt === 'number' ? last.createdAt : 0,
        };
        continue;
      }
      const pair = parseChatKey(key);
      if (!pair) continue;
      const [a, b] = pair;
      const peerId = a === selfId ? b : b === selfId ? a : null;
      if (!peerId) continue;
      const history = (await messagesDb.getItem<StoredMessage[]>(key)) ?? [];
      const last = history[history.length - 1];
      if (!last) continue;
      const snippet = formatMessageSnippet(last);
      out[peerId] = {
        peerId,
        snippet: last.mine ? `Вы: ${snippet}` : snippet,
        timeLabel: previewTimeLabel(last),
        createdAt: typeof last.createdAt === 'number' ? last.createdAt : 0,
      };
    }
  } catch {
    /* */
  }
  return out;
}

export type OwnMediaArchiveItem = {
  id: string;
  peerId: string;
  conversationId: string;
  message: StoredMessage;
  category: Extract<ChatMessageCategory, 'media' | 'files' | 'voice'>;
  createdAt: number;
  timeLabel: string;
};

/** Исходящие медиа/файлы/голос из локальной истории — архив профиля. */
export async function loadOwnMediaArchive(
  selfId: string,
  limit = 48
): Promise<OwnMediaArchiveItem[]> {
  const out: OwnMediaArchiveItem[] = [];
  if (!selfId) return out;
  try {
    const keys = await messagesDb.keys();
    for (const raw of keys) {
      const key = String(raw);
      const pair = parseChatKey(key);
      if (!pair) continue;
      const [a, b] = pair;
      const peerId = a === selfId ? b : b === selfId ? a : null;
      if (!peerId) continue;
      const convId = conversationId(a, b);
      const history = (await messagesDb.getItem<StoredMessage[]>(key)) ?? [];
      for (let i = history.length - 1; i >= 0; i--) {
        const message = history[i]!;
        if (!message.mine) continue;
        if (message.kind !== 'media' && message.kind !== 'file-transfer') continue;
        const category = classifyMessageCategory(message);
        if (category !== 'media' && category !== 'files' && category !== 'voice') continue;
        out.push({
          id: message.id,
          peerId,
          conversationId: convId,
          message,
          category,
          createdAt: typeof message.createdAt === 'number' ? message.createdAt : 0,
          timeLabel: previewTimeLabel(message),
        });
      }
    }
  } catch {
    /* */
  }
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out.slice(0, limit);
}
