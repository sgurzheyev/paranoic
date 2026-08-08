/** Запись видео-кружочков и голосовых заметок (MediaRecorder). */

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
          'video/webm;codecs=vp9,opus',
          'video/webm;codecs=vp8,opus',
          'video/webm',
          'video/mp4',
        ]
      : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];

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
  if (mode === 'video') {
    return navigator.mediaDevices.getUserMedia({
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
  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  });
}

export function stopStream(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
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

/**
 * Запись MediaRecorder до stop()/max duration.
 * `onTick` — прогресс 0..1.
 */
export function recordMediaNote(
  stream: MediaStream,
  mode: NoteMode,
  options?: {
    onTick?: (ratio: number, elapsedMs: number) => void;
    signal?: AbortSignal;
  }
): {
  stop: () => void;
  result: Promise<NoteRecording | null>;
} {
  const mime = pickRecorderMime(mode);
  const recorder = new MediaRecorder(stream, { mimeType: mime });
  const chunks: BlobPart[] = [];
  const startedAt = Date.now();
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  let maxTimer: ReturnType<typeof setTimeout> | null = null;
  let settled = false;

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const cleanupTimers = () => {
    if (tickTimer != null) clearInterval(tickTimer);
    if (maxTimer != null) clearTimeout(maxTimer);
    tickTimer = null;
    maxTimer = null;
  };

  const result = new Promise<NoteRecording | null>((resolve) => {
    recorder.onstop = () => {
      cleanupTimers();
      if (settled) return;
      settled = true;
      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_NOTE_MS || chunks.length === 0) {
        resolve(null);
        return;
      }
      const blob = new Blob(chunks, { type: mime.split(';')[0] || mime });
      const ext = extensionForMime(mime);
      const mediaKind = mode === 'video' ? 'circle' : 'voice';
      const name =
        mode === 'video' ? `circle-${Date.now()}.${ext}` : `voice-${Date.now()}.${ext}`;
      const file = new File([blob], name, { type: blob.type || mime });
      resolve({ file, mediaKind, durationMs: elapsed });
    };

    recorder.onerror = () => {
      cleanupTimers();
      if (settled) return;
      settled = true;
      resolve(null);
    };

    options?.signal?.addEventListener('abort', () => {
      try {
        if (recorder.state !== 'inactive') recorder.stop();
      } catch {
        /* */
      }
    });
  });

  recorder.start(200);
  tickTimer = setInterval(() => {
    const elapsed = Date.now() - startedAt;
    options?.onTick?.(Math.min(1, elapsed / MAX_NOTE_MS), elapsed);
    if (elapsed >= MAX_NOTE_MS) {
      try {
        if (recorder.state !== 'inactive') recorder.stop();
      } catch {
        /* */
      }
    }
  }, 100);

  maxTimer = setTimeout(() => {
    try {
      if (recorder.state !== 'inactive') recorder.stop();
    } catch {
      /* */
    }
  }, MAX_NOTE_MS + 50);

  return {
    stop: () => {
      try {
        if (recorder.state !== 'inactive') recorder.stop();
      } catch {
        /* */
      }
    },
    result,
  };
}
