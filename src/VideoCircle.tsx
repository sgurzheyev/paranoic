import React, { useEffect, useRef, useState } from 'react';
import { Maximize2, Volume2, VolumeX, Pause, Play } from 'lucide-react';

type VideoCirclePlayerProps = {
  src: string;
  mine?: boolean;
};

/** Круглый видеоплеер: mute+loop, тап — звук и увеличение. */
export function VideoCirclePlayer({ src, mine }: VideoCirclePlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const expandRef = useRef<HTMLVideoElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [unmuted, setUnmuted] = useState(false);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = true;
    void v.play().catch(() => undefined);
  }, [src]);

  useEffect(() => {
    if (!expanded) return;
    const v = expandRef.current;
    if (!v) return;
    v.currentTime = videoRef.current?.currentTime ?? 0;
    v.muted = !unmuted;
    void v.play().catch(() => undefined);
  }, [expanded, unmuted, src]);

  const open = (withSound: boolean) => {
    setUnmuted(withSound);
    setExpanded(true);
  };

  return (
    <>
      <button
        type="button"
        className={`video-circle-note${mine ? ' mine' : ''}${unmuted ? ' unmuted' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          open(true);
        }}
        aria-label="Видео-кружочек — нажмите для звука"
      >
        <video
          ref={videoRef}
          src={src}
          className="video-circle-note-video"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
        />
        <span className="video-circle-note-ring" aria-hidden />
        <span className="video-circle-note-badge" aria-hidden>
          {unmuted ? <Volume2 size={14} /> : <VolumeX size={14} />}
        </span>
      </button>

      {expanded && (
        <div
          className="video-circle-expand-backdrop"
          role="dialog"
          aria-label="Видео-кружочек"
          onClick={() => setExpanded(false)}
        >
          <div
            className="video-circle-expand"
            onClick={(e) => e.stopPropagation()}
          >
            <video
              ref={expandRef}
              src={src}
              className="video-circle-expand-video"
              autoPlay
              loop
              playsInline
              controls={false}
              muted={!unmuted}
            />
            <div className="video-circle-expand-actions">
              <button
                type="button"
                className="call-glass-btn icon-only"
                onClick={() => {
                  setUnmuted((u) => {
                    const next = !u;
                    if (expandRef.current) expandRef.current.muted = !next;
                    return next;
                  });
                }}
                aria-label={unmuted ? 'Выключить звук' : 'Включить звук'}
              >
                {unmuted ? <Volume2 size={18} /> : <VolumeX size={18} />}
              </button>
              <button
                type="button"
                className="call-glass-btn icon-only"
                onClick={() => setExpanded(false)}
                aria-label="Закрыть"
              >
                <Maximize2 size={18} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

type VoiceNotePlayerProps = {
  src: string;
  mine?: boolean;
};

/** Голосовая заметка в чате. */
export function VoiceNotePlayer({ src, mine }: VoiceNotePlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => {
      if (!a.duration || !Number.isFinite(a.duration)) return;
      setProgress(a.currentTime / a.duration);
    };
    const onEnd = () => {
      setPlaying(false);
      setProgress(0);
    };
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('ended', onEnd);
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('ended', onEnd);
    };
  }, [src]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
      setPlaying(false);
    } else {
      void a.play().then(() => setPlaying(true)).catch(() => undefined);
    }
  };

  return (
    <div className={`voice-note${mine ? ' mine' : ''}`}>
      <audio ref={audioRef} src={src} preload="metadata" />
      <button
        type="button"
        className="voice-note-play"
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
        aria-label={playing ? 'Пауза' : 'Слушать'}
      >
        {playing ? <Pause size={18} /> : <Play size={18} />}
      </button>
      <div className="voice-note-wave" aria-hidden>
        {Array.from({ length: 18 }, (_, i) => (
          <i
            key={i}
            style={{
              height: `${28 + ((i * 17) % 40)}%`,
              opacity: progress > i / 18 ? 1 : 0.35,
            }}
          />
        ))}
      </div>
    </div>
  );
}
