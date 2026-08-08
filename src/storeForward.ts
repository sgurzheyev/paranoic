/**
 * Store-and-Forward через Supabase:
 * - шифрование на клиенте (ключ инбокса получателя)
 * - таблица `messages` + Storage `offline-transfers`
 * - после расшифровки у получателя — немедленное удаление (ZK).
 */

import {
  base64ToBytes,
  bytesToBase64,
  decryptBytes,
  decryptMessage,
  deriveKeyFromRoom,
  encryptBytes,
  encryptMessage,
} from './crypto';
import { personalInboxRoom } from './identity';
import { getSupabase, hasSupabaseConfig } from './lib/supabase';
import { conversationId } from './storage';

export const MESSAGES_TABLE = 'messages';
export const OFFLINE_TRANSFERS_BUCKET = 'offline-transfers';

const MAX_OFFLINE_FILE_BYTES = 16 * 1024 * 1024;

export type PendingMessageRow = {
  id: string;
  from_user_id: string;
  to_user_id: string;
  conversation_id: string;
  room_id: string;
  kind: 'text' | 'media';
  pending_delivery: boolean;
  cipher: string | null;
  iv: string;
  sender_name: string | null;
  media_mime: string | null;
  media_name: string | null;
  media_size: number | null;
  storage_path: string | null;
  created_at: string;
};

export type IngestedPendingText = {
  id: string;
  conversationId: string;
  fromUserId: string;
  senderName: string;
  text: string;
  createdAt: number;
};

export type IngestedPendingMedia = {
  id: string;
  conversationId: string;
  fromUserId: string;
  senderName: string;
  mime: string;
  name: string;
  size: number;
  blob: Blob;
  createdAt: number;
};

function storagePathFor(toUserId: string, id: string): string {
  return `${toUserId}/${id}.bin`;
}

/** Загрузить зашифрованный текст в Supabase (pending_delivery). */
export async function uploadPendingText(opts: {
  id: string;
  fromUserId: string;
  toUserId: string;
  senderName: string;
  plaintext: string;
}): Promise<void> {
  if (!hasSupabaseConfig()) {
    throw new Error('Supabase не настроен');
  }

  const roomId = personalInboxRoom(opts.toUserId);
  const key = await deriveKeyFromRoom(roomId);
  const { cipher, iv } = await encryptMessage(opts.plaintext, key);
  const conv = conversationId(opts.fromUserId, opts.toUserId);
  const sb = getSupabase();

  const row: Omit<PendingMessageRow, 'created_at'> & { created_at?: string } = {
    id: opts.id,
    from_user_id: opts.fromUserId,
    to_user_id: opts.toUserId,
    conversation_id: conv,
    room_id: roomId,
    kind: 'text',
    pending_delivery: true,
    cipher,
    iv,
    sender_name: opts.senderName,
    media_mime: null,
    media_name: null,
    media_size: null,
    storage_path: null,
    created_at: new Date().toISOString(),
  };

  const { error } = await sb.from(MESSAGES_TABLE).upsert(row, { onConflict: 'id' });
  if (error) throw new Error(error.message || 'Не удалось сохранить сообщение офлайн');
}

/** Зашифровать файл и положить в Storage + строку messages. */
export async function uploadPendingMedia(opts: {
  id: string;
  fromUserId: string;
  toUserId: string;
  senderName: string;
  file: File;
  onProgress?: (ratio: number) => void;
}): Promise<void> {
  if (!hasSupabaseConfig()) {
    throw new Error('Supabase не настроен');
  }
  if (opts.file.size > MAX_OFFLINE_FILE_BYTES) {
    throw new Error('Файл слишком большой (макс. 16 МБ)');
  }

  const roomId = personalInboxRoom(opts.toUserId);
  const key = await deriveKeyFromRoom(roomId);
  opts.onProgress?.(0.05);

  const buffer = await opts.file.arrayBuffer();
  const { cipher, iv } = await encryptBytes(buffer, key);
  opts.onProgress?.(0.45);

  const cipherBytes = base64ToBytes(cipher);
  const path = storagePathFor(opts.toUserId, opts.id);
  const sb = getSupabase();

  const { error: upErr } = await sb.storage
    .from(OFFLINE_TRANSFERS_BUCKET)
    .upload(path, cipherBytes, {
      upsert: true,
      contentType: 'application/octet-stream',
      cacheControl: '0',
    });
  if (upErr) throw new Error(upErr.message || 'Не удалось загрузить файл офлайн');
  opts.onProgress?.(0.85);

  const conv = conversationId(opts.fromUserId, opts.toUserId);
  const row = {
    id: opts.id,
    from_user_id: opts.fromUserId,
    to_user_id: opts.toUserId,
    conversation_id: conv,
    room_id: roomId,
    kind: 'media' as const,
    pending_delivery: true,
    cipher: null as string | null,
    iv,
    sender_name: opts.senderName,
    media_mime: opts.file.type || 'application/octet-stream',
    media_name: opts.file.name,
    media_size: opts.file.size,
    storage_path: path,
    created_at: new Date().toISOString(),
  };

  const { error } = await sb.from(MESSAGES_TABLE).upsert(row, { onConflict: 'id' });
  if (error) {
    await sb.storage.from(OFFLINE_TRANSFERS_BUCKET).remove([path]).catch(() => undefined);
    throw new Error(error.message || 'Не удалось сохранить метаданные файла');
  }
  opts.onProgress?.(1);
}

