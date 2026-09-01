import { ArrowLeft, PanelLeft, Paperclip, Phone } from 'lucide-react';
import Avatar from './Avatar';

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

  return (
    <div className="chat-top">
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
          onOpenProfile(e);
        }}
        disabled={!activePeerId}
        aria-label={`Профиль: ${peerLabel}`}
      >
        <Avatar
          name={peerLabel}
          color={peerColor}
          avatarUrl={peerAvatarUrl}
          size="sm"
        />
        <div className="chat-peer-meta">
          <span className="chat-peer-name">{peerLabel}</span>
          <span className="chat-peer-sub">
            {peerTyping ? typingLabel : connected ? onLinkLabel : offlineLabel}
          </span>
        </div>
      </button>
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
      <button
        type="button"
        className="icon-btn chat-attach-btn"
        onClick={(e) => {
          e.stopPropagation();
          onAttach(e);
        }}
        aria-label={attachLabel}
        disabled={!activePeerId}
      >
        <Paperclip size={17} />
      </button>
    </div>
  );
}
