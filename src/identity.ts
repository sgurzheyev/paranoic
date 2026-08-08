/** Постоянная личность пользователя + магическая ссылка. */

export type UserIdentity = {
  id: string;
  name: string;
  /** CSS-цвет запасного аватара (если нет фото). */
  color: string;
  /** Публичный URL аватара (Supabase Storage или локальный data URL). */
  avatarUrl: string;
  /** Фон интерфейса: CSS color или gradient. */
  themeFon: string;
};

const STORAGE_KEY = 'paranoic-identity-v1';

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
    id: 'night',
    label: 'Ночь',
    value:
      'radial-gradient(1200px 600px at 10% -10%, rgba(94, 234, 212, 0.12), transparent 55%), radial-gradient(900px 500px at 100% 0%, rgba(96, 165, 250, 0.1), transparent 50%), #12141c',
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
  {
    id: 'violet',
    label: 'Сумерки',
    value: 'linear-gradient(165deg, #12101a 0%, #2a1f45 48%, #151822 100%)',
  },
  {
    id: 'forest',
    label: 'Лес',
    value: 'linear-gradient(165deg, #0d1410 0%, #1a3324 50%, #101816 100%)',
  },
  {
    id: 'slate',
    label: 'Сталь',
    value: 'linear-gradient(180deg, #1e2330 0%, #12151c 100%)',
  },
];

export const DEFAULT_THEME_FON = THEME_FON_PRESETS[0]!.value;

function randomId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  }
  return Math.random().toString(36).slice(2, 14);
}

function randomColor(): string {
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]!;
}

function normalizeIdentity(raw: Partial<UserIdentity> & { id: string; name: string }): UserIdentity {
  return {
    id: raw.id,
    name: raw.name,
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
        localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
        return normalized;
      }
    }
  } catch {
    /* */
  }

  const identity: UserIdentity = {
    id: randomId(),
    name: 'Я',
    color: randomColor(),
    avatarUrl: '',
    themeFon: DEFAULT_THEME_FON,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  return identity;
}

export function updateIdentity(
  patch: Partial<Pick<UserIdentity, 'name' | 'color' | 'avatarUrl' | 'themeFon'>>
): UserIdentity {
  const current = getOrCreateIdentity();
  const next = normalizeIdentity({ ...current, ...patch });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

/** Магическая ссылка: ?u=<id> */
export function buildMagicLink(userId: string): string {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('u', userId);
  return url.toString();
}

export function getMagicTargetFromUrl(): string | null {
  const u = new URLSearchParams(window.location.search).get('u');
  return u?.trim() || null;
}

/**
 * Роутинг магической ссылки:
 * - guest: ?u=чужой_id → открываем диалог с этим пользователем
 * - self:  ?u=мой_id → свой профиль / инбокс
 * - host:  нет ?u → свой инбокс
 */
export type MagicRoute =
  | { kind: 'guest'; peerId: string }
  | { kind: 'self' }
  | { kind: 'host' };

export function resolveMagicRoute(currentUserId: string): MagicRoute {
  const target = getMagicTargetFromUrl();
  if (!target) return { kind: 'host' };
  if (target === currentUserId) return { kind: 'self' };
  return { kind: 'guest', peerId: target };
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
