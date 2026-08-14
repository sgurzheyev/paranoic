import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, Mic, MicOff, Paperclip, PhoneIncoming, PhoneOff } from 'lucide-react';
import type { CallFailKind, CallState, NetworkQuality } from './p2p';

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
  failure?: CallFailKind | null;
};

const CONTROLS_HIDE_MS = 4000;

export function formatCallClock(elapsedMs: number): string {
  const total = Math.max(0, Math.floor(elapsedMs / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

type ActiveCallBannerProps = {
  visible: boolean;
  peerLabel: string;
  callState: CallState;
  startedAt: number | null;
  onOpen: () => void;
  onHangUp: () => void;
};

/** Глобальная полоска активного звонка — только когда соединение реально идёт. */
export function ActiveCallBanner({
  visible,
  peerLabel,
  callState,
  startedAt,
  onOpen,
  onHangUp,
}: ActiveCallBannerProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!visible || callState !== 'in-call') return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [visible, callState]);

  if (!visible) return null;

  const status =
    callState === 'in-call' && startedAt
      ? formatCallClock(now - startedAt)
      : 'Ожидание…';

  return (
    <div className="active-call-banner" role="status">
      <button type="button" className="active-call-banner__main" onClick={onOpen}>
        <span className="active-call-banner__peer">{peerLabel}</span>
        <span className="active-call-banner__status">{status}</span>
      </button>
      <button
        type="button"
        className="active-call-banner__hangup"
        onClick={onHangUp}
        aria-label="Завершить звонок"
      >
        <PhoneOff size={16} />
      </button>
    </div>
  );
}

/**
 * Полноэкранный видеозвонок: удалённый поток на весь экран, свой — PiP.
 * Свёрнутый режим держит <video>, чтобы не терять стримы.
 */
export default function CallOverlay({
  callState,
  peerLabel,
  screenSharing,
  networkQuality,
  expanded,
  onExpandedChange,
  localVideoRef,
  remoteVideoRef,
  onAccept,
  onDecline,
  onHangUp,
  micMuted = false,
  onToggleMute,
  onAttachFile,
  failure = null,
}: CallOverlayProps) {
  const [mainIsRemote, setMainIsRemote] = useState(true);
  const [controlsVisible, setControlsVisible] = useState(true);

  const isRinging = callState === 'ringing';

  useEffect(() => {
    setMainIsRemote(true);
    setControlsVisible(true);
  }, [callState]);

  useEffect(() => {
    if (!expanded || !controlsVisible || callState === 'idle' || isRinging) return;
    const timer = window.setTimeout(() => setControlsVisible(false), CONTROLS_HIDE_MS);
    return () => window.clearTimeout(timer);
  }, [controlsVisible, callState, isRinging, expanded]);

  useEffect(() => {
    for (const el of [localVideoRef.current, remoteVideoRef.current]) {
      if (el?.srcObject) void el.play().catch(() => undefined);
    }
  }, [callState, expanded, localVideoRef, remoteVideoRef]);

  const toggleControls = useCallback(() => {
    setControlsVisible((v) => !v);
  }, []);

  const swapStreams = useCallback((e: React.SyntheticEvent) => {
    e.stopPropagation();
    setMainIsRemote((v) => !v);
    setControlsVisible(true);
  }, []);

  if (callState === 'idle' && !failure) return null;

  if (failure) {
    return (
      <div
        className="call-overlay expanded ringing"
        role="dialog"
        aria-label={failure === 'declined' ? 'Вызов отклонён' : 'Не удалось связаться'}
      >
        <div className="incoming-media-card call-overlay-ring">
          <div className="avatar lg" style={{ background: 'var(--call)' }}>
            <PhoneOff size={28} />
          </div>
          <h2 className="incoming-media-title">
            {failure === 'declined' ? 'Собеседник отклонил вызов' : 'Не удалось связаться'}
          </h2>
          <p className="incoming-media-sub">
            {failure === 'declined'
              ? peerLabel
              : 'Хост офлайн или ссылка неверна. Проверьте никнейм / ID.'}
          </p>
          <div className="incoming-call-actions row">
            <button type="button" className="decline-call-btn large" onClick={onHangUp}>
              Закрыть
            </button>
          </div>
        </div>
      </div>
    );
  }

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
      className={`call-overlay${expanded ? ' expanded' : ' keep-alive'}${isRinging ? ' ringing' : ''}`}
      role={expanded ? 'dialog' : 'presentation'}
      aria-hidden={!expanded}
      aria-label={expanded ? (isRinging ? 'Входящий звонок' : 'Видеозвонок') : undefined}
    >
      {isRinging && expanded ? (
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
        <div className="call-room" onClick={expanded ? toggleControls : undefined}>
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
          {expanded && (
            <>
              <button
                type="button"
                className="call-pip-swap"
                aria-label="Поменять видео местами"
                onClick={swapStreams}
              />
              <div className={`call-room-chrome${controlsVisible ? ' is-visible' : ''}`}>
                <div className="call-room-top">
                  <button
                    type="button"
                    className="call-room-minimize"
                    aria-label="Свернуть звонок"
                    onClick={(e) => {
                      e.stopPropagation();
                      onExpandedChange(false);
                    }}
                  >
                    <ChevronDown size={22} />
                  </button>
                  <p className="call-room-status">{statusText}</p>
                </div>
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
            </>
          )}
        </div>
      )}
    </div>
  );
}
