import { Phone, PhoneOff } from 'lucide-react';
import Avatar from './Avatar';
import { callerDisplayName, type CallerInfo } from './callSignaling';
import { useLanguage } from './i18n';
import { MEDIA_ACCESS_DENIED_MESSAGE } from './mediaPermissions';

type IncomingCallModalProps = {
  caller: CallerInfo;
  mediaBlocked?: boolean;
  onAccept: () => void;
  onReject: () => void;
};

/** Полноэкранный Caller ID (Liquid Glass) для входящего звонка. */
export default function IncomingCallModal({
  caller,
  mediaBlocked = false,
  onAccept,
  onReject,
}: IncomingCallModalProps) {
  const { t } = useLanguage();
  const label = callerDisplayName(caller);
  const sub =
    caller.username && caller.name && caller.name !== 'Я'
      ? caller.name
      : caller.username
        ? 'Paranoic'
        : `ID ${caller.id.slice(0, 12)}`;

  return (
    <div
      className="incoming-call-modal"
      role="dialog"
      aria-modal="true"
      aria-label={t('call.incoming')}
    >
      <div className="incoming-call-modal-glow" aria-hidden />
      <div className="incoming-call-modal-card">
        <p className="incoming-call-modal-eyebrow">{t('call.incoming')}</p>
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
            aria-label={t('call.decline')}
          >
            <PhoneOff size={28} />
            <span>{t('call.decline')}</span>
          </button>
          <button
            type="button"
            className={`incoming-call-accept${mediaBlocked ? ' is-media-blocked' : ''}`}
            onClick={onAccept}
            aria-label={t('call.accept')}
            title={mediaBlocked ? MEDIA_ACCESS_DENIED_MESSAGE : undefined}
          >
            <Phone size={28} />
            <span>{t('call.accept')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
