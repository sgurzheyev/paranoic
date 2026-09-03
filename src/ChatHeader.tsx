import { ArrowLeft, PanelLeft, Paperclip, Phone, Users } from 'lucide-react';
import Avatar from './Avatar';

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
  onBack: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onToggleSidebar?: () => void;
  onOpenProfile: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onCall: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onAttach: (e: React.MouseEvent<HTMLButtonElement>) => void;
};

/** Chat screen header — back / peer / call controls are strictly isolated. */
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
  onBack,
  onToggleSidebar,
  onOpenProfile,
  onCall,
  onAttach,
}: ChatHeaderProps) {
  const handleBack = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    onBack(e);
  };

  const handleCall = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    onCall(e);
  };

  const canCompose = isGroup || Boolean(activePeerId);
  const faces = groupFaces.slice(0, 3);

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
        onClick={handleBack}
      >
        <ArrowLeft size={16} /> {backLabel}
      </button>
      <button
        type="button"
        className="chat-peer chat-peer--btn"
        onClick={(e) => {
          e.stopPropagation();
          if (!isGroup) onOpenProfile(e);
        }}
        disabled={isGroup ? false : !activePeerId}
        aria-label={isGroup ? peerLabel : `Профиль: ${peerLabel}`}
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
          <span className="chat-peer-name">{peerLabel}</span>
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
          onClick={handleCall}
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
    </div>
  );
}
