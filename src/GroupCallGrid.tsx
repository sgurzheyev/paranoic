import './GroupCallGrid.css';
import { useEffect, useRef } from 'react';
import { Mic, MicOff, PhoneOff, Video, VideoOff } from 'lucide-react';
import { useLanguage } from './i18n';
import type { RemoteGroupStream } from './groupCall';

type Props = {
  groupName: string;
  localStream: MediaStream | null;
  remotes: RemoteGroupStream[];
  micMuted: boolean;
  cameraOff: boolean;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onHangUp: () => void;
};

function bindStream(el: HTMLVideoElement | null, stream: MediaStream | null): void {
  if (!el) return;
  if (el.srcObject !== stream) el.srcObject = stream;
}

function RemoteTile({ remote }: { remote: RemoteGroupStream }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    bindStream(ref.current, remote.stream);
  }, [remote.stream]);
  const hasVideo = remote.stream.getVideoTracks().some((t) => t.enabled && t.readyState === 'live');
  return (
    <div className="group-call-tile">
      <video ref={ref} className="group-call-tile__video" autoPlay playsInline />
      {!hasVideo && (
        <span className="group-call-tile__fallback">{(remote.name || '?').slice(0, 1).toUpperCase()}</span>
      )}
      <span className="group-call-tile__name">{remote.name}</span>
    </div>
  );
}

export default function GroupCallGrid({
  groupName,
  localStream,
  remotes,
  micMuted,
  cameraOff,
  onToggleMute,
  onToggleCamera,
  onHangUp,
}: Props) {
  const { t } = useLanguage();
  const localRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    bindStream(localRef.current, localStream);
  }, [localStream]);

  const count = remotes.length + 1;
  const cols = count <= 1 ? 1 : count <= 4 ? 2 : 3;

  return (
    <div className="group-call-overlay" role="dialog" aria-modal="true" aria-label={groupName}>
      <div className="group-call-head">
        <p className="group-call-title">{groupName}</p>
        <p className="group-call-sub">{t('groups.call.inCall')}</p>
      </div>
      <div className="group-call-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        <div className="group-call-tile is-local">
          <video ref={localRef} className="group-call-tile__video" autoPlay playsInline muted />
          {cameraOff && <span className="group-call-tile__fallback">{t('call.cameraOff')}</span>}
          <span className="group-call-tile__name">{t('common.you')}</span>
        </div>
        {remotes.map((r) => (
          <RemoteTile key={r.userId} remote={r} />
        ))}
      </div>
      <div className="group-call-controls">
        <button
          type="button"
          className={`group-call-btn${micMuted ? ' is-off' : ''}`}
          onClick={onToggleMute}
          aria-label={micMuted ? t('call.unmute') : t('call.mute')}
        >
          {micMuted ? <MicOff size={18} /> : <Mic size={18} />}
        </button>
        <button
          type="button"
          className={`group-call-btn${cameraOff ? ' is-off' : ''}`}
          onClick={onToggleCamera}
          aria-label={cameraOff ? t('call.cameraOn') : t('call.cameraOff')}
        >
          {cameraOff ? <VideoOff size={18} /> : <Video size={18} />}
        </button>
        <button
          type="button"
          className="group-call-btn hangup"
          onClick={onHangUp}
          aria-label={t('call.end')}
        >
          <PhoneOff size={18} />
        </button>
      </div>
    </div>
  );
}
