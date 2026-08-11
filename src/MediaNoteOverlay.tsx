import { useEffect, useRef } from 'react';
import { Mic, Video, X } from 'lucide-react';
import type { NoteMode } from './mediaNotes';

type MediaNoteOverlayProps = {
  mode: NoteMode;
  stream: MediaStream;
  progress: number;
  /** Палец ушёл вверх / в зону отмены (Telegram slide-to-cancel). */
  cancelArmed?: boolean;
  onCancel: () => void;
};

/** Круглый превью-экран во время записи кружочка / голоса. */
export default function MediaNoteOverlay({
  mode,
  stream,
  progress,
  cancelArmed = false,
  onCancel,
}: MediaNoteOverlayProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || mode !== 'video') return;
    el.srcObject = stream;
    el.muted = true;
    void el.play().catch(() => undefined);
    return () => {
      el.srcObject = null;
    };
  }, [stream, mode]);

  const deg = Math.round(progress * 360);

  return (
    <div
      className={`media-note-overlay${cancelArmed ? ' cancel-armed' : ''}`}
      role="dialog"
      aria-label="Запись сообщения"
    >
      <div className="media-note-stage">
        <div
          className="media-note-ring"
          style={{
            background: `conic-gradient(${
              cancelArmed ? 'rgba(248,113,113,0.95)' : 'var(--chat)'
            } ${deg}deg, rgba(255,255,255,0.12) 0deg)`,
          }}
        >
          <div className="media-note-preview">
            {mode === 'video' ? (
              <video ref={videoRef} autoPlay playsInline muted className="media-note-video" />
            ) : (
              <div className="media-note-voice-preview">
                <Mic size={42} />
                <p>Запись голоса…</p>
              </div>
            )}
          </div>
        </div>
        <p className="media-note-hint">
          {cancelArmed ? (
            <>
              <X size={14} /> Отпустите, чтобы отменить
            </>
          ) : mode === 'video' ? (
            <>
              <Video size={14} /> Удерживайте · отпустите, чтобы отправить
            </>
          ) : (
            <>
              <Mic size={14} /> Удерживайте · отпустите, чтобы отправить
            </>
          )}
        </p>
        <button
          type="button"
          className="media-note-cancel"
          aria-label="Отмена"
          onPointerDown={(e) => {
            // Важно: pointerdown, не click — иначе pointer capture / hold глотает tap.
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }}
        >
          <X size={18} /> Отмена
        </button>
      </div>
    </div>
  );
}
