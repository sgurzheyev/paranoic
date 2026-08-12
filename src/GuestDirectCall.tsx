import { ArrowLeft, Phone, PhoneOff } from 'lucide-react';
import Avatar from './Avatar';
import type { CallState, P2PStatus } from './p2p';

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
  onCall: () => void;
  onCancel: () => void;
  onBack: () => void;
};

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
  onCall,
  onCancel,
  onBack,
}: GuestDirectCallProps) {
  const inCall = callState === 'in-call';
  const calling = callState === 'calling';
  const failed = connectionStatus === 'failed' || connectionStatus === 'disconnected';
  const waiting =
    !failed &&
    (joining || Boolean(signalingStatus) || (!connected && !calling && !inCall));
  const isCancellable = !inCall && !failed && (waiting || calling);

  const label = failed
    ? 'Не удалось связаться'
    : inCall
      ? 'Разговор идёт…'
      : calling
        ? 'Звоним…'
        : waiting
          ? signalingStatus || 'Подключаемся…'
          : `ПОЗВОНИТЬ ${hostName.toUpperCase()}`;

  const handleMainClick = () => {
    if (failed) {
      onBack();
      return;
    }
    if (isCancellable) onCancel();
    else if (!inCall) onCall();
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
          {failed
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
          }${isCancellable ? ' is-cancellable' : ''}${failed ? ' is-failed' : ''}`}
          onClick={handleMainClick}
          disabled={inCall}
          title={
            failed
              ? 'Назад'
              : isCancellable
                ? 'Повесить трубку / Cancel'
                : undefined
          }
          aria-label={failed ? 'Назад' : isCancellable ? 'Отменить звонок' : label}
        >
          <span className="guest-direct-call-pulse" aria-hidden />
          {isCancellable || failed ? <PhoneOff size={32} /> : <Phone size={32} />}
          <span>{label}</span>
        </button>
      </div>
    </div>
  );
}
