export const GEM_IMAGE_FALLBACK = '💎';

export const gemImageProps = {
  referrerPolicy: 'no-referrer' as const,
  crossOrigin: 'anonymous' as const,
};

export function createGemFallbackElement(className = 'memory-gem-media-fallback'): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = GEM_IMAGE_FALLBACK;
  el.setAttribute('aria-hidden', 'true');
  return el;
}

/** Настройка динамически созданного <img> для memory_gems / map_gems. */
export function configureGemImageElement(
  img: HTMLImageElement,
  fallbackClass = 'map-gem-marker-fallback'
): void {
  img.referrerPolicy = 'no-referrer';
  img.crossOrigin = 'anonymous';
  img.dataset.fallbackClass = fallbackClass;
  img.addEventListener('error', () => swapGemImageForFallback(img), { once: true });
}

export function swapGemImageForFallback(img: HTMLImageElement): void {
  const parent = img.parentElement;
  if (!parent) return;
  const fallbackClass = img.dataset.fallbackClass || 'memory-gem-media-fallback';
  img.replaceWith(createGemFallbackElement(fallbackClass));
}
