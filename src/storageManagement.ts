/**
 * Local storage management: size estimates + category clears
 * for chat IndexedDB (localforage) and Mapbox Cache API.
 */

import localforage from 'localforage';
import type { StoredMessage } from './storage';

const messagesDb = localforage.createInstance({
  name: 'paranoic',
  storeName: 'messages',
});

const mediaDb = localforage.createInstance({
  name: 'paranoic',
  storeName: 'media',
});

/** Cache name used by mapbox-gl (`const Wt = "mapbox-tiles"`). */
export const MAPBOX_CACHE_NAME = 'mapbox-tiles';

export const STORAGE_CLEARED_EVENT = 'paranoic:local-storage-cleared';

export type StorageCategoryId = 'messages' | 'images' | 'videos' | 'mapbox';

export type StorageBreakdownBytes = Record<StorageCategoryId, number>;

const encoder = new TextEncoder();

function utf8Bytes(value: string): number {
  return encoder.encode(value).length;
}

function estimateRecordBytes(row: StoredMessage): number {
  try {
    return utf8Bytes(JSON.stringify(row));
  } catch {
    return 256;
  }
}

function isChatHistoryKey(key: string): boolean {
  return key.startsWith('chat:');
}

function isImageMessage(row: StoredMessage): boolean {
  if (row.kind !== 'media' && row.kind !== 'file-pending' && row.kind !== 'file-transfer') {
    return false;
  }
  if (row.mediaKind === 'circle' || row.mediaKind === 'voice') return false;
  if (row.mediaMime?.startsWith('image/')) return true;
  if (row.mediaMime?.startsWith('video/') || row.mediaMime?.startsWith('audio/')) return false;
  const name = (row.mediaName || '').toLowerCase();
  return /\.(png|jpe?g|gif|webp|avif|heic|bmp)$/i.test(name);
}

function isVideoMessage(row: StoredMessage): boolean {
  if (row.kind !== 'media' && row.kind !== 'file-pending' && row.kind !== 'file-transfer') {
    return false;
  }
  if (row.mediaKind === 'voice') return false;
  if (row.mediaKind === 'circle') return true;
  if (row.mediaMime?.startsWith('video/')) return true;
  if (row.mediaMime?.startsWith('image/') || row.mediaMime?.startsWith('audio/')) return false;
  const name = (row.mediaName || '').toLowerCase();
  return /\.(mp4|webm|mov|mkv|m4v)$/i.test(name);
}

function isTextMessage(row: StoredMessage): boolean {
  return row.kind === 'text';
}

function isMapboxCacheName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === MAPBOX_CACHE_NAME || lower.includes('mapbox');
}

async function blobSizeForKey(mediaKey: string): Promise<number> {
  try {
    const blob = await mediaDb.getItem<Blob>(mediaKey);
    if (blob && typeof blob.size === 'number') return blob.size;
  } catch {
    /* */
  }
  return 0;
}

async function estimateCacheBytes(cacheName: string): Promise<number> {
  if (typeof caches === 'undefined') return 0;
  try {
    const cache = await caches.open(cacheName);
    const requests = await cache.keys();
    let total = 0;
    for (const req of requests) {
      try {
        const res = await cache.match(req);
        if (!res) continue;
        const header = res.headers.get('content-length');
        if (header) {
          const n = Number(header);
          if (Number.isFinite(n) && n > 0) {
            total += n;
            continue;
          }
        }
        const blob = await res.clone().blob();
        total += blob.size;
      } catch {
        /* */
      }
    }
    return total;
  } catch {
    return 0;
  }
}

/** List Cache API names that look like Mapbox tile / asset caches. */
export async function listMapboxCacheNames(): Promise<string[]> {
  if (typeof caches === 'undefined') return [];
  try {
    const names = await caches.keys();
    return names.filter(isMapboxCacheName);
  } catch {
    return [];
  }
}

export async function estimateMapboxCacheBytes(): Promise<number> {
  const names = await listMapboxCacheNames();
  let total = 0;
  for (const name of names) {
    total += await estimateCacheBytes(name);
  }
  return total;
}

/**
 * Walk chat histories + media blobs and estimate bytes per UI category.
 * Images/videos prefer Blob.size; text uses serialized message size.
 */
