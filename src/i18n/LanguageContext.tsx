import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  applySettingsSideEffects,
  languageLocale,
  loadSettings,
  normalizeLanguage,
  saveSettings,
  type AppLanguage,
} from '../settings';
import { DEFAULT_I18N_LOCALE, TRANSLATIONS } from './translations';
import type { I18nLocale } from './types';

type Vars = Record<string, string | number>;

type LanguageContextValue = {
  /** Предпочтение из настроек (ru / en / pl / …). */
  language: AppLanguage;
  /** Словарь: en | ru | pl (с fallback). */
  locale: I18nLocale;
  setLanguage: (language: AppLanguage) => void;
  t: (key: string, vars?: Vars) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

/** Map stored preference to a loaded translation dictionary. */
export function resolveI18nLocale(lang: AppLanguage): I18nLocale {
  return lang;
}

function getByPath(dict: unknown, path: string): string | undefined {
  const parts = path.split('.').filter(Boolean);
  let cur: unknown = dict;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === 'string' ? cur : undefined;
}

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const v = vars[name];
    return v == null ? `{${name}}` : String(v);
  });
}

export function translate(
  locale: I18nLocale,
  key: string,
  vars?: Vars
): string {
  const primary = getByPath(TRANSLATIONS[locale], key);
  if (primary) return interpolate(primary, vars);
  if (locale !== DEFAULT_I18N_LOCALE) {
    const fallback = getByPath(TRANSLATIONS[DEFAULT_I18N_LOCALE], key);
    if (fallback) return interpolate(fallback, vars);
  }
  return key;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>(() =>
    normalizeLanguage(loadSettings().language)
  );

  const locale = useMemo(() => resolveI18nLocale(language), [language]);

  const setLanguage = useCallback((next: AppLanguage) => {
    const normalized = normalizeLanguage(next);
    const saved = saveSettings({ language: normalized });
    setLanguageState(saved.language);
    applySettingsSideEffects(saved);
  }, []);

  const t = useCallback(
    (key: string, vars?: Vars) => translate(locale, key, vars),
    [locale]
  );

  const value = useMemo(
    () => ({ language, locale, setLanguage, t }),
    [language, locale, setLanguage, t]
  );

  return (
    <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useLanguage must be used within LanguageProvider');
  }
  return ctx;
}

/** Безопасный хук для мест вне провайдера (тесты / story) — English. */
export function useLanguageOptional(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (ctx) return ctx;
  return {
    language: 'en',
    locale: 'en',
    setLanguage: () => undefined,
    t: (key, vars) => translate('en', key, vars),
  };
}

export { languageLocale };
