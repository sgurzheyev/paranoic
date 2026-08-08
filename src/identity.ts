/** Постоянная личность пользователя + магическая ссылка. */

export type UserIdentity = {
  id: string;
  name: string;
  /** CSS-цвет аватара */
  color: string;
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

function randomId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  }
  return Math.random().toString(36).slice(2, 14);
}

function randomColor(): string {
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]!;
}

export function getOrCreateIdentity(): UserIdentity {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as UserIdentity;
      if (parsed?.id && parsed?.name) return parsed;
    }
  } catch {
    /* */
  }

  const identity: UserIdentity = {
    id: randomId(),
    name: 'Я',
    color: randomColor(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  return identity;
}

export function updateIdentity(patch: Partial<Pick<UserIdentity, 'name' | 'color'>>): UserIdentity {
  const current = getOrCreateIdentity();
  const next = { ...current, ...patch };
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
