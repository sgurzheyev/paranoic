import { ArrowLeft, Phone } from 'lucide-react';
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
  onBack,
}: GuestDirectCallProps) {
  const calling = callState === 'calling' || callState === 'in-call';
  const waiting =
    joining || Boolean(signalingStatus) || (!connected && !calling);
  const label = calling
    ? callState === 'in-call'
      ? 'Разговор идёт…'
      : 'Звоним…'
    : waiting
      ? signalingStatus || 'Подключаемся…'
      : `ПОЗВОНИТЬ ${hostName.toUpperCase()}`;

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
            : 'Ждём, пока хост примет подключение…'}
        </p>

        <button
          type="button"
          className={`guest-direct-call-btn${waiting && !connected ? ' is-waiting' : ''}${
            calling ? ' is-active' : ''
          }`}
          onClick={onCall}
          disabled={calling}
        >
          <span className="guest-direct-call-pulse" aria-hidden />
          <Phone size={32} />
          <span>{label}</span>
        </button>
      </div>
    </div>
  );
}
