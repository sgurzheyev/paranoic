/** Постоянная личность пользователя + магическая ссылка. */

export type UserIdentity = {
  id: string;
  name: string;
  /** Короткий публичный handle для ?u=username (опционально). */
  username: string;
  /** CSS-цвет запасного аватара (если нет фото). */
  color: string;
  /** Публичный URL аватара (Supabase Storage или локальный data URL). */
  avatarUrl: string;
  /** Фон интерфейса: CSS color или gradient. */
  themeFon: string;
};

const STORAGE_KEY = 'paranoic-identity-v1';

/** 3–24 символа: латиница/цифры/_, начинается с буквы. */
export const USERNAME_PATTERN = /^[a-z][a-z0-9_]{2,23}$/;

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
}

export function validateUsername(
  raw: string
): { ok: true; value: string } | { ok: false; error: string } {
  const value = normalizeUsername(raw);
  if (!value) return { ok: true, value: '' }; // пустой = без username
  if (!USERNAME_PATTERN.test(value)) {
    return {
      ok: false,
      error: 'Username: 3–24 символа, латиница/цифры/_, с буквы (например gurgini)',
    };
  }
  return { ok: true, value };
}

export function looksLikeUsername(handle: string): boolean {
  const v = handle.trim().toLowerCase();
  return USERNAME_PATTERN.test(v);
}

const AVATAR_COLORS = [
  '#34d399',
  '#60a5fa',
  '#fbbf24',
  '#f472b6',
  '#a78bfa',
  '#fb7185',
  '#2dd4bf',
  '#f97316',
];

/** Пресеты фона для выбора в профиле. */
export const THEME_FON_PRESETS: { id: string; label: string; value: string }[] = [
  {
    id: 'sequoia',
    label: 'Sequoia',
    value:
      'radial-gradient(900px 520px at 18% -8%, rgba(180, 190, 210, 0.14), transparent 55%), radial-gradient(800px 480px at 92% 8%, rgba(140, 150, 170, 0.1), transparent 50%), linear-gradient(180deg, #14161c 0%, #0a0b0e 100%)',
  },
  {
    id: 'silver',
    label: 'Серебро',
    value: 'linear-gradient(165deg, #1c1e24 0%, #2a2d36 42%, #12141a 100%)',
  },
  {
    id: 'graphite',
    label: 'Графит',
    value: 'linear-gradient(180deg, #1a1b20 0%, #0e0f12 100%)',
  },
  {
    id: 'mist',
    label: 'Туман',
    value: 'linear-gradient(165deg, #1a1d24 0%, #252a33 48%, #12151a 100%)',
  },
  {
    id: 'ocean',
    label: 'Океан',
    value: 'linear-gradient(165deg, #0b1220 0%, #0e3a4a 42%, #082f28 100%)',
  },
  {
    id: 'ember',
    label: 'Тлеющий',
    value: 'linear-gradient(165deg, #1a1210 0%, #3b1d18 45%, #1c1412 100%)',
  },
];

export const DEFAULT_THEME_FON = THEME_FON_PRESETS[0]!.value;

/** UUID v4 (с дефисами) — формат, который принимает Postgres `uuid`. */
const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUuid(id: string): boolean {
  return UUID_V4_RE.test(id.trim());
}

/** Полноценный UUID v4 для profiles.id / author_id (не короткие срезы). */
export function createUserId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback без crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const n = (Math.random() * 16) | 0;
    const v = ch === 'x' ? n : (n & 0x3) | 0x8;
    return v.toString(16);
  });
}

function randomColor(): string {
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]!;
}

function normalizeIdentity(raw: Partial<UserIdentity> & { id: string; name: string }): UserIdentity {
  const usernameRaw = typeof raw.username === 'string' ? raw.username : '';
  const usernameCheck = validateUsername(usernameRaw);
  const id = isValidUuid(raw.id) ? raw.id.trim() : createUserId();
  return {
    id,
    name: raw.name,
    username: usernameCheck.ok ? usernameCheck.value : '',
    color: raw.color || randomColor(),
    avatarUrl: typeof raw.avatarUrl === 'string' ? raw.avatarUrl : '',
    themeFon: typeof raw.themeFon === 'string' && raw.themeFon ? raw.themeFon : DEFAULT_THEME_FON,
  };
}

export function getOrCreateIdentity(): UserIdentity {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<UserIdentity>;
      if (parsed?.id && parsed?.name) {
        const normalized = normalizeIdentity(parsed as UserIdentity);
        // Миграция: старые короткие id (напр. "b0ffd8eb4633") → UUID v4.
        localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
        return normalized;
      }
    }
  } catch {
    /* */
  }

  const identity: UserIdentity = {
    id: createUserId(),
    name: 'Я',
    username: '',
    color: randomColor(),
    avatarUrl: '',
    themeFon: DEFAULT_THEME_FON,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  return identity;
}

export function updateIdentity(
  patch: Partial<Pick<UserIdentity, 'name' | 'username' | 'color' | 'avatarUrl' | 'themeFon'>>
): UserIdentity {
  const current = getOrCreateIdentity();
  const next = normalizeIdentity({ ...current, ...patch });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

/** Магическая ссылка: коротко ?u=username, иначе ?u=id */
export function buildMagicLink(identityOrHandle: UserIdentity | string): string {
  const handle =
    typeof identityOrHandle === 'string'
      ? identityOrHandle
      : identityOrHandle.username
        ? identityOrHandle.username
        : identityOrHandle.id;
  return `${window.location.origin}/?u=${encodeURIComponent(handle)}`;
}

export function getMagicTargetFromUrl(): string | null {
  const u = new URLSearchParams(window.location.search).get('u');
  return u?.trim() || null;
}

/**
 * Роутинг магической ссылки:
 * - guest: ?u=чужой_id|username → диалог с этим пользователем
 * - self:  ?u=мой_id|мой_username → свой профиль / инбокс
 * - host:  нет ?u → свой инбокс
 */
export type MagicRoute =
  | { kind: 'guest'; peerId: string }
  | { kind: 'self' }
  | { kind: 'host' };

/** Синхронный черновой роут (без lookup username → id). */
export function resolveMagicRoute(currentUserId: string, currentUsername = ''): MagicRoute {
  const target = getMagicTargetFromUrl();
  if (!target) return { kind: 'host' };
  const t = target.trim();
  if (t === currentUserId) return { kind: 'self' };
  if (currentUsername && t.toLowerCase() === currentUsername.toLowerCase()) {
    return { kind: 'self' };
  }
  return { kind: 'guest', peerId: t };
}

export function clearMagicParamFromUrl(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('u')) return;
  url.searchParams.delete('u');
  const qs = url.searchParams.toString();
  history.replaceState(null, '', `${url.pathname}${qs ? `?${qs}` : ''}`);
}

/** Канал личного инбокса пользователя (постоянная «комната»). */
export function personalInboxRoom(userId: string): string {
  return `inbox-${userId}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}
