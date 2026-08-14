import { useEffect, useState } from 'react';

/** Shown whenever camera/mic is blocked or missing in an in-app / denied context. */
export const MEDIA_ACCESS_DENIED_MESSAGE =
  'Нет доступа к микрофону или камере. Откройте приложение в стандартном браузере (Chrome/Safari) и разрешите доступ.';

const ACCESS_ERROR_NAMES = new Set([
  'NotAllowedError',
  'PermissionDeniedError',
  'NotFoundError',
  'DevicesNotFoundError',
  'NotReadableError',
  'TrackStartError',
  'AbortError',
  'SecurityError',
  'OverconstrainedError',
  'TypeError',
]);

export type MediaDevicePresence = {
  apiAvailable: boolean;
  hasMic: boolean;
  hasCam: boolean;
  /** enumerateDevices returned at least one device (inventory is trustworthy). */
  inventoryReady: boolean;
};

export function isMediaApiAvailable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices) &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  );
}

export function isMediaAccessError(err: unknown): boolean {
  if (err == null) return false;
  if (typeof err === 'object') {
    const name = 'name' in err ? String((err as { name: unknown }).name) : '';
    const message = 'message' in err ? String((err as { message: unknown }).message) : '';
    if (message === MEDIA_ACCESS_DENIED_MESSAGE) return true;
    if (ACCESS_ERROR_NAMES.has(name)) return true;
    if (
      /permission|not allowed|denied|could not start|requested device not found|mediaDevices|getUserMedia/i.test(
        message
      )
    ) {
      return true;
    }
  }
  return false;
}

function isMissingDeviceError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = 'name' in err ? String((err as { name: unknown }).name) : '';
  return name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError';
}

export function toMediaAccessError(err?: unknown): Error {
  const e = new Error(MEDIA_ACCESS_DENIED_MESSAGE);
  if (err && typeof err === 'object' && 'name' in err) {
    e.name = String((err as { name: unknown }).name) || 'NotAllowedError';
  } else {
    e.name = 'NotAllowedError';
  }
  return e;
}

export function mediaErrorMessage(err: unknown, fallback: string): string {
  if (!isMediaApiAvailable() || isMediaAccessError(err)) {
    return MEDIA_ACCESS_DENIED_MESSAGE;
  }
  return err instanceof Error && err.message ? err.message : fallback;
}

function stopTracks(stream: MediaStream | null | undefined): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      /* */
    }
  }
}

export async function getUserMediaStrict(
  constraints: MediaStreamConstraints
): Promise<MediaStream> {
  if (!isMediaApiAvailable()) {
    throw toMediaAccessError();
  }
  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    if (isMediaAccessError(err)) throw toMediaAccessError(err);
    throw err;
  }
}

/**
 * Permission / device check for outgoing calls: request then release tracks
 * so the camera LED is not left on while ringing.
 */
export async function ensureCallMediaAccess(): Promise<void> {
  if (!isMediaApiAvailable()) {
    throw toMediaAccessError();
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
  } catch (err) {
    if (isMissingDeviceError(err)) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch (err2) {
        throw isMediaAccessError(err2) ? toMediaAccessError(err2) : err2;
      }
    } else if (isMediaAccessError(err)) {
      throw toMediaAccessError(err);
    } else {
      throw err;
    }
  }
  stopTracks(stream);
}

export async function getUserMediaForCall(
  constraints: MediaStreamConstraints
): Promise<MediaStream> {
  if (!isMediaApiAvailable()) {
    throw toMediaAccessError();
  }
  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    if (isMissingDeviceError(err) && constraints.video) {
      try {
        return await navigator.mediaDevices.getUserMedia({
          audio: constraints.audio ?? true,
          video: false,
        });
      } catch (err2) {
        throw isMediaAccessError(err2) ? toMediaAccessError(err2) : err2;
      }
    }
    if (isMediaAccessError(err)) throw toMediaAccessError(err);
    throw err;
  }
}

export async function probeMediaDevicePresence(): Promise<MediaDevicePresence> {
  if (!isMediaApiAvailable()) {
    return { apiAvailable: false, hasMic: false, hasCam: false, inventoryReady: true };
  }
  if (typeof navigator.mediaDevices.enumerateDevices !== 'function') {
    return { apiAvailable: true, hasMic: true, hasCam: true, inventoryReady: false };
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const hasMic = devices.some((d) => d.kind === 'audioinput');
    const hasCam = devices.some((d) => d.kind === 'videoinput');
    return {
      apiAvailable: true,
      hasMic,
      hasCam,
      inventoryReady: devices.length > 0,
    };
  } catch {
    return { apiAvailable: true, hasMic: true, hasCam: true, inventoryReady: false };
  }
}

export function isCallMediaBlocked(p: MediaDevicePresence): boolean {
  if (!p.apiAvailable) return true;
  if (p.inventoryReady && !p.hasMic) return true;
  return false;
}

export function isRecordMediaBlocked(p: MediaDevicePresence, video: boolean): boolean {
  if (!p.apiAvailable) return true;
  if (!p.inventoryReady) return false;
  if (video) return !p.hasCam || !p.hasMic;
  return !p.hasMic;
}

export function useMediaDevicePresence(): MediaDevicePresence {
  const [presence, setPresence] = useState<MediaDevicePresence>(() => ({
    apiAvailable: isMediaApiAvailable(),
    hasMic: isMediaApiAvailable(),
    hasCam: isMediaApiAvailable(),
    inventoryReady: !isMediaApiAvailable(),
  }));

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void probeMediaDevicePresence().then((next) => {
        if (!cancelled) setPresence(next);
      });
    };
    refresh();
    const md = navigator.mediaDevices;
    md?.addEventListener?.('devicechange', refresh);
    return () => {
      cancelled = true;
      md?.removeEventListener?.('devicechange', refresh);
    };
  }, []);

  return presence;
}
