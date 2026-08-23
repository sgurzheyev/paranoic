/** Локальные настройки приложения (приватность, уведомления, язык). */

export type AppLanguage = 'ru' | 'en';

export type AppSettings = {
  /** Скрыть реальный GPS — Presence шлёт Антарктиду. */
  ghostMode: boolean;
  /** Удалять сообщения старше 24 часов из IndexedDB. */
  ephemeral24h: boolean;
  /** Локальные push / звуки входящих. */
  notificationsEnabled: boolean;
  /** Показывать текст превью в уведомлении. */
  notificationPreview: boolean;
  /** Снизить анимации и фон-активность. */
  powerSaving: boolean;
  /** Язык интерфейса. */
  language: AppLanguage;
};

const STORAGE_KEY = 'paranoic-settings-v1';

const DEFAULTS: AppSettings = {
  ghostMode: false,
  ephemeral24h: false,
  notificationsEnabled: true,
  notificationPreview: true,
  powerSaving: false,
  language: 'ru',
};

function normalizeLanguage(raw: unknown): AppLanguage {
  return raw === 'en' ? 'en' : 'ru';
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      ghostMode: Boolean(parsed.ghostMode),
      ephemeral24h: Boolean(parsed.ephemeral24h),
      notificationsEnabled:
        parsed.notificationsEnabled == null
          ? DEFAULTS.notificationsEnabled
          : Boolean(parsed.notificationsEnabled),
      notificationPreview:
        parsed.notificationPreview == null
          ? DEFAULTS.notificationPreview
          : Boolean(parsed.notificationPreview),
      powerSaving: Boolean(parsed.powerSaving),
      language: normalizeLanguage(parsed.language),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...loadSettings(), ...patch };
  if (patch.language != null) next.language = normalizeLanguage(patch.language);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  applySettingsSideEffects(next);
  return next;
}

/** Применить побочные эффекты (lang, класс энергосбережения). */
export function applySettingsSideEffects(settings: AppSettings = loadSettings()): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = settings.language;
  document.documentElement.classList.toggle('power-saving', settings.powerSaving);
  document.body.classList.toggle('power-saving', settings.powerSaving);
}
