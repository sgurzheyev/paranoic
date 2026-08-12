import { Phone, UserCheck } from 'lucide-react';
import Avatar from './Avatar';
import type { Contact } from './contacts';

type ContactListRowProps = {
  contact: Contact;
  online: boolean;
  trusted: boolean;
  avatarUrl?: string;
  disabled?: boolean;
  onOpen: () => void;
  onCall: () => void;
};

/** Строка контакта: tap по карточке → чат, иконка справа → звонок. */
export default function ContactListRow({
  contact,
  online,
  trusted,
  avatarUrl,
  disabled = false,
  onOpen,
  onCall,
}: ContactListRowProps) {
  return (
    <li className="contact-list-item">
      <button
        type="button"
        className="contact-row contact-row--info"
        disabled={disabled}
        aria-label={`Чат с ${contact.name}`}
        onClick={onOpen}
      >
        <Avatar
          name={contact.name}
          color={contact.color}
          avatarUrl={avatarUrl || contact.avatarUrl}
          size="sm"
          online={online ? true : 'off'}
        />
        <span className="contact-info">
          <span className="contact-name">
            {contact.name}
            {trusted && (
              <span className="trust-badge" title="Доверенный">
                <UserCheck size={12} />
              </span>
            )}
          </span>
          <span className="contact-status">{online ? 'в сети' : 'не в сети'}</span>
        </span>
      </button>
      <button
        type="button"
        className="contact-action-btn contact-action-btn--call"
        disabled={disabled}
        aria-label={`Позвонить ${contact.name}`}
        onClick={(e) => {
          e.stopPropagation();
          onCall();
        }}
      >
        <Phone size={18} strokeWidth={2.25} />
      </button>
    </li>
  );
}
