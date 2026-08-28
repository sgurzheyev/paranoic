/** Запись видео-кружочков и голосовых заметок (MediaRecorder). */

import { getUserMediaStrict, toMediaAccessError } from './mediaPermissions';

export type NoteMode = 'voice' | 'video';
export type MediaKind = 'file' | 'circle' | 'voice';

export const MAX_NOTE_MS = 60_000;
export const MIN_NOTE_MS = 450;

export function inferMediaKind(name?: string, mime?: string): MediaKind {
  const n = (name || '').toLowerCase();
  if (n.startsWith('circle-') || n.includes('circle-')) return 'circle';
  if (n.startsWith('voice-') || n.includes('voice-')) return 'voice';
  if (mime?.startsWith('audio/')) return 'voice';
  return 'file';
}

export function pickRecorderMime(mode: NoteMode): string {
  const candidates =
    mode === 'video'
      ? [
          'video/mp4',
          'video/webm;codecs=vp8,opus',
          'video/webm;codecs=vp9,opus',
          'video/webm',
        ]
      : ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'];

  for (const mime of candidates) {
    if (
      typeof MediaRecorder !== 'undefined' &&
      MediaRecorder.isTypeSupported(mime)
    ) {
      return mime;
    }
  }
  return mode === 'video' ? 'video/webm' : 'audio/webm';
}

export function extensionForMime(mime: string): string {
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('ogg')) return 'ogg';
  return 'webm';
}

export async function openNoteStream(mode: NoteMode): Promise<MediaStream> {
  try {
    if (mode === 'video') {
      return await getUserMediaStrict({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: {
          facingMode: 'user',
          width: { ideal: 480 },
          height: { ideal: 480 },
          frameRate: { ideal: 24, max: 30 },
        },
      });
    }
    return await getUserMediaStrict({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
  } catch (e) {
    throw toMediaAccessError(e);
  }
}

export function stopStream(stream: MediaStream | null | undefined): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.enabled = false;
    } catch {
      /* */
    }
    try {
      track.stop();
    } catch {
      /* */
    }
    try {
      stream.removeTrack(track);
    } catch {
      /* */
    }
  }
}

export type NoteRecording = {
  file: File;
  mediaKind: 'circle' | 'voice';
  durationMs: number;
};

export type NoteRecorderSession = {
  /** Корректно завершить запись (для отправки). */
  stop: () => void;
  /** Прервать без полезных данных. */
  cancel: () => void;
  result: Promise<NoteRecording | null>;
};

/**
 * Запись MediaRecorder до stop()/cancel()/max duration.
 * `onTick` — прогресс 0..1.
 */
export function recordMediaNote(
  stream: MediaStream,
  mode: NoteMode,
  options?: {
    onTick?: (ratio: number, elapsedMs: number) => void;
    signal?: AbortSignal;
  }
): NoteRecorderSession {
  const mime = pickRecorderMime(mode);
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType: mime });
  } catch {
    recorder = new MediaRecorder(stream);
  }

  const chunks: BlobPart[] = [];
  const startedAt = Date.now();
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  let maxTimer: ReturnType<typeof setTimeout> | null = null;
  let settled = false;
  let discarded = false;

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const cleanupTimers = () => {
    if (tickTimer != null) clearInterval(tickTimer);
    if (maxTimer != null) clearTimeout(maxTimer);
    tickTimer = null;
    maxTimer = null;
  };

  const safeStop = () => {
    try {
      if (recorder.state === 'recording' || recorder.state === 'paused') {
        recorder.stop();
      }
    } catch {
      /* */
    }
  };

  const hardStopRecorder = () => {
    cleanupTimers();
    try {
      if (recorder.state !== 'inactive') {
        recorder.stop();
      }
    } catch {
      try {
        recorder.stop();
      } catch {
        /* */
      }
    }
  };

  let settle: ((value: NoteRecording | null) => void) | null = null;

  const finish = (value: NoteRecording | null) => {
    cleanupTimers();
    if (settled) return;
    settled = true;
    settle?.(value);
  };

  const stopTimeout = (ms: number) => {
    window.setTimeout(() => {
      if (settled) return;
      if (discarded) {
        finish(null);
        return;
      }
      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_NOTE_MS || chunks.length === 0) {
        finish(null);
        return;
      }
      const type = (recorder.mimeType || mime).split(';')[0] || mime;
      const blob = new Blob(chunks, { type });
      if (blob.size < 32) {
        finish(null);
        return;
      }
      const ext = extensionForMime(type);
      const mediaKind = mode === 'video' ? 'circle' : 'voice';
      const name =
        mode === 'video' ? `circle-${Date.now()}.${ext}` : `voice-${Date.now()}.${ext}`;
      finish({
        file: new File([blob], name, { type: blob.type || type }),
        mediaKind,
        durationMs: elapsed,
      });
    }, ms);
  };

  const requestStop = () => {
    cleanupTimers();
    try {
      if (recorder.state === 'recording') recorder.requestData();
    } catch {
      /* */
    }
    safeStop();
    stopTimeout(900);
  };

  const result = new Promise<NoteRecording | null>((resolve) => {
    settle = resolve;

    recorder.onstop = () => {
      if (discarded) {
        finish(null);
        return;
      }
      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_NOTE_MS || chunks.length === 0) {
        finish(null);
        return;
      }
      const type = (recorder.mimeType || mime).split(';')[0] || mime;
      const blob = new Blob(chunks, { type });
      if (blob.size < 32) {
        finish(null);
        return;
      }
      const ext = extensionForMime(type);
      const mediaKind = mode === 'video' ? 'circle' : 'voice';
      const name =
        mode === 'video' ? `circle-${Date.now()}.${ext}` : `voice-${Date.now()}.${ext}`;
      const file = new File([blob], name, { type: blob.type || type });
      finish({ file, mediaKind, durationMs: elapsed });
    };

    recorder.onerror = () => {
      discarded = true;
      finish(null);
    };

    const onAbort = () => {
      discarded = true;
      chunks.length = 0;
      hardStopRecorder();
      stopTimeout(200);
    };

    if (options?.signal) {
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener('abort', onAbort, { once: true });
    }
  });

  // iOS/Safari часто ломается на timeslice — пробуем без него при ошибке.
  try {
    recorder.start(250);
  } catch {
    try {
      recorder.start();
    } catch {
      discarded = true;
      cleanupTimers();
      return {
        stop: () => undefined,
        cancel: () => undefined,
        result: Promise.resolve(null),
      };
    }
  }

  tickTimer = setInterval(() => {
    const elapsed = Date.now() - startedAt;
    options?.onTick?.(Math.min(1, elapsed / MAX_NOTE_MS), elapsed);
    if (elapsed >= MAX_NOTE_MS) requestStop();
  }, 100);

  maxTimer = setTimeout(() => requestStop(), MAX_NOTE_MS + 50);

  return {
    stop: () => {
      requestStop();
    },
    cancel: () => {
      discarded = true;
      chunks.length = 0;
      hardStopRecorder();
      stopTimeout(200);
    },
    result,
  };
}
