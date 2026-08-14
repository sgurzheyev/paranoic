import type { MouseEvent } from 'react';
import { ArrowLeft, Phone, PhoneOff } from 'lucide-react';
import Avatar from './Avatar';
import type { CallFailKind, CallState, P2PStatus, SignalingDebugStatus } from './p2p';
import { MEDIA_ACCESS_DENIED_MESSAGE } from './mediaPermissions';

type GuestDirectCallProps = {
  hostName: string;
  hostColor: string;
  hostAvatarUrl: string;
  hostOnline: boolean;
  connected: boolean;
  joining: boolean;
  signalingStatus: string;
  callState: CallState;
  /** P2P status — чтобы не крутить «Подключаемся» после failed. */
  connectionStatus?: P2PStatus;
  failure?: CallFailKind | null;
  mediaBlocked?: boolean;
  onCall: () => void;
  onCancel: () => void;
  onBack: () => void;
};

const CONNECTING_SIGNALS = new Set<SignalingDebugStatus | string>([
  'Подключаемся к сокетам...',
  'Ожидаем собеседника...',
  'Входящий вызов...',
  'Собеседник найден, генерируем ключи...',
  'Обмен маршрутами (ICE)...',
  'Связь установлена!',
]);

/** Direct Call Mode — гость по магической ссылке, один большой CTA. */
export default function GuestDirectCall({
  hostName,
  hostColor,
  hostAvatarUrl,
  hostOnline,
  connected,
  joining,
  signalingStatus,
  callState,
  connectionStatus = 'idle',
  failure = null,
  mediaBlocked = false,
  onCall,
  onCancel,
  onBack,
}: GuestDirectCallProps) {
  const inCall = callState === 'in-call';
  const calling = callState === 'calling';
  const failed = Boolean(failure);
  const waitingConnection =
    connectionStatus === 'connecting' ||
    connectionStatus === 'creating-offer' ||
    connectionStatus === 'waiting-answer';
  const waiting =
    !failed &&
    (joining || waitingConnection || CONNECTING_SIGNALS.has(signalingStatus));
  const isCancellable = !inCall && !failed && (waiting || calling);

  const label = failed
    ? failure === 'declined'
      ? 'Собеседник отклонил вызов'
      : 'Не удалось связаться'
    : inCall
      ? 'Разговор идёт…'
      : calling
        ? 'Звоним…'
        : waiting
          ? CONNECTING_SIGNALS.has(signalingStatus)
            ? signalingStatus
            : 'Подключаемся…'
          : `ПОЗВОНИТЬ ${hostName.toUpperCase()}`;

  const handleMainClick = () => {
    if (failed) {
      onBack();
      return;
    }
    if (mediaBlocked) {
      onCall();
      return;
    }
    if (!inCall && !calling && !waiting) onCall();
  };

  const handleCancel = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onCancel();
  };

  return (
    <div className="guest-direct-call">
      <button type="button" className="guest-direct-back text-link" onClick={onBack}>
        <ArrowLeft size={16} /> К своему профилю
      </button>

      <div className="guest-direct-card liquid-glass-card">
        <Avatar
          name={hostName}
          color={hostColor}
          avatarUrl={hostAvatarUrl}
          size="lg"
          online={hostOnline ? true : 'off'}
        />
        <p className="guest-direct-eyebrow">Прямой звонок</p>
        <h1 className="guest-direct-name">{hostName}</h1>
        <p className="guest-direct-hint">
          {failure === 'declined'
            ? 'Собеседник отклонил вызов.'
            : failure === 'offline'
              ? 'Хост офлайн или ссылка неверна. Вернитесь и проверьте никнейм / ID.'
              : connected
                ? `Вы подключены к ${hostName}. Нажмите, чтобы позвонить.`
                : waiting
                  ? `Вы подключаетесь к ${hostName}…`
                  : `Вы подключаетесь к ${hostName}`}
        </p>

        <button
          type="button"
          className={`guest-direct-call-btn${waiting && !connected ? ' is-waiting' : ''}${
            calling ? ' is-active' : ''
          }${failed ? ' is-failed' : ''}${mediaBlocked && !failed ? ' is-media-blocked' : ''}`}
          onClick={handleMainClick}
          disabled={inCall || isCancellable}
          title={mediaBlocked && !failed ? MEDIA_ACCESS_DENIED_MESSAGE : undefined}
          aria-label={failed ? 'Назад' : label}
        >
          <span className="guest-direct-call-pulse" aria-hidden />
          {failed ? <PhoneOff size={32} /> : <Phone size={32} />}
          <span>{label}</span>
        </button>

        {isCancellable && (
          <button
            type="button"
            className="guest-direct-cancel-btn"
            aria-label="Отменить звонок"
            onClick={handleCancel}
          >
            <PhoneOff size={18} />
            Отменить
          </button>
        )}
      </div>
    </div>
  );
}
