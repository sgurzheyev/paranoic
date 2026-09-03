import './groups.css';
import './ChatHeader.css';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  BellOff,
  BellRing,
  MoreVertical,
  PanelLeft,
  Paperclip,
  Phone,
  PhoneCall,
  ShieldOff,
  Trash2,
  UserPen,
  Users,
  Video,
} from 'lucide-react';
import Avatar from './Avatar';
import { useLanguage } from './i18n';

export type GroupHeaderFace = {
  userId: string;
  name: string;
  color?: string;
  avatarUrl?: string;
};

type ChatHeaderProps = {
  backLabel: string;
  peerLabel: string;
  peerColor: string;
  peerAvatarUrl?: string;
  peerTyping: boolean;
  connected: boolean;
  onLinkLabel: string;
  offlineLabel: string;
  typingLabel: string;
  callLabel: string;
  returnToCallLabel: string;
  attachLabel: string;
  contactsToggleLabel: string;
  callLive: boolean;
  callMediaBlocked: boolean;
  callMediaBlockedMessage: string;
  activePeerId: string | null;
  showSidebarToggle?: boolean;
  /** Group chat mode: stacked faces, no 1:1 call. */
  isGroup?: boolean;
  groupFaces?: GroupHeaderFace[];
  groupSubtitle?: string;
  /** Whether this peer is muted. */
  isMuted?: boolean;
  /** Whether this peer is blocked. */
  isBlocked?: boolean;
  onBack: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onToggleSidebar?: () => void;
  onOpenProfile: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onCall: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onAttach: (e: React.MouseEvent<HTMLButtonElement>) => void;
  /** More-options menu callbacks — omit any to hide the item. */
  onEditContact?: () => void;
  onToggleMute?: () => void;
  onBlockUser?: () => void;
  onClearHistory?: () => void;
};

type DropdownState = 'idle' | 'open' | 'confirm-clear';

