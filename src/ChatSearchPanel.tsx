import { useEffect, useId, useMemo, useState } from 'react';
import {
  FileText,
  Image as ImageIcon,
  Link2,
  Mic,
  Search,
  X,
} from 'lucide-react';
import type { Contact } from './contacts';
import { useLanguage } from './i18n';
import {
  classifyMessageCategory,
  loadMediaBlob,
  mediaStorageKey,
  searchLocalChatMessages,
  type ChatSearchFilter,
  type ChatSearchHit,
} from './storage';

const FILTERS: Array<{
  id: ChatSearchFilter;
  labelKey: string;
  icon: typeof Search;
}> = [
  { id: 'all', labelKey: 'chats.filterAll', icon: Search },
  { id: 'media', labelKey: 'chats.filterMedia', icon: ImageIcon },
  { id: 'links', labelKey: 'chats.filterLinks', icon: Link2 },
  { id: 'files', labelKey: 'chats.filterFiles', icon: FileText },
  { id: 'voice', labelKey: 'chats.filterVoice', icon: Mic },
];

const CATEGORY_KEYS: Record<string, string> = {
  media: 'chats.badgeMedia',
  links: 'chats.badgeLink',
  files: 'chats.badgeFile',
  voice: 'chats.badgeVoice',
  text: 'chats.badgeText',
};

type ChatSearchPanelProps = {
  selfId: string;
  contacts: Contact[];
  /** Компактный вид для сайдбара мессенджера. */
  compact?: boolean;
  /** true, когда вместо списка чатов нужно показать выдачу. */
  onResultsModeChange?: (active: boolean) => void;
  onOpenPeer: (peerId: string, peerName: string) => void;
};

