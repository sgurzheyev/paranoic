import { useEffect, useMemo, useState } from 'react';
import { Check, Users, X } from 'lucide-react';
import Avatar from './Avatar';
import type { Contact } from './contacts';
import { MAX_GROUP_MEMBERS } from './groups';
import { useLanguage } from './i18n';

type CreateGroupModalProps = {
  open: boolean;
  contacts: Contact[];
  selfId: string;
  busy?: boolean;
  onClose: () => void;
  onCreate: (opts: { name: string; memberIds: string[] }) => void | Promise<void>;
};

/** Telegram-style create group: name + multi-select contacts. */
export default function CreateGroupModal({
  open,
  contacts,
  selfId,
  busy = false,
  onClose,
  onCreate,
}: CreateGroupModalProps) {
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setName('');
    setSelected(new Set());
    setError('');
  }, [open]);

  const candidates = useMemo(
    () => contacts.filter((c) => c.id !== selfId),
    [contacts, selfId]
  );

  if (!open) return null;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        if (next.size + 1 >= MAX_GROUP_MEMBERS) {
          setError(t('groups.maxMembers', { count: String(MAX_GROUP_MEMBERS) }));
          return prev;
        }
        next.add(id);
      }
      setError('');
      return next;
    });
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t('groups.nameRequired'));
      return;
    }
    if (selected.size < 1) {
      setError(t('groups.membersRequired'));
      return;
    }
    setError('');
    await onCreate({ name: trimmed, memberIds: [...selected] });
  };

  return (
    <div className="qr-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="qr-modal create-group-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-group-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="qr-modal-head create-group-modal__head">
          <h3 id="create-group-title">
            <Users size={18} aria-hidden /> {t('groups.createTitle')}
          </h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('common.close')}>
            <X size={18} />
          </button>
        </header>

        <label className="create-group-modal__field">
          <span>{t('groups.nameLabel')}</span>
          <input
            type="text"
            value={name}
            maxLength={80}
            placeholder={t('groups.namePlaceholder')}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </label>

        <p className="create-group-modal__hint">
          {t('groups.pickMembers', {
            selected: String(selected.size),
            max: String(MAX_GROUP_MEMBERS - 1),
          })}
        </p>

        <ul className="create-group-modal__list">
          {candidates.length === 0 ? (
            <li className="empty-contacts">{t('groups.noContacts')}</li>
          ) : (
            candidates.map((c) => {
              const on = selected.has(c.id);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    className={`create-group-modal__row${on ? ' is-selected' : ''}`}
                    onClick={() => toggle(c.id)}
                  >
                    <Avatar
                      name={c.name}
                      color={c.color}
                      avatarUrl={c.avatarUrl}
                      size="sm"
                    />
                    <span className="contact-name truncate">{c.name}</span>
                    <span className={`create-group-modal__check${on ? ' on' : ''}`} aria-hidden>
                      {on ? <Check size={14} /> : null}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>

        {error ? (
          <p className="create-group-modal__error" role="alert">
            {error}
          </p>
        ) : null}

        <footer className="create-group-modal__foot">
          <button type="button" className="text-link" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="mega-btn call"
            disabled={busy || selected.size < 1 || !name.trim()}
            onClick={() => void submit()}
          >
            {busy ? t('common.loading') : t('groups.createAction')}
          </button>
        </footer>
      </div>
    </div>
  );
}
