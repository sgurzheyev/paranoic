import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Mic } from 'lucide-react';
import MediaNoteOverlay from './MediaNoteOverlay';
import {
  openNoteStream,
  recordMediaNote,
  stopStream,
  type NoteMode,
} from './mediaNotes';
import {
  MEDIA_ACCESS_DENIED_MESSAGE,
  isRecordMediaBlocked,
  mediaErrorMessage,
  useMediaDevicePresence,
} from './mediaPermissions';

const HOLD_MS = 160;
const LOCK_DY = 56;
const CANCEL_DX = 56;

type ChatRecordButtonProps = {
  disabled?: boolean;
  onSend: (file: File, mediaKind: 'circle' | 'voice') => void;
  onError?: (message: string) => void;
};

/**
 * Одна кнопка как в Telegram: тап — смена режима, удержание — запись.
 * Слушатели на window, чтобы overlay не перехватывал pointerup (фриз).
 */
export default function ChatRecordButton({
  disabled = false,
  onSend,
  onError,
}: ChatRecordButtonProps) {
  const [mode, setMode] = useState<NoteMode>('voice');
  const [recording, setRecording] = useState<{
    stream: MediaStream;
    progress: number;
  } | null>(null);
  const [cancelArmed, setCancelArmed] = useState(false);
  const [locked, setLocked] = useState(false);

  const modeRef = useRef(mode);
  modeRef.current = mode;
  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const mediaPresence = useMediaDevicePresence();
  const recordBlocked = isRecordMediaBlocked(mediaPresence, false);

  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const originRef = useRef({ x: 0, y: 0 });
  const startedRef = useRef(false);
  const lockedRef = useRef(false);
  const cancelArmedRef = useRef(false);
  const releasePendingRef = useRef(false);
  const commitRef = useRef(false);
  const listenersBoundRef = useRef(false);
  const sessionRef = useRef<{
    stop: () => void;
    cancel: () => void;
    abort: AbortController;
    stream: MediaStream;
  } | null>(null);
  const pendingStreamRef = useRef<MediaStream | null>(null);
  const startingRef = useRef(false);

  const onWindowMoveRef = useRef((_e: PointerEvent) => undefined);
  const onWindowUpRef = useRef((_e: PointerEvent) => undefined);
  const onWindowCancelRef = useRef((_e: PointerEvent) => undefined);

  const clearHoldTimer = () => {
    if (holdTimerRef.current != null) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  const unbindWindowListeners = useCallback(() => {
    if (!listenersBoundRef.current) return;
    listenersBoundRef.current = false;
    window.removeEventListener('pointermove', onWindowMoveRef.current, true);
    window.removeEventListener('pointerup', onWindowUpRef.current, true);
    window.removeEventListener('pointercancel', onWindowCancelRef.current, true);
  }, []);

  const bindWindowListeners = useCallback(() => {
    if (listenersBoundRef.current) return;
    listenersBoundRef.current = true;
    window.addEventListener('pointermove', onWindowMoveRef.current, true);
    window.addEventListener('pointerup', onWindowUpRef.current, true);
    window.addEventListener('pointercancel', onWindowCancelRef.current, true);
  }, []);

  const cleanupSession = useCallback(
    (discard: boolean) => {
      unbindWindowListeners();
      const session = sessionRef.current;
      sessionRef.current = null;
      const pending = pendingStreamRef.current;
      pendingStreamRef.current = null;
      if (session) {
        try {
          if (discard) session.abort.abort();
        } catch {
          /* */
        }
        try {
          if (discard) session.cancel();
          else session.stop();
        } catch {
          /* */
        }
        stopStream(session.stream);
      }
      stopStream(pending);
      setRecording(null);
      setCancelArmed(false);
      setLocked(false);
      lockedRef.current = false;
      cancelArmedRef.current = false;
      startedRef.current = false;
      startingRef.current = false;
      releasePendingRef.current = false;
      commitRef.current = false;
      pointerIdRef.current = null;
    },
    [unbindWindowListeners]
  );

  const beginRecord = useCallback(async () => {
    if (startingRef.current || sessionRef.current) return;
    startingRef.current = true;
    startedRef.current = true;
    commitRef.current = false;
    releasePendingRef.current = false;
    const currentMode = modeRef.current;
    let stream: MediaStream | null = null;
    try {
      stream = await openNoteStream(currentMode);
      pendingStreamRef.current = stream;

      const releasedEarly =
        releasePendingRef.current ||
        (pointerIdRef.current === null && !lockedRef.current);

      if (releasedEarly && (!commitRef.current || cancelArmedRef.current) && !lockedRef.current) {
        pendingStreamRef.current = null;
        stopStream(stream);
        startingRef.current = false;
        startedRef.current = false;
        return;
      }

      const abort = new AbortController();
      const session = recordMediaNote(stream, currentMode, {
        signal: abort.signal,
        onTick: (ratio) => {
          setRecording((prev) =>
            prev ? { ...prev, progress: ratio } : { stream: stream!, progress: ratio }
          );
        },
      });
      sessionRef.current = {
        stop: session.stop,
        cancel: session.cancel,
        abort,
        stream,
      };
      pendingStreamRef.current = null;
      setRecording({ stream, progress: 0 });

      if (releasePendingRef.current && !lockedRef.current) {
        if (commitRef.current && !cancelArmedRef.current) {
          session.stop();
        } else {
          session.cancel();
          stopStream(stream);
          sessionRef.current = null;
          setRecording(null);
          startingRef.current = false;
          startedRef.current = false;
          return;
        }
      }

      void session.result
        .then((note) => {
          const shouldSend = commitRef.current && !cancelArmedRef.current;
          stopStream(stream);
          if (sessionRef.current?.stream === stream) sessionRef.current = null;
          setRecording(null);
          setCancelArmed(false);
          setLocked(false);
          lockedRef.current = false;
          cancelArmedRef.current = false;
          releasePendingRef.current = false;
          pointerIdRef.current = null;
          startingRef.current = false;
          startedRef.current = false;
          unbindWindowListeners();
          if (!shouldSend || !note) return;
          onSendRef.current(note.file, note.mediaKind);
        })
        .catch(() => {
          stopStream(stream);
          cleanupSession(true);
        });
    } catch (e) {
      pendingStreamRef.current = null;
      stopStream(stream);
      startingRef.current = false;
      startedRef.current = false;
      setRecording(null);
      unbindWindowListeners();
      pointerIdRef.current = null;
      onErrorRef.current?.(mediaErrorMessage(e, MEDIA_ACCESS_DENIED_MESSAGE));
    }
  }, [cleanupSession, unbindWindowListeners]);

  const discard = useCallback(() => {
    clearHoldTimer();
    commitRef.current = false;
    releasePendingRef.current = true;
    cancelArmedRef.current = true;
    cleanupSession(true);
  }, [cleanupSession]);

  const sendStop = useCallback(() => {
    clearHoldTimer();
    commitRef.current = true;
    cancelArmedRef.current = false;
    releasePendingRef.current = true;
    unbindWindowListeners();
    pointerIdRef.current = null;
    const session = sessionRef.current;
    if (session) {
      session.stop();
      return;
    }
    if (!startingRef.current) {
      commitRef.current = false;
      releasePendingRef.current = false;
    }
  }, [unbindWindowListeners]);

  useEffect(() => {
    onWindowMoveRef.current = (e: PointerEvent) => {
      if (pointerIdRef.current !== null && e.pointerId !== pointerIdRef.current) return;
      if (lockedRef.current) return;
      if (!startedRef.current && holdTimerRef.current == null) return;
      const dx = e.clientX - originRef.current.x;
      const dy = e.clientY - originRef.current.y;
      if (dx < -CANCEL_DX && Math.abs(dx) >= Math.abs(dy)) {
        if (!cancelArmedRef.current) {
          cancelArmedRef.current = true;
          setCancelArmed(true);
        }
        return;
      }
      if (dy < -LOCK_DY && Math.abs(dy) > Math.abs(dx)) {
        cancelArmedRef.current = false;
        setCancelArmed(false);
        lockedRef.current = true;
        setLocked(true);
        pointerIdRef.current = null;
        unbindWindowListeners();
        return;
      }
      if (cancelArmedRef.current) {
        cancelArmedRef.current = false;
        setCancelArmed(false);
      }
    };

    onWindowUpRef.current = (e: PointerEvent) => {
      if (pointerIdRef.current !== null && e.pointerId !== pointerIdRef.current) return;
      const wasHolding = holdTimerRef.current != null;
      clearHoldTimer();
      pointerIdRef.current = null;
      unbindWindowListeners();

      if (lockedRef.current) return;

      if (wasHolding && !startedRef.current) {
        setMode((m) => (m === 'video' ? 'voice' : 'video'));
        return;
      }
      if (cancelArmedRef.current) {
        discard();
        return;
      }
      if (startedRef.current || startingRef.current) {
        sendStop();
      }
    };

    onWindowCancelRef.current = (e: PointerEvent) => {
      if (pointerIdRef.current !== null && e.pointerId !== pointerIdRef.current) return;
      if (lockedRef.current) return;
      discard();
    };
  }, [discard, sendStop, unbindWindowListeners]);

  useEffect(() => () => cleanupSession(true), [cleanupSession]);

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled || e.button !== 0) return;
    if (recordBlocked) {
      e.preventDefault();
      onErrorRef.current?.(MEDIA_ACCESS_DENIED_MESSAGE);
      return;
    }
    if (lockedRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    pointerIdRef.current = e.pointerId;
    originRef.current = { x: e.clientX, y: e.clientY };
    cancelArmedRef.current = false;
    lockedRef.current = false;
    setCancelArmed(false);
    setLocked(false);
    bindWindowListeners();
    clearHoldTimer();
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null;
      void beginRecord();
    }, HOLD_MS);
  };

  return (
    <>
      <button
        type="button"
        className={`chat-record-btn${recording ? ' recording' : ''}${
          cancelArmed ? ' cancel-armed' : ''
        }${locked ? ' locked' : ''}${recordBlocked ? ' is-media-blocked' : ''}`}
        disabled={disabled}
        aria-disabled={disabled || recordBlocked}
        title={recordBlocked ? MEDIA_ACCESS_DENIED_MESSAGE : undefined}
        aria-label={
          mode === 'video'
            ? 'Тап — голос, удержание — видео'
            : 'Тап — видео, удержание — голос'
        }
        onPointerDown={onPointerDown}
        onContextMenu={(e) => e.preventDefault()}
      >
        {mode === 'video' ? <Camera size={22} /> : <Mic size={22} />}
      </button>
      {recording && (
        <MediaNoteOverlay
          mode={mode}
          stream={recording.stream}
          progress={recording.progress}
          cancelArmed={cancelArmed}
          locked={locked}
          onCancel={discard}
          onSend={sendStop}
        />
      )}
    </>
  );
}
