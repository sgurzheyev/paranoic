/**
 * Глобальный P2P-синглтон на время жизни вкладки.
 * Не привязан к монтированию Chat / ModeSelector — переживает навигацию.
 */

import { P2PConnection, type P2PHandlers } from './p2p';

let session: P2PConnection | null = null;

export function getP2PSession(): P2PConnection | null {
  return session;
}

/** Создать или обновить handlers у существующего соединения. */
export function ensureP2PSession(handlers: P2PHandlers): P2PConnection {
  if (!session) {
    session = new P2PConnection(handlers);
  } else {
    session.setHandlers(handlers);
  }
  return session;
}

/**
 * Явный разрыв (Hang Up / «Разорвать связь» / смена собеседника).
 * Навигация «Назад» сюда НЕ должна ходить.
 */
export function destroyP2PSession(): void {
  if (!session) return;
  try {
    session.close();
  } catch {
    /* */
  }
  session = null;
}

export function hasLiveP2PSession(): boolean {
  if (!session) return false;
  const s = session.currentStatus;
  return (
    s === 'connected' ||
    s === 'connecting' ||
    s === 'waiting-answer' ||
    s === 'creating-offer'
  );
}
