/** Комната для P2P mesh: короткий ID в query `?room=…`. */

export function getRoomIdFromUrl(): string | null {
  const room = new URLSearchParams(window.location.search).get('room');
  return room?.trim() || null;
}

export function generateRoomId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 10);
  }
  return Math.random().toString(36).slice(2, 12);
}

/** Берёт room из URL или создаёт новый и пишет в адресную строку. */
export function getOrCreateRoomId(): string {
  const existing = getRoomIdFromUrl();
  if (existing) return existing;

  const room = generateRoomId();
  const url = new URL(window.location.href);
  url.searchParams.set('room', room);
  history.replaceState(null, '', `${url.pathname}?${url.searchParams.toString()}`);
  return room;
}

export function buildRoomShareUrl(roomId: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set('room', roomId);
  url.hash = '';
  return url.toString();
}
