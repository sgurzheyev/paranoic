import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Phone,
  MessageCircle,
  ImagePlus,
  Shield,
  Copy,
  Check,
  X,
  PhoneOff,
  Unplug,
  Send,
  ArrowLeft,
  FileDown,
  Link2,
  Pencil,
  PhoneIncoming,
  Settings2,
} from 'lucide-react';
import ModeSelector, { type AppModeChoice } from './ModeSelector';
import GlobeLobby, { type MapPerson } from './GlobeLobby';
import Avatar from './Avatar';
import ProfileModal from './ProfileModal';
import {
  deriveKeyFromRoom,
  exportKey,
  encryptMessage,
  decryptMessage,
  encryptBytes,
  decryptBytes,
} from './crypto';
import { P2PConnection, type CallState, type P2PStatus, type SignalingDebugStatus } from './p2p';
import {
  buildRoomShareUrl,
  clearRoomParamFromUrl,
  getRoomIdFromUrl,
  resolveRoom,
  setMagicUserInUrl,
} from './room';
import { hasSupabaseConfig } from './lib/supabase';
import {
  appendStoredMessage,
  conversationId,
  formatFileSize,
  loadChatHistory,
  loadMediaBlob,
  mediaStorageKey,
  purgeLegacyGlobalHistory,
  saveMediaBlob,
  type StoredMessage,
} from './storage';
import {
  buildMagicLink,
  clearMagicParamFromUrl,
  getMagicTargetFromUrl,
  getOrCreateIdentity,
  personalInboxRoom,
  resolveMagicRoute,
  updateIdentity,
  type UserIdentity,
} from './identity';
import { loadContacts, upsertContact, type Contact } from './contacts';
import { resolveGeo, WorldPresence, type GeoPoint, type PresenceUser } from './presence';
import { syncProfileToSupabase } from './profile';

type AppMode = 'select' | AppModeChoice;
type Screen = 'home' | 'chat' | 'call';

type ChatMessage = StoredMessage & {
  mediaUrl?: string;
};

function toStored(message: ChatMessage): StoredMessage {
  const { mediaUrl: _url, ...stored } = message;
  return stored;
}

const FRIENDLY_STATUS: Record<P2PStatus, string> = {
  idle: 'Пока никого нет',
  'creating-offer': 'Создаём соединение…',
  'waiting-answer': 'Ждём звонка по вашей ссылке…',
  connecting: 'Соединяемся…',
  connected: 'Вы на связи',
  disconnected: 'Связь прервалась',
  failed: 'Не получилось связаться',
};

function nowTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function App() {
  const [identity, setIdentity] = useState<UserIdentity>(() => getOrCreateIdentity());
  const [appMode, setAppMode] = useState<AppMode>(() =>
    getMagicTargetFromUrl() || getRoomIdFromUrl() ? 'paranoic' : 'select'
  );
  const [secretKey, setSecretKey] = useState<CryptoKey | null>(null);
  const [keyString, setKeyString] = useState('');
  const [p2pStatus, setP2pStatus] = useState<P2PStatus>('idle');
  const [callState, setCallState] = useState<CallState>('idle');
  const [screen, setScreen] = useState<Screen>('home');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [error, setError] = useState('');
  const [roomId, setRoomId] = useState('');
  const [magicLink, setMagicLink] = useState(() => buildMagicLink(getOrCreateIdentity().id));
  const [copied, setCopied] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [peerLabel, setPeerLabel] = useState('Близкий');
  const [peerId, setPeerId] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [signalingStatus, setSignalingStatus] = useState<SignalingDebugStatus>('');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([]);
  const [geo, setGeo] = useState<GeoPoint | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(identity.name);
  const [profileOpen, setProfileOpen] = useState(false);
  const [peerAvatarUrl, setPeerAvatarUrl] = useState('');
  const [peerColor, setPeerColor] = useState('#60a5fa');
  const [sessionEpoch, setSessionEpoch] = useState(0);
  /** Гостевой peer из ?u= — держим явно, чтобы не «съехать» на свой инбокс. */
  const [guestPeerId, setGuestPeerId] = useState<string | null>(() => {
    const route = resolveMagicRoute(getOrCreateIdentity().id);
    return route.kind === 'guest' ? route.peerId : null;
  });
  const [hostingSelf, setHostingSelf] = useState(() => {
    const route = resolveMagicRoute(getOrCreateIdentity().id);
    return route.kind !== 'guest';
  });
  const [incomingConnection, setIncomingConnection] = useState(false);

  const p2pRef = useRef<P2PConnection | null>(null);
  const secretKeyRef = useRef<CryptoKey | null>(null);
  const identityRef = useRef(identity);
  const peerIdRef = useRef<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingFilesRef = useRef<Map<string, Blob>>(new Map());
  const mediaUrlsRef = useRef<Set<string>>(new Set());
  const presenceRef = useRef<WorldPresence | null>(null);
  const guestPeerIdRef = useRef<string | null>(guestPeerId);
  const ensureP2PRef = useRef<() => P2PConnection>(() => {
    throw new Error('P2P not ready');
  });

  useEffect(() => {
    guestPeerIdRef.current = guestPeerId;
  }, [guestPeerId]);

  const onlineIds = useMemo(() => new Set(presenceUsers.map((u) => u.userId)), [presenceUsers]);

  const mapPeople = useMemo((): MapPerson[] => {
    const list: MapPerson[] = presenceUsers
      .filter((u) => u.userId !== identity.id)
      .map((u) => {
        const contact = contacts.find((c) => c.id === u.userId);
        return {
          ...u,
          isContact: Boolean(contact),
          name: contact?.name || u.name,
          color: contact?.color || u.color,
          avatarUrl: u.avatarUrl || contact?.avatarUrl || '',
        };
      });

    if (geo) {
      list.push({
        userId: identity.id,
        name: identity.name,
        color: identity.color,
        avatarUrl: identity.avatarUrl,
        themeFon: identity.themeFon,
        lat: geo.lat,
        lng: geo.lng,
        online: true,
        updatedAt: Date.now(),
        isContact: false,
        isMe: true,
      });
    }
    return list;
  }, [presenceUsers, contacts, identity, geo]);

  const revokeMediaUrls = useCallback(() => {
    for (const url of mediaUrlsRef.current) URL.revokeObjectURL(url);
    mediaUrlsRef.current.clear();
  }, []);

  const hydrateConversation = useCallback(
    async (convId: string | null) => {
      revokeMediaUrls();
      if (!convId) {
        setMessages([]);
        return;
      }
      const stored = await loadChatHistory(convId);
      const hydrated: ChatMessage[] = [];
      for (const row of stored) {
        if (row.kind === 'media' && row.mediaKey) {
          const blob = await loadMediaBlob(row.mediaKey);
          if (blob) {
            const mediaUrl = URL.createObjectURL(blob);
            mediaUrlsRef.current.add(mediaUrl);
            hydrated.push({ ...row, mediaUrl });
          } else {
            hydrated.push({
              ...row,
              kind: 'text',
              text: `[${row.mediaName ?? 'файл'} — не найден локально]`,
            });
          }
        } else {
          hydrated.push(row);
        }
      }
      setMessages(hydrated);
    },
    [revokeMediaUrls]
  );

  const setActivePeer = useCallback(
    async (id: string | null, label?: string) => {
      peerIdRef.current = id;
      setPeerId(id);
      if (label) setPeerLabel(label);
      const conv = id ? conversationId(identityRef.current.id, id) : null;
      conversationIdRef.current = conv;
      await hydrateConversation(conv);
    },
    [hydrateConversation]
  );

  const addMessage = useCallback(async (message: ChatMessage, persist = true) => {
    setMessages((prev) => [...prev, message]);
    const conv = conversationIdRef.current;
    if (persist && conv && message.kind !== 'file-pending') {
      await appendStoredMessage(conv, toStored(message));
    }
  }, []);

  const acceptFile = useCallback(async (messageId: string) => {
    const blob = pendingFilesRef.current.get(messageId);
    if (!blob) {
      setError('Файл больше недоступен в памяти');
      return;
    }

    setMessages((prev) => {
      const target = prev.find((m) => m.id === messageId);
      if (!target) return prev;

      const mediaKey = mediaStorageKey(messageId);
      const mediaUrl = URL.createObjectURL(blob);
      mediaUrlsRef.current.add(mediaUrl);
      pendingFilesRef.current.delete(messageId);

      const updated: ChatMessage = {
        ...target,
        kind: 'media',
        mediaKey,
        mediaUrl,
        mediaMime: blob.type || target.mediaMime,
      };

      const conv = conversationIdRef.current;
      if (conv) {
        void saveMediaBlob(mediaKey, blob).then(() =>
          appendStoredMessage(conv, toStored(updated))
        );
      }
      return prev.map((m) => (m.id === messageId ? updated : m));
    });
  }, []);

  useEffect(() => {
    void purgeLegacyGlobalHistory();
    void loadContacts().then(setContacts);
  }, []);

  useEffect(() => {
    identityRef.current = identity;
    setMagicLink(buildMagicLink(identity.id));
  }, [identity]);

  useEffect(() => {
    peerIdRef.current = peerId;
  }, [peerId]);

  useEffect(() => {
    secretKeyRef.current = secretKey;
  }, [secretKey]);

  useEffect(() => {
    return () => {
      revokeMediaUrls();
      pendingFilesRef.current.clear();
      void presenceRef.current?.stop();
    };
  }, [revokeMediaUrls]);

  /** Presence + геолокация для карты и зелёных точек. */
  useEffect(() => {
    if (appMode !== 'paranoic' && appMode !== 'family') return;

    let cancelled = false;
    const presence = new WorldPresence({
      onSync: (users) => {
        if (!cancelled) setPresenceUsers(users);
      },
      onError: (err) => {
        if (!cancelled) console.warn('[presence]', err.message);
      },
    });
    presenceRef.current = presence;

    void (async () => {
      const point = await resolveGeo();
      if (cancelled) return;
      setGeo(point);
      await presence.start({
        userId: identityRef.current.id,
        name: identityRef.current.name,
        color: identityRef.current.color,
        avatarUrl: identityRef.current.avatarUrl,
        themeFon: identityRef.current.themeFon,
        lat: point.lat,
        lng: point.lng,
      });
      void syncProfileToSupabase(identityRef.current);
    })();

    return () => {
      cancelled = true;
      void presence.stop();
      if (presenceRef.current === presence) presenceRef.current = null;
    };
  }, [appMode, identity.id]);

  const attachLocalVideo = useCallback((stream: MediaStream | null) => {
    if (localVideoRef.current) localVideoRef.current.srcObject = stream;
  }, []);

  const ensureP2P = useCallback(() => {
    if (!p2pRef.current) {
      p2pRef.current = new P2PConnection({
        onStatus: (status) => {
          setP2pStatus(status);
          if (status === 'connected') {
            setError('');
            setIncomingConnection(false);
            // Гость по магической ссылке — сразу в диалог с этим peer.
            if (guestPeerIdRef.current) {
              setScreen('chat');
            }
          }
          if (status === 'waiting-answer') {
            setIncomingConnection(false);
          }
        },
        onSignalingStatus: (status) => setSignalingStatus(status),
        onCallState: (state) => {
          setCallState(state);
          if (state === 'in-call' || state === 'calling' || state === 'ringing') {
            setScreen('call');
          }
          if (state === 'idle') {
            attachLocalVideo(null);
            setScreen((s) => (s === 'call' ? 'home' : s));
          }
        },
        onIncomingConnection: () => {
          setIncomingConnection(true);
          setError('');
        },
        onConnectionDeclined: () => {
          setIncomingConnection(false);
          setError('Вызов отклонён');
        },
        onIncomingCall: () => {
          setScreen('call');
        },
        onCallDeclined: () => {
          setError('Звонок отклонён');
          setScreen('home');
        },
        onRemoteStream: (stream) => {
          if (remoteVideoRef.current) remoteVideoRef.current.srcObject = stream;
        },
        onPeerHello: (peer) => {
          void (async () => {
            setPeerLabel(peer.name);
            setPeerAvatarUrl(peer.avatarUrl || '');
            setPeerColor(peer.color);
            await setActivePeer(peer.userId, peer.name);
            const next = await upsertContact({
              id: peer.userId,
              name: peer.name,
              color: peer.color,
              avatarUrl: peer.avatarUrl || '',
            });
            setContacts(next);
          })();
        },
        onMessage: async (payload) => {
          const key = secretKeyRef.current;
          if (!key) return;
          try {
            const packet = JSON.parse(payload) as { cipher: string; iv: string; sender: string };
            const text = await decryptMessage(packet.cipher, packet.iv, key);
            await addMessage({
              id: `m-${Date.now()}`,
              sender: packet.sender || 'Близкий',
              text,
              time: nowTime(),
              mine: false,
              kind: 'text',
            });
            if (packet.sender) setPeerLabel(packet.sender);
          } catch {
            setError('Сообщение не удалось прочитать.');
          }
        },
        onEncryptedFile: async (meta, cipher, iv) => {
          const key = secretKeyRef.current;
          if (!key) return;
          try {
            const plain = await decryptBytes(cipher, iv, key);
            const blob = new Blob([plain], { type: meta.mime });
            pendingFilesRef.current.set(meta.id, blob);
            setMessages((prev) => [
              ...prev,
              {
                id: meta.id,
                sender: peerLabel,
                time: nowTime(),
                mine: false,
                kind: 'file-pending',
                mediaMime: meta.mime,
                mediaName: meta.name,
                mediaSize: meta.size,
              },
            ]);
            setScreen('chat');
          } catch {
            setError('Не удалось расшифровать файл');
          }
        },
        onFileProgress: (_id, progress) => setUploadProgress(progress),
        onError: (err) => setError(err.message),
      });
    }
    p2pRef.current.setLocalIdentity({
      userId: identityRef.current.id,
      name: identityRef.current.name,
      color: identityRef.current.color,
      avatarUrl: identityRef.current.avatarUrl,
    });
    return p2pRef.current;
  }, [addMessage, attachLocalVideo, peerLabel, setActivePeer]);

  ensureP2PRef.current = ensureP2P;

  /** Вход в персональный инбокс / magic link / legacy room. */
  useEffect(() => {
    if (appMode !== 'paranoic') return;

    let cancelled = false;

    void (async () => {
      setJoining(true);
      setError('');
      try {
        if (!hasSupabaseConfig()) {
          throw new Error(
            'Добавьте VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY в переменные окружения.'
          );
        }

        const me = identityRef.current;
        const urlRoute = resolveMagicRoute(me.id);
        const legacyRoom = getRoomIdFromUrl();

        // Явный гость из state (после connectToUser) или из ?u= в URL.
        const guestId =
          (urlRoute.kind === 'guest' ? urlRoute.peerId : null) ||
          (guestPeerIdRef.current && guestPeerIdRef.current !== me.id
            ? guestPeerIdRef.current
            : null);

        let room: string;
        let isHost: boolean;
        let provisionalPeer: string | null = null;

        if (guestId) {
          // Гость: чат/звонок с конкретным ?u=ID_ДРУГА — никогда не подменяем на свой id.
          room = personalInboxRoom(guestId);
          isHost = false;
          provisionalPeer = guestId;
          setGuestPeerId(guestId);
          guestPeerIdRef.current = guestId;
          setHostingSelf(false);
          setMagicUserInUrl(guestId);
        } else if (legacyRoom) {
          const resolved = resolveRoom();
          room = resolved.roomId;
          isHost = resolved.isHost;
          setHostingSelf(true);
          setGuestPeerId(null);
          guestPeerIdRef.current = null;
          if (urlRoute.kind === 'self') {
            // Свой ?u= — остаёмся на своём профиле, убираем только если мешает room.
          }
        } else {
          // Свой инбокс / свой профиль (?u=me или без ?u).
          room = personalInboxRoom(me.id);
          isHost = true;
          setHostingSelf(true);
          setGuestPeerId(null);
          guestPeerIdRef.current = null;
          if (urlRoute.kind === 'self') {
            setMagicUserInUrl(me.id);
          } else {
            clearMagicParamFromUrl();
          }
          clearRoomParamFromUrl();
        }

        if (cancelled) return;
        setRoomId(room);
        setMagicLink(buildMagicLink(me.id));

        if (provisionalPeer) {
          const known = contacts.find((c) => c.id === provisionalPeer);
          const presence = presenceUsers.find((u) => u.userId === provisionalPeer);
          setPeerAvatarUrl(presence?.avatarUrl || known?.avatarUrl || '');
          setPeerColor(presence?.color || known?.color || '#60a5fa');
          setPeerLabel(known?.name || presence?.name || 'Близкий');
          await setActivePeer(provisionalPeer, known?.name || presence?.name || 'Близкий');
        } else if (isHost) {
          await setActivePeer(null);
        }

        const key = await deriveKeyFromRoom(room);
        if (cancelled) return;
        setSecretKey(key);
        secretKeyRef.current = key;
        const exported = await exportKey(key);
        setKeyString(exported);

        const p2p = ensureP2PRef.current();
        await p2p.joinRoom(room, { isHost });
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Не удалось войти');
          setP2pStatus('failed');
          setSignalingStatus('');
        }
      } finally {
        if (!cancelled) setJoining(false);
      }
    })();

    return () => {
      cancelled = true;
      p2pRef.current?.close();
      p2pRef.current = null;
      setSignalingStatus('');
    };
    // ensureP2P через ref — иначе смена peerLabel рвёт гостевую сессию и «сбрасывает» роутинг
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appMode, sessionEpoch, guestPeerId, setActivePeer]);

  useEffect(() => {
    if (screen === 'call' && p2pRef.current) {
      attachLocalVideo(p2pRef.current.getLocalStream());
    }
  }, [screen, callState, attachLocalVideo]);

  const copyMagicLink = async () => {
    await navigator.clipboard.writeText(magicLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const connectToUser = async (targetUserId: string, label?: string) => {
    if (targetUserId === identity.id) return;
    setError('');
    setAppMode('paranoic');
    setScreen('home');
    setHostingSelf(false);
    setGuestPeerId(targetUserId);
    guestPeerIdRef.current = targetUserId;
    setMagicUserInUrl(targetUserId);
    const known = contacts.find((c) => c.id === targetUserId);
    const presence = presenceUsers.find((u) => u.userId === targetUserId);
    setPeerAvatarUrl(presence?.avatarUrl || known?.avatarUrl || '');
    setPeerColor(presence?.color || known?.color || '#60a5fa');
    await setActivePeer(targetUserId, label || known?.name || 'Близкий');
    p2pRef.current?.close();
    p2pRef.current = null;
    setSessionEpoch((n) => n + 1);
  };

  const returnToOwnInbox = () => {
    clearMagicParamFromUrl();
    clearRoomParamFromUrl();
    setGuestPeerId(null);
    guestPeerIdRef.current = null;
    setHostingSelf(true);
    void setActivePeer(null);
    p2pRef.current?.close();
    p2pRef.current = null;
    setP2pStatus('idle');
    setCallState('idle');
    setScreen('home');
    setSessionEpoch((n) => n + 1);
  };

  const disconnect = () => {
    returnToOwnInbox();
  };

  const startCall = async () => {
    setError('');
    try {
      const stream = await ensureP2P().startCall();
      attachLocalVideo(stream);
      setScreen('call');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Камера или микрофон недоступны');
    }
  };

  const acceptIncomingConnection = async () => {
    setError('');
    try {
      await ensureP2P().acceptIncomingConnection();
      setIncomingConnection(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось принять вызов');
    }
  };

  const declineIncomingConnection = async () => {
    await ensureP2P().declineIncomingConnection();
    setIncomingConnection(false);
  };

  const acceptMediaCall = async () => {
    setError('');
    try {
      const stream = await ensureP2P().acceptCall();
      attachLocalVideo(stream);
      setScreen('call');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось принять звонок');
      setScreen('home');
    }
  };

  const declineMediaCall = async () => {
    await ensureP2P().declineCall();
    setScreen('home');
  };

  const hangUp = async () => {
    await p2pRef.current?.hangUp();
    attachLocalVideo(null);
    setScreen('home');
  };

  const sendText = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !secretKey || !p2pRef.current?.isReady) return;

    const encrypted = await encryptMessage(inputText, secretKey);
    const packet = JSON.stringify({
      cipher: encrypted.cipher,
      iv: encrypted.iv,
      sender: identityRef.current.name,
    });

    try {
      p2pRef.current.send(packet);
      await addMessage({
        id: `m-${Date.now()}`,
        sender: 'Я',
        text: inputText,
        time: nowTime(),
        mine: true,
        kind: 'text',
      });
      setInputText('');
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не отправилось');
    }
  };

  const sendMedia = async (file: File) => {
    if (!secretKey || !p2pRef.current?.isReady) return;
    setError('');
    setUploadProgress(0);
    const messageId = `local-${Date.now()}`;
    const mediaKey = mediaStorageKey(messageId);
    try {
      await p2pRef.current.sendFile(file, (data) => encryptBytes(data, secretKey));
      const mediaUrl = URL.createObjectURL(file);
      mediaUrlsRef.current.add(mediaUrl);
      await saveMediaBlob(mediaKey, file);
      await addMessage({
        id: messageId,
        sender: 'Я',
        time: nowTime(),
        mine: true,
        kind: 'media',
        mediaUrl,
        mediaMime: file.type,
        mediaName: file.name,
        mediaSize: file.size,
        mediaKey,
      });
      setScreen('chat');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Файл не отправился');
    } finally {
      setUploadProgress(null);
    }
  };

  const applyIdentity = (next: UserIdentity) => {
    setIdentity(next);
    identityRef.current = next;
    p2pRef.current?.setLocalIdentity({
      userId: next.id,
      name: next.name,
      color: next.color,
      avatarUrl: next.avatarUrl,
    });
    void presenceRef.current?.updateProfile({
      name: next.name,
      color: next.color,
      avatarUrl: next.avatarUrl,
      themeFon: next.themeFon,
    });
    void syncProfileToSupabase(next);
  };

  const saveName = () => {
    const next = updateIdentity({ name: nameDraft.trim() || 'Я' });
    applyIdentity(next);
    setEditingName(false);
  };

  const connected = p2pStatus === 'connected';

  const shellStyle =
    appMode === 'paranoic'
      ? ({ background: identity.themeFon } as React.CSSProperties)
      : undefined;

  if (appMode === 'select') {
    return <ModeSelector onSelect={(mode) => setAppMode(mode)} />;
  }

  if (appMode === 'family') {
    return (
      <GlobeLobby
        onBack={() => setAppMode('select')}
        people={mapPeople}
        geoSource={geo ? geo.source : 'pending'}
        onCallUser={(user) => {
          void connectToUser(user.userId, user.isContact ? user.name : 'Незнакомец');
        }}
      />
    );
  }

  return (
    <div className="app-shell themed" style={shellStyle}>
      {profileOpen && (
        <ProfileModal
          identity={identity}
          onClose={() => setProfileOpen(false)}
          onSaved={(next) => applyIdentity(next)}
        />
      )}
      <header className="app-header">
        <div className="brand">
          <button
            type="button"
            className="icon-btn"
            aria-label="К выбору режима"
            onClick={() => setAppMode('select')}
          >
            <ArrowLeft size={20} />
          </button>
          <Shield className="brand-icon" strokeWidth={2.2} />
          <div>
            <h1>Paranoic</h1>
            <p className="brand-sub">Семейная связь без чужих серверов</p>
          </div>
        </div>
        <div className={`status-pill ${connected ? 'ok' : ''}`}>
          <span className="status-dot" />
          <span className="status-pill-text">
            <span>{FRIENDLY_STATUS[p2pStatus]}</span>
            {signalingStatus && !connected && (
              <span className="signaling-debug">{signalingStatus}</span>
            )}
          </span>
        </div>
      </header>

      {error && (
        <div className="banner error" role="alert">
          {error}
          <button type="button" className="icon-btn" onClick={() => setError('')} aria-label="Закрыть">
            <X size={18} />
          </button>
        </div>
      )}

      {uploadProgress !== null && (
        <div className="banner info">Отправка… {Math.round(uploadProgress * 100)}%</div>
      )}

      {incomingConnection && screen === 'home' && (
        <div className="banner incoming-call" role="dialog" aria-label="Входящий вызов">
          <div className="incoming-call-body">
            <PhoneIncoming size={22} />
            <div>
              <p className="incoming-call-title">Входящий вызов</p>
              <p className="incoming-call-sub">Кто-то открыл вашу магическую ссылку</p>
            </div>
          </div>
          <div className="incoming-call-actions">
            <button
              type="button"
              className="accept-file-btn"
              onClick={() => void acceptIncomingConnection()}
            >
              Принять
            </button>
            <button
              type="button"
              className="decline-call-btn"
              onClick={() => void declineIncomingConnection()}
            >
              Отклонить
            </button>
          </div>
        </div>
      )}

      <main className="app-main">
        {screen === 'home' && (
          <section className="home">
            <div className="identity-card">
              <button
                type="button"
                className="avatar-hit"
                onClick={() => setProfileOpen(true)}
                aria-label="Открыть профиль"
              >
                <Avatar
                  name={identity.name}
                  color={identity.color}
                  avatarUrl={identity.avatarUrl}
                  online="self"
                />
              </button>
              <div className="identity-meta">
                {editingName ? (
                  <div className="name-edit">
                    <input
                      value={nameDraft}
                      onChange={(e) => setNameDraft(e.target.value)}
                      maxLength={32}
                      autoFocus
                    />
                    <button type="button" className="text-link" onClick={saveName}>
                      Сохранить
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="name-btn"
                    onClick={() => {
                      setNameDraft(identity.name);
                      setEditingName(true);
                    }}
                  >
                    <span>{identity.name}</span>
                    <Pencil size={14} />
                  </button>
                )}
                <p className="mono-id">ID · {identity.id}</p>
              </div>
              <button
                type="button"
                className="icon-btn profile-settings-btn"
                onClick={() => setProfileOpen(true)}
                aria-label="Настройки профиля"
              >
                <Settings2 size={20} />
              </button>
            </div>

            {guestPeerId ? (
              <div className="room-card guest-peer-card">
                <Avatar
                  name={peerLabel}
                  color={peerColor}
                  avatarUrl={peerAvatarUrl}
                  size="lg"
                  online={onlineIds.has(guestPeerId) ? true : 'off'}
                />
                <p className="room-id-label">Магическая ссылка</p>
                <h2 className="guest-peer-title">{peerLabel}</h2>
                <p className="mono-id">ID · {guestPeerId}</p>
                {!connected ? (
                  <>
                    <p className="lead">
                      {joining || signalingStatus
                        ? signalingStatus || 'Подключаемся к этому пользователю…'
                        : 'Ожидаем, пока собеседник примет вызов…'}
                    </p>
                    <button type="button" className="text-link" onClick={returnToOwnInbox}>
                      Вернуться к своему профилю
                    </button>
                  </>
                ) : (
                  <>
                    <p className="lead">
                      На связи: <strong>{peerLabel}</strong>
                    </p>
                    <div className="mega-grid">
                      <button type="button" className="mega-btn call" onClick={() => void startCall()}>
                        <Phone size={36} />
                        Позвонить
                      </button>
                      <button
                        type="button"
                        className="mega-btn chat"
                        onClick={() => setScreen('chat')}
                      >
                        <MessageCircle size={36} />
                        Написать
                      </button>
                      <button
                        type="button"
                        className="mega-btn media"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <ImagePlus size={36} />
                        Отправить фото / видео
                      </button>
                    </div>
                    <button type="button" className="text-link danger" onClick={disconnect}>
                      <Unplug size={16} /> Разорвать связь
                    </button>
                  </>
                )}
              </div>
            ) : (
              <>
                <div className="room-card magic-card">
                  <Link2 size={28} className="room-card-icon" />
                  <p className="room-id-label">Ваша магическая ссылка</p>
                  <p className="mono-box magic-url">{magicLink}</p>
                  <button
                    type="button"
                    className="mega-btn primary compact"
                    onClick={() => void copyMagicLink()}
                  >
                    {copied ? <Check size={28} /> : <Copy size={28} />}
                    {copied ? 'Скопировано' : 'Скопировать ссылку'}
                  </button>
                  <p className="hint">
                    Постоянная ссылка: близкие открывают её в любой момент — без новой комнаты на
                    каждый звонок.
                  </p>
                </div>

                {!connected ? (
                  <p className="lead">
                    {joining || signalingStatus
                      ? signalingStatus || 'Ждём входящий звонок по вашей ссылке…'
                      : 'Ссылка активна. Или выберите контакт ниже.'}
                  </p>
                ) : (
                  <>
                    <p className="lead">
                      На связи: <strong>{peerLabel}</strong>
                    </p>
                    <div className="mega-grid">
                      <button type="button" className="mega-btn call" onClick={() => void startCall()}>
                        <Phone size={36} />
                        Позвонить
                      </button>
                      <button
                        type="button"
                        className="mega-btn chat"
                        onClick={() => setScreen('chat')}
                      >
                        <MessageCircle size={36} />
                        Написать
                      </button>
                      <button
                        type="button"
                        className="mega-btn media"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <ImagePlus size={36} />
                        Отправить фото / видео
                      </button>
                    </div>
                    <button type="button" className="text-link danger" onClick={disconnect}>
                      <Unplug size={16} /> Разорвать связь
                    </button>
                  </>
                )}
              </>
            )}

            {!guestPeerId && (
            <div className="contacts-panel">
              <div className="contacts-head">
                <h2>Контакты</h2>
                <span className="contacts-count">{contacts.length}</span>
              </div>
              {contacts.length === 0 ? (
                <p className="empty-contacts">
                  Пока пусто. Когда кто-то откроет вашу ссылку (или вы — чужую), контакт появится
                  здесь.
                </p>
              ) : (
                <ul className="contacts-list">
                  {contacts.map((c) => {
                    const online = onlineIds.has(c.id);
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          className="contact-row"
                          onClick={() => void connectToUser(c.id, c.name)}
                          disabled={connected && peerId === c.id}
                        >
                          <Avatar
                            name={c.name}
                            color={c.color}
                            avatarUrl={
                              c.avatarUrl ||
                              presenceUsers.find((u) => u.userId === c.id)?.avatarUrl
                            }
                            size="sm"
                            online={online ? true : 'off'}
                          />
                          <span className="contact-info">
                            <span className="contact-name">{c.name}</span>
                            <span className="contact-status">
                              {online ? 'в сети' : 'не в сети'}
                            </span>
                          </span>
                          <Phone size={18} className="contact-call" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            )}

            {getRoomIdFromUrl() && (
              <p className="hint muted-sep">
                Legacy-комната: {roomId} · {buildRoomShareUrl(roomId)}
              </p>
            )}
            {keyString && (
              <p className="hint muted-sep">
                E2EE активен · {guestPeerId ? `гость → ${guestPeerId}` : hostingSelf ? 'свой инбокс' : 'гостевой'}
              </p>
            )}
          </section>
        )}

        {screen === 'chat' && (
          <section className="chat">
            <div className="chat-top">
              <button type="button" className="text-link" onClick={() => setScreen('home')}>
                <ArrowLeft size={16} /> Назад
              </button>
              <div className="chat-peer">
                <Avatar
                  name={peerLabel}
                  color={peerColor}
                  avatarUrl={peerAvatarUrl}
                  size="sm"
                />
                <span>Переписка с {peerLabel}</span>
              </div>
              <button
                type="button"
                className="icon-btn"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Отправить фото"
              >
                <ImagePlus size={22} />
              </button>
            </div>

            <div className="chat-log">
              {messages.length === 0 ? (
                <p className="empty">Пока тихо. Напишите первое сообщение.</p>
              ) : (
                messages.map((m) => (
                  <div key={m.id} className={`bubble-wrap ${m.mine ? 'mine' : 'theirs'}`}>
                    {!m.mine && (
                      <Avatar
                        name={peerLabel}
                        color={peerColor}
                        avatarUrl={peerAvatarUrl}
                        size="sm"
                      />
                    )}
                    <div className={`bubble ${m.mine ? 'mine' : 'theirs'}`}>
                      {m.kind === 'text' && <p>{m.text}</p>}
                      {m.kind === 'file-pending' && (
                        <div className="file-pending-card">
                          <p className="file-pending-name">{m.mediaName ?? 'Файл'}</p>
                          <p className="file-pending-size">{formatFileSize(m.mediaSize ?? 0)}</p>
                          {!m.mine && (
                            <button
                              type="button"
                              className="accept-file-btn"
                              onClick={() => void acceptFile(m.id)}
                            >
                              <FileDown size={16} />
                              Принять файл
                            </button>
                          )}
                        </div>
                      )}
                      {m.kind === 'media' &&
                        m.mediaUrl &&
                        (m.mediaMime?.startsWith('video/') ? (
                          <video src={m.mediaUrl} controls className="media-preview" />
                        ) : (
                          <img src={m.mediaUrl} alt={m.mediaName || 'фото'} className="media-preview" />
                        ))}
                      <time>{m.time}</time>
                    </div>
                    {m.mine && (
                      <Avatar
                        name={identity.name}
                        color={identity.color}
                        avatarUrl={identity.avatarUrl}
                        size="sm"
                      />
                    )}
                  </div>
                ))
              )}
            </div>

            <form className="chat-compose" onSubmit={sendText}>
              <input
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Ваше сообщение…"
                disabled={!connected}
              />
              <button type="submit" disabled={!connected || !inputText.trim()} aria-label="Отправить">
                <Send size={22} />
              </button>
            </form>
          </section>
        )}

        {screen === 'call' && (
          <section className="call">
            {callState === 'ringing' ? (
              <div className="incoming-media-card">
                <div className="avatar lg" style={{ background: 'var(--call)' }}>
                  <PhoneIncoming size={28} />
                </div>
                <h2 className="incoming-media-title">Входящий звонок</h2>
                <p className="incoming-media-sub">{peerLabel}</p>
                <div className="incoming-call-actions row">
                  <button
                    type="button"
                    className="accept-file-btn large"
                    onClick={() => void acceptMediaCall()}
                  >
                    Принять
                  </button>
                  <button
                    type="button"
                    className="decline-call-btn large"
                    onClick={() => void declineMediaCall()}
                  >
                    Отклонить
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="call-stage">
                  <div className="video-circle remote">
                    <video ref={remoteVideoRef} autoPlay playsInline />
                    <span className="video-label">{peerLabel}</span>
                  </div>
                  <div className="video-circle local">
                    <video ref={localVideoRef} autoPlay playsInline muted />
                    <span className="video-label">Вы</span>
                  </div>
                </div>
                <p className="call-status">
                  {callState === 'calling'
                    ? 'Ожидаем ответа…'
                    : callState === 'in-call'
                      ? 'Разговор идёт'
                      : 'Звонок'}
                </p>
                <button
                  type="button"
                  className="mega-btn hangup"
                  onClick={() => void (callState === 'calling' ? hangUp() : hangUp())}
                >
                  <PhoneOff size={32} />
                  {callState === 'calling' ? 'Отменить' : 'Завершить'}
                </button>
              </>
            )}
          </section>
        )}
      </main>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void sendMedia(file);
          e.target.value = '';
        }}
      />
    </div>
  );
}
