/**
 * Cloudflare R2 media storage (S3-compatible).
 * Public URLs are saved into Supabase tables (map_gems.media_url, profiles.avatar_url).
 *
 * Required env:
 *   VITE_R2_ACCOUNT_ID
 *   VITE_R2_ACCESS_KEY_ID
 *   VITE_R2_SECRET_ACCESS_KEY
 *   VITE_R2_BUCKET
 *   VITE_R2_PUBLIC_URL  — e.g. https://media.example.com or https://pub-xxx.r2.dev
 */

import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Upload } from '@aws-sdk/lib-storage';

export type R2Folder = 'avatars' | 'map-gems' | 'media';

/** Жёсткий лимит размера файла до клиентского сжатия. */
export const MAX_UPLOAD_BYTES_BEFORE_COMPRESS = 15 * 1024 * 1024;

const GEM_FULL_MAX_EDGE = 1600;
const GEM_FULL_QUALITY = 0.82;
const GEM_THUMB_EDGE = 256;
const GEM_THUMB_QUALITY = 0.75;

type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicUrl: string;
};

let client: S3Client | null = null;

function readConfig(): R2Config | null {
  const accountId = (import.meta.env.VITE_R2_ACCOUNT_ID as string | undefined)?.trim();
  const accessKeyId = (import.meta.env.VITE_R2_ACCESS_KEY_ID as string | undefined)?.trim();
  const secretAccessKey = (
    import.meta.env.VITE_R2_SECRET_ACCESS_KEY as string | undefined
  )?.trim();
  const bucket = (import.meta.env.VITE_R2_BUCKET as string | undefined)?.trim();
  const publicUrl = (import.meta.env.VITE_R2_PUBLIC_URL as string | undefined)?.trim();
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicUrl) {
    return null;
  }
  return { accountId, accessKeyId, secretAccessKey, bucket, publicUrl };
}

export function hasR2Config(): boolean {
  return Boolean(readConfig());
}

function getR2Config(): R2Config {
  const cfg = readConfig();
  if (!cfg) {
    throw new Error(
      'Cloudflare R2 не настроен. Добавьте VITE_R2_ACCOUNT_ID, VITE_R2_ACCESS_KEY_ID, VITE_R2_SECRET_ACCESS_KEY, VITE_R2_BUCKET, VITE_R2_PUBLIC_URL.'
    );
  }
  return cfg;
}

function getS3Client(): S3Client {
  if (client) return client;
  const cfg = getR2Config();
  client = new S3Client({
    region: 'auto',
    endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
    forcePathStyle: true,
  });
  return client;
}

function sanitizeSegment(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
}

function extFromName(name: string, fallback = 'bin'): string {
  const part = name.split('.').pop()?.toLowerCase();
  if (!part || part.length > 8) return fallback;
  return part.replace(/[^a-z0-9]/g, '') || fallback;
}

