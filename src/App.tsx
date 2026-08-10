import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Phone,
  MessageCircle,
  ImagePlus,
  Copy,
  Check,
  CheckCheck,
  Clock,
  X,
  Unplug,
  Send,
  ArrowLeft,
  FileDown,
  Link2,
  Pencil,
  Settings2,
  Paperclip,
  Ghost,
  Timer,
  RefreshCw,
  PanelLeft,
  Mic,
  Video,
  Camera,
  ShieldCheck,
} from 'lucide-react';
import ModeSelector, { type AppModeChoice } from './ModeSelector';
import GlobeLobby, { type MapPerson } from './GlobeLobby';
import Avatar from './Avatar';
import ProfileModal from './ProfileModal';
import AdminDashboard from './AdminDashboard';
import CallOverlay from './CallOverlay';
import IncomingCallModal from './IncomingCallModal';
import LiquidNavigationBar, { type LiquidNavTab } from './LiquidNavigationBar';
import GuestDirectCall from './GuestDirectCall';
import ParanoicLogo from './ParanoicLogo';
import MediaNoteOverlay from './MediaNoteOverlay';
import { VideoCirclePlayer, VoiceNotePlayer } from './VideoCircle';
import {
  CallInbox,
  callerDisplayName,
  newCallId,
  type CallerInfo,
} from './callSignaling';
import { upsertCallSession, updateCallSessionStatus, fetchRingingCallsForUser } from './callSessions';
import { fetchMyAccessFlags } from './admin';
import { resolveCallerInfo } from './callers';
import {
  bindAudioUnlock,
  closeActiveNotification,
  playReceiveSound,
  playSendSound,
  startRingtone,
  stopRingtone,
  ensureNotifyPermission,
  notifyIfHidden,
  DELIVERY_LABELS,
} from './notify';
import {
  openNoteStream,
  recordMediaNote,
  stopStream,
  inferMediaKind,
  type NoteMode,
} from './mediaNotes';
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
import { loadSettings, saveSettings, type AppSettings } from './settings';
import {
  enqueueOutbox,
  listOutbox,
  removeOutboxMany,
} from './outbox';
import {
  syncPendingDeliveries,
  uploadPendingMedia,
  uploadPendingText,
} from './storeForward';
import {
  buildMagicLink,
  clearMagicParamFromUrl,
  getMagicTargetFromUrl,
  getOrCreateIdentity,
  personalInboxRoom,
  resolveMagicRoute,
  updateIdentity,
  looksLikeUsername,
  type UserIdentity,
} from './identity';
import {
  loadContacts,
  removeContact,
  upsertContact,
  validateContactForCall,
  type Contact,
} from './contacts';
import {
  clearCallResidueState,
  clearCallSessionResidue,
  clearEphemeralGuestId,
  saveCallResidue,
} from './callSessionCleanup';
import { ANTARCTICA, watchGeo, WorldPresence, type GeoPoint, type PresenceUser } from './presence';
import { syncProfileToSupabase, resolveHandleToUserId } from './profile';

type AppMode = 'select' | AppModeChoice;
type Screen = 'home' | 'chat' | 'call';

type ChatMessage = StoredMessage & {
  mediaUrl?: string;
  /** 0..1 для file-transfer / исходящей отправки. */
  transferProgress?: number;
  /** Обрыв связи во время передачи. */
  transferFailed?: boolean;
};

