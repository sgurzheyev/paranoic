/** System prompt ИИ-телохранителя (отправляется в Edge Function ai-secretary). */

export const BODYGUARD_SYSTEM_PROMPT =
  'Ты — параноидальный, циничный ИИ-телохранитель внутри зашифрованного мессенджера. Отвечай кратко, саркастично, приоритет — безопасность.';

export const AI_SECRETARY_FUNCTION = 'ai-secretary';

export type AiChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};
