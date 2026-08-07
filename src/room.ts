/** Комната для P2P mesh: короткий ID в query `?room=…`. */

export type RoomResolve = {
  roomId: string;
  /** true — мы сгенерировали ID (хост/инициатор после join). */
  isHost: boolean;
};

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

function hostStorageKey(roomId: string): string {
  return `paranoic-host:${roomId}`;
}

/**
 * Берёт room из URL или создаёт новый.
 * Хост помечается в sessionStorage, чтобы после F5 с ?room= остаться инициатором.
 */
export function resolveRoom(): RoomResolve {
  const existing = getRoomIdFromUrl();
  if (existing) {
    const isHost = sessionStorage.getItem(hostStorageKey(existing)) === '1';
    return { roomId: existing, isHost };
  }

  const room = generateRoomId();
  sessionStorage.setItem(hostStorageKey(room), '1');
  const url = new URL(window.location.href);
  url.searchParams.set('room', room);
  history.replaceState(null, '', `${url.pathname}?${url.searchParams.toString()}`);
  return { roomId: room, isHost: true };
}

/** @deprecated используйте resolveRoom() */
export function getOrCreateRoomId(): string {
  return resolveRoom().roomId;
}

export function buildRoomShareUrl(roomId: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set('room', roomId);
  url.hash = '';
  return url.toString();
}
