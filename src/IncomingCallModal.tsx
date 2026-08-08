import { Phone, PhoneOff } from 'lucide-react';
import Avatar from './Avatar';
import { callerDisplayName, type CallerInfo } from './callSignaling';

type IncomingCallModalProps = {
  caller: CallerInfo;
  onAccept: () => void;
  onReject: () => void;
};

/** Полноэкранный Caller ID (Liquid Glass) для входящего звонка. */
export default function IncomingCallModal({
  caller,
  onAccept,
  onReject,
}: IncomingCallModalProps) {
  const label = callerDisplayName(caller);
  const sub =
    caller.username && caller.name && caller.name !== 'Я'
      ? caller.name
      : caller.username
        ? 'Вам звонят в Paranoic'
        : `ID ${caller.id.slice(0, 12)}`;

  return (
    <div className="incoming-call-modal" role="dialog" aria-modal="true" aria-label="Входящий звонок">
      <div className="incoming-call-modal-glow" aria-hidden />
      <div className="incoming-call-modal-card">
        <p className="incoming-call-modal-eyebrow">Входящий вызов</p>
        <div className="incoming-call-modal-avatar-wrap">
          <span className="incoming-call-modal-ring" aria-hidden />
          <Avatar
            name={caller.name || caller.username || caller.id}
            color={caller.color || '#34d399'}
            avatarUrl={caller.avatarUrl}
            size="lg"
            className="incoming-call-modal-avatar"
          />
        </div>
        <h2 className="incoming-call-modal-name">{label}</h2>
        <p className="incoming-call-modal-sub">{sub}</p>

        <div className="incoming-call-modal-actions">
          <button
            type="button"
            className="incoming-call-reject"
            onClick={onReject}
            aria-label="Отклонить"
          >
            <PhoneOff size={28} />
            <span>Отклонить</span>
          </button>
          <button
            type="button"
            className="incoming-call-accept"
            onClick={onAccept}
            aria-label="Принять"
          >
            <Phone size={28} />
            <span>Принять</span>
          </button>
        </div>
      </div>
    </div>
  );
}
