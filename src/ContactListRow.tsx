import { Phone, UserCheck } from 'lucide-react';
import Avatar from './Avatar';
import type { Contact } from './contacts';
import { useLanguage } from './i18n';
import type { LastMessagePreview } from './storage';
import { MEDIA_ACCESS_DENIED_MESSAGE } from './mediaPermissions';

type ContactListRowProps = {
  contact: Contact;
  online: boolean;
  trusted: boolean;
  avatarUrl?: string;
  disabled?: boolean;
  mediaBlocked?: boolean;
  preview?: LastMessagePreview;
  onOpen: () => void;
  onCall: () => void;
};

/** Строка чата/контакта: имя, сниппет, время — как в Telegram. */
export default function ContactListRow({
  contact,
  online,
  trusted,
  avatarUrl,
  disabled = false,
  mediaBlocked = false,
  preview,
  onOpen,
  onCall,
}: ContactListRowProps) {
  const { t } = useLanguage();
  const subtitle = preview?.snippet || (online ? t('common.online') : t('common.offline'));

  return (
    <li className="contact-list-item">
      <button
        type="button"
        className="contact-row contact-row--info"
        disabled={disabled}
        aria-label={t('contacts.chatAria', { name: contact.name })}
        onClick={onOpen}
      >
        <Avatar
          name={contact.name}
          color={contact.color}
          avatarUrl={avatarUrl || contact.avatarUrl}
          size="sm"
          online={online ? true : 'off'}
        />
        <span className="contact-info min-w-0 flex-1">
          <span className="flex min-w-0 items-center justify-between gap-2">
            <span className="contact-name min-w-0 truncate">
              {contact.name}
              {trusted && (
                <span className="trust-badge" title={t('contacts.trusted')}>
                  <UserCheck size={12} />
                </span>
              )}
            </span>
            {preview?.timeLabel ? (
              <span className="shrink-0 text-xs text-gray-400">{preview.timeLabel}</span>
            ) : null}
          </span>
          <span className="truncate text-sm text-gray-400">{subtitle}</span>
        </span>
      </button>
      <button
        type="button"
        className={`contact-action-btn contact-action-btn--call${mediaBlocked ? ' is-media-blocked' : ''}`}
        disabled={disabled}
        aria-disabled={disabled || mediaBlocked}
        title={mediaBlocked ? MEDIA_ACCESS_DENIED_MESSAGE : undefined}
        aria-label={t('contacts.callAria', { name: contact.name })}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onCall();
        }}
      >
        <Phone size={18} strokeWidth={2.25} />
      </button>
    </li>
  );
}
