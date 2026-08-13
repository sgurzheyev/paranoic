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

  await upload.done();
  opts.onProgress?.(1);
  return publicUrlForKey(opts.key);
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
  if (!hasR2Config()) return;
  const cfg = getR2Config();
  const s3 = getS3Client();
  try {
    await s3.send(
      new DeleteObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
      })
    );
  } catch (e) {
    console.warn('[paranoic r2] delete failed', key, e);
  }
}

/** Upload a File under a folder and return the public URL. */
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
  const key = buildObjectKey(folder, ownerId, file.name, {
    fixedName: opts?.fixedName,
  });
  return uploadToR2({
    key,
    body: file,
    contentType: file.type || undefined,
    cacheControl: opts?.cacheControl,
    onProgress: opts?.onProgress,
  });
}
