/** Локальные настройки приватности (Ghost Mode, эфемерный чат). */

export type AppSettings = {
  /** Скрыть реальный GPS — Presence шлёт Антарктиду. */
  ghostMode: boolean;
  /** Удалять сообщения старше 24 часов из IndexedDB. */
  ephemeral24h: boolean;
};

const STORAGE_KEY = 'paranoic-settings-v1';

const DEFAULTS: AppSettings = {
  ghostMode: false,
  ephemeral24h: false,
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      ghostMode: Boolean(parsed.ghostMode),
      ephemeral24h: Boolean(parsed.ephemeral24h),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...loadSettings(), ...patch };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}