export async function estimateStorageBreakdown(): Promise<StorageBreakdownBytes> {
  const out: StorageBreakdownBytes = {
    messages: 0,
    images: 0,
    videos: 0,
    mapbox: 0,
  };

  const referencedMedia = new Set<string>();

  try {
    const keys = await messagesDb.keys();
    for (const raw of keys) {
      const key = String(raw);
      if (!isChatHistoryKey(key)) continue;
      const history = (await messagesDb.getItem<StoredMessage[]>(key)) ?? [];
      for (const row of history) {
        if (isTextMessage(row)) {
          out.messages += estimateRecordBytes(row);
          continue;
        }
        if (isImageMessage(row)) {
          out.images += estimateRecordBytes(row);
          if (row.mediaKey) {
            referencedMedia.add(row.mediaKey);
            const blobBytes = await blobSizeForKey(row.mediaKey);
            out.images += blobBytes > 0 ? blobBytes : row.mediaSize ?? 0;
          } else if (typeof row.mediaSize === 'number') {
            out.images += row.mediaSize;
          }
          continue;
        }
        if (isVideoMessage(row)) {
          out.videos += estimateRecordBytes(row);
          if (row.mediaKey) {
            referencedMedia.add(row.mediaKey);
            const blobBytes = await blobSizeForKey(row.mediaKey);
            out.videos += blobBytes > 0 ? blobBytes : row.mediaSize ?? 0;
          } else if (typeof row.mediaSize === 'number') {
            out.videos += row.mediaSize;
          }
        } else if (row.mediaKey) {
          referencedMedia.add(row.mediaKey);
        }
      }
    }
  } catch {
    /* */
  }

  // Orphan media blobs (no message ref) — classify by MIME.
  try {
    const mediaKeys = await mediaDb.keys();
    for (const raw of mediaKeys) {
      const key = String(raw);
      if (referencedMedia.has(key)) continue;
      try {
        const blob = await mediaDb.getItem<Blob>(key);
        if (!blob || typeof blob.size !== 'number') continue;
        const type = (blob.type || '').toLowerCase();
        if (type.startsWith('image/')) out.images += blob.size;
        else if (type.startsWith('video/')) out.videos += blob.size;
      } catch {
        /* */
      }
    }
  } catch {
    /* */
  }

  out.mapbox = await estimateMapboxCacheBytes();
  return out;
}

function notifyCleared(category: StorageCategoryId): void {
  try {
    window.dispatchEvent(
      new CustomEvent(STORAGE_CLEARED_EVENT, { detail: { category } })
    );
  } catch {
    /* */
  }
}

/** Remove text messages from every chat history. */
export async function clearTextMessages(): Promise<void> {
  const keys = await messagesDb.keys();
  for (const raw of keys) {
    const key = String(raw);
    if (!isChatHistoryKey(key)) continue;
    const history = (await messagesDb.getItem<StoredMessage[]>(key)) ?? [];
    const kept = history.filter((row) => !isTextMessage(row));
    if (kept.length !== history.length) {
      await messagesDb.setItem(key, kept);
    }
  }
  notifyCleared('messages');
}

async function clearMediaByPredicate(
  category: 'images' | 'videos',
  match: (row: StoredMessage) => boolean
): Promise<void> {
  const dropKeys = new Set<string>();
  const keys = await messagesDb.keys();

  for (const raw of keys) {
    const key = String(raw);
    if (!isChatHistoryKey(key)) continue;
    const history = (await messagesDb.getItem<StoredMessage[]>(key)) ?? [];
    const kept: StoredMessage[] = [];
    for (const row of history) {
      if (match(row)) {
        if (row.mediaKey) dropKeys.add(row.mediaKey);
        continue;
      }
      kept.push(row);
    }
    if (kept.length !== history.length) {
      await messagesDb.setItem(key, kept);
    }
  }

  for (const mk of dropKeys) {
    try {
      await mediaDb.removeItem(mk);
    } catch {
      /* */
    }
  }

  // Orphan blobs of this MIME family.
  try {
    const mediaKeys = await mediaDb.keys();
    for (const raw of mediaKeys) {
      const key = String(raw);
      if (dropKeys.has(key)) continue;
      try {
        const blob = await mediaDb.getItem<Blob>(key);
        if (!blob) continue;
        const type = (blob.type || '').toLowerCase();
        const orphanMatch =
          category === 'images'
            ? type.startsWith('image/')
            : type.startsWith('video/');
        if (orphanMatch) await mediaDb.removeItem(key);
      } catch {
        /* */
      }
    }
  } catch {
    /* */
  }

  notifyCleared(category);
}

export async function clearImageMedia(): Promise<void> {
  await clearMediaByPredicate('images', isImageMessage);
}

export async function clearVideoMedia(): Promise<void> {
  await clearMediaByPredicate('videos', isVideoMessage);
}

/** Delete Mapbox-related Cache Storage entries (`mapbox-tiles`, etc.). */
export async function clearMapboxCaches(): Promise<void> {
  const names = await listMapboxCacheNames();
  for (const name of names) {
    try {
      await caches.delete(name);
    } catch {
      /* */
    }
  }
  notifyCleared('mapbox');
}

export async function clearStorageCategory(category: StorageCategoryId): Promise<void> {
  switch (category) {
    case 'messages':
      await clearTextMessages();
      break;
    case 'images':
      await clearImageMedia();
      break;
    case 'videos':
      await clearVideoMedia();
      break;
    case 'mapbox':
      await clearMapboxCaches();
      break;
  }
}
