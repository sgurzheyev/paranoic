import { getSupabase, hasSupabaseConfig } from './lib/supabase';
import type { UserIdentity } from './identity';

export const AVATARS_BUCKET = 'avatars';
export const PROFILES_TABLE = 'profiles';

export type RemoteProfile = {
  id: string;
  name: string;
  color: string;
  avatar_url: string | null;
  theme_fon: string | null;
  updated_at?: string;
};

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const MAX_EDGE = 512;

function extFromMime(mime: string): string {
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  return 'jpg';
}

/** Сжимает изображение до квадрата ≤512px (JPEG). */
export async function prepareAvatarBlob(file: File): Promise<{ blob: Blob; mime: string }> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Нужно изображение');
  }
  if (file.size > MAX_AVATAR_BYTES * 3) {
    throw new Error('Файл слишком большой (макс. ~2 МБ после сжатия)');
  }

  const bitmap = await createImageBitmap(file);
  const size = Math.min(MAX_EDGE, Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('Не удалось обработать изображение');
  }

  const scale = Math.max(size / bitmap.width, size / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.86)
  );
  if (!blob) throw new Error('Не удалось сжать изображение');
  if (blob.size > MAX_AVATAR_BYTES) {
    throw new Error('Аватар всё ещё слишком большой');
  }
  return { blob, mime: 'image/jpeg' };
}

/**
 * Загружает аватар в Supabase Storage (`avatars/{userId}/avatar.jpg`)
 * и возвращает публичный URL. При ошибке — локальный object URL как fallback нет:
 * возвращаем data URL через FileReader, если Storage недоступен.
 */
export async function uploadAvatar(userId: string, file: File): Promise<string> {
  const { blob, mime } = await prepareAvatarBlob(file);

  if (hasSupabaseConfig()) {
    try {
      const sb = getSupabase();
      const path = `${userId}/avatar.${extFromMime(mime)}`;
      const { error } = await sb.storage.from(AVATARS_BUCKET).upload(path, blob, {
        upsert: true,
        contentType: mime,
        cacheControl: '3600',
      });
      if (error) throw error;

      const { data } = sb.storage.from(AVATARS_BUCKET).getPublicUrl(path);
      // cache-bust чтобы сразу увидеть новое фото
      return `${data.publicUrl}?t=${Date.now()}`;
    } catch (e) {
      console.warn('[paranoic] avatar upload failed, using data URL', e);
    }
  }

  return blobToDataUrl(blob);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.readAsDataURL(blob);
  });
}

/** Upsert в таблицу `profiles` (если настроена). Ошибки не фатальны. */
export async function syncProfileToSupabase(identity: UserIdentity): Promise<void> {
  if (!hasSupabaseConfig()) return;
  try {
    const sb = getSupabase();
    const row: RemoteProfile = {
      id: identity.id,
      name: identity.name,
      color: identity.color,
      avatar_url: identity.avatarUrl || null,
      theme_fon: identity.themeFon || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await sb.from(PROFILES_TABLE).upsert(row, { onConflict: 'id' });
    if (error) console.warn('[paranoic] profiles upsert', error.message);
  } catch (e) {
    console.warn('[paranoic] profiles sync skipped', e);
  }
}

export async function fetchRemoteProfile(userId: string): Promise<RemoteProfile | null> {
  if (!hasSupabaseConfig()) return null;
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from(PROFILES_TABLE)
      .select('id,name,color,avatar_url,theme_fon,updated_at')
      .eq('id', userId)
      .maybeSingle();
    if (error) {
      console.warn('[paranoic] profiles fetch', error.message);
      return null;
    }
    return data as RemoteProfile | null;
  } catch {
    return null;
  }
}
