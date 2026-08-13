import React, { useCallback, useEffect, useState } from 'react';
import { Mic, MicOff, Paperclip, PhoneIncoming, PhoneOff } from 'lucide-react';
import type { CallState, NetworkQuality } from './p2p';

type CallOverlayProps = {
  callState: CallState;
  peerLabel: string;
  screenSharing: boolean;
  networkQuality: NetworkQuality;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  localVideoRef: React.RefObject<HTMLVideoElement | null>;
  remoteVideoRef: React.RefObject<HTMLVideoElement | null>;
  onAccept: () => void;
  onDecline: () => void;
  onHangUp: () => void;
  onToggleScreenShare: () => void;
  micMuted?: boolean;
  onToggleMute?: () => void;
  onAttachFile?: () => void;
};

const CONTROLS_HIDE_MS = 4000;

/**
 * Полноэкранный видеозвонок: удалённый поток на весь экран, свой — PiP.
 */
export default function CallOverlay({
  callState,
  peerLabel,
  screenSharing,
  networkQuality,
  localVideoRef,
  remoteVideoRef,
  onAccept,
  onDecline,
  onHangUp,
  micMuted = false,
  onToggleMute,
  onAttachFile,
}: CallOverlayProps) {
  const [mainIsRemote, setMainIsRemote] = useState(true);
  const [controlsVisible, setControlsVisible] = useState(true);

  const isRinging = callState === 'ringing';

  useEffect(() => {
    setMainIsRemote(true);
    setControlsVisible(true);
  }, [callState]);

  useEffect(() => {
    if (!controlsVisible || callState === 'idle' || isRinging) return;
    const timer = window.setTimeout(() => setControlsVisible(false), CONTROLS_HIDE_MS);
    return () => window.clearTimeout(timer);
  }, [controlsVisible, callState, isRinging]);

  useEffect(() => {
    for (const el of [localVideoRef.current, remoteVideoRef.current]) {
      if (el?.srcObject) void el.play().catch(() => undefined);
    }
  }, [callState, localVideoRef, remoteVideoRef]);

  const toggleControls = useCallback(() => {
    setControlsVisible((v) => !v);
  }, []);

  const swapStreams = useCallback((e: React.SyntheticEvent) => {
    e.stopPropagation();
    setMainIsRemote((v) => !v);
    setControlsVisible(true);
  }, []);

  if (callState === 'idle') return null;

  const statusText =
    callState === 'calling'
      ? 'Ожидаем ответа…'
      : callState === 'in-call'
        ? screenSharing
          ? 'Демонстрация экрана'
          : networkQuality === 'critical'
            ? 'Слабая сеть — только аудио'
            : networkQuality === 'poor'
              ? 'Слабая сеть'
              : peerLabel
        : peerLabel;

  return (
    <div
      className={`call-overlay expanded${isRinging ? ' ringing' : ''}`}
      role="dialog"
      aria-label={isRinging ? 'Входящий звонок' : 'Видеозвонок'}
    >
      {isRinging ? (
        <div className="incoming-media-card call-overlay-ring">
          <div className="avatar lg" style={{ background: 'var(--call)' }}>
            <PhoneIncoming size={28} />
          </div>
          <h2 className="incoming-media-title">Входящий звонок</h2>
          <p className="incoming-media-sub">{peerLabel}</p>
          <div className="incoming-call-actions row">
            <button type="button" className="accept-file-btn large" onClick={onAccept}>
              Принять
            </button>
            <button type="button" className="decline-call-btn large" onClick={onDecline}>
              Отклонить
            </button>
          </div>
        </div>
      ) : (
        <div className="call-room" onClick={toggleControls}>
          <video
            ref={remoteVideoRef}
            className={mainIsRemote ? 'call-video-main' : 'call-video-pip'}
            autoPlay
            playsInline
          />
          <video
            ref={localVideoRef}
            className={`call-video-self ${mainIsRemote ? 'call-video-pip' : 'call-video-main'}`}
            autoPlay
            playsInline
            muted
          />
          <button
            type="button"
            className="call-pip-swap"
            aria-label="Поменять видео местами"
            onClick={swapStreams}
          />

          <div className={`call-room-chrome${controlsVisible ? ' is-visible' : ''}`}>
            <p className="call-room-status">{statusText}</p>
            <div
              className="call-room-controls"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className={`call-room-btn${micMuted ? ' is-off' : ''}`}
                onClick={onToggleMute}
                aria-pressed={micMuted}
                aria-label={micMuted ? 'Включить микрофон' : 'Выключить микрофон'}
              >
                {micMuted ? <MicOff size={22} /> : <Mic size={22} />}
              </button>
              <button
                type="button"
                className="call-room-btn"
                onClick={onAttachFile}
                aria-label="Отправить файл"
              >
                <Paperclip size={22} />
              </button>
              <button
                type="button"
                className="call-room-btn hangup"
                onClick={onHangUp}
                aria-label="Завершить звонок"
              >
                <PhoneOff size={22} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
