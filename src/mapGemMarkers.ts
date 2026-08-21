import type { MapGem } from './mapGems';
import { gemMapPreviewUrl } from './mapGems';
import { configureGemImageElement, createGemFallbackElement } from './gemImage';

/** Кастомный HTML-маркер капсулы: превью thumb / media_url. */
export function buildGemMarkerElement(gem: MapGem, onOpen: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'map-gem-marker';
  btn.setAttribute('aria-label', gem.content?.trim() || 'Memory Gem');
  btn.title = gem.content?.trim() || 'Memory Gem';
  btn.style.touchAction = 'manipulation';

  const preview = gemMapPreviewUrl(gem);
  if (preview && gem.type !== 'text') {
    const img = document.createElement('img');
    img.src = preview;
    img.alt = '';
    img.draggable = false;
    img.className = 'map-gem-marker-img';
    img.loading = 'lazy';
    configureGemImageElement(img, 'map-gem-marker-fallback');
    btn.appendChild(img);
  } else {
    btn.appendChild(createGemFallbackElement('map-gem-marker-fallback'));
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
