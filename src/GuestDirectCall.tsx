import { ArrowLeft, Phone, PhoneOff } from 'lucide-react';
import Avatar from './Avatar';
import type { CallState } from './p2p';

type GuestDirectCallProps = {
  hostName: string;
  hostColor: string;
  hostAvatarUrl: string;
  hostOnline: boolean;
  connected: boolean;
  joining: boolean;
  signalingStatus: string;
  callState: CallState;
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
  onCall,
  onCancel,
  onBack,
}: GuestDirectCallProps) {
  const inCall = callState === 'in-call';
  const calling = callState === 'calling';
  const waiting =
    joining || Boolean(signalingStatus) || (!connected && !calling && !inCall);
  const isCancellable = !inCall && (waiting || calling);

  const label = inCall
    ? 'Разговор идёт…'
    : calling
      ? 'Звоним…'
      : waiting
        ? signalingStatus || 'Подключаемся…'
        : `ПОЗВОНИТЬ ${hostName.toUpperCase()}`;

  const handleMainClick = () => {
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
          {connected
            ? 'Связь установлена. Нажмите, чтобы позвонить.'
            : isCancellable
              ? 'Нажмите кнопку, чтобы отменить ожидание.'
              : 'Ждём, пока хост примет подключение…'}
        </p>

        <button
          type="button"
          className={`guest-direct-call-btn${waiting && !connected ? ' is-waiting' : ''}${
            calling ? ' is-active' : ''
          }${isCancellable ? ' is-cancellable' : ''}`}
          onClick={handleMainClick}
          disabled={inCall}
          title={isCancellable ? 'Повесить трубку / Cancel' : undefined}
          aria-label={isCancellable ? 'Отменить звонок' : label}
        >
          <span className="guest-direct-call-pulse" aria-hidden />
          {isCancellable ? <PhoneOff size={32} /> : <Phone size={32} />}
          <span>{label}</span>
        </button>
      </div>
    </div>
  );
}