/** Public HTTPS URL for a stored object key. */
export function publicUrlForKey(key: string): string {
  const cfg = getR2Config();
  const base = cfg.publicUrl.replace(/\/$/, '');
  const path = key.replace(/^\//, '');
  return `${base}/${path}`;
}

/** Reverse a public media URL to the R2 object key (`map-gems/...`). */
export function objectKeyFromPublicUrl(mediaUrl: string): string | null {
  const raw = mediaUrl.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const path = decodeURIComponent(u.pathname.replace(/^\//, ''));
    if (
      path.startsWith('map-gems/') ||
      path.startsWith('avatars/') ||
      path.startsWith('media/')
    ) {
      return path;
    }
  } catch {
    /* not an absolute URL */
  }
  const cfg = readConfig();
  if (cfg) {
    const base = cfg.publicUrl.replace(/\/$/, '');
    if (raw.startsWith(`${base}/`)) {
      return decodeURIComponent(raw.slice(base.length + 1).split('?')[0] ?? '');
    }
  }
  return null;
}

/** Build object key: `{folder}/{ownerId}/{timestamp}-{rand}.{ext}` */
export function buildObjectKey(
  folder: R2Folder,
  ownerId: string,
  fileName: string,
  opts?: { fixedName?: string }
): string {
  const owner = sanitizeSegment(ownerId || 'anon');
  const ext = extFromName(fileName, 'bin');
  if (opts?.fixedName) {
    return `${folder}/${owner}/${sanitizeSegment(opts.fixedName)}.${ext}`;
  }
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `${folder}/${owner}/${stamp}-${rand}.${ext}`;
}

/** Публичный URL миниатюры рядом с полным media URL. */
export function thumbUrlFromMediaUrl(mediaUrl: string): string | null {
  try {
    const u = new URL(mediaUrl);
    const path = u.pathname;
    const m = path.match(/^(.*)\.([^.]+)$/);
    if (!m) return null;
    u.pathname = `${m[1]}-thumb.${m[2]}`;
    return u.toString();
  } catch {
    const m = mediaUrl.match(/^(.*)\.([a-z0-9]+)(\?.*)?$/i);
    if (!m) return null;
    return `${m[1]}-thumb.${m[2]}${m[3] ?? ''}`;
  }
}

export function assertWithinUploadLimit(file: Blob | File): void {
  if (file.size > MAX_UPLOAD_BYTES_BEFORE_COMPRESS) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    throw new Error(
      `Файл слишком большой (${mb} МБ). Максимум ${MAX_UPLOAD_BYTES_BEFORE_COMPRESS / (1024 * 1024)} МБ до сжатия.`
    );
  }
}

function canvasToWebpBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Не удалось сжать изображение в WebP'));
          return;
        }
        resolve(blob);
      },
      'image/webp',
      quality
    );
  });
}

/**
 * Сжимает изображение через Canvas → WebP.
 * @param maxEdge максимальная сторона (сохраняет пропорции)
 * @param quality 0..1
 * @param cover если true — квадратный кроп cover (для thumbnail)
 */
export async function compressImageToWebp(
  file: Blob,
  maxEdge: number,
  quality: number,
  cover = false
): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D недоступен');

    if (cover) {
      const size = maxEdge;
      canvas.width = size;
      canvas.height = size;
      const scale = Math.max(size / bitmap.width, size / bitmap.height);
      const w = bitmap.width * scale;
      const h = bitmap.height * scale;
      ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);
    } else {
      const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    }

    return await canvasToWebpBlob(canvas, quality);
  } finally {
    bitmap.close();
  }
}

export type PreparedGemImage = {
  full: Blob;
  thumb: Blob;
  fullFileName: string;
  thumbFileName: string;
  contentType: 'image/webp';
};

/** Полное WebP ≤1600px + thumbnail 256×256 для карты. */
export async function prepareGemImageForR2(file: File): Promise<PreparedGemImage> {
  assertWithinUploadLimit(file);
  if (!file.type.startsWith('image/')) {
    throw new Error('Ожидалось изображение');
  }
  const base = sanitizeSegment(file.name.replace(/\.[^.]+$/, '') || 'gem');
  const [full, thumb] = await Promise.all([
    compressImageToWebp(file, GEM_FULL_MAX_EDGE, GEM_FULL_QUALITY, false),
    compressImageToWebp(file, GEM_THUMB_EDGE, GEM_THUMB_QUALITY, true),
  ]);
  return {
    full,
    thumb,
    fullFileName: `${base}.webp`,
    thumbFileName: `${base}-thumb.webp`,
    contentType: 'image/webp',
  };
}

export type UploadToR2Options = {
  key: string;
  body: Blob | File | Uint8Array;
  contentType?: string;
  cacheControl?: string;
  onProgress?: (ratio: number) => void;
};

