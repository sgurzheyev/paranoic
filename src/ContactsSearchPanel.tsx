import { useEffect, useId, useMemo, useState } from 'react';
import { MessageCircle, Search, UserPlus, X } from 'lucide-react';
import Avatar from './Avatar';
import type { Contact } from './contacts';
import { useLanguage } from './i18n';
import {
  searchProfilesGlobally,
  shouldSearchProfilesGlobally,
  type RemoteProfile,
} from './profile';

type ContactsSearchPanelProps = {
  selfId: string;
  contacts: Contact[];
  onQueryChange: (query: string) => void;
  onStartChat: (profile: RemoteProfile) => void;
  onAddContact: (profile: RemoteProfile) => void | Promise<void>;
  addingId?: string | null;
};

export default function ContactsSearchPanel({
  selfId,
  contacts,
  onQueryChange,
  onStartChat,
  onAddContact,
  addingId = null,
}: ContactsSearchPanelProps) {
  const { t } = useLanguage();
  const inputId = useId();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [focused, setFocused] = useState(false);
  const [globalHits, setGlobalHits] = useState<RemoteProfile[]>([]);
  const [scanning, setScanning] = useState(false);

  const localIds = useMemo(() => new Set(contacts.map((c) => c.id)), [contacts]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 180);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    onQueryChange(debounced);
  }, [debounced, onQueryChange]);

  useEffect(() => {
    if (!debounced || !shouldSearchProfilesGlobally(debounced)) {
      setGlobalHits([]);
      setScanning(false);
      return;
    }

    let cancelled = false;
    setScanning(true);
    void searchProfilesGlobally(debounced, { excludeUserId: selfId, limit: 8 }).then((rows) => {
      if (cancelled) return;
      setGlobalHits(rows.filter((p) => !localIds.has(p.id)));
      setScanning(false);
    });

    return () => {
      cancelled = true;
    };
  }, [debounced, selfId, localIds]);

  const searchActive = focused || Boolean(debounced);
  const showGlobal = Boolean(debounced) && shouldSearchProfilesGlobally(debounced);

  const clearSearch = () => {
    setQuery('');
    setDebounced('');
    setFocused(false);
    setGlobalHits([]);
  };

  return (
    <div className={`chat-search contacts-search${searchActive ? ' is-active' : ''}`}>
      <label className="chat-search-field" htmlFor={inputId}>
        <Search size={15} strokeWidth={1.75} aria-hidden />
        <input
          id={inputId}
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          placeholder={t('contacts.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            window.setTimeout(() => {
              if (!query.trim()) setFocused(false);
            }, 160);
          }}
        />
        {query && (
          <button
            type="button"
            className="chat-search-clear"
            aria-label={t('common.close')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={clearSearch}
          >
            <X size={14} strokeWidth={1.75} />
          </button>
        )}
      </label>

      {showGlobal && (
        <div className="contacts-search-global" aria-live="polite">
          <p className="contacts-search-global-title">{t('contacts.searchGlobalTitle')}</p>

          {scanning && (
            <p className="chat-search-status">{t('contacts.searchScanning')}</p>
          )}

          {!scanning && globalHits.length === 0 && (
            <p className="chat-search-status">{t('contacts.searchEmpty')}</p>
          )}

          {!scanning &&
            globalHits.map((profile) => {
              const subtitle = profile.username
                ? `@${profile.username}`
                : profile.id;
              const busy = addingId === profile.id;

              return (
                <div key={profile.id} className="contacts-search-hit">
                  <Avatar
                    name={profile.name}
                    color={profile.color}
                    avatarUrl={profile.avatar_url}
                    size="sm"
                  />
                  <div className="contacts-search-hit-body">
                    <div className="contacts-search-hit-top">
                      <span className="contacts-search-hit-name">{profile.name}</span>
                      <span className="contacts-search-hit-badge">{t('contacts.globalBadge')}</span>
                    </div>
                    <p className="contacts-search-hit-sub mono-box small">{subtitle}</p>
                  </div>
                  <div className="contacts-search-hit-actions">
                    <button
                      type="button"
                      className="contacts-search-action"
                      disabled={busy}
                      onClick={() => void onAddContact(profile)}
                      aria-label={t('contacts.addContact', { name: profile.name })}
                      title={t('contacts.addContact', { name: profile.name })}
                    >
                      <UserPlus size={14} strokeWidth={2} />
                      <span>{busy ? t('common.loading') : t('contacts.addContactShort')}</span>
                    </button>
                    <button
                      type="button"
                      className="contacts-search-action contacts-search-action--primary"
                      disabled={busy}
                      onClick={() => onStartChat(profile)}
                      aria-label={t('contacts.startChat', { name: profile.name })}
                      title={t('contacts.startChat', { name: profile.name })}
                    >
                      <MessageCircle size={14} strokeWidth={2} />
                      <span>{t('contacts.startChatShort')}</span>
                    </button>
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
