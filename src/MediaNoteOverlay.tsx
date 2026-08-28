import { useEffect, useRef } from 'react';
import { Lock, Mic, Send, Video, X } from 'lucide-react';
import type { NoteMode } from './mediaNotes';

type MediaNoteOverlayProps = {
  mode: NoteMode;
  stream: MediaStream;
  progress: number;
  cancelArmed?: boolean;
  locked?: boolean;
  onCancel: () => void;
  onSend?: () => void;
};

/** Превью записи кружочка / голоса. pointer-events: none, чтобы не фризить hold. */
export default function MediaNoteOverlay({
  mode,
  stream,
  progress,
  cancelArmed = false,
  locked = false,
  onCancel,
  onSend,
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
      className={`media-note-overlay${cancelArmed ? ' cancel-armed' : ''}${locked ? ' is-locked' : ''}`}
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
                <Mic size={30} />
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
          ) : locked ? (
            <>
              <Lock size={14} /> Запись зафиксирована
            </>
          ) : (
            <>
              {mode === 'video' ? <Video size={14} /> : <Mic size={14} />}
              Вверх — lock · влево — отмена
            </>
          )}
        </p>
        {locked && (
          <div className="mt-4 flex w-full flex-row items-center justify-center gap-6">
            <button
              type="button"
              className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-gray-700 bg-gray-800/80 px-6 py-2.5 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700"
              aria-label="Отмена"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onCancel();
              }}
            >
              <X size={18} /> Отмена
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 whitespace-nowrap rounded-full bg-blue-600 px-6 py-2.5 text-sm font-medium text-white shadow-lg shadow-blue-500/30 transition-colors hover:bg-blue-500"
              aria-label="Отправить"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onSend?.();
              }}
            >
              <Send size={16} /> Отправить
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
