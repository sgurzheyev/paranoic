/** Настройки локального LLM (Ollama / LM Studio). */

export type AiSettings = {
  /** Полный URL endpoint generate, напр. http://localhost:11434/api/generate */
  apiUrl: string;
  /** Имя модели, напр. llama3 */
  model: string;
};

const STORAGE_KEY = 'paranoic-ai-settings-v1';

export const DEFAULT_AI_SETTINGS: AiSettings = {
  apiUrl: 'http://localhost:11434/api/generate',
  model: 'llama3',
};

export function loadAiSettings(): AiSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_AI_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AiSettings>;
    return {
      apiUrl: (parsed.apiUrl || DEFAULT_AI_SETTINGS.apiUrl).trim() || DEFAULT_AI_SETTINGS.apiUrl,
      model: (parsed.model || DEFAULT_AI_SETTINGS.model).trim() || DEFAULT_AI_SETTINGS.model,
    };
  } catch {
    return { ...DEFAULT_AI_SETTINGS };
  }
}

export function saveAiSettings(patch: Partial<AiSettings>): AiSettings {
  const next: AiSettings = {
    ...loadAiSettings(),
    ...patch,
  };
  next.apiUrl = next.apiUrl.trim() || DEFAULT_AI_SETTINGS.apiUrl;
  next.model = next.model.trim() || DEFAULT_AI_SETTINGS.model;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export const BODYGUARD_SYSTEM_PROMPT =
  'Ты — параноидальный, циничный ИИ-телохранитель внутри зашифрованного мессенджера. Отвечай кратко, саркастично, приоритет — безопасность.';