/** Upload bytes to R2; returns the public URL. */
export async function uploadToR2(opts: UploadToR2Options): Promise<string> {
  const cfg = getR2Config();
  const s3 = getS3Client();
  const contentType =
    opts.contentType ||
    (opts.body instanceof File || opts.body instanceof Blob
      ? opts.body.type
      : undefined) ||
    'application/octet-stream';

  const upload = new Upload({
    client: s3,
    params: {
      Bucket: cfg.bucket,
      Key: opts.key,
      Body: opts.body,
      ContentType: contentType,
      CacheControl: opts.cacheControl || 'public, max-age=31536000, immutable',
    },
  });

  upload.on('httpUploadProgress', (progress) => {
    if (!opts.onProgress) return;
    const total = progress.total ?? 0;
    const loaded = progress.loaded ?? 0;
    if (total > 0) opts.onProgress(Math.min(1, loaded / total));
  });

  try {
    await upload.done();
  } catch (err) {
    throw wrapR2UploadError(err, opts.key);
  }
  opts.onProgress?.(1);
  return publicUrlForKey(opts.key);
}

function envFlag(name: string, secret = false): string {
  const v = (import.meta.env[name] as string | undefined)?.trim();
  if (!v) return `${name}=MISSING`;
  if (secret) return `${name}=set(${v.length}ch)`;
  return `${name}=${v}`;
}

function wrapR2UploadError(err: unknown, key: string): Error {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'n/a';
  const cfg = readConfig();
  const envDump = [
    envFlag('VITE_R2_ACCOUNT_ID'),
    envFlag('VITE_R2_ACCESS_KEY_ID', true),
    envFlag('VITE_R2_SECRET_ACCESS_KEY', true),
    envFlag('VITE_R2_BUCKET'),
    envFlag('VITE_R2_PUBLIC_URL'),
  ].join(', ');

  const raw = err instanceof Error ? err : new Error(String(err));
  const aws = err as {
    name?: string;
    message?: string;
    stack?: string;
    cause?: unknown;
    $metadata?: { httpStatusCode?: number; requestId?: string; extendedRequestId?: string };
  };
  const cause =
    aws.cause instanceof Error
      ? `${aws.cause.name}: ${aws.cause.message}`
      : aws.cause
        ? String(aws.cause)
        : '';
  const http = aws.$metadata?.httpStatusCode;
  const requestId = aws.$metadata?.requestId;
  const fetchFail = /failed to fetch|networkerror|load failed|cors/i.test(
    `${raw.name} ${raw.message} ${cause}`
  );
  const corsHint = fetchFail
    ? `Likely CORS or blocked browser fetch to R2 S3 API (${cfg ? `https://${cfg.accountId}.r2.cloudflarestorage.com` : 'endpoint unknown'}). Add this origin (${origin}) to the bucket CORS rules (AllowedMethods PUT,POST,GET,HEAD; AllowedHeaders *).`
    : '';

  const detail = [
    `R2 upload failed for key=${key}`,
    `origin=${origin}`,
    envDump,
    `name=${raw.name}`,
    `message=${raw.message}`,
    http != null ? `http=${http}` : '',
    requestId ? `requestId=${requestId}` : '',
    cause ? `cause=${cause}` : '',
    corsHint,
    `stack=${raw.stack ?? 'none'}`,
  ]
    .filter(Boolean)
    .join(' | ');

  const wrapped = new Error(detail);
  wrapped.name = raw.name || 'R2UploadError';
  wrapped.stack = raw.stack;
  return wrapped;
}

/** Presigned PUT URL (optional path for custom XHR uploads). */
export async function createPresignedUploadUrl(
  key: string,
  contentType: string,
  expiresInSec = 600
): Promise<{ uploadUrl: string; publicUrl: string; key: string }> {
  const cfg = getR2Config();
  const s3 = getS3Client();
  const command = new PutObjectCommand({
    Bucket: cfg.bucket,
    Key: key,
    ContentType: contentType,
  });
  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: expiresInSec });
  return { uploadUrl, publicUrl: publicUrlForKey(key), key };
}