function extractFirstUrl(text?: string): string | null {
  if (!text) return null;
  const m = text.match(/https?:\/\/[^\s<>"'`]+/i);
  return m?.[0] ?? null;
}

function HitThumb({ hit }: { hit: ChatSearchHit }) {
  const [url, setUrl] = useState<string | null>(null);
  const cat = hit.category;

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    const key = hit.message.mediaKey || mediaStorageKey(hit.message.id);
    void (async () => {
      if (cat !== 'media' && cat !== 'files' && cat !== 'voice') return;
      const blob = await loadMediaBlob(key);
      if (cancelled || !blob) return;
      const objectUrl = URL.createObjectURL(blob);
      revoked = objectUrl;
      setUrl(objectUrl);
    })();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [hit.message.id, hit.message.mediaKey, cat]);

  if (cat === 'media' && url && hit.message.mediaMime?.startsWith('image/')) {
    return <img src={url} alt="" className="chat-search-thumb-img" />;
  }
  if (cat === 'media' && url && hit.message.mediaMime?.startsWith('video/')) {
    return <video src={url} muted playsInline className="chat-search-thumb-img" />;
  }

  const Icon =
    cat === 'links'
      ? Link2
      : cat === 'voice'
        ? Mic
        : cat === 'files'
          ? FileText
          : ImageIcon;

  return (
    <span className={`chat-search-thumb-icon chat-search-thumb-icon--${cat}`}>
      <Icon size={14} strokeWidth={1.75} aria-hidden />
    </span>
  );
}

/** Поиск по чатам с горизонтальными фильтрами типов контента. */
export default function ChatSearchPanel({
  selfId,
  contacts,
  compact = false,
  onResultsModeChange,
  onOpenPeer,
}: ChatSearchPanelProps) {
  const { t } = useLanguage();
  const inputId = useId();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [filter, setFilter] = useState<ChatSearchFilter>('all');
  const [focused, setFocused] = useState(false);
  const [hits, setHits] = useState<ChatSearchHit[]>([]);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), 120);
    return () => window.clearTimeout(t);
  }, [query]);

  const searchActive = focused || Boolean(debounced) || filter !== 'all';
  const showResults = Boolean(debounced) || filter !== 'all';

  useEffect(() => {
    onResultsModeChange?.(showResults);
  }, [showResults, onResultsModeChange]);

  const contactHits = useMemo(() => {
    if (filter !== 'all' || !debounced) return [];
    const q = debounced.toLowerCase();
    return contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        (c.username || '').toLowerCase().includes(q)
    );
  }, [contacts, debounced, filter]);

  useEffect(() => {
    if (!selfId || !showResults) {
      setHits([]);
      setScanning(false);
      return;
    }
    let cancelled = false;
    setScanning(true);
    void searchLocalChatMessages(selfId, {
      query: debounced,
      filter,
      limit: 100,
    }).then((rows) => {
      if (cancelled) return;
      setHits(rows);
      setScanning(false);
    });
    return () => {
      cancelled = true;
    };
  }, [selfId, debounced, filter, showResults]);

  const clearSearch = () => {
    setQuery('');
    setDebounced('');
    setFilter('all');
    setFocused(false);
  };

  const empty =
    showResults && !scanning && contactHits.length === 0 && hits.length === 0;

  return (
    <div
      className={`chat-search${compact ? ' chat-search--compact' : ''}${
        searchActive ? ' is-active' : ''
      }`}
    >
      <label className="chat-search-field" htmlFor={inputId}>
        <Search size={15} strokeWidth={1.75} aria-hidden />
        <input
          id={inputId}
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          placeholder={t('chats.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            window.setTimeout(() => {
              if (!query.trim() && filter === 'all') setFocused(false);
            }, 160);
          }}
        />
        {(query || filter !== 'all') && (
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

      {searchActive && (
        <div className="chat-search-tabs" role="tablist" aria-label={t('search.category')}>
          {FILTERS.map((tab) => {
            const Icon = tab.icon;
            const active = filter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={`chat-search-tab${active ? ' is-active' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setFilter(tab.id)}
              >
                <Icon size={12} strokeWidth={1.75} aria-hidden />
                {t(tab.labelKey)}
              </button>
            );
          })}
        </div>
      )}

      {showResults && (
        <div className="chat-search-results" role="listbox" aria-label={t('chats.searchPlaceholder')}>
          {scanning && (
            <p className="chat-search-status">{t('chats.searchScanning')}</p>
          )}
          {empty && (
            <p className="chat-search-status">{t('chats.searchEmpty')}</p>
          )}

          {contactHits.map((c) => (
            <button
              key={`contact-${c.id}`}
              type="button"
              role="option"
              className="chat-search-hit"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onOpenPeer(c.id, c.name)}
            >
              <span className="chat-search-thumb chat-search-thumb--peer">
                {(c.name || '?').slice(0, 1).toUpperCase()}
              </span>
              <span className="chat-search-hit-body">
                <span className="chat-search-hit-top">
                  <span className="chat-search-hit-title">{c.name}</span>
                  <span className="chat-search-hit-badge">{t('chats.badgeChat')}</span>
                </span>
                <span className="chat-search-hit-sub truncate">
                  {c.username ? `@${c.username}` : c.id}
                </span>
              </span>
            </button>
          ))}

          {hits.map((hit) => {
            const peer =
              contacts.find((c) => c.id === hit.peerId)?.name ||
              hit.peerId.slice(0, 8);
            const url =
              hit.category === 'links'
                ? extractFirstUrl(hit.message.text)
                : null;
            const title =
              hit.category === 'links' && url
                ? url.replace(/^https?:\/\//i, '')
                : hit.message.mediaName || hit.snippet;
            return (
              <button
                key={`${hit.conversationId}:${hit.message.id}`}
                type="button"
                role="option"
                className="chat-search-hit"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onOpenPeer(hit.peerId, peer)}
              >
                <span className="chat-search-thumb">
                  <HitThumb hit={hit} />
                </span>
                <span className="chat-search-hit-body">
                  <span className="chat-search-hit-top">
                    <span className="chat-search-hit-title truncate">{title}</span>
                    <span className="chat-search-hit-time">{hit.timeLabel}</span>
                  </span>
                  <span className="chat-search-hit-sub">
                    <span className="chat-search-hit-badge">
                      {t(
                        CATEGORY_KEYS[classifyMessageCategory(hit.message)] ||
                          CATEGORY_KEYS[hit.category] ||
                          'chats.badgeText'
                      )}
                    </span>
                    <span className="truncate">{peer}</span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
