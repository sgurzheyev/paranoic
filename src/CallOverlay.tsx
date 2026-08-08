import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Maximize2,
  Minimize2,
  Monitor,
  MonitorOff,
  PhoneIncoming,
  PhoneOff,
} from 'lucide-react';
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
};

/**
 * Плавающий PiP / полноэкранный звонок поверх чата.
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
  onToggleScreenShare,
}: CallOverlayProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const isRinging = callState === 'ringing';
  const showExpanded = expanded || isRinging;

  useEffect(() => {
    if (showExpanded) return;
    // Сброс к дефолту при первом PiP, если ещё не двигали.
    setPos((prev) => prev);
  }, [showExpanded]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (showExpanded) return;
      if ((e.target as Element).closest('button, a, video')) return;
      const el = shellRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = pos?.x ?? rect.left;
      const y = pos?.y ?? rect.top;
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        origX: x,
        origY: y,
      };
      el.setPointerCapture(e.pointerId);
      e.preventDefault();
    },
    [pos, showExpanded]
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const el = shellRef.current;
    const w = el?.offsetWidth ?? 200;
    const h = el?.offsetHeight ?? 200;
    const nx = Math.min(
      Math.max(8, drag.origX + (e.clientX - drag.startX)),
      window.innerWidth - w - 8
    );
    const ny = Math.min(
      Math.max(8, drag.origY + (e.clientY - drag.startY)),
      window.innerHeight - h - 8
    );
    setPos({ x: nx, y: ny });
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (dragRef.current?.pointerId === e.pointerId) {
      dragRef.current = null;
    }
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
              : 'Разговор идёт'
        : 'Звонок';

  const pipStyle: React.CSSProperties | undefined =
    !showExpanded && pos
      ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' }
      : undefined;

  return (
    <div
      ref={shellRef}
      className={`call-overlay ${showExpanded ? 'expanded' : 'pip'}${isRinging ? ' ringing' : ''}`}
      style={pipStyle}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
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
        <>
          <div className="call-overlay-stage">
            <div className="video-frame remote">
              <video ref={remoteVideoRef} autoPlay playsInline />
              <span className="video-label">{peerLabel}</span>
            </div>
            <div className="video-frame local">
              <video ref={localVideoRef} autoPlay playsInline muted />
              <span className="video-label">Вы</span>
            </div>
          </div>

          <div className="call-overlay-bar">
            <p className="call-overlay-status">{statusText}</p>
            <div className="call-overlay-actions">
              {!isRinging && (
                <button
                  type="button"
                  className="call-glass-btn icon-only"
                  onClick={() => onExpandedChange(!expanded)}
                  aria-label={expanded ? 'Свернуть в окно' : 'На весь экран'}
                  title={expanded ? 'Свернуть' : 'Развернуть'}
                >
                  {expanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                </button>
              )}
              {callState === 'in-call' && (
                <button
                  type="button"
                  className={`call-glass-btn ${screenSharing ? 'active' : ''}`}
                  onClick={onToggleScreenShare}
                  aria-pressed={screenSharing}
                >
                  {screenSharing ? <MonitorOff size={18} /> : <Monitor size={18} />}
                  {showExpanded ? (screenSharing ? 'Камера' : 'Экран') : null}
                </button>
              )}
              <button
                type="button"
                className="mega-btn hangup compact-hangup"
                onClick={onHangUp}
              >
                <PhoneOff size={showExpanded ? 28 : 20} />
                {showExpanded ? (callState === 'calling' ? 'Отменить' : 'Завершить') : null}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
