/**
 * Медиатека семьи для ИИ-ассистента (Omni-Helper).
 * Метаданные фото/видео из капсул всех связанных контактов — без загрузки самих файлов.
 */

import type { MapGem } from './mapGems';

export type MediaOwnerStat = {
  ownerId: string;
  label: string;
  photos: number;
  videos: number;
};

export type MediaLibraryIndex = {
  photos: number;
  videos: number;
  texts: number;
  /** Капсулы, у которых есть хотя бы один медиафайл. */
  capsulesWithMedia: number;
  owners: MediaOwnerStat[];
  places: string[];
  oldest: string | null;
  newest: string | null;
};

const VIDEO_RE = /\.(mp4|webm|mov|m4v|avi|mkv)(\?|$)/i;
const IMAGE_RE = /\.(jpg|jpeg|png|webp|gif|heic|heif|avif)(\?|$)/i;

/** Порог, после которого ассистент просит подтверждение перед сканом. */
export const HEAVY_SCAN_THRESHOLD = 300;

function classifyUrl(url: string): 'photo' | 'video' | null {
  if (VIDEO_RE.test(url)) return 'video';
  if (IMAGE_RE.test(url)) return 'photo';
  return null;
}

function gemMediaUrls(gem: MapGem): string[] {
  const all = [gem.media_url, ...(gem.media_urls ?? [])];
  return [...new Set(all.filter((u): u is string => Boolean(u && u.trim())))];
}

/**
 * Считает фото/видео по капсулам семьи.
 * `resolveOwner` даёт человекочитаемое имя владельца (контакт / «Вы»).
 */
export function buildMediaLibraryIndex(
  gems: MapGem[],
  resolveOwner: (ownerId: string) => string
): MediaLibraryIndex {
  const owners = new Map<string, MediaOwnerStat>();
  const places = new Set<string>();
  let photos = 0;
  let videos = 0;
  let texts = 0;
  let capsulesWithMedia = 0;
  let oldest: number | null = null;
  let newest: number | null = null;

  for (const gem of gems) {
    const urls = gemMediaUrls(gem);
    let gemPhotos = 0;
    let gemVideos = 0;

    for (const url of urls) {
      const kind = classifyUrl(url) ?? (gem.type === 'video' ? 'video' : 'photo');
      if (kind === 'video') gemVideos += 1;
      else gemPhotos += 1;
    }

    if (urls.length === 0) {
      texts += 1;
    } else {
      capsulesWithMedia += 1;
      photos += gemPhotos;
      videos += gemVideos;
    }

    const ownerId = gem.author_id || 'unknown';
    const prev = owners.get(ownerId);
    if (prev) {
      prev.photos += gemPhotos;
      prev.videos += gemVideos;
    } else {
      owners.set(ownerId, {
        ownerId,
        label: resolveOwner(ownerId),
        photos: gemPhotos,
        videos: gemVideos,
      });
    }

    const label = gem.description?.trim() || gem.content?.trim();
    if (label) places.add(label);

    const ts = Date.parse(gem.created_at);
    if (Number.isFinite(ts)) {
      if (oldest == null || ts < oldest) oldest = ts;
      if (newest == null || ts > newest) newest = ts;
    }
  }

  return {
    photos,
    videos,
    texts,
    capsulesWithMedia,
    owners: [...owners.values()].sort((a, b) => b.photos + b.videos - (a.photos + a.videos)),
    places: [...places].slice(0, 60),
    oldest: oldest != null ? new Date(oldest).toISOString() : null,
    newest: newest != null ? new Date(newest).toISOString() : null,
  };
}

export function totalMediaCount(index: MediaLibraryIndex): number {
  return index.photos + index.videos;
}

/** Запрос требует прохода по всей медиатеке? */
export function isHeavyMediaQuery(text: string, index: MediaLibraryIndex): boolean {
  if (totalMediaCount(index) < HEAVY_SCAN_THRESHOLD) return false;
  return /(фото|видео|снимк|кадр|媒|медиа|галере|архив|альбом|карточк|все\s+мои|найди|поищ|собери|подбор|отсортируй|просмотр)/i.test(
    text
  );
}

function ruPlural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

/** Шутливое подтверждение перед тяжёлым сканом. */
export function buildScanConfirmation(index: MediaLibraryIndex): string {
  const { photos, videos } = index;
  const photoWord = ruPlural(photos, 'фото', 'фото', 'фото');
  const videoWord = ruPlural(videos, 'видео', 'видео', 'видео');
  const family = index.owners.length;
  const familyNote =
    family > 1
      ? ` Причём раскидано это по ${family} ${ruPlural(family, 'аккаунту', 'аккаунтам', 'аккаунтам')}.`
      : '';
  return (
    `Ого, шеф. ${photos} ${photoWord} и ${videos} ${videoWord}.${familyNote} ` +
    'Ты уверен, что переварим это прямо сейчас? Я-то железный, а вот твой трафик — не очень.'
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('ru-RU', {
      year: 'numeric',
      month: 'long',
    });
  } catch {
    return iso.slice(0, 10);
  }
}

/** Блок медиатеки для system prompt. */
export function formatMediaLibraryBlock(index: MediaLibraryIndex): string {
  if (totalMediaCount(index) === 0 && index.texts === 0) {
    return '(медиатека семьи пуста — капсул с фото/видео нет)';
  }

  const lines = [
    `Всего медиа: ${index.photos} фото, ${index.videos} видео в ${index.capsulesWithMedia} капсулах (+${index.texts} текстовых).`,
    `Период съёмки: ${formatDate(index.oldest)} — ${formatDate(index.newest)}.`,
  ];

  if (index.owners.length > 0) {
    lines.push('Владельцы:');
    for (const o of index.owners.slice(0, 12)) {
      lines.push(`- ${o.label}: ${o.photos} фото, ${o.videos} видео`);
    }
  }

  if (index.places.length > 0) {
    lines.push(`Места и подписи: ${index.places.slice(0, 30).join('; ')}`);
  }

  return lines.join('\n');
}
