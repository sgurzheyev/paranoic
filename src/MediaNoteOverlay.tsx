import React, { useEffect, useRef } from 'react';
import { Mic, Video, X } from 'lucide-react';
import type { NoteMode } from './mediaNotes';

type MediaNoteOverlayProps = {
  mode: NoteMode;
  stream: MediaStream;
  progress: number;
  onCancel: () => void;
};

/** Круглый превью-экран во время записи кружочка / голоса. */
export default function MediaNoteOverlay({
  mode,
  stream,
  progress,
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
    <div className="media-note-overlay" role="dialog" aria-label="Запись сообщения">
      <div className="media-note-stage">
        <div
          className="media-note-ring"
          style={{
            background: `conic-gradient(var(--chat) ${deg}deg, rgba(255,255,255,0.12) 0deg)`,
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
          {mode === 'video' ? (
            <>
              <Video size={14} /> Отпустите, чтобы отправить
            </>
          ) : (
            <>
              <Mic size={14} /> Отпустите, чтобы отправить
            </>
          )}
        </p>
        <button type="button" className="media-note-cancel" onClick={onCancel} aria-label="Отмена">
          <X size={18} /> Отмена
        </button>
      </div>
    </div>
  );
}
