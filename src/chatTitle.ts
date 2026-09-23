/** Characters that render as a lone dot when a title is squeezed to a few pixels. */
const BULLET_ONLY = /^[\s•·∙⋅.\u2022\u2024\u2027\u00b7\u2219\u2026]+$/;

/**
 * Title shown in the open-chat header.
 * Empty labels and bullet-only placeholders (a collapsed ellipsis) use `fallback`.
 * Real names, including «#» and Cyrillic, are kept as typed.
 */
export function resolveChatTitle(label: string | null | undefined, fallback: string): string {
  const trimmed = (label ?? '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  if (!trimmed || BULLET_ONLY.test(trimmed)) return fallback;
  return trimmed;
}