/** Best-effort delete (avatar overwrite / cleanup). */
export async function deleteFromR2(key: string): Promise<void> {
  try {
    await deleteR2Object(key);
  } catch (e) {
    console.warn('[paranoic r2] delete failed', key, e);
  }
}

/** Permanently delete an object; throws on failure. */
export async function deleteR2Object(key: string): Promise<void> {
  if (!key.trim()) throw new Error('Пустой ключ R2');
  if (!hasR2Config()) {
    throw new Error(
      'Cloudflare R2 не настроен. Добавьте VITE_R2_* переменные окружения.'
    );
  }
  const cfg = getR2Config();
  const s3 = getS3Client();
  await s3.send(
    new DeleteObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
    })
  );
}

/**
 * Удаляет оригинал + thumbnail капсулы из R2 по публичному URL.
 * Thumb best-effort (может отсутствовать).
 */
export async function deleteGemMedia(mediaUrl: string): Promise<void> {
  const url = mediaUrl.trim();
  if (!url) return;
  const key = objectKeyFromPublicUrl(url);
  if (!key) {
    throw new Error(`Не удалось определить ключ R2: ${url}`);
  }
  await deleteR2Object(key);
  const thumbKey = objectKeyFromPublicUrl(thumbUrlFromMediaUrl(url) || '');
  if (thumbKey && thumbKey !== key) {
    try {
      await deleteR2Object(thumbKey);
    } catch (e) {
      console.warn('[paranoic r2] thumb delete', e);
    }
  }
}

export type UploadFileToR2Result = {
  mediaUrl: string;
  thumbUrl?: string;
};

/**
 * Upload a File under a folder and return the public URL.
 * Для изображений в `map-gems`: лимит 15 МБ, WebP ≤1600px + thumb 256×256.
 */
export async function uploadFileToR2(
  folder: R2Folder,
  ownerId: string,
  file: File,
  opts?: {
    fixedName?: string;
    onProgress?: (ratio: number) => void;
    cacheControl?: string;
  }
): Promise<string> {
  const result = await uploadFileToR2Detailed(folder, ownerId, file, opts);
  return result.mediaUrl;
}

/** Как uploadFileToR2, но возвращает URL миниатюры для map-gems изображений. */
export async function uploadFileToR2Detailed(
  folder: R2Folder,
  ownerId: string,
  file: File,
  opts?: {
    fixedName?: string;
    onProgress?: (ratio: number) => void;
    cacheControl?: string;
  }
): Promise<UploadFileToR2Result> {
  assertWithinUploadLimit(file);

  const isGemImage = folder === 'map-gems' && file.type.startsWith('image/');
  if (!isGemImage) {
    const key = buildObjectKey(folder, ownerId, file.name, {
      fixedName: opts?.fixedName,
    });
    const mediaUrl = await uploadToR2({
      key,
      body: file,
      contentType: file.type || undefined,
      cacheControl: opts?.cacheControl,
      onProgress: opts?.onProgress,
    });
    return { mediaUrl };
  }

  opts?.onProgress?.(0.05);
  const prepared = await prepareGemImageForR2(file);
  opts?.onProgress?.(0.2);

  const fullKey = buildObjectKey(folder, ownerId, prepared.fullFileName, {
    fixedName: opts?.fixedName,
  });
  const baseKey = fullKey.replace(/\.webp$/i, '');
  const mediaKey = `${baseKey}.webp`;
  const thumbKey = `${baseKey}-thumb.webp`;

  const mediaUrl = await uploadToR2({
    key: mediaKey,
    body: prepared.full,
    contentType: prepared.contentType,
    cacheControl: opts?.cacheControl,
    onProgress: (r) => opts?.onProgress?.(0.2 + r * 0.55),
  });

  const thumbUrl = await uploadToR2({
    key: thumbKey,
    body: prepared.thumb,
    contentType: prepared.contentType,
    cacheControl: opts?.cacheControl,
    onProgress: (r) => opts?.onProgress?.(0.75 + r * 0.25),
  });

  return { mediaUrl, thumbUrl };
}
