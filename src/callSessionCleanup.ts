/** Очистка зависших флагов P2P/комнаты в sessionStorage (не трогаем identity). */

const HOST_PREFIX = 'paranoic-host:';
const EPHEMERAL_GUEST_KEY = 'paranoic-ephemeral-guest';
const CALL_RESIDUE_KEY = 'paranoic-call-residue';

export type CallResidue = {
  peerId?: string;
  roomId?: string;
  guestPeerId?: string;
  at: number;
};

export function saveCallResidue(residue: Omit<CallResidue, 'at'>): void {
  try {
    const payload: CallResidue = { ...residue, at: Date.now() };
    sessionStorage.setItem(CALL_RESIDUE_KEY, JSON.stringify(payload));
  } catch {
    /* */
  }
}

export function readCallResidue(): CallResidue | null {
  try {
    const raw = sessionStorage.getItem(CALL_RESIDUE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CallResidue;
  } catch {
    return null;
  }
}

/** Только residue/ephemeral — не трогает legacy host-флаги комнат. */
export function clearCallResidueState(): void {
  try {
    sessionStorage.removeItem(CALL_RESIDUE_KEY);
    sessionStorage.removeItem(EPHEMERAL_GUEST_KEY);
  } catch {
    /* */
  }
}

/** Полная очистка: residue + ephemeral + legacy host-флаги (выход / ошибка связи). */
export function clearCallSessionResidue(): void {
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (!key) continue;
      if (key.startsWith(HOST_PREFIX) || key === CALL_RESIDUE_KEY || key === EPHEMERAL_GUEST_KEY) {
        toRemove.push(key);
      }
    }
    for (const key of toRemove) sessionStorage.removeItem(key);
  } catch {
    /* */
  }
}

/**
 * Временный guest id для второго устройства с тем же аккаунтом (опционально).
 * Не подменяет постоянный identity в localStorage.
 */
export function getOrCreateEphemeralGuestId(): string {
  try {
    const existing = sessionStorage.getItem(EPHEMERAL_GUEST_KEY);
    if (existing) return existing;
    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `guest-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(EPHEMERAL_GUEST_KEY, id);
    return id;
  } catch {
    return `guest-${Date.now()}`;
  }
}

export function clearEphemeralGuestId(): void {
  try {
    sessionStorage.removeItem(EPHEMERAL_GUEST_KEY);
  } catch {
    /* */
  }
}
