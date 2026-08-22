import type { MapGem } from './mapGems';
import { gemMapPreviewUrl } from './mapGems';
import { configureGemImageElement, createGemFallbackElement } from './gemImage';

const CAMERA_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/></svg>';

const VIDEO_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 8-6 4 6 4V8z"/><rect x="2" y="6" width="14" height="12" rx="2"/></svg>';

/**
 * Кастомный HTML-маркер капсулы: круглое превью фото/видео
 * в тонкой золотой рамке + мягкое «дыхание» вместо резкого пульса.
 */
export function buildGemMarkerElement(gem: MapGem, onOpen: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'map-gem-marker';
  btn.setAttribute('aria-label', gem.content?.trim() || 'Memory Gem');
  btn.title = gem.content?.trim() || 'Memory Gem';
  btn.style.touchAction = 'manipulation';

  const frame = document.createElement('span');
  frame.className = 'map-gem-marker-frame';

  const preview = gemMapPreviewUrl(gem);
  const hasMedia = Boolean(preview) && gem.type !== 'text';

  if (hasMedia) {
    btn.classList.add('has-media');
    const img = document.createElement('img');
    img.src = preview!;
    img.alt = '';
    img.draggable = false;
    img.className = 'map-gem-marker-img';
    img.loading = 'lazy';
    configureGemImageElement(img, 'map-gem-marker-fallback');
    frame.appendChild(img);
  } else {
    frame.appendChild(createGemFallbackElement('map-gem-marker-fallback'));
  }

  btn.appendChild(frame);

  if (hasMedia) {
    const badge = document.createElement('span');
    badge.className = 'map-gem-marker-badge';
    badge.setAttribute('aria-hidden', 'true');
    badge.innerHTML = gem.type === 'video' ? VIDEO_SVG : CAMERA_SVG;
    btn.appendChild(badge);
  }

  const ring = document.createElement('span');
  ring.className = 'map-gem-marker-ring';
  ring.setAttribute('aria-hidden', 'true');
  btn.appendChild(ring);

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onOpen();
  });

  return btn;
}
