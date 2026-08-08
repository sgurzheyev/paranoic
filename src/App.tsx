import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Phone,
  MessageCircle,
  ImagePlus,
  Shield,
  Copy,
  Check,
  CheckCheck,
  Clock,
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
  Paperclip,
  Monitor,
  MonitorOff,
  Ghost,
  Timer,
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
import { P2PConnection, type CallState, type NetworkQuality, type P2PStatus, type SignalingDebugStatus } from './p2p';
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
  updateStoredMessage,
  purgeExpiredMessages,
  EPHEMERAL_TTL_MS,
  type DeliveryStatus,
  type StoredMessage,
} from './storage';
import { loadSettings, type AppSettings } from './settings';
import {
  enqueueOutbox,
  listOutbox,
  removeOutboxMany,
} from './outbox';
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
import { ANTARCTICA, watchGeo, WorldPresence, type GeoPoint, type PresenceUser } from './presence';
import { syncProfileToSupabase } from './profile';

type AppMode = 'select' | AppModeChoice;
type Screen = 'home' | 'chat' | 'call';

type ChatMessage = StoredMessage & {
  mediaUrl?: string;
  /** 0..1 для file-transfer / исходящей отправки. */
  transferProgress?: number;
};

function toStored(message: ChatMessage): StoredMessage {
  const { mediaUrl: _url, transferProgress: _p, ...stored } = message;
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
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [appMode, setAppMode] = useState<AppMode>(() =>
    getMagicTargetFromUrl() || getRoomIdFromUrl() ? 'paranoic' : 'select'
  );
  const [secretKey, setSecretKey] = useState<CryptoKey | null>(null);
  const [keyString, setKeyString] = useState('');
  const [p2pStatus, setP2pStatus] = useState<P2PStatus>('idle');
  const [callState, setCallState] = useState<CallState>('idle');
  const [screenSharing, setScreenSharing] = useState(false);
  const [networkQuality, setNetworkQuality] = useState<NetworkQuality>('good');
  const [screen, setScreen] = useState<Screen>('home');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [peerTyping, setPeerTyping] = useState(false);
  /** id → счётчик вспышек ❤️ для перезапуска анимации. */
  const [heartBursts, setHeartBursts] = useState<Record<string, number>>({});
  const [error, setError] = useState('');
  const [roomId, setRoomId] = useState('');
  const [magicLink, setMagicLink] = useState(() => buildMagicLink(getOrCreateIdentity().id));
  const [copied, setCopied] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  /** id → прогресс исходящей/входящей передачи для баблов. */
  const [transferProgressMap, setTransferProgressMap] = useState<Record<string, number>>({});
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
  /** После Family Mode «Позвонить» — стартуем медиазвонок, когда P2P готов. */
  const pendingStartCallRef = useRef(false);
  const screenRef = useRef<Screen>(screen);
  const pendingReadAckRef = useRef<Set<string>>(new Set());
  const flushOutboxRef = useRef<() => Promise<void>>(async () => undefined);
  const ensureP2PRef = useRef<() => P2PConnection>(() => {
    throw new Error('P2P not ready');
  });
  const typingIdleTimerRef = useRef<number | null>(null);
  const typingSentRef = useRef(false);
  const peerTypingClearRef = useRef<number | null>(null);
  const lastBubbleTapRef = useRef<{ id: string; at: number } | null>(null);

  useEffect(() => {
    guestPeerIdRef.current = guestPeerId;
  }, [guestPeerId]);

  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

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

  const stopTypingPing = useCallback(() => {
    if (typingIdleTimerRef.current != null) {
      window.clearTimeout(typingIdleTimerRef.current);
      typingIdleTimerRef.current = null;
    }
    if (typingSentRef.current) {
      typingSentRef.current = false;
      p2pRef.current?.sendTyping(false);
    }
  }, []);

  const pingTyping = useCallback(() => {
    if (!p2pRef.current?.isReady) return;
    if (!typingSentRef.current) {
      typingSentRef.current = true;
      p2pRef.current.sendTyping(true);
    }
    if (typingIdleTimerRef.current != null) {
      window.clearTimeout(typingIdleTimerRef.current);
    }
    typingIdleTimerRef.current = window.setTimeout(() => {
      typingIdleTimerRef.current = null;
      typingSentRef.current = false;
      p2pRef.current?.sendTyping(false);
    }, 1800);
  }, []);

  const setActivePeer = useCallback(
    async (id: string | null, label?: string) => {
      peerIdRef.current = id;
      setPeerId(id);
      if (label) setPeerLabel(label);
      setPeerTyping(false);
      stopTypingPing();
      const conv = id ? conversationId(identityRef.current.id, id) : null;
      conversationIdRef.current = conv;
      await hydrateConversation(conv);
    },
    [hydrateConversation, stopTypingPing]
  );

  const addMessage = useCallback(async (message: ChatMessage, persist = true) => {
    const withAge: ChatMessage = {
      ...message,
      createdAt: message.createdAt ?? Date.now(),
    };
    setMessages((prev) => {
      if (prev.some((m) => m.id === withAge.id)) {
        return prev.map((m) => (m.id === withAge.id ? { ...m, ...withAge } : m));
      }
      return [...prev, withAge];
    });
    const conv = conversationIdRef.current;
    if (
      persist &&
      conv &&
      withAge.kind !== 'file-pending' &&
      withAge.kind !== 'file-transfer'
    ) {
      await appendStoredMessage(conv, toStored(withAge));
    }
  }, []);

  const patchDeliveryStatus = useCallback(async (ids: string[], status: DeliveryStatus) => {
    if (ids.length === 0) return;
    setMessages((prev) =>
      prev.map((m) => {
        if (!m.mine || !ids.includes(m.id)) return m;
        if (m.deliveryStatus === 'read') return m;
        if (m.deliveryStatus === 'delivered' && status === 'delivered') return m;
        return { ...m, deliveryStatus: status };
      })
    );
    const conv = conversationIdRef.current;
    if (conv) {
      for (const id of ids) {
        await updateStoredMessage(conv, id, { deliveryStatus: status });
      }
    }
    if (status === 'delivered' || status === 'read') {
      await removeOutboxMany(ids);
    }
  }, []);

  const applyHeart = useCallback((id: string, animate: boolean) => {
    if (!id) return;
    if (animate) {
      setHeartBursts((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
    }
    setMessages((prev) => {
      const target = prev.find((m) => m.id === id);
      if (target?.hearted) return prev;
      return prev.map((m) => (m.id === id ? { ...m, hearted: true } : m));
    });
    const conv = conversationIdRef.current;
    if (conv) void updateStoredMessage(conv, id, { hearted: true });
  }, []);

  const likeMessage = useCallback(
    (id: string) => {
      applyHeart(id, true);
      p2pRef.current?.sendReaction(id, '❤️');
    },
    [applyHeart]
  );

  const onBubbleTap = useCallback(
    (id: string, target: EventTarget | null) => {
      if (
        target instanceof Element &&
        target.closest('a, button, video, audio, input, textarea')
      ) {
        return;
      }
      const now = Date.now();
      const last = lastBubbleTapRef.current;
      if (last && last.id === id && now - last.at < 340) {
        lastBubbleTapRef.current = null;
        likeMessage(id);
      } else {
        lastBubbleTapRef.current = { id, at: now };
      }
    },
    [likeMessage]
  );

  const flushOutbox = useCallback(async () => {
    const p2p = p2pRef.current;
    const peer = peerIdRef.current;
    if (!p2p?.isReady || !peer) return;
    const pending = await listOutbox(peer);
    for (const item of pending) {
      try {
        p2p.send(item.packet);
      } catch (e) {
        console.warn('[paranoic outbox] flush failed', e);
        break;
      }
    }
  }, []);

  flushOutboxRef.current = flushOutbox;

  useEffect(() => {
    const onOnline = () => {
      void flushOutboxRef.current();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  /** Когда открыт чат — шлём read-ack по накопленным входящим. */
  useEffect(() => {
    if (screen !== 'chat' || p2pStatus !== 'connected') return;
    const ids = [...pendingReadAckRef.current];
    if (ids.length === 0) return;
    pendingReadAckRef.current.clear();
    p2pRef.current?.sendMessageAck(ids, 'read');
  }, [screen, p2pStatus, messages.length]);

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
    void purgeLegacyGlobalHistory(identityRef.current.id);
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

  /** Presence + GPS (или Ghost Mode / Антарктида). */
  useEffect(() => {
    if (appMode !== 'paranoic' && appMode !== 'family') return;

    let cancelled = false;
    const geoWatchBox: { stop: (() => void) | null } = { stop: null };
    const presence = new WorldPresence({
      onSync: (users) => {
        if (!cancelled) setPresenceUsers(users);
      },
      onError: (err) => {
        if (!cancelled) console.warn('[presence]', err.message);
      },
    });
    presenceRef.current = presence;
    const ghost = settings.ghostMode;

    void (async () => {
      setGeo({ ...ANTARCTICA });
      try {
        await presence.start({
          userId: identityRef.current.id,
          name: identityRef.current.name,
          color: identityRef.current.color,
          avatarUrl: identityRef.current.avatarUrl,
          themeFon: identityRef.current.themeFon,
          lat: ANTARCTICA.lat,
          lng: ANTARCTICA.lng,
        });
      } catch (e) {
        if (!cancelled) {
          console.warn('[presence] start failed', e);
        }
        return;
      }
      if (cancelled) {
        void presence.stop();
        return;
      }

      if (ghost) {
        // Ghost Mode: не трогаем watchPosition, остаёмся в Антарктиде.
        setGeo({ ...ANTARCTICA });
        void presence.updateLocation(ANTARCTICA.lat, ANTARCTICA.lng);
      } else {
        const handle = watchGeo((point) => {
          if (cancelled) return;
          setGeo(point);
          void presence.updateLocation(point.lat, point.lng);
        });
        geoWatchBox.stop = () => handle.stop();
      }

      void syncProfileToSupabase(identityRef.current);
    })();

    return () => {
      cancelled = true;
      geoWatchBox.stop?.();
      void presence.stop();
      if (presenceRef.current === presence) presenceRef.current = null;
    };
  }, [appMode, identity.id, settings.ghostMode]);

  /** Эфемерные сообщения: чистим IndexedDB каждые 5 мин и при включении настройки. */
  useEffect(() => {
    if (!settings.ephemeral24h) return;

    const runPurge = async () => {
      const { removed, conversationIds } = await purgeExpiredMessages(EPHEMERAL_TTL_MS);
      if (removed === 0) return;
      const conv = conversationIdRef.current;
      if (conv && conversationIds.includes(conv)) {
        await hydrateConversation(conv);
      }
    };

    void runPurge();
    const timer = window.setInterval(() => void runPurge(), 5 * 60_000);
    return () => window.clearInterval(timer);
  }, [settings.ephemeral24h, hydrateConversation]);

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
            void flushOutboxRef.current();
            if (pendingStartCallRef.current) {
              pendingStartCallRef.current = false;
              void (async () => {
                try {
                  await p2pRef.current?.startCall();
                  setScreen('call');
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Не удалось начать звонок');
                }
              })();
            }
          } else {
            setPeerTyping(false);
            typingSentRef.current = false;
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
            setScreenSharing(false);
            setNetworkQuality('good');
            setScreen((s) => (s === 'call' ? 'home' : s));
          }
        },
        onNetworkQuality: (quality) => setNetworkQuality(quality),
        onScreenShare: (active) => setScreenSharing(active),
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
        onLocalStream: (stream) => {
          attachLocalVideo(stream);
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
            const packet = JSON.parse(payload) as {
              cipher: string;
              iv: string;
              sender: string;
              id?: string;
            };
            const text = await decryptMessage(packet.cipher, packet.iv, key);
            const id = packet.id || `m-${Date.now()}`;
            setPeerTyping(false);
            await addMessage({
              id,
              sender: packet.sender || 'Близкий',
              text,
              time: nowTime(),
              mine: false,
              kind: 'text',
            });
            if (packet.sender) setPeerLabel(packet.sender);
            p2pRef.current?.sendMessageAck([id], 'delivered');
            if (screenRef.current === 'chat') {
              p2pRef.current?.sendMessageAck([id], 'read');
            } else {
              pendingReadAckRef.current.add(id);
            }
          } catch {
            setError('Сообщение не удалось прочитать.');
          }
        },
        onMessageDelivery: (ids, status) => {
          void patchDeliveryStatus(ids, status);
        },
        onTyping: (active) => {
          setPeerTyping(active);
          if (peerTypingClearRef.current != null) {
            window.clearTimeout(peerTypingClearRef.current);
            peerTypingClearRef.current = null;
          }
          if (active) {
            peerTypingClearRef.current = window.setTimeout(() => {
              peerTypingClearRef.current = null;
              setPeerTyping(false);
            }, 3200);
          }
        },
        onMessageReaction: (id) => {
          applyHeart(id, true);
        },
        onFileIncoming: (meta) => {
          setMessages((prev) => {
            if (prev.some((m) => m.id === meta.id)) return prev;
            return [
              ...prev,
              {
                id: meta.id,
                sender: peerLabel,
                time: nowTime(),
                mine: false,
                kind: 'file-transfer',
                mediaMime: meta.mime,
                mediaName: meta.name,
                mediaSize: meta.size,
                transferProgress: 0,
              },
            ];
          });
          setScreen('chat');
        },
        onEncryptedFile: async (meta, cipher, iv) => {
          const key = secretKeyRef.current;
          if (!key) return;
          try {
            const plain = await decryptBytes(cipher, iv, key);
            const blob = new Blob([plain], { type: meta.mime });
            const mediaKey = mediaStorageKey(meta.id);
            const mediaUrl = URL.createObjectURL(blob);
            mediaUrlsRef.current.add(mediaUrl);
            await saveMediaBlob(mediaKey, blob);

            setMessages((prev) => {
              const updated: ChatMessage = {
                id: meta.id,
                sender: peerLabel,
                time: nowTime(),
                mine: false,
                kind: 'media',
                mediaMime: meta.mime,
                mediaName: meta.name,
                mediaSize: meta.size,
                mediaKey,
                mediaUrl,
                transferProgress: 1,
              };
              return prev.some((m) => m.id === meta.id)
                ? prev.map((m) => (m.id === meta.id ? { ...m, ...updated } : m))
                : [...prev, updated];
            });

            const conv = conversationIdRef.current;
            if (conv) {
              await appendStoredMessage(conv, {
                id: meta.id,
                sender: peerLabel,
                time: nowTime(),
                mine: false,
                kind: 'media',
                mediaMime: meta.mime,
                mediaName: meta.name,
                mediaSize: meta.size,
                mediaKey,
              });
            }
            setTransferProgressMap((p) => {
              const { [meta.id]: _drop, ...rest } = p;
              return rest;
            });
            setScreen('chat');
          } catch {
            setError('Не удалось расшифровать файл');
          }
        },
        onFileProgress: (id, progress) => {
          setUploadProgress(progress < 1 ? progress : null);
          setTransferProgressMap((prev) => ({ ...prev, [id]: progress }));
          setMessages((prev) =>
            prev.map((m) =>
              m.id === id && (m.kind === 'file-transfer' || m.kind === 'file-pending')
                ? { ...m, transferProgress: progress, kind: 'file-transfer' }
                : m
            )
          );
        },
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
  }, [addMessage, applyHeart, attachLocalVideo, patchDeliveryStatus, peerLabel, setActivePeer]);

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
      await ensureP2P().startCall();
      attachLocalVideo(null);
      setScreen('call');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось начать звонок');
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
    setScreenSharing(false);
    setNetworkQuality('good');
    setScreen('home');
  };

  const toggleScreenShare = async () => {
    setError('');
    try {
      const active = await ensureP2P().toggleScreenShare();
      setScreenSharing(active);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось переключить демонстрацию экрана');
    }
  };

  const sendText = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = inputText.trim();
    if (!text || !secretKey) return;

    const peer = peerIdRef.current;
    const conv = conversationIdRef.current;
    if (!peer || !conv) {
      setError('Сначала выберите собеседника');
      return;
    }

    const id = `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const encrypted = await encryptMessage(text, secretKey);
    const packet = JSON.stringify({
      cipher: encrypted.cipher,
      iv: encrypted.iv,
      sender: identityRef.current.name,
      id,
    });

    await addMessage({
      id,
      sender: 'Я',
      text,
      time: nowTime(),
      mine: true,
      kind: 'text',
      deliveryStatus: 'sending',
    });
    setInputText('');
    stopTypingPing();
    setError('');
    setScreen('chat');

    try {
      if (p2pRef.current?.isReady) {
        p2pRef.current.send(packet);
      } else {
        await enqueueOutbox({
          id,
          conversationId: conv,
          peerUserId: peer,
          createdAt: Date.now(),
          text,
          packet,
        });
      }
    } catch {
      await enqueueOutbox({
        id,
        conversationId: conv,
        peerUserId: peer,
        createdAt: Date.now(),
        text,
        packet,
      });
    }
  };

  const sendMedia = async (file: File) => {
    if (!secretKey || !p2pRef.current?.isReady) return;
    setError('');
    const transferId = `f-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setUploadProgress(0);
    setTransferProgressMap((p) => ({ ...p, [transferId]: 0 }));
    setMessages((prev) => [
      ...prev,
      {
        id: transferId,
        sender: 'Я',
        time: nowTime(),
        mine: true,
        kind: 'file-transfer',
        mediaMime: file.type || 'application/octet-stream',
        mediaName: file.name,
        mediaSize: file.size,
        transferProgress: 0,
      },
    ]);
    setScreen('chat');

    const mediaKey = mediaStorageKey(transferId);
    try {
      await p2pRef.current.sendFile(
        file,
        (data) => encryptBytes(data, secretKey),
        { transferId }
      );

      const mediaUrl = URL.createObjectURL(file);
      mediaUrlsRef.current.add(mediaUrl);
      await saveMediaBlob(mediaKey, file);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === transferId
            ? {
                ...m,
                kind: 'media' as const,
                mediaUrl,
                mediaKey,
                transferProgress: 1,
              }
            : m
        )
      );
      const conv = conversationIdRef.current;
      if (conv) {
        await appendStoredMessage(conv, {
          id: transferId,
          sender: 'Я',
          time: nowTime(),
          mine: true,
          kind: 'media',
          mediaMime: file.type,
          mediaName: file.name,
          mediaSize: file.size,
          mediaKey,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Файл не отправился');
      setMessages((prev) => prev.filter((m) => m.id !== transferId));
    } finally {
      setUploadProgress(null);
      setTransferProgressMap((p) => {
        const { [transferId]: _drop, ...rest } = p;
        return rest;
      });
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
        geoSource={
          settings.ghostMode ? 'antarctica' : geo ? geo.source : 'pending'
        }
        onChatUser={(user) => {
          void connectToUser(user.userId, user.isContact ? user.name : 'Незнакомец');
        }}
        onCallUser={(user) => {
          pendingStartCallRef.current = true;
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
          settings={settings}
          onClose={() => setProfileOpen(false)}
          onSaved={(next) => applyIdentity(next)}
          onSettingsChange={setSettings}
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
                {settings.ghostMode && (
                  <p className="ghost-mode-pill">
                    <Ghost size={12} /> Ghost Mode · Антарктида
                  </p>
                )}
                {settings.ephemeral24h && (
                  <p className="ghost-mode-pill soft">
                    <Timer size={12} /> Сообщения исчезают через 24 ч
                  </p>
                )}
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
                aria-label="Прикрепить файл"
                disabled={!connected}
              >
                <Paperclip size={22} />
              </button>
            </div>

            <div className="chat-log">
              {messages.length === 0 ? (
                <p className="empty">Пока тихо. Напишите первое сообщение.</p>
              ) : (
                messages.map((m) => {
                  const progress =
                    m.transferProgress ?? transferProgressMap[m.id] ?? null;
                  const isMediaPreview =
                    m.kind === 'media' &&
                    m.mediaUrl &&
                    (m.mediaMime?.startsWith('image/') ||
                      m.mediaMime?.startsWith('video/') ||
                      !m.mediaMime);
                  const isGenericFile =
                    m.kind === 'media' &&
                    m.mediaUrl &&
                    m.mediaMime &&
                    !m.mediaMime.startsWith('image/') &&
                    !m.mediaMime.startsWith('video/');

                  return (
                  <div key={m.id} className={`bubble-wrap ${m.mine ? 'mine' : 'theirs'}`}>
                    {!m.mine && (
                      <Avatar
                        name={peerLabel}
                        color={peerColor}
                        avatarUrl={peerAvatarUrl}
                        size="sm"
                      />
                    )}
                    <div
                      className={`bubble ${m.mine ? 'mine' : 'theirs'}${m.hearted ? ' hearted' : ''}`}
                      onClick={(e) => onBubbleTap(m.id, e.target)}
                      role="presentation"
                    >
                      {heartBursts[m.id] != null && (
                        <span
                          key={heartBursts[m.id]}
                          className="heart-burst"
                          aria-hidden
                        >
                          ❤️
                        </span>
                      )}
                      {m.hearted && (
                        <span className="bubble-heart" aria-label="Нравится">
                          ❤️
                        </span>
                      )}
                      {m.kind === 'text' && <p>{m.text}</p>}
                      {(m.kind === 'file-transfer' || m.kind === 'file-pending') && (
                        <div className="file-transfer-card">
                          <p className="file-pending-name">{m.mediaName ?? 'Файл'}</p>
                          <p className="file-pending-size">
                            {formatFileSize(m.mediaSize ?? 0)}
                            {progress != null
                              ? ` · ${Math.round(progress * 100)}%`
                              : m.mine
                                ? ' · отправка…'
                                : ' · загрузка…'}
                          </p>
                          <div
                            className="file-progress-track"
                            role="progressbar"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={Math.round((progress ?? 0) * 100)}
                          >
                            <div
                              className="file-progress-fill"
                              style={{ width: `${Math.round((progress ?? 0) * 100)}%` }}
                            />
                          </div>
                          {m.kind === 'file-pending' && !m.mine && (
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
                      {isMediaPreview &&
                        (m.mediaMime?.startsWith('video/') ? (
                          <video src={m.mediaUrl} controls className="media-preview" />
                        ) : (
                          <img src={m.mediaUrl} alt={m.mediaName || 'фото'} className="media-preview" />
                        ))}
                      {isGenericFile && (
                        <div className="file-transfer-card">
                          <p className="file-pending-name">{m.mediaName ?? 'Файл'}</p>
                          <p className="file-pending-size">{formatFileSize(m.mediaSize ?? 0)}</p>
                          <a
                            className="accept-file-btn"
                            href={m.mediaUrl}
                            download={m.mediaName || 'file'}
                          >
                            <FileDown size={16} />
                            Скачать
                          </a>
                        </div>
                      )}
                      <div className="bubble-meta">
                        <time>{m.time}</time>
                        {m.mine && m.kind === 'text' && (
                          <span
                            className={`msg-delivery ${m.deliveryStatus ?? 'sending'}`}
                            title={
                              m.deliveryStatus === 'read'
                                ? 'Прочитано'
                                : m.deliveryStatus === 'delivered'
                                  ? 'Доставлено'
                                  : 'Отправляется'
                            }
                            aria-label={
                              m.deliveryStatus === 'read'
                                ? 'Прочитано'
                                : m.deliveryStatus === 'delivered'
                                  ? 'Доставлено'
                                  : 'Отправляется'
                            }
                          >
                            {m.deliveryStatus === 'read' ? (
                              <CheckCheck size={14} />
                            ) : m.deliveryStatus === 'delivered' ? (
                              <Check size={14} />
                            ) : (
                              <Clock size={13} />
                            )}
                          </span>
                        )}
                      </div>
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
                  );
                })
              )}
            </div>

            <div
              className={`typing-indicator${peerTyping ? ' visible' : ''}`}
              aria-live="polite"
              aria-hidden={!peerTyping}
            >
              {peerTyping ? (
                <>
                  <span className="typing-dots" aria-hidden>
                    <i />
                    <i />
                    <i />
                  </span>
                  Печатает…
                </>
              ) : null}
            </div>

            <form className="chat-compose" onSubmit={sendText}>
              <button
                type="button"
                className="chat-attach-btn"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Прикрепить файл"
                disabled={!peerId}
              >
                <Paperclip size={20} />
              </button>
              <input
                value={inputText}
                onChange={(e) => {
                  const value = e.target.value;
                  setInputText(value);
                  if (value.trim()) pingTyping();
                  else stopTypingPing();
                }}
                placeholder={
                  peerId
                    ? connected
                      ? 'Ваше сообщение…'
                      : 'Офлайн — сообщение уйдёт из очереди'
                    : 'Выберите собеседника…'
                }
                disabled={!peerId || !secretKey}
              />
              <button
                type="submit"
                disabled={!peerId || !secretKey || !inputText.trim()}
                aria-label="Отправить"
              >
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
                    ? 'Ожидаем ответа… Камера откроется после «Принять»'
                    : callState === 'in-call'
                      ? screenSharing
                        ? 'Демонстрация экрана'
                        : networkQuality === 'critical'
                          ? 'Слабая сеть — только аудио'
                          : networkQuality === 'poor'
                            ? 'Слабая сеть — понижено качество видео'
                            : 'Разговор идёт'
                      : 'Звонок'}
                </p>
                <div className="call-actions">
                  {callState === 'in-call' && (
                    <button
                      type="button"
                      className={`call-glass-btn ${screenSharing ? 'active' : ''}`}
                      onClick={() => void toggleScreenShare()}
                      aria-pressed={screenSharing}
                    >
                      {screenSharing ? <MonitorOff size={22} /> : <Monitor size={22} />}
                      {screenSharing ? 'Камера' : 'Показать экран'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="mega-btn hangup"
                    onClick={() => void hangUp()}
                  >
                    <PhoneOff size={32} />
                    {callState === 'calling' ? 'Отменить' : 'Завершить'}
                  </button>
                </div>
              </>
            )}
          </section>
        )}
      </main>

      <input
        ref={fileInputRef}
        type="file"
        accept="*/*"
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
