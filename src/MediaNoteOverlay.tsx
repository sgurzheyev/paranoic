import { useEffect, useRef } from 'react';
import { Lock, Mic, Video, X } from 'lucide-react';
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
          <div className="mt-6 flex w-full flex-row items-center justify-center gap-3 px-6">
            <button
              type="button"
              aria-label="Отмена"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onCancel();
              }}
              className="flex-1 rounded-2xl border border-white/10 bg-[#2A2A2A] py-3.5 text-center text-[15px] font-semibold text-white transition-all hover:bg-[#333333] active:scale-95"
            >
              Отмена
            </button>
            <button
              type="button"
              aria-label="Отправить"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onSend?.();
              }}
              className="flex-1 rounded-2xl bg-blue-600 py-3.5 text-center text-[15px] font-semibold text-white shadow-lg shadow-blue-900/30 transition-all hover:bg-blue-500 active:scale-95"
            >
              Отправить
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
