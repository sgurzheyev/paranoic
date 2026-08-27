import { applyThemeSpectrum, snapThemeSpectrum, themeSpectrumFromSettings } from './themeSpectrum';

export type AppLanguage =
  | 'en'
  | 'ru'
  | 'pl'
  | 'es'
  | 'fr'
  | 'de'
  | 'zh'
  | 'pt'
  | 'ar'
  | 'ua';

export type AppLanguageOption = {
  id: AppLanguage;
  label: string;
  /** Unicode flag emoji. */
  flag: string;
  /** BCP 47 tag for document.documentElement.lang */
  locale: string;
};

/** Top 10 interface languages (ordered for the picker). */
export const APP_LANGUAGES: AppLanguageOption[] = [
  { id: 'en', label: 'English', flag: '🇬🇧', locale: 'en' },
  { id: 'ru', label: 'Русский', flag: '🇷🇺', locale: 'ru' },
  { id: 'pl', label: 'Polski', flag: '🇵🇱', locale: 'pl' },
  { id: 'es', label: 'Español', flag: '🇪🇸', locale: 'es' },
  { id: 'fr', label: 'Français', flag: '🇫🇷', locale: 'fr' },
  { id: 'de', label: 'Deutsch', flag: '🇩🇪', locale: 'de' },
  { id: 'zh', label: '中文', flag: '🇨🇳', locale: 'zh-CN' },
  { id: 'pt', label: 'Português', flag: '🇵🇹', locale: 'pt' },
  { id: 'ar', label: 'العربية', flag: '🇸🇦', locale: 'ar' },
  { id: 'ua', label: 'Українська', flag: '🇺🇦', locale: 'uk' },
];

const LEGACY_LANGUAGE_ALIASES: Record<string, AppLanguage> = {
  uk: 'ua',
  it: 'en',
  tr: 'en',
  ja: 'en',
  ko: 'en',
};

const LANGUAGE_IDS = new Set<string>(APP_LANGUAGES.map((l) => l.id));

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
  /** Zip Lift theme position 0–100. */
  themeSpectrum: number;
};

const STORAGE_KEY = 'paranoic-settings-v1';

const DEFAULTS: AppSettings = {
  ghostMode: false,
  ephemeral24h: false,
  notificationsEnabled: true,
  notificationPreview: true,
  powerSaving: false,
  language: 'en',
  themeSpectrum: 0,
};

export function normalizeLanguage(raw: unknown): AppLanguage {
  if (typeof raw === 'string') {
    if (LANGUAGE_IDS.has(raw)) return raw as AppLanguage;
    const legacy = LEGACY_LANGUAGE_ALIASES[raw];
    if (legacy) return legacy;
  }
  return DEFAULTS.language;
}

export function languageLocale(code: AppLanguage): string {
  return APP_LANGUAGES.find((l) => l.id === code)?.locale ?? code;
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
      themeSpectrum:
        typeof parsed.themeSpectrum === 'number' && Number.isFinite(parsed.themeSpectrum)
          ? snapThemeSpectrum(Math.max(0, Math.min(100, Math.round(parsed.themeSpectrum))))
          : DEFAULTS.themeSpectrum,
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
  const locale = languageLocale(settings.language);
  document.documentElement.lang = locale;
  document.documentElement.dir = settings.language === 'ar' ? 'rtl' : 'ltr';
  applyThemeSpectrum(themeSpectrumFromSettings(settings.themeSpectrum));
  document.documentElement.classList.toggle('power-saving', settings.powerSaving);
  document.body.classList.toggle('power-saving', settings.powerSaving);
}
