import type { MapGem } from './mapGems';

/** Кастомный HTML-маркер капсулы: превью media_urls[0] / media_url. */
export function buildGemMarkerElement(gem: MapGem, onOpen: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'map-gem-marker';
  btn.setAttribute('aria-label', gem.content?.trim() || 'Memory Gem');
  btn.title = gem.content?.trim() || 'Memory Gem';
  btn.style.touchAction = 'manipulation';

  if (gem.media_url && gem.type !== 'text') {
    const img = document.createElement('img');
    img.src = gem.media_url;
    img.alt = '';
    img.draggable = false;
    img.className = 'map-gem-marker-img';
    img.loading = 'lazy';
    btn.appendChild(img);
  } else {
    const fallback = document.createElement('span');
    fallback.className = 'map-gem-marker-fallback';
    fallback.textContent = '💎';
    btn.appendChild(fallback);
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