/** Chat screen header — back / peer / call / more-options controls. */
export default function ChatHeader({
  backLabel,
  peerLabel,
  peerColor,
  peerAvatarUrl,
  peerTyping,
  connected,
  onLinkLabel,
  offlineLabel,
  typingLabel,
  callLabel,
  returnToCallLabel,
  attachLabel,
  contactsToggleLabel,
  callLive,
  callMediaBlocked,
  callMediaBlockedMessage,
  activePeerId,
  showSidebarToggle = true,
  isGroup = false,
  groupFaces = [],
  groupSubtitle,
  isMuted = false,
  isBlocked = false,
  onBack,
  onToggleSidebar,
  onOpenProfile,
  onCall,
  onAttach,
  onEditContact,
  onToggleMute,
  onBlockUser,
  onClearHistory,
}: ChatHeaderProps) {
  const { t } = useLanguage();
  const [ddState, setDdState] = useState<DropdownState>('idle');
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click.
  useEffect(() => {
    if (ddState === 'idle') return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setDdState('idle');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ddState]);

  const canCompose = isGroup || Boolean(activePeerId);
  const faces = groupFaces.slice(0, 3);

  const hasMenu = Boolean(
    !isGroup && (onEditContact || onToggleMute || onBlockUser || onClearHistory)
  ) || Boolean(isGroup && (onToggleMute || onClearHistory));

  return (
    <div className={`chat-top${isGroup ? ' chat-top--group' : ''}`}>
      {showSidebarToggle ? (
        <button
          type="button"
          className="icon-btn messenger-sidebar-toggle"
          aria-label={contactsToggleLabel}
          onClick={(e) => {
            e.stopPropagation();
            onToggleSidebar?.();
          }}
        >
          <PanelLeft size={16} />
        </button>
      ) : null}

      <button
        type="button"
        className="text-link chat-back-home"
        aria-label={backLabel}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onBack(e);
        }}
      >
        <ArrowLeft size={16} /> {backLabel}
      </button>

      <button
        type="button"
        className="chat-peer chat-peer--btn"
        onClick={(e) => {
          e.stopPropagation();
          onOpenProfile(e);
        }}
        disabled={isGroup ? false : !activePeerId}
        aria-label={isGroup ? peerLabel : `${t('chat.profileAria')}: ${peerLabel}`}
      >
        {isGroup ? (
          <span className="group-avatar-stack group-avatar-stack--header" aria-hidden>
            {faces.length === 0 ? (
              <span className="group-avatar-fallback">
                <Users size={14} />
              </span>
            ) : (
              faces.map((m, i) => (
                <span
                  key={m.userId}
                  className="group-avatar-stack__face"
                  style={{
                    zIndex: faces.length - i,
                    background: m.color || peerColor || '#60a5fa',
                  }}
                >
                  {(m.name || '?').slice(0, 1).toUpperCase()}
                </span>
              ))
            )}
          </span>
        ) : (
          <Avatar
            name={peerLabel}
            color={peerColor}
            avatarUrl={peerAvatarUrl}
            size="sm"
          />
        )}
        <div className="chat-peer-meta">
          <span className="chat-peer-name">
            {peerLabel}
            {isMuted && <BellOff size={11} aria-label="muted" style={{ marginLeft: 4, opacity: 0.5 }} />}
          </span>
          <span className="chat-peer-sub">
            {isGroup
              ? groupSubtitle || offlineLabel
              : peerTyping
                ? typingLabel
                : connected
                  ? onLinkLabel
                  : offlineLabel}
          </span>
        </div>
      </button>

      {!isGroup ? (
        <button
          type="button"
          className={`icon-btn chat-call-btn${callMediaBlocked ? ' is-media-blocked' : ''}${callLive ? ' is-call-live' : ''}`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onCall(e);
          }}
          aria-label={callLive ? returnToCallLabel : callLabel}
          title={
            callMediaBlocked
              ? callMediaBlockedMessage
              : callLive
                ? returnToCallLabel
                : callLabel
          }
          disabled={!activePeerId}
          aria-disabled={!activePeerId || callMediaBlocked}
        >
          <Phone size={17} />
        </button>
      ) : null}

      <button
        type="button"
        className="icon-btn chat-attach-btn"
        onClick={(e) => {
          e.stopPropagation();
          onAttach(e);
        }}
        aria-label={attachLabel}
        disabled={!canCompose}
      >
        <Paperclip size={17} />
      </button>

      {hasMenu && (
        <div className="chat-menu-wrap" ref={wrapRef}>
          <button
            type="button"
            className="chat-menu-btn"
            aria-label="More options"
            aria-expanded={ddState !== 'idle'}
            disabled={!canCompose}
            onClick={(e) => {
              e.stopPropagation();
              setDdState((s) => (s === 'idle' ? 'open' : 'idle'));
            }}
          >
            <MoreVertical size={18} />
          </button>

          {ddState !== 'idle' && (
            <div className="chat-dropdown" role="menu">
              {/* ── Confirm: Clear History ──────────────────────── */}
              {ddState === 'confirm-clear' ? (
                <div className="chat-dropdown-confirm">
                  <span>{t('chatMenu.clearHistoryConfirm')}</span>
                  <div className="chat-dropdown-confirm-btns">
                    <button
                      type="button"
                      className="btn-cancel"
                      onClick={() => setDdState('open')}
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      type="button"
                      className="btn-confirm"
                      onClick={() => {
                        setDdState('idle');
                        onClearHistory?.();
                      }}
                    >
                      {t('chatMenu.clearHistory')}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Audio call */}
                  {!isGroup && onCall && (
                    <button
                      type="button"
                      role="menuitem"
                      className="chat-dropdown-item"
                      disabled={!activePeerId}
                      onClick={(e) => {
                        setDdState('idle');
                        onCall(e as unknown as React.MouseEvent<HTMLButtonElement>);
                      }}
                    >
                      <PhoneCall size={15} />
                      {t('chatMenu.audioCall')}
                    </button>
                  )}

                  {/* Video call — placeholder (wire video in App.tsx) */}
                  {!isGroup && onCall && (
                    <button
                      type="button"
                      role="menuitem"
                      className="chat-dropdown-item"
                      disabled={!activePeerId}
                      onClick={(e) => {
                        setDdState('idle');
                        onCall(e as unknown as React.MouseEvent<HTMLButtonElement>);
                      }}
                    >
                      <Video size={15} />
                      {t('chatMenu.videoCall')}
                    </button>
                  )}

                  {/* Edit contact */}
                  {onEditContact && (
                    <button
                      type="button"
                      role="menuitem"
                      className="chat-dropdown-item"
                      onClick={() => { setDdState('idle'); onEditContact(); }}
                    >
                      <UserPen size={15} />
                      {t('chatMenu.editContact')}
                    </button>
                  )}

                  {((!isGroup && onCall) || onEditContact) && (onToggleMute || onBlockUser || onClearHistory) && (
                    <div className="chat-dropdown-sep" role="separator" />
                  )}

                  {/* Mute / Unmute */}
                  {onToggleMute && (
                    <button
                      type="button"
                      role="menuitem"
                      className={`chat-dropdown-item${isMuted ? ' is-muted' : ''}`}
                      onClick={() => { setDdState('idle'); onToggleMute(); }}
                    >
                      {isMuted ? <BellRing size={15} /> : <BellOff size={15} />}
                      {isMuted ? t('chatMenu.unmute') : t('chatMenu.mute')}
                    </button>
                  )}

                  {/* Block user */}
                  {onBlockUser && !isGroup && (
                    <button
                      type="button"
                      role="menuitem"
                      className="chat-dropdown-item is-danger"
                      onClick={() => { setDdState('idle'); onBlockUser(); }}
                    >
                      <ShieldOff size={15} />
                      {isBlocked ? t('safety.blocked') : t('chatMenu.blockUser')}
                    </button>
                  )}

                  {/* Clear history */}
                  {onClearHistory && (
                    <button
                      type="button"
                      role="menuitem"
                      className="chat-dropdown-item is-danger"
                      onClick={() => setDdState('confirm-clear')}
                    >
                      <Trash2 size={15} />
                      {t('chatMenu.clearHistory')}
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
