/** Счётчики просмотров медиа-архива профиля (локально). */

const STORAGE_KEY = 'paranoic-media-views-v1';

function loadMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const n = typeof v === 'number' ? v : Number(v);
      if (Number.isFinite(n) && n >= 0) out[k] = Math.floor(n);
    }
    return out;
  } catch {
    return {};
  }
}

function saveMap(map: Record<string, number>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

export function getMediaViewCount(id: string): number {
  return loadMap()[id] ?? 0;
}

export function getMediaViewCounts(ids: string[]): Record<string, number> {
  const map = loadMap();
  const out: Record<string, number> = {};
  for (const id of ids) out[id] = map[id] ?? 0;
  return out;
}

export function bumpMediaViewCount(id: string): number {
  if (!id) return 0;
  const map = loadMap();
  const next = (map[id] ?? 0) + 1;
  map[id] = next;
  saveMap(map);
  return next;
}