function toStored(message: ChatMessage): StoredMessage {
  const { mediaUrl: _url, transferProgress: _p, transferFailed: _f, ...stored } = message;
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
  const [appMode, setAppMode] = useState<AppMode>(() => {
    if (getMagicTargetFromUrl() || getRoomIdFromUrl()) return 'paranoic';
    try {
      const start = new URLSearchParams(window.location.search).get('start');
      if (start === 'paranoic' || start === 'family') return start;
    } catch {
      /* */
    }
    return 'select';
  });
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
  const [magicLink, setMagicLink] = useState(() =>
    buildMagicLink(getOrCreateIdentity())
  );
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
  const [adminOpen, setAdminOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isBanned, setIsBanned] = useState(false);
  const [peerAvatarUrl, setPeerAvatarUrl] = useState('');
  const [peerColor, setPeerColor] = useState('#60a5fa');
  const [sessionEpoch, setSessionEpoch] = useState(0);
  /** Гостевой peer из ?u= — держим явно, чтобы не «съехать» на свой инбокс. */
  const [guestPeerId, setGuestPeerId] = useState<string | null>(() => {
    const me = getOrCreateIdentity();
    const route = resolveMagicRoute(me.id, me.username);
    // Username в URL резолвим асинхронно — не подставляем handle как peer id.
    if (route.kind !== 'guest') return null;
    if (looksLikeUsername(route.peerId)) return null;
    return route.peerId;
  });
  const [hostingSelf, setHostingSelf] = useState(() => {
    const me = getOrCreateIdentity();
    const route = resolveMagicRoute(me.id, me.username);
    return route.kind !== 'guest';
  });
  const [incomingConnection, setIncomingConnection] = useState(false);
  /** Caller ID из Realtime call_offer / DC invite. */
  const [incomingRing, setIncomingRing] = useState<{
    callId: string;
    from: CallerInfo;
  } | null>(null);
  /** PiP свёрнут / развёрнут на весь экран. */
  const [callExpanded, setCallExpanded] = useState(false);
  /** Мобильный сайдбар контактов в мессенджере. */
  const [messengerSidebarOpen, setMessengerSidebarOpen] = useState(false);
  /** Режим заметки: голос или видео-кружочек. */
  const [noteMode, setNoteMode] = useState<NoteMode>('video');
  const [noteRecording, setNoteRecording] = useState<{
    stream: MediaStream;
    progress: number;
  } | null>(null);

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
  /** Исходящие File для «Повторить попытку» после обрыва. */
  const retrySendFilesRef = useRef<Map<string, File>>(new Map());
  const noteSessionRef = useRef<{
    stop: () => void;
    abort: AbortController;
    stream: MediaStream;
  } | null>(null);
  const noteReleasePendingRef = useRef(false);
  const presenceRef = useRef<WorldPresence | null>(null);
  const guestPeerIdRef = useRef<string | null>(guestPeerId);
  /** После Family Mode «Позвонить» — стартуем медиазвонок, когда P2P готов. */
  const pendingStartCallRef = useRef(false);
  /** После Accept по Realtime — принять WebRTC, когда придёт call-invite. */
  const pendingRingAcceptRef = useRef(false);
  const pendingAcceptCallerRef = useRef<CallerInfo | null>(null);
  const outboundCallIdRef = useRef<string | null>(null);
  const callInboxRef = useRef<CallInbox | null>(null);
  const isBannedRef = useRef(false);
  const peerMetaRef = useRef({
    id: '',
    label: 'Близкий',
    avatarUrl: '',
    color: '#60a5fa',
  });
  const screenRef = useRef<Screen>(screen);
  const pendingReadAckRef = useRef<Set<string>>(new Set());
  const flushOutboxRef = useRef<() => Promise<void>>(async () => undefined);
  const syncPendingRef = useRef<() => Promise<void>>(async () => undefined);
  const syncingPendingLockRef = useRef(false);
  const ensureP2PRef = useRef<() => P2PConnection>(() => {
    throw new Error('P2P not ready');
  });
  const typingIdleTimerRef = useRef<number | null>(null);
  const typingSentRef = useRef(false);
  const peerTypingClearRef = useRef<number | null>(null);
  const lastBubbleTapRef = useRef<{ id: string; at: number } | null>(null);
  const contactsRef = useRef(contacts);
  const presenceUsersRef = useRef(presenceUsers);

  useEffect(() => {
    guestPeerIdRef.current = guestPeerId;
  }, [guestPeerId]);

  useEffect(() => {
    contactsRef.current = contacts;
  }, [contacts]);

  useEffect(() => {
    presenceUsersRef.current = presenceUsers;
  }, [presenceUsers]);

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
        target.closest(
          'a, button, video, audio, input, textarea, .video-circle-note, .voice-note, .video-circle-expand-backdrop'
        )
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
        await patchDeliveryStatus([item.id], 'delivered');
        playSendSound();
      } catch (e) {
        console.warn('[paranoic outbox] flush failed', e);
        break;
      }
    }
  }, [patchDeliveryStatus]);

  flushOutboxRef.current = flushOutbox;

  /** Store-and-Forward: забрать pending_delivery, расшифровать, удалить с сервера. */
  const syncStoreForward = useCallback(async () => {
    if (!hasSupabaseConfig() || syncingPendingLockRef.current) return;
    const me = identityRef.current.id;
    if (!me) return;
    syncingPendingLockRef.current = true;
    try {
      await syncPendingDeliveries(me, {
        onText: async (msg) => {
          const existing = await loadChatHistory(msg.conversationId);
          if (existing.some((m) => m.id === msg.id)) return;

          const row = {
            id: msg.id,
            sender: msg.senderName,
            text: msg.text,
            time: new Date(msg.createdAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            }),
            mine: false,
            kind: 'text' as const,
            createdAt: msg.createdAt,
          };
          await appendStoredMessage(msg.conversationId, row);
          if (conversationIdRef.current === msg.conversationId) {
            await addMessage(row, false);
          }
          playReceiveSound();
          notifyIfHidden(msg.senderName || 'Новое сообщение', {
            body: msg.text.slice(0, 120),
            tag: `paranoic-msg-${msg.id}`,
          });
        },
        onMedia: async (msg) => {
          const existing = await loadChatHistory(msg.conversationId);
          if (existing.some((m) => m.id === msg.id)) return;

          const mediaKey = mediaStorageKey(msg.id);
          await saveMediaBlob(mediaKey, msg.blob);
          const mediaUrl = URL.createObjectURL(msg.blob);
          mediaUrlsRef.current.add(mediaUrl);
          const row = {
            id: msg.id,
            sender: msg.senderName,
            time: new Date(msg.createdAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            }),
            mine: false,
            kind: 'media' as const,
            mediaMime: msg.mime,
            mediaName: msg.name,
            mediaSize: msg.size,
            mediaKind: inferMediaKind(msg.name, msg.mime),
            mediaKey,
            createdAt: msg.createdAt,
          };
          await appendStoredMessage(msg.conversationId, row);
          if (conversationIdRef.current === msg.conversationId) {
            await addMessage({ ...row, mediaUrl }, false);
          }
          playReceiveSound();
          notifyIfHidden(msg.senderName || 'Новый файл', {
            body: msg.name || 'Медиафайл',
            tag: `paranoic-media-${msg.id}`,
          });
        },
      });
    } catch (e) {
      console.warn('[paranoic SAF] sync', e);
    } finally {
      syncingPendingLockRef.current = false;
    }
  }, [addMessage]);

  syncPendingRef.current = syncStoreForward;

  useEffect(() => {
    const onOnline = () => {
      void flushOutboxRef.current();
      void syncPendingRef.current();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  /** При входе в Paranoic — сразу забираем отложенную почту. */
  useEffect(() => {
    if (appMode !== 'paranoic') return;
    void syncPendingRef.current();
    const timer = window.setInterval(() => void syncPendingRef.current(), 45_000);
    return () => window.clearInterval(timer);
  }, [appMode, identity.id, sessionEpoch]);

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
    // Снос только residue прошлой сессии (host-флаги legacy ?room= оставляем для F5).
    clearCallResidueState();
  }, []);

  useEffect(() => {
    const onLeave = () => {
      if (p2pRef.current?.currentStatus === 'failed' || p2pRef.current?.currentStatus === 'disconnected') {
        clearCallSessionResidue();
      }
    };
    window.addEventListener('pagehide', onLeave);
    return () => window.removeEventListener('pagehide', onLeave);
  }, []);

  useEffect(() => {
    identityRef.current = identity;
    setMagicLink(buildMagicLink(identity));
  }, [identity]);

  useEffect(() => {
    peerMetaRef.current = {
      id: peerId || guestPeerId || '',
      label: peerLabel,
      avatarUrl: peerAvatarUrl,
      color: peerColor,
    };
  }, [peerId, guestPeerId, peerLabel, peerAvatarUrl, peerColor]);

  /** Разблокировка автоплея рингтона после первого жеста. */
  useEffect(() => bindAudioUnlock(), []);

  /** Роль admin / бан из profiles. */
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      if (!hasSupabaseConfig()) return;
      const flags = await fetchMyAccessFlags(identity.id);
      if (cancelled) return;
      setIsAdmin(flags.role === 'admin');
      const wasBanned = isBannedRef.current;
      setIsBanned(flags.isBanned);
      isBannedRef.current = flags.isBanned;
      if (flags.isBanned && !wasBanned) {
        pendingStartCallRef.current = false;
        stopRingtone();
        p2pRef.current?.close();
        p2pRef.current = null;
        setCallState('idle');
        setP2pStatus('idle');
        setSessionEpoch((n) => n + 1);
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 45_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [identity.id]);

  /** Постоянный слушатель call_offer на calls:{myId}. */
  useEffect(() => {
    if (!hasSupabaseConfig()) return;
    let cancelled = false;
    const inbox = new CallInbox({
      onOffer: (offer) => {
        if (cancelled) return;
        if (isBannedRef.current) return;
        setAppMode((m) => (m === 'select' ? 'paranoic' : m));
        setIncomingConnection(false);
        setPeerLabel(offer.from.name || callerDisplayName(offer.from));
        setPeerAvatarUrl(offer.from.avatarUrl || '');
        setPeerColor(offer.from.color || '#60a5fa');
        peerMetaRef.current = {
          id: offer.from.id,
          label: offer.from.name || callerDisplayName(offer.from),
          avatarUrl: offer.from.avatarUrl || '',
          color: offer.from.color || '#60a5fa',
        };
        setIncomingRing({ callId: offer.callId, from: offer.from });
        setCallExpanded(true);
        startRingtone();
        notifyIfHidden('Входящий звонок', {
          body: `Вам звонит ${callerDisplayName(offer.from)}`,
          tag: 'paranoic-call',
        });
      },
      onReject: () => {
        if (cancelled) return;
        stopRingtone();
        closeActiveNotification();
        outboundCallIdRef.current = null;
        setError('Звонок отклонён');
        void p2pRef.current?.hangUp();
        setCallState('idle');
      },
      onCancel: (event) => {
        if (cancelled) return;
        setIncomingRing((prev) => {
          if (prev && prev.callId !== event.callId && prev.from.id !== event.fromUserId) {
            return prev;
          }
          return null;
        });
        pendingRingAcceptRef.current = false;
        stopRingtone();
        closeActiveNotification();
        if (p2pRef.current?.currentCallState === 'ringing') {
          void p2pRef.current.declineCall();
        }
      },
    });
    callInboxRef.current = inbox;
    void inbox.start(identity.id).catch((e) => {
      console.warn('[P2P Audit] call inbox start failed', e);
    });
    return () => {
      cancelled = true;
      callInboxRef.current = null;
      void inbox.stop();
    };
  }, [identity.id]);

  /** Fallback: poll call_sessions если Realtime offer потерялся в фоне. */
  useEffect(() => {
    if (!hasSupabaseConfig()) return;
    let cancelled = false;
    const seen = new Set<string>();

    const poll = async () => {
      if (cancelled || isBannedRef.current) return;
      if (document.visibilityState === 'hidden') return;
      try {
        const rows = await fetchRingingCallsForUser(identity.id);
        for (const row of rows) {
          if (seen.has(row.call_id)) continue;
          if (p2pRef.current?.currentCallState !== 'idle') continue;

          const caller = await resolveCallerInfo(
            row.from_user_id,
            contactsRef.current,
            presenceUsersRef.current
          );
          if (cancelled) continue;

          let applied = false;
          setIncomingRing((prev) => {
            if (prev) {
              seen.add(prev.callId);
              return prev;
            }
            applied = true;
            return { callId: row.call_id, from: caller };
          });
          seen.add(row.call_id);
          if (!applied) continue;

          console.log('[P2P Audit] call_sessions poll recovered offer', row.call_id);
          setPeerLabel(caller.name || callerDisplayName(caller));
          setPeerAvatarUrl(caller.avatarUrl || '');
          setPeerColor(caller.color || '#60a5fa');
          peerMetaRef.current = {
            id: caller.id,
            label: caller.name || callerDisplayName(caller),
            avatarUrl: caller.avatarUrl || '',
            color: caller.color || '#60a5fa',
          };
          startRingtone();
          notifyIfHidden('Входящий звонок', {
            body: `Вам звонит ${callerDisplayName(caller)}`,
            tag: 'paranoic-call',
          });
        }
      } catch (e) {
        console.warn('[P2P Audit] call_sessions poll error', e);
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), 8_000);
    const onVis = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [identity.id]);

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
            setIncomingRing(null);
            stopRingtone();
            closeActiveNotification();
            // Гость по магической ссылке — сразу в диалог с этим peer.
            if (guestPeerIdRef.current) {
              setScreen('chat');
            }
            void flushOutboxRef.current();
            void syncPendingRef.current();
            if (pendingStartCallRef.current) {
              pendingStartCallRef.current = false;
              if (isBannedRef.current) {
                setError('Ваш аккаунт заблокирован. Звонки недоступны.');
              } else {
              void (async () => {
                try {
                  const me = identityRef.current;
                  const target =
                    guestPeerIdRef.current || peerIdRef.current || peerMetaRef.current.id;
                  if (target && target === me.id) {
                    setError(
                      'Вы пытаетесь позвонить на это же устройство / аккаунт. Откройте ссылку другого человека или войдите с другого профиля.'
                    );
                    pendingStartCallRef.current = false;
                    clearCallSessionResidue();
                    return;
                  }
                  if (target) {
                    const callId = newCallId();
                    outboundCallIdRef.current = callId;
                    void callInboxRef.current?.sendOffer(
                      target,
                      {
                        id: me.id,
                        name: me.name,
                        username: me.username || '',
                        avatarUrl: me.avatarUrl || '',
                        color: me.color,
                      },
                      callId
                    );
                  }
                  await p2pRef.current?.startCall();
                  setCallExpanded(false);
                  setScreen('chat');
                } catch (e) {
                  clearCallSessionResidue();
                  setError(e instanceof Error ? e.message : 'Не удалось начать звонок');
                }
              })();
              }
            } else if (pendingRingAcceptRef.current) {
              pendingRingAcceptRef.current = false;
              // Ждём call-invite — auto-accept в onCallState/onIncomingCall.
            }
          } else {
            setPeerTyping(false);
            typingSentRef.current = false;
          }
          if (status === 'waiting-answer') {
            setIncomingConnection(false);
          }
          if (status === 'failed' || status === 'disconnected') {
            clearCallSessionResidue();
          }
        },
        onSignalingStatus: (status) => setSignalingStatus(status),
        onCallState: (state) => {
          setCallState(state);
          if (state === 'ringing') {
            setCallExpanded(true);
            const meta = peerMetaRef.current;
            setIncomingRing((prev) =>
              prev ?? {
                callId: newCallId(),
                from: {
                  id: meta.id || peerIdRef.current || 'peer',
                  name: meta.label,
                  username: '',
                  avatarUrl: meta.avatarUrl,
                  color: meta.color,
                },
              }
            );
            startRingtone();
            notifyIfHidden('Входящий звонок', {
              body: `Вам звонит ${meta.label || 'близкий'}`,
              tag: 'paranoic-call',
            });
            if (pendingRingAcceptRef.current) {
              pendingRingAcceptRef.current = false;
              void (async () => {
                try {
                  stopRingtone();
                  closeActiveNotification();
                  const stream = await p2pRef.current?.acceptCall();
                  if (stream) attachLocalVideo(stream);
                  setIncomingRing(null);
                  setCallExpanded(false);
                  setScreen('chat');
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Не удалось принять звонок');
                }
              })();
            }
          } else if (state === 'in-call' || state === 'calling') {
            setCallExpanded(false);
            stopRingtone();
            closeActiveNotification();
            if (state === 'in-call') {
              setIncomingRing(null);
              outboundCallIdRef.current = null;
            }
            setScreen((s) => (s === 'call' || s === 'home' ? 'chat' : s));
          }
          if (state === 'idle') {
            attachLocalVideo(null);
            setScreenSharing(false);
            setNetworkQuality('good');
            setCallExpanded(false);
            stopRingtone();
            closeActiveNotification();
            if (!pendingRingAcceptRef.current && !incomingConnection) {
              setIncomingRing(null);
            }
            setScreen((s) => (s === 'call' ? 'chat' : s));
          }
        },
        onNetworkQuality: (quality) => setNetworkQuality(quality),
        onScreenShare: (active) => setScreenSharing(active),
        onIncomingConnection: (info) => {
          setError('');
          // Хост на стартовом экране — сразу в Paranoic, чтобы handshake был виден.
          setAppMode((m) => (m === 'select' ? 'paranoic' : m));
          console.log('[P2P_DEBUG] onIncomingConnection — auto-accept P2P link', info);
          // Магическая ссылка: сразу устанавливаем DataChannel.
          // Медиазвонок по-прежнему требует Accept через CallInbox / call-invite.
          void (async () => {
            try {
              await p2pRef.current?.acceptIncomingConnection();
              setIncomingConnection(false);
            } catch (e) {
              console.warn('[P2P_DEBUG] auto-accept join failed', e);
              setIncomingConnection(true);
              setCallExpanded(true);
              startRingtone();
            }
          })();
          notifyIfHidden('Входящее подключение', {
            body: 'Кто-то открыл вашу магическую ссылку — соединяем…',
            tag: 'paranoic-link',
          });
          void (async () => {
            try {
              const resolveId = info.userId || info.peerId;
              const caller = await resolveCallerInfo(
                resolveId,
                contactsRef.current,
                presenceUsersRef.current
              );
              setPeerLabel(caller.name);
              setPeerAvatarUrl(caller.avatarUrl);
              setPeerColor(caller.color);
              peerMetaRef.current = {
                id: caller.id,
                label: caller.name,
                avatarUrl: caller.avatarUrl,
                color: caller.color,
              };
              await setActivePeer(caller.id, caller.name);
            } catch (e) {
              console.warn('[P2P_DEBUG] resolve incoming caller', e);
            }
          })();
        },
        onConnectionDeclined: () => {
          setIncomingConnection(false);
          setIncomingRing(null);
          setError('Вызов отклонён');
          stopRingtone();
          closeActiveNotification();
        },
        onIncomingCall: () => {
          const meta = peerMetaRef.current;
          setIncomingRing((prev) =>
            prev ?? {
              callId: newCallId(),
              from: {
                id: meta.id || peerIdRef.current || 'peer',
                name: meta.label,
                username: '',
                avatarUrl: meta.avatarUrl,
                color: meta.color,
              },
            }
          );
          setCallExpanded(true);
          setScreen((s) => (s === 'home' ? 'chat' : s));
          startRingtone();
          notifyIfHidden('Входящий звонок', {
            body: `Вам звонит ${meta.label || 'близкий'}`,
            tag: 'paranoic-call',
          });
          if (pendingRingAcceptRef.current) {
            pendingRingAcceptRef.current = false;
            void (async () => {
              try {
                stopRingtone();
                closeActiveNotification();
                const stream = await p2pRef.current?.acceptCall();
                if (stream) attachLocalVideo(stream);
                setIncomingRing(null);
                setCallExpanded(false);
                setScreen('chat');
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Не удалось принять звонок');
              }
            })();
          }
        },
        onCallDeclined: () => {
          setError('Звонок отклонён');
          setCallExpanded(false);
          setIncomingRing(null);
          outboundCallIdRef.current = null;
          stopRingtone();
          closeActiveNotification();
          setScreen((s) => (s === 'call' ? 'chat' : s));
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
              username: looksLikeUsername(peer.name) ? peer.name : undefined,
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
            playReceiveSound();
            notifyIfHidden(packet.sender || 'Новое сообщение', {
              body: text.slice(0, 120),
              tag: `paranoic-msg-${id}`,
            });
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
                mediaKind: inferMediaKind(meta.name, meta.mime),
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
            const mediaKind = inferMediaKind(meta.name, meta.mime);

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
                mediaKind,
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
                mediaKind,
                mediaKey,
              });
            }
            setTransferProgressMap((p) => {
              const { [meta.id]: _drop, ...rest } = p;
              return rest;
            });
            setScreen('chat');
            playReceiveSound();
            notifyIfHidden(peerLabel || 'Новый файл', {
              body: meta.name || 'Медиафайл',
              tag: `paranoic-media-${meta.id}`,
            });
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
                ? {
                    ...m,
                    transferProgress: progress,
                    transferFailed: false,
                    kind: 'file-transfer',
                  }
                : m
            )
          );
        },
        onFileTransferFailed: (id) => {
          setUploadProgress(null);
          setTransferProgressMap((prev) => {
            const { [id]: _drop, ...rest } = prev;
            return rest;
          });
          setMessages((prev) =>
            prev.map((m) =>
              m.id === id && (m.kind === 'file-transfer' || m.kind === 'file-pending')
                ? { ...m, transferFailed: true, kind: 'file-transfer' }
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

  /** Вход в персональный инбокс / magic link / legacy room.
   * Инбокс держим и на стартовом экране (select), и на карте (family),
   * иначе гости по магической ссылке не достучатся до хоста. */
  useEffect(() => {
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

        if (isBannedRef.current) {
          throw new Error('Ваш аккаунт заблокирован. Связь недоступна.');
        }

        const me = identityRef.current;
        const urlHandle = appMode === 'paranoic' ? getMagicTargetFromUrl() : null;
        const legacyRoom = appMode === 'paranoic' ? getRoomIdFromUrl() : null;

        // Резолв ?u=username|id → реальный peer id.
        let urlRoute = resolveMagicRoute(me.id, me.username);
        if (appMode === 'family' || appMode === 'select') {
          // Фон: всегда свой инбокс-хост, чтобы принимать join/звонки.
          urlRoute = { kind: 'self' };
        } else if (urlRoute.kind === 'guest' && urlHandle) {
          const resolvedId = await resolveHandleToUserId(urlHandle);
          if (cancelled) return;
          if (!resolvedId) {
            // Жёсткий стоп: не уходим в «Подключаемся» с битым peer id.
            setGuestPeerId(null);
            guestPeerIdRef.current = null;
            setHostingSelf(true);
            setP2pStatus('failed');
            setSignalingStatus('');
            setJoining(false);
            clearCallSessionResidue();
            setError(
              `Пользователь «${urlHandle}» не найден. Проверьте никнейм или откройте ссылку с ID.`
            );
            console.warn('[P2P_DEBUG] abort join — peer unresolved', { urlHandle });
            return;
          }
          if (resolvedId === me.id) {
            // Свой же аккаунт (второе устройство / своя ссылка) — остаёмся хостом своего инбокса.
            clearCallSessionResidue();
            urlRoute = { kind: 'self' };
          } else {
            urlRoute = { kind: 'guest', peerId: resolvedId };
          }
          console.log('[P2P_DEBUG] magic route resolved', {
            handle: urlHandle,
            peerId: resolvedId,
            kind: urlRoute.kind,
          });
        }

        // В Family/Select всегда свой инбокс (хост).
        const guestId =
          appMode === 'family' || appMode === 'select'
            ? null
            : (urlRoute.kind === 'guest' ? urlRoute.peerId : null) ||
              (guestPeerIdRef.current && guestPeerIdRef.current !== me.id
                ? guestPeerIdRef.current
                : null);

        let room: string;
        let isHost: boolean;
        let provisionalPeer: string | null = null;

        if (guestId) {
          room = personalInboxRoom(guestId);
          isHost = false;
          provisionalPeer = guestId;
          setGuestPeerId(guestId);
          guestPeerIdRef.current = guestId;
          setHostingSelf(false);
          if (urlHandle && looksLikeUsername(urlHandle)) {
            setMagicUserInUrl(urlHandle);
          } else {
            setMagicUserInUrl(guestId);
          }
        } else if (legacyRoom && appMode === 'paranoic') {
          const resolved = resolveRoom();
          room = resolved.roomId;
          isHost = resolved.isHost;
          setHostingSelf(true);
          setGuestPeerId(null);
          guestPeerIdRef.current = null;
        } else {
          room = personalInboxRoom(me.id);
          isHost = true;
          setHostingSelf(true);
          if (appMode === 'paranoic') {
            setGuestPeerId(null);
            guestPeerIdRef.current = null;
            if (urlRoute.kind === 'self') {
              setMagicUserInUrl(me.username || me.id);
            } else {
              clearMagicParamFromUrl();
            }
            clearRoomParamFromUrl();
          }
        }

        if (cancelled) return;

        const liveStatus = p2pRef.current?.currentStatus;
        if (
          p2pRef.current?.currentRoomId === room &&
          liveStatus &&
          liveStatus !== 'failed' &&
          liveStatus !== 'disconnected' &&
          liveStatus !== 'idle' &&
          (liveStatus === 'waiting-answer' ||
            liveStatus === 'connecting' ||
            liveStatus === 'connected' ||
            liveStatus === 'creating-offer')
        ) {
          console.log('[P2P_DEBUG] skip rejoin — already in room', {
            room,
            status: liveStatus,
            appMode,
          });
          setRoomId(room);
          setJoining(false);
          return;
        }

        setRoomId(room);
        setMagicLink(buildMagicLink(me));

        if (provisionalPeer) {
          const known = contacts.find((c) => c.id === provisionalPeer);
          const presence = presenceUsers.find((u) => u.userId === provisionalPeer);
          setPeerAvatarUrl(presence?.avatarUrl || known?.avatarUrl || '');
          setPeerColor(presence?.color || known?.color || '#60a5fa');
          setPeerLabel(known?.name || presence?.name || 'Близкий');
          await setActivePeer(provisionalPeer, known?.name || presence?.name || 'Близкий');
        } else if (isHost && appMode === 'paranoic') {
          await setActivePeer(null);
        }

        const key = await deriveKeyFromRoom(room);
        if (cancelled) return;
        setSecretKey(key);
        secretKeyRef.current = key;
        const exported = await exportKey(key);
        setKeyString(exported);

        const p2p = ensureP2PRef.current();
        console.log('[P2P_DEBUG] joinRoom', { room, isHost, appMode, me: me.id });
        await p2p.joinRoom(room, { isHost });
      } catch (e) {
        if (!cancelled) {
          clearCallSessionResidue();
          setError(e instanceof Error ? e.message : 'Не удалось войти');
          setP2pStatus('failed');
          setSignalingStatus('');
          setJoining(false);
        }
      } finally {
        if (!cancelled) setJoining(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // ensureP2P через ref — иначе смена peerLabel рвёт гостевую сессию и «сбрасывает» роутинг
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appMode, sessionEpoch, guestPeerId, setActivePeer]);

  useEffect(() => {
    if (callState !== 'idle' && p2pRef.current) {
      attachLocalVideo(p2pRef.current.getLocalStream());
    }
  }, [callState, callExpanded, attachLocalVideo]);

  const copyMagicLink = async () => {
    await navigator.clipboard.writeText(magicLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const connectToUser = async (
    targetUserId: string,
    label?: string,
    opts?: { openChat?: boolean }
  ) => {
    if (isBannedRef.current) {
      setError('Ваш аккаунт заблокирован. Связь недоступна.');
      return;
    }

    const me = identityRef.current;
    const known = contacts.find((c) => c.id === targetUserId);

    if (targetUserId === me.id) {
      setError(
        'Вы пытаетесь позвонить на это же устройство / аккаунт. Откройте ссылку другого человека или войдите с другого профиля.'
      );
      return;
    }

    setError('');
    const validation = await validateContactForCall(targetUserId, me.id, {
      name: label || known?.name,
      username: known?.username || (label && looksLikeUsername(label) ? label : undefined),
      color: known?.color,
      avatarUrl: known?.avatarUrl,
    });

    if (!validation.ok) {
      if (validation.reason === 'self') {
        setError(
          'Вы пытаетесь позвонить на это же устройство / аккаунт. Откройте ссылку другого человека или войдите с другого профиля.'
        );
        return;
      }
      const title = label || known?.name || targetUserId;
      const shouldRemove = window.confirm(
        `Контакт «${title}» больше не найден (профиль удалён или ID изменился).\n\nУдалить его из записной книжки?`
      );
      if (shouldRemove) {
        const next = await removeContact(targetUserId);
        setContacts(next);
        setError(`Контакт «${title}» удалён из записной книжки.`);
      } else {
        setError(
          `Контакт «${title}» неактуален. Удалите его из списка или обновите ссылку собеседника.`
        );
      }
      return;
    }

    const resolvedId = validation.contact.id;
    const resolvedLabel = validation.contact.name || label || 'Близкий';

    if (validation.idChanged) {
      const next = await loadContacts();
      setContacts(next);
    } else if (!validation.skipped) {
      setContacts(await loadContacts());
    }

    if (resolvedId === me.id) {
      setError(
        'Вы пытаетесь позвонить на это же устройство / аккаунт. Откройте ссылку другого человека или войдите с другого профиля.'
      );
      return;
    }

    setAppMode('paranoic');
    setScreen(opts?.openChat ? 'chat' : 'home');
    setMessengerSidebarOpen(false);
    setHostingSelf(false);
    setGuestPeerId(resolvedId);
    guestPeerIdRef.current = resolvedId;
    saveCallResidue({ peerId: resolvedId, guestPeerId: resolvedId });
    setMagicUserInUrl(validation.contact.username || resolvedId);
    const presence = presenceUsers.find((u) => u.userId === resolvedId);
    setPeerAvatarUrl(presence?.avatarUrl || validation.contact.avatarUrl || '');
    setPeerColor(presence?.color || validation.contact.color || '#60a5fa');
    await setActivePeer(resolvedId, resolvedLabel);
    p2pRef.current?.close();
    p2pRef.current = null;
    setSessionEpoch((n) => n + 1);
  };

  const returnToOwnInbox = () => {
    clearMagicParamFromUrl();
    clearRoomParamFromUrl();
    clearCallSessionResidue();
    clearEphemeralGuestId();
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

  const guestCallHost = async () => {
    setError('');
    void ensureNotifyPermission();
    if (isBannedRef.current) {
      setError('Ваш аккаунт заблокирован. Звонки недоступны.');
      return;
    }
    const me = identityRef.current;
    const target = peerIdRef.current || guestPeerIdRef.current;
    if (target && target === me.id) {
      setError(
        'Вы пытаетесь позвонить на это же устройство / аккаунт. Откройте ссылку другого человека или войдите с другого профиля.'
      );
      return;
    }
    pendingStartCallRef.current = true;
    if (connected) {
      await startCall();
    }
  };

  const startCall = async () => {
    setError('');
    void ensureNotifyPermission();
    if (isBannedRef.current) {
      setError('Ваш аккаунт заблокирован. Звонки недоступны.');
      return;
    }
    try {
      const me = getOrCreateIdentity();
      identityRef.current = me;
      const target = peerIdRef.current || guestPeerIdRef.current;
      if (target && target === me.id) {
        setError(
          'Вы пытаетесь позвонить на это же устройство / аккаунт. Откройте ссылку другого человека или войдите с другого профиля.'
        );
        clearCallSessionResidue();
        return;
      }
      if (target) {
        const known = contacts.find((c) => c.id === target);
        const validation = await validateContactForCall(target, me.id, {
          name: peerLabel || known?.name,
          username: known?.username,
          color: known?.color || peerColor,
          avatarUrl: known?.avatarUrl || peerAvatarUrl,
        });
        if (!validation.ok) {
          if (validation.reason === 'self') {
            setError(
              'Вы пытаетесь позвонить на это же устройство / аккаунт. Откройте ссылку другого человека или войдите с другого профиля.'
            );
            return;
          }
          const title = peerLabel || known?.name || target;
          const shouldRemove = window.confirm(
            `Контакт «${title}» больше не найден (профиль удалён или ID изменился).\n\nУдалить его из записной книжки?`
          );
          if (shouldRemove) {
            const next = await removeContact(target);
            setContacts(next);
            setError(`Контакт «${title}» удалён из записной книжки.`);
          } else {
            setError(`Контакт «${title}» неактуален. Обновите ссылку собеседника.`);
          }
          clearCallSessionResidue();
          return;
        }
        if (validation.idChanged) {
          setContacts(await loadContacts());
          setGuestPeerId(validation.contact.id);
          guestPeerIdRef.current = validation.contact.id;
          await setActivePeer(validation.contact.id, validation.contact.name);
        }
        const callTarget = validation.contact.id;
        saveCallResidue({ peerId: callTarget, guestPeerId: callTarget });
        const callId = newCallId();
        outboundCallIdRef.current = callId;
        void upsertCallSession({
          callId,
          fromUserId: me.id,
          toUserId: callTarget,
          status: 'ringing',
        });
        void callInboxRef.current?.sendOffer(
          callTarget,
          {
            id: me.id,
            name: me.name,
            username: me.username || '',
            avatarUrl: me.avatarUrl || '',
            color: me.color,
          },
          callId
        );
      }
      await ensureP2P().startCall();
      attachLocalVideo(null);
      setCallExpanded(false);
      setScreen('chat');
    } catch (e) {
      clearCallSessionResidue();
      setError(e instanceof Error ? e.message : 'Не удалось начать звонок');
    }
  };

  const declineIncomingConnection = async () => {
    await ensureP2P().declineIncomingConnection();
    setIncomingConnection(false);
    setIncomingRing(null);
    stopRingtone();
    closeActiveNotification();
  };

  const acceptMediaCall = async () => {
    setError('');
    stopRingtone();
    closeActiveNotification();
    void ensureNotifyPermission();
    const ring = incomingRing;
    if (ring?.callId) {
      void updateCallSessionStatus(ring.callId, 'accepted');
    }
    try {
      if (p2pRef.current?.currentCallState === 'ringing') {
        const stream = await ensureP2P().acceptCall();
        attachLocalVideo(stream);
        setIncomingRing(null);
        setIncomingConnection(false);
        pendingRingAcceptRef.current = false;
        pendingAcceptCallerRef.current = null;
        setCallExpanded(false);
        setScreen('chat');
        return;
      }

      if (incomingConnection) {
        await ensureP2P().acceptIncomingConnection();
        setIncomingConnection(false);
        setIncomingRing(null);
        pendingRingAcceptRef.current = false;
        pendingAcceptCallerRef.current = null;
        setCallExpanded(false);
        setScreen('chat');
        return;
      }

      // Realtime offer: звонящий сам заходит в наш inbox — принимаем join и ждём invite.
      if (ring?.from.id) {
        pendingRingAcceptRef.current = true;
        pendingAcceptCallerRef.current = ring.from;
        setIncomingRing(null);
        setScreen('chat');
        return;
      }

      const stream = await ensureP2P().acceptCall();
      attachLocalVideo(stream);
      setIncomingRing(null);
      setIncomingConnection(false);
      setCallExpanded(false);
      setScreen('chat');
    } catch (e) {
      pendingRingAcceptRef.current = false;
      pendingAcceptCallerRef.current = null;
      setError(e instanceof Error ? e.message : 'Не удалось принять звонок');
      setCallExpanded(false);
      setScreen('chat');
    }
  };

  const declineMediaCall = async () => {
    stopRingtone();
    closeActiveNotification();
    const ring = incomingRing;
    setIncomingRing(null);
    pendingRingAcceptRef.current = false;
    pendingAcceptCallerRef.current = null;
    if (incomingConnection) {
      await declineIncomingConnection();
      return;
    }
    if (ring?.from.id) {
      void callInboxRef.current?.sendReject(
        ring.from.id,
        identityRef.current.id,
        ring.callId
      );
      void updateCallSessionStatus(ring.callId, 'rejected');
    }
    if (p2pRef.current?.currentCallState === 'ringing') {
      await ensureP2P().declineCall();
    }
    setCallExpanded(false);
    setScreen((s) => (s === 'call' ? 'chat' : s));
  };

  const cancelCall = async () => {
    stopRingtone();
    closeActiveNotification();
    pendingStartCallRef.current = false;

    const me = identityRef.current;
    const target = peerIdRef.current || guestPeerIdRef.current;
    const callId = outboundCallIdRef.current;
    const state = p2pRef.current?.currentCallState ?? callState;

    if (target && callId && state === 'calling') {
      void callInboxRef.current?.sendCancel(target, me.id, callId);
      void updateCallSessionStatus(callId, 'cancelled');
    } else if (callId && (state === 'in-call' || state === 'ending')) {
      void updateCallSessionStatus(callId, 'ended');
    } else if (target && callId) {
      // Гость ещё ждёт Accept — всё равно помечаем отмену для peer.
      void callInboxRef.current?.sendCancel(target, me.id, callId);
      void updateCallSessionStatus(callId, 'cancelled');
    }

    outboundCallIdRef.current = null;
    setIncomingRing(null);
    pendingRingAcceptRef.current = false;

    await p2pRef.current?.cancelCall();
    attachLocalVideo(null);
    setScreenSharing(false);
    setNetworkQuality('good');
    setCallExpanded(false);
    setScreen(guestPeerIdRef.current ? 'home' : 'chat');
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
        await patchDeliveryStatus([id], 'delivered');
        playSendSound();
        void ensureNotifyPermission();
      } else if (hasSupabaseConfig()) {
        await uploadPendingText({
          id,
          fromUserId: identityRef.current.id,
          toUserId: peer,
          senderName: identityRef.current.name,
          plaintext: text,
        });
        await patchDeliveryStatus([id], 'delivered');
        playSendSound();
        void ensureNotifyPermission();
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
      try {
        if (hasSupabaseConfig()) {
          await uploadPendingText({
            id,
            fromUserId: identityRef.current.id,
            toUserId: peer,
            senderName: identityRef.current.name,
            plaintext: text,
          });
          await patchDeliveryStatus([id], 'delivered');
          playSendSound();
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
      } catch (e) {
        await enqueueOutbox({
          id,
          conversationId: conv,
          peerUserId: peer,
          createdAt: Date.now(),
          text,
          packet,
        });
        setError(e instanceof Error ? e.message : 'Не удалось отправить офлайн');
      }
    }
  };

  const sendMedia = async (
    file: File,
    reuseId?: string,
    opts?: { mediaKind?: 'file' | 'circle' | 'voice' }
  ) => {
    if (!secretKey) return;
    const peer = peerIdRef.current;
    if (!peer) {
      setError('Сначала выберите собеседника');
      return;
    }

    const live = Boolean(p2pRef.current?.isReady);
    if (!live && !hasSupabaseConfig()) {
      setError('Нет соединения — повторите, когда будете на связи');
      return;
    }

    const mediaKind = opts?.mediaKind ?? 'file';
    setError('');
    const transferId =
      reuseId || `f-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    retrySendFilesRef.current.set(transferId, file);
    setUploadProgress(0);
    setTransferProgressMap((p) => ({ ...p, [transferId]: 0 }));
    setMessages((prev) => {
      const row: ChatMessage = {
        id: transferId,
        sender: 'Я',
        time: nowTime(),
        mine: true,
        kind: 'file-transfer',
        mediaMime: file.type || 'application/octet-stream',
        mediaName: file.name,
        mediaSize: file.size,
        mediaKind,
        transferProgress: 0,
        transferFailed: false,
        deliveryStatus: 'sending',
      };
      if (prev.some((m) => m.id === transferId)) {
        return prev.map((m) => (m.id === transferId ? { ...m, ...row } : m));
      }
      return [...prev, row];
    });
    setScreen('chat');

    const mediaKey = mediaStorageKey(transferId);
    try {
      if (live && p2pRef.current) {
        await p2pRef.current.sendFile(
          file,
          (data) => encryptBytes(data, secretKey),
          { transferId }
        );
      } else {
        await uploadPendingMedia({
          id: transferId,
          fromUserId: identityRef.current.id,
          toUserId: peer,
          senderName: identityRef.current.name,
          file,
          onProgress: (ratio) => {
            setUploadProgress(ratio < 1 ? ratio : null);
            setTransferProgressMap((p) => ({ ...p, [transferId]: ratio }));
            setMessages((prev) =>
              prev.map((m) =>
                m.id === transferId
                  ? { ...m, transferProgress: ratio, transferFailed: false }
                  : m
              )
            );
          },
        });
      }

      const mediaUrl = URL.createObjectURL(file);
      mediaUrlsRef.current.add(mediaUrl);
      await saveMediaBlob(mediaKey, file);
      retrySendFilesRef.current.delete(transferId);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === transferId
            ? {
                ...m,
                kind: 'media' as const,
                mediaUrl,
                mediaKey,
                mediaKind,
                transferProgress: 1,
                transferFailed: false,
                deliveryStatus: 'delivered',
              }
            : m
        )
      );
      playSendSound();
      void ensureNotifyPermission();
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
          mediaKind,
          mediaKey,
          deliveryStatus: 'delivered',
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Файл не отправился';
      const lost = msg === 'Связь потеряна' || (!p2pRef.current?.isReady && live);
      if (lost && live) {
        // P2P оборвался — пробуем store-and-forward
        try {
          if (hasSupabaseConfig()) {
            await uploadPendingMedia({
              id: transferId,
              fromUserId: identityRef.current.id,
              toUserId: peer,
              senderName: identityRef.current.name,
              file,
            });
            const mediaUrl = URL.createObjectURL(file);
            mediaUrlsRef.current.add(mediaUrl);
            await saveMediaBlob(mediaKey, file);
            retrySendFilesRef.current.delete(transferId);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === transferId
                  ? {
                      ...m,
                      kind: 'media' as const,
                      mediaUrl,
                      mediaKey,
                      mediaKind,
                      transferProgress: 1,
                      transferFailed: false,
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
                mediaKind,
                mediaKey,
              });
            }
            return;
          }
        } catch (safErr) {
          setError(safErr instanceof Error ? safErr.message : msg);
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === transferId
              ? { ...m, transferFailed: true, kind: 'file-transfer' }
              : m
          )
        );
      } else {
        setError(msg);
        retrySendFilesRef.current.delete(transferId);
        setMessages((prev) => prev.filter((m) => m.id !== transferId));
      }
    } finally {
      setUploadProgress(null);
      setTransferProgressMap((p) => {
        const { [transferId]: _drop, ...rest } = p;
        return rest;
      });
    }
  };

  const cancelMediaNote = useCallback(() => {
    const session = noteSessionRef.current;
    if (session) {
      session.abort.abort();
      session.stop();
      stopStream(session.stream);
      noteSessionRef.current = null;
    }
    setNoteRecording(null);
  }, []);

  const finishMediaNote = useCallback(() => {
    noteReleasePendingRef.current = true;
    const session = noteSessionRef.current;
    if (session) session.stop();
  }, []);

  const startMediaNote = useCallback(
    async (mode: NoteMode) => {
      if (!peerId || !secretKey || noteSessionRef.current) return;
      noteReleasePendingRef.current = false;
      setError('');
      try {
        const stream = await openNoteStream(mode);
        if (noteReleasePendingRef.current) {
          stopStream(stream);
          setNoteRecording(null);
          return;
        }
        const abort = new AbortController();
        const session = recordMediaNote(stream, mode, {
          signal: abort.signal,
          onTick: (ratio) => {
            setNoteRecording((prev) =>
              prev ? { ...prev, progress: ratio } : { stream, progress: ratio }
            );
          },
        });
        noteSessionRef.current = { stop: session.stop, abort, stream };
        setNoteRecording({ stream, progress: 0 });

        if (noteReleasePendingRef.current) {
          session.stop();
        }

        void session.result.then((note) => {
          stopStream(stream);
          noteSessionRef.current = null;
          setNoteRecording(null);
          if (!note) return;
          void sendMedia(note.file, undefined, { mediaKind: note.mediaKind });
        });
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : mode === 'video'
              ? 'Нет доступа к камере'
              : 'Нет доступа к микрофону'
        );
        setNoteRecording(null);
        noteSessionRef.current = null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [peerId, secretKey]
  );

  useEffect(() => {
    return () => {
      stopRingtone();
      cancelMediaNote();
    };
  }, [cancelMediaNote]);

  /** Разрешение на уведомления по первому жесту в приложении. */
  useEffect(() => {
    if (appMode === 'select') return;
    const unlock = () => {
      void ensureNotifyPermission();
      window.removeEventListener('pointerdown', unlock);
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, [appMode]);

  const retryFileTransfer = (id: string) => {
    const file = retrySendFilesRef.current.get(id);
    if (!file) {
      setError('Файл для повтора недоступен — прикрепите снова');
      return;
    }
    void sendMedia(file, id);
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
  const isActiveSession =
    connected ||
    callState === 'calling' ||
    callState === 'in-call' ||
    callState === 'ringing';
  const liquidNavActive: LiquidNavTab =
    callState === 'calling' || callState === 'in-call' || callState === 'ringing'
      ? 'camera'
      : 'chat';

  const shellStyle =
    appMode === 'paranoic'
      ? ({ background: identity.themeFon } as React.CSSProperties)
      : undefined;

  if (appMode === 'select') {
    return (
      <>
        {error && (
          <div className="banner error" role="alert" style={{ position: 'relative', zIndex: 50 }}>
            {error}
            <button type="button" className="icon-btn" onClick={() => setError('')} aria-label="Закрыть">
              <X size={16} />
            </button>
          </div>
        )}
        {incomingRing && (
          <IncomingCallModal
            caller={incomingRing.from}
            onAccept={() => {
              setAppMode('paranoic');
              void acceptMediaCall();
            }}
            onReject={() => void declineMediaCall()}
          />
        )}
        <ModeSelector onSelect={(mode) => setAppMode(mode)} />
      </>
    );
  }

  if (appMode === 'family') {
    return (
      <>
        {error && <div className="banner error">{error}</div>}
        {adminOpen && (
          <AdminDashboard currentUserId={identity.id} onClose={() => setAdminOpen(false)} />
        )}
        {incomingRing && (
          <IncomingCallModal
            caller={incomingRing.from}
            onAccept={() => {
              setAppMode('paranoic');
              void acceptMediaCall();
            }}
            onReject={() => void declineMediaCall()}
          />
        )}
        <GlobeLobby
          onBack={() => setAppMode('select')}
          people={mapPeople}
          geoSource={
            settings.ghostMode ? 'antarctica' : geo ? geo.source : 'pending'
          }
          isAdmin={isAdmin}
          onOpenAdmin={() => setAdminOpen(true)}
          banned={isBanned}
          ghostMode={settings.ghostMode}
          onGhostModeChange={(next) => {
            const saved = saveSettings({ ghostMode: next });
            setSettings(saved);
          }}
          onChatUser={(user) => {
            if (isBannedRef.current) {
              setError('Ваш аккаунт заблокирован. Связь недоступна.');
              setAppMode('paranoic');
              return;
            }
            void connectToUser(
              user.userId,
              user.isContact ? user.name : 'Незнакомец',
              { openChat: true }
            );
          }}
          onCallUser={(user) => {
            if (isBannedRef.current) {
              setError('Ваш аккаунт заблокирован. Звонки недоступны.');
              setAppMode('paranoic');
              return;
            }
            pendingStartCallRef.current = true;
            void connectToUser(
              user.userId,
              user.isContact ? user.name : 'Незнакомец',
              { openChat: true }
            );
          }}
        />
      </>
    );
  }

  return (
    <div
      className={`app-shell themed${screen === 'chat' ? ' messenger-shell' : ''}${
        isActiveSession ? ' has-liquid-nav' : ''
      }`}
      style={shellStyle}
    >
      {profileOpen && (
        <ProfileModal
          identity={identity}
          settings={settings}
          onClose={() => setProfileOpen(false)}
          onSaved={(next) => applyIdentity(next)}
          onSettingsChange={setSettings}
        />
      )}
      {adminOpen && (
        <AdminDashboard currentUserId={identity.id} onClose={() => setAdminOpen(false)} />
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
          <ParanoicLogo size={36} compact className="brand-logo-mark" />
          <div>
            <h1>Paranoic</h1>
            <p className="brand-sub">Семейная связь без чужих серверов</p>
          </div>
        </div>
        <div className="app-header-right">
          {isAdmin && (
            <button
              type="button"
              className="admin-panel-btn"
              onClick={() => setAdminOpen(true)}
            >
              <ShieldCheck size={16} />
              Admin Panel
            </button>
          )}
          <div className={`status-pill ${connected ? 'ok' : ''}`}>
            <span className="status-dot" />
            <span className="status-pill-text">
              <span>{FRIENDLY_STATUS[p2pStatus]}</span>
              {signalingStatus && !connected && (
                <span className="signaling-debug">{signalingStatus}</span>
              )}
            </span>
          </div>
        </div>
      </header>

      {isBanned && (
        <div className="banner banned" role="alert">
          Ваш аккаунт заблокирован. Звонки и P2P-соединения недоступны.
        </div>
      )}

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

      <main className="app-main">
        {screen === 'home' && (
          <section className="home">
            {guestPeerId ? (
              <GuestDirectCall
                hostName={peerLabel}
                hostColor={peerColor}
                hostAvatarUrl={peerAvatarUrl}
                hostOnline={onlineIds.has(guestPeerId)}
                connected={connected}
                joining={joining}
                signalingStatus={signalingStatus}
                callState={callState}
                connectionStatus={p2pStatus}
                onCall={() => void guestCallHost()}
                onCancel={() => void cancelCall()}
                onBack={returnToOwnInbox}
              />
            ) : (
              <>
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

                <div className="room-card magic-card liquid-glass-card">
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
                    {identity.username
                      ? `Короткая ссылка: ?u=${identity.username}`
                      : 'Задайте никнейм в профиле — ссылка станет короткой и красивой.'}
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

            <div className="contacts-panel liquid-glass-card">
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

            {getRoomIdFromUrl() && (
              <p className="hint muted-sep">
                Legacy-комната: {roomId} · {buildRoomShareUrl(roomId)}
              </p>
            )}
            {keyString && (
              <p className="hint muted-sep">
                E2EE активен · {hostingSelf ? 'свой инбокс' : 'гостевой'}
              </p>
            )}
              </>
            )}
          </section>
        )}

        {screen === 'chat' && (
          <section className="messenger">
            <aside
              className={`messenger-sidebar${messengerSidebarOpen ? ' open' : ''}`}
              aria-label="Контакты"
            >
              <div className="messenger-sidebar-head">
                <button
                  type="button"
                  className="text-link"
                  onClick={() => {
                    setMessengerSidebarOpen(false);
                    setScreen('home');
                  }}
                >
                  <ArrowLeft size={16} /> Профиль
                </button>
                <h2>Чаты</h2>
              </div>
              <ul className="messenger-contacts">
                {contacts.length === 0 ? (
                  <li className="empty-contacts">Пока нет контактов</li>
                ) : (
                  contacts.map((c) => {
                    const online = onlineIds.has(c.id);
                    const active = peerId === c.id;
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          className={`messenger-contact${active ? ' active' : ''}`}
                          onClick={() => {
                            if (active) {
                              setMessengerSidebarOpen(false);
                              return;
                            }
                            void connectToUser(c.id, c.name, { openChat: true });
                          }}
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
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            </aside>

            {messengerSidebarOpen && (
              <button
                type="button"
                className="messenger-sidebar-scrim"
                aria-label="Закрыть список"
                onClick={() => setMessengerSidebarOpen(false)}
              />
            )}

            <div className="messenger-pane chat">
            <div className="chat-top">
              <button
                type="button"
                className="icon-btn messenger-sidebar-toggle"
                aria-label="Контакты"
                onClick={() => setMessengerSidebarOpen((v) => !v)}
              >
                <PanelLeft size={20} />
              </button>
              <button type="button" className="text-link chat-back-home" onClick={() => setScreen('home')}>
                <ArrowLeft size={16} /> Назад
              </button>
              <div className="chat-peer">
                <Avatar
                  name={peerLabel}
                  color={peerColor}
                  avatarUrl={peerAvatarUrl}
                  size="sm"
                />
                <div className="chat-peer-meta">
                  <span className="chat-peer-name">{peerLabel}</span>
                  <span className="chat-peer-sub">
                    {peerTyping ? 'печатает…' : connected ? 'на связи' : 'офлайн'}
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="icon-btn"
                onClick={() => void startCall()}
                aria-label="Позвонить"
                disabled={!connected}
              >
                <Phone size={20} />
              </button>
              <button
                type="button"
                className="icon-btn"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Прикрепить файл"
                disabled={!peerId}
              >
                <Paperclip size={20} />
              </button>
            </div>

            <div className="chat-log">
              {messages.length === 0 ? (
                <p className="empty">Пока тихо. Напишите первое сообщение.</p>
              ) : (
                messages.map((m) => {
                  const progress =
                    m.transferProgress ?? transferProgressMap[m.id] ?? null;
                  const isVideoCircle =
                    m.kind === 'media' &&
                    Boolean(m.mediaUrl) &&
                    (m.mediaKind === 'circle' ||
                      (m.mediaName || '').startsWith('circle-'));
                  const isVoiceNote =
                    m.kind === 'media' &&
                    Boolean(m.mediaUrl) &&
                    (m.mediaKind === 'voice' ||
                      (m.mediaName || '').startsWith('voice-') ||
                      Boolean(m.mediaMime?.startsWith('audio/')));
                  const isMediaPreview =
                    m.kind === 'media' &&
                    m.mediaUrl &&
                    !isVideoCircle &&
                    !isVoiceNote &&
                    (m.mediaMime?.startsWith('image/') ||
                      m.mediaMime?.startsWith('video/') ||
                      !m.mediaMime);
                  const isGenericFile =
                    m.kind === 'media' &&
                    m.mediaUrl &&
                    !isVideoCircle &&
                    !isVoiceNote &&
                    m.mediaMime &&
                    !m.mediaMime.startsWith('image/') &&
                    !m.mediaMime.startsWith('video/') &&
                    !m.mediaMime.startsWith('audio/');

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
                      className={`bubble ${m.mine ? 'mine' : 'theirs'}${m.hearted ? ' hearted' : ''}${isVideoCircle ? ' circle-bubble' : ''}${isVoiceNote ? ' voice-bubble' : ''}`}
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
                      {isVideoCircle && m.mediaUrl && (
                        <VideoCirclePlayer src={m.mediaUrl} mine={m.mine} />
                      )}
                      {isVoiceNote && m.mediaUrl && (
                        <VoiceNotePlayer src={m.mediaUrl} mine={m.mine} />
                      )}
                      {(m.kind === 'file-transfer' || m.kind === 'file-pending') && (
                        <div className="file-transfer-card">
                          <p className="file-pending-name">{m.mediaName ?? 'Файл'}</p>
                          <p className="file-pending-size">
                            {formatFileSize(m.mediaSize ?? 0)}
                            {m.transferFailed
                              ? ' · связь потеряна'
                              : progress != null
                                ? ` · ${Math.round(progress * 100)}%`
                                : m.mine
                                  ? ' · отправка…'
                                  : ' · загрузка…'}
                          </p>
                          {!m.transferFailed && (
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
                          )}
                          {m.transferFailed && (
                            <div className="file-transfer-lost">
                              <p className="file-transfer-lost-title">Связь потеряна</p>
                              {m.mine ? (
                                <button
                                  type="button"
                                  className="accept-file-btn"
                                  onClick={() => retryFileTransfer(m.id)}
                                  disabled={!connected}
                                >
                                  <RefreshCw size={16} />
                                  Повторить попытку
                                </button>
                              ) : (
                                <p className="file-transfer-lost-hint">
                                  Дождитесь повторной отправки
                                </p>
                              )}
                            </div>
                          )}
                          {m.kind === 'file-pending' && !m.mine && !m.transferFailed && (
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
                        {m.mine && (m.kind === 'text' || m.kind === 'media') && (
                          <span
                            className={`msg-delivery ${m.deliveryStatus ?? 'sending'}`}
                            title={
                              DELIVERY_LABELS[
                                (m.deliveryStatus ?? 'sending') as DeliveryStatus
                              ]
                            }
                            aria-label={
                              DELIVERY_LABELS[
                                (m.deliveryStatus ?? 'sending') as DeliveryStatus
                              ]
                            }
                          >
                            {m.deliveryStatus === 'read' ? (
                              <CheckCheck size={15} strokeWidth={2.4} />
                            ) : m.deliveryStatus === 'delivered' ? (
                              <Check size={15} strokeWidth={2.4} />
                            ) : (
                              <Clock size={13} strokeWidth={2.2} />
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
              {inputText.trim() ? (
                <button
                  type="submit"
                  disabled={!peerId || !secretKey}
                  aria-label="Отправить"
                >
                  <Send size={22} />
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="icon-btn note-mode-toggle"
                    disabled={!peerId || !secretKey}
                    onClick={() =>
                      setNoteMode((m) => (m === 'video' ? 'voice' : 'video'))
                    }
                    aria-label={
                      noteMode === 'video'
                        ? 'Переключить на голосовое'
                        : 'Переключить на видео-кружочек'
                    }
                    title={
                      noteMode === 'video'
                        ? 'Сейчас: видео · нажмите для микрофона'
                        : 'Сейчас: голос · нажмите для камеры'
                    }
                  >
                    {noteMode === 'video' ? <Video size={20} /> : <Mic size={20} />}
                  </button>
                  <button
                    type="button"
                    className={`chat-record-btn${noteRecording ? ' recording' : ''}`}
                    disabled={!peerId || !secretKey}
                    aria-label={
                      noteMode === 'video'
                        ? 'Удерживайте для видео-кружочка'
                        : 'Удерживайте для голосового'
                    }
                    onPointerDown={(e) => {
                      e.preventDefault();
                      (e.currentTarget as HTMLButtonElement).setPointerCapture(
                        e.pointerId
                      );
                      void startMediaNote(noteMode);
                    }}
                    onPointerUp={() => {
                      finishMediaNote();
                    }}
                    onPointerCancel={() => {
                      cancelMediaNote();
                    }}
                    onContextMenu={(e) => e.preventDefault()}
                  >
                    {noteMode === 'video' ? <Camera size={22} /> : <Mic size={22} />}
                  </button>
                </>
              )}
            </form>
            </div>
          </section>
        )}
      </main>

      {noteRecording && (
        <MediaNoteOverlay
          mode={noteMode}
          stream={noteRecording.stream}
          progress={noteRecording.progress}
          onCancel={cancelMediaNote}
        />
      )}

      {incomingRing && (
        <IncomingCallModal
          caller={incomingRing.from}
          onAccept={() => void acceptMediaCall()}
          onReject={() => void declineMediaCall()}
        />
      )}

      {!incomingRing && (
      <CallOverlay
        callState={callState === 'ringing' ? 'idle' : callState}
        peerLabel={peerLabel}
        screenSharing={screenSharing}
        networkQuality={networkQuality}
        expanded={callExpanded}
        onExpandedChange={setCallExpanded}
        localVideoRef={localVideoRef}
        remoteVideoRef={remoteVideoRef}
        onAccept={() => void acceptMediaCall()}
        onDecline={() => void declineMediaCall()}
        onHangUp={() => void cancelCall()}
        onToggleScreenShare={() => void toggleScreenShare()}
      />
      )}

      {isActiveSession && !incomingRing && (
        <LiquidNavigationBar
          active={liquidNavActive}
          onChat={() => {
            setCallExpanded(false);
            setScreen('chat');
          }}
          onCamera={() => {
            if (callState === 'in-call' || callState === 'calling') {
              setCallExpanded(true);
              return;
            }
            void startCall();
            setCallExpanded(true);
          }}
          onMap={() => {
            setCallExpanded(false);
            setAppMode('family');
          }}
        />
      )}

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