/** Удалить ciphertext из Storage и строку из messages (Zero-Knowledge). */
export async function purgePendingDelivery(row: Pick<PendingMessageRow, 'id' | 'storage_path'>): Promise<void> {
  if (!hasSupabaseConfig()) return;
  const sb = getSupabase();
  if (row.storage_path) {
    const { error } = await sb.storage
      .from(OFFLINE_TRANSFERS_BUCKET)
      .remove([row.storage_path]);
    if (error) console.warn('[paranoic SAF] storage delete', error.message);
  }
  const { error } = await sb.from(MESSAGES_TABLE).delete().eq('id', row.id);
  if (error) console.warn('[paranoic SAF] row delete', error.message);
}

async function downloadCipherBlob(path: string): Promise<ArrayBuffer> {
  const sb = getSupabase();
  const { data, error } = await sb.storage.from(OFFLINE_TRANSFERS_BUCKET).download(path);
  if (error || !data) {
    throw new Error(error?.message || 'Не удалось скачать офлайн-файл');
  }
  return data.arrayBuffer();
}

/**
 * Забрать все входящие pending_delivery для пользователя,
 * расшифровать и сразу удалить с сервера.
 */
export async function syncPendingDeliveries(
  myUserId: string,
  handlers: {
    onText: (msg: IngestedPendingText) => void | Promise<void>;
    onMedia: (msg: IngestedPendingMedia) => void | Promise<void>;
  }
): Promise<{ text: number; media: number }> {
  if (!hasSupabaseConfig() || !myUserId) return { text: 0, media: 0 };

  const sb = getSupabase();
  const { data, error } = await sb
    .from(MESSAGES_TABLE)
    .select(
      'id,from_user_id,to_user_id,conversation_id,room_id,kind,pending_delivery,cipher,iv,sender_name,media_mime,media_name,media_size,storage_path,created_at'
    )
    .eq('to_user_id', myUserId)
    .eq('pending_delivery', true)
    .order('created_at', { ascending: true });

  if (error) {
    console.warn('[paranoic SAF] fetch pending', error.message);
    return { text: 0, media: 0 };
  }

  const rows = (data ?? []) as PendingMessageRow[];
  let textCount = 0;
  let mediaCount = 0;

  for (const row of rows) {
    try {
      const roomId = row.room_id || personalInboxRoom(myUserId);
      const key = await deriveKeyFromRoom(roomId);
      const createdAt = Date.parse(row.created_at) || Date.now();
      const senderName = row.sender_name || 'Близкий';

      if (row.kind === 'text') {
        if (!row.cipher) throw new Error('Нет cipher');
        const text = await decryptMessage(row.cipher, row.iv, key);
        await handlers.onText({
          id: row.id,
          conversationId: row.conversation_id || conversationId(row.from_user_id, myUserId),
          fromUserId: row.from_user_id,
          senderName,
          text,
          createdAt,
        });
        await purgePendingDelivery(row);
        textCount += 1;
        continue;
      }

      if (row.kind === 'media') {
        if (!row.storage_path) throw new Error('Нет storage_path');
        const cipherBuf = await downloadCipherBlob(row.storage_path);
        const plain = await decryptBytes(
          bytesToBase64(new Uint8Array(cipherBuf)),
          row.iv,
          key
        );
        const mime = row.media_mime || 'application/octet-stream';
        const blob = new Blob([plain], { type: mime });
        await handlers.onMedia({
          id: row.id,
          conversationId: row.conversation_id || conversationId(row.from_user_id, myUserId),
          fromUserId: row.from_user_id,
          senderName,
          mime,
          name: row.media_name || 'file',
          size: row.media_size ?? blob.size,
          blob,
          createdAt,
        });
        await purgePendingDelivery(row);
        mediaCount += 1;
      }
    } catch (e) {
      console.warn('[paranoic SAF] ingest failed', row.id, e);
    }
  }

  return { text: textCount, media: mediaCount };
}
