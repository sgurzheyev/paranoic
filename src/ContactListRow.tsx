import { MessageCircle, Phone, UserCheck } from 'lucide-react';
import Avatar from './Avatar';
import type { Contact } from './contacts';

type ContactListRowProps = {
  contact: Contact;
  online: boolean;
  trusted: boolean;
  avatarUrl?: string;
  disabled?: boolean;
  onCall: () => void;
  onMessage: () => void;
};

/** Строка контакта с быстрыми кнопками «Позвонить» и «Чат». */
export default function ContactListRow({
  contact,
  online,
  trusted,
  avatarUrl,
  disabled = false,
  onCall,
  onMessage,
}: ContactListRowProps) {
  return (
    <li className="contact-list-item">
      <div className="contact-row contact-row--info">
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
      </div>
      <div className="contact-row-actions">
        <button
          type="button"
          className="contact-action-btn contact-action-btn--call"
          disabled={disabled}
          aria-label={`Позвонить ${contact.name}`}
          onClick={onCall}
        >
          <Phone size={17} />
        </button>
        <button
          type="button"
          className="contact-action-btn contact-action-btn--chat"
          disabled={disabled}
          aria-label={`Чат с ${contact.name}`}
          onClick={onMessage}
        >
          <MessageCircle size={17} />
        </button>
      </div>
    </li>
  );
}
