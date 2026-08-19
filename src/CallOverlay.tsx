import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, Mic, MicOff, Paperclip, Phone, PhoneIncoming, PhoneOff } from 'lucide-react';
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
  callState: CallState;
  startedAt: number | null;
  onOpen: () => void;
};

/** Глобальная полоска: звонок идёт, пользователь ушёл с экрана видео. */
export function ActiveCallBanner({
  visible,
  callState,
  startedAt,
  onOpen,
}: ActiveCallBannerProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!visible || callState !== 'in-call') return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [visible, callState]);

  if (!visible) return null;

  const clock =
    callState === 'in-call' && startedAt ? formatCallClock(now - startedAt) : null;

  return (
    <button
      type="button"
      className="active-call-banner"
      onClick={onOpen}
      aria-label="Идёт звонок. Нажмите, чтобы вернуться к видео."
    >
      <Phone className="active-call-banner__icon" size={18} strokeWidth={2.4} aria-hidden />
      <span className="active-call-banner__copy">
        Идёт звонок. Нажмите, чтобы вернуться к видео.
        {clock ? <span className="active-call-banner__timer">{clock}</span> : null}
      </span>
    </button>
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
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4 backdrop-blur-md"
        role="dialog"
        aria-modal="true"
        aria-label={failure === 'declined' ? 'Вызов отклонён' : 'Не удалось связаться'}
      >
        <div className="mx-auto w-full max-w-sm rounded-3xl border border-white/10 bg-neutral-900/90 p-6 text-center shadow-2xl">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-rose-500/30 bg-rose-500/20 text-rose-400">
            <PhoneOff size={28} aria-hidden />
          </div>
          <h2 className="m-0 text-lg font-bold text-white">
            {failure === 'declined' ? 'Собеседник отклонил вызов' : 'Не удалось связаться'}
          </h2>
          <p className="mt-2 mb-6 text-sm text-neutral-400">
            {failure === 'declined'
              ? peerLabel
              : 'Хост офлайн или ссылка неверна. Проверьте никнейм / ID.'}
          </p>
          <button type="button" className="decline-call-btn large w-full" onClick={onHangUp}>
            Закрыть
          </button>
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
