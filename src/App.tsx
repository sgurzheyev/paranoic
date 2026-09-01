import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Phone,
  MessageCircle,
  Check,
  CheckCheck,
  Clock,
  X,
  Unplug,
  Send,
  ArrowLeft,
  FileDown,
  Paperclip,
  RefreshCw,
  ShieldCheck,
  Shield,
  Ban,
  UserCheck,
} from 'lucide-react';
import ContactListRow from './ContactListRow';
import ChatHeader from './ChatHeader';
import ChatSearchPanel from './ChatSearchPanel';
import ContactsSearchPanel from './ContactsSearchPanel';
import SettingsPanel from './SettingsPanel';
import ProfileHome from './ProfileHome';
import GlobeLobby, { type MapPerson } from './GlobeLobby';
import Avatar from './Avatar';
import ProfileModal from './ProfileModal';
import PeerProfileModal from './PeerProfileModal';
import AdminDashboard from './AdminDashboard';
import AdminPanel from './AdminPanel';
import { isSuperAdminUsername } from './adminModeration';
import CallOverlay, { ActiveCallBanner } from './CallOverlay';
import IncomingCallModal from './IncomingCallModal';
import LiquidNavigationBar, { type LiquidNavTab } from './LiquidNavigationBar';
import GuestDirectCall from './GuestDirectCall';
import ParanoicLogo from './ParanoicLogo';
import ChatRecordButton from './ChatRecordButton';
import {
  MEDIA_ACCESS_DENIED_MESSAGE,
  isCallMediaBlocked,
  mediaErrorMessage,
  useMediaDevicePresence,
} from './mediaPermissions';
import { VideoCirclePlayer, VoiceNotePlayer } from './VideoCircle';
import {
  bootstrapPeerRelations,
  isBlocked,
  isTrusted,
  loadBlockedIds,
  loadTrustedIds,
} from './trust';
import { blockUserSafety } from './userSafety';
import {
  CallInbox,
  callerDisplayName,
  checkCalleeOnline,
  clearParticipantsInCall,
  markParticipantsInCall,
  newCallId,
  type CallOfferEvent,
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
import { inferMediaKind } from './mediaNotes';
import {
  deriveKeyFromRoom,
  exportKey,
  encryptMessage,
  decryptMessage,
  encryptBytes,
  decryptBytes,
} from './crypto';
import {
  P2PConnection,
  classifyCallFailure,
  isCallFailureUserAlert,
  type CallFailKind,
  type CallState,
  type NetworkQuality,
  type P2PStatus,
  type SignalingDebugStatus,
} from './p2p';
import {
  destroyP2PSession,
  ensureP2PSession,
  getP2PSession,
} from './p2pSession';
import { useP2P } from './P2PProvider';
import {
  clearRoomParamFromUrl,
  getRoomIdFromUrl,
  resolveRoom,
  setMagicUserInUrl,
} from './room';
import {
  hasSupabaseConfig,
  isPasswordRecoveryPending,
  notePasswordRecoveryFromLocation,
  peekAuthSession,
  pauseAuthBootstrap,
  signOutAndReset,
  waitForRealtimeAuth,
} from './lib/supabase';
import AuthScreen from './AuthScreen';
import {
  appendStoredMessage,
  conversationId,
  formatFileSize,
  loadChatHistory,
  loadLastMessagePreviews,
  loadMediaBlob,
  mediaStorageKey,
  purgeLegacyGlobalHistory,
  saveMediaBlob,
  updateStoredMessage,
  purgeExpiredMessages,
  EPHEMERAL_TTL_MS,
  type DeliveryStatus,
  type LastMessagePreview,
  type StoredMessage,
} from './storage';
import { STORAGE_CLEARED_EVENT } from './storageManagement';
import { applySettingsSideEffects, loadSettings, saveSettings, type AppSettings } from './settings';
import { useLanguage } from './i18n';
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
  ensureAuthBoundIdentity,
  forcePersistSession,
  getMagicTargetFromUrl,
  getOrCreateIdentity,
  getSavedLoginSession,
  personalInboxRoom,
  resolveMagicRoute,
  restoreIdentityFromProfile,
  looksLikeUsername,
  type UserIdentity,
} from './identity';
import {
  captureHostFromMagicLink,
  loadContacts,
  removeContact,
  resolvePeerHandle,
  resolvePeerProfile,
  trustAndUpsertContact,
  upsertContact,
  validateContactForCall,
  type Contact,
} from './contacts';
import { syncProfileToSupabase, fetchRemoteProfile, PROFILE_STALE_MESSAGE, type RemoteProfile } from './profile';
import { startNativePush } from './pushNotifications';
import {
  clearCallResidueState,
  clearCallSessionResidue,
  clearEphemeralGuestId,
  saveCallResidue,
} from './callSessionCleanup';
import { ANTARCTICA, GEO_BLOCKED_MESSAGE, watchGeo, WorldPresence, type GeoPoint, type PresenceUser } from './presence';

/** Мессенджер и карта семьи — две поверхности одного интерфейса, без экрана выбора. */
type AppMode = 'paranoic' | 'family';
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

function nowTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Trace every outbound call attempt — source + stack for debugging rogue triggers. */
function logCallInit(source: string, detail?: Record<string, unknown>) {
  console.log('[Call] INIT', source, detail ?? {}, new Error().stack);
}

export default function App() {
  const { t } = useLanguage();
  const {
    setStatus: mirrorP2pStatus,
    setCallState: mirrorCallState,
    setSignalingStatus: mirrorSignalingStatus,
    hangUpSession,
  } = useP2P();
  const mediaPresence = useMediaDevicePresence();
  const callMediaBlocked = isCallMediaBlocked(mediaPresence);
  const [identity, setIdentity] = useState<UserIdentity>(() => getOrCreateIdentity());
  const [settings, setSettings] = useState<AppSettings>(() => {
    const loaded = loadSettings();
    applySettingsSideEffects(loaded);
    return loaded;
  });
  /** checking → login (AuthScreen) → ok (приложение). */
  const [authGate, setAuthGate] = useState<'checking' | 'login' | 'ok'>(() =>
    hasSupabaseConfig() ? 'checking' : 'ok'
  );
  const [appMode, setAppMode] = useState<AppMode>(() => {
    if (getMagicTargetFromUrl() || getRoomIdFromUrl()) return 'paranoic';
    try {
      if (new URLSearchParams(window.location.search).get('start') === 'family') {
        return 'family';
      }
    } catch {
      /* */
    }
    return 'paranoic';
  });
  const [familyEntered, setFamilyEntered] = useState(
    () =>
      new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search).get('start') ===
      'family'
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
  /** Family Mode: ошибка дозвона — индикатор в шапке карты, toast только по клику. */
  const [callAlert, setCallAlert] = useState('');
  const [callAlertToastOpen, setCallAlertToastOpen] = useState(false);
  const [callFailKind, setCallFailKind] = useState<CallFailKind | null>(null);
  /** ICE / сеть просела — компактный toast, не блокирует UI. */
  const [linkWarning, setLinkWarning] = useState('');
  const [dismissedLinkWarning, setDismissedLinkWarning] = useState('');
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
  const [contactsSearchQuery, setContactsSearchQuery] = useState('');
  const [contactsSearchAdding, setContactsSearchAdding] = useState<string | null>(null);
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([]);
  const [geo, setGeo] = useState<GeoPoint | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [peerProfileOpen, setPeerProfileOpen] = useState(false);
  const [accountHint, setAccountHint] = useState('');
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
  /** Блокирует ghost-click на home сразу после «Назад» из чата. */
  const [uiNavLock, setUiNavLock] = useState(false);
  const [callStartedAt, setCallStartedAt] = useState<number | null>(null);
  const [lastPreviews, setLastPreviews] = useState<Record<string, LastMessagePreview>>({});
  /** Мобильный сайдбар контактов в мессенджере. */
  const [messengerSidebarOpen, setMessengerSidebarOpen] = useState(false);
  /** Поиск с фильтрами перекрывает список чатов. */
  const [chatsSearchMode, setChatsSearchMode] = useState(false);
  const [sidebarSearchMode, setSidebarSearchMode] = useState(false);
  /** Главная вкладка Bottom Tab Bar. */
  const [mainTab, setMainTab] = useState<LiquidNavTab>(() =>
    getMagicTargetFromUrl() ? 'chats' : 'contacts'
  );
  const [trustedIds, setTrustedIds] = useState<Set<string>>(() => loadTrustedIds());
  /** Отклонённые / заблокированные id — скрываются с карты и из presence. */
  const [blockedIds, setBlockedIds] = useState<Set<string>>(() => loadBlockedIds());
  const [micMuted, setMicMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);

  const p2pRef = useRef<P2PConnection | null>(null);
  const secretKeyRef = useRef<CryptoKey | null>(null);
  const identityRef = useRef(identity);
  const appModeRef = useRef(appMode);
  /** На экране логина не показываем и не накапливаем ошибки WebRTC. */
  const suppressGlobalErrorsRef = useRef(authGate !== 'ok');
  /** Идёт ли реальный вызов: без него обрыв ICE — фоновый, а не «не удалось связаться». */
  const callAttemptRef = useRef(false);
  /** Антидребезг кнопки звонка в шапке чата. */
  const callDialLockRef = useRef(false);
  const peerIdRef = useRef<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingFilesRef = useRef<Map<string, Blob>>(new Map());
  const mediaUrlsRef = useRef<Set<string>>(new Set());
  /** Исходящие File для «Повторить попытку» после обрыва. */
  const retrySendFilesRef = useRef<Map<string, File>>(new Map());
  const presenceRef = useRef<WorldPresence | null>(null);
  const guestPeerIdRef = useRef<string | null>(guestPeerId);
  /** One-shot token set ONLY in Call button onClick — consumed by startCall / invokeP2PStartCall. */
  const outboundCallButtonTokenRef = useRef(0);
  /** Явное намерение пользователя позвонить — ONLY set via armOutboundCallFromButton in phone onClick handlers. */
  const callUserIntentRef = useRef(false);
  /** Поколение async-звонка — инвалидируется при «Назад». */
  const callDialGenerationRef = useRef(0);
  /** true после «Назад» из чата — блокирует исходящие звонки до следующего открытия чата. */
  const chatClosedRef = useRef(false);
  /** Долгоживущий флаг «пользователь ушёл из чата» — до явного open chat. */
  const leavingChatRef = useRef(false);
  /** Пользователь явно закрыл чат «Назад» — не открываем чат/звонок автоматически. */
  const suppressChatAutoOpenRef = useRef(false);
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
    if (screen === 'chat') {
      chatClosedRef.current = false;
      leavingChatRef.current = false;
    }
  }, [screen]);

  /** Arm outbound call — ONLY from direct Call button onClick handlers. Returns one-shot token. */
  const armOutboundCallFromButton = useCallback(
    (source: string, opts?: { fromHome?: boolean }): number => {
      if (opts?.fromHome) {
        leavingChatRef.current = false;
        chatClosedRef.current = false;
      } else if (leavingChatRef.current || chatClosedRef.current) {
        logCallInit(`${source}-arm-refused-left-chat`);
        return 0;
      }
      const token = outboundCallButtonTokenRef.current + 1;
      outboundCallButtonTokenRef.current = token;
      callUserIntentRef.current = true;
      logCallInit(`${source}-armed`, { token });
      return token;
    },
    []
  );

  const disarmOutboundCall = useCallback((source: string) => {
    logCallInit(`${source}-disarmed`);
    outboundCallButtonTokenRef.current += 1;
    callUserIntentRef.current = false;
  }, []);

  const clearOutboundCallIntent = disarmOutboundCall;

  const isOutboundCallArmed = useCallback(
    (source: string, token?: number): boolean => {
      const armedToken = outboundCallButtonTokenRef.current;
      const tokenOk = token === undefined || token === armedToken;
      const ok =
        tokenOk &&
        armedToken > 0 &&
        callUserIntentRef.current &&
        !chatClosedRef.current &&
        !leavingChatRef.current &&
        !suppressChatAutoOpenRef.current;
      if (!ok) {
        logCallInit(`${source}-not-armed`, {
          token,
          armedToken,
          intent: callUserIntentRef.current,
          chatClosed: chatClosedRef.current,
          leavingChat: leavingChatRef.current,
          suppressNav: suppressChatAutoOpenRef.current,
          screen: screenRef.current,
        });
      }
      return ok;
    },
    []
  );

  const abortActiveCallUi = useCallback(
    (source: string) => {
      logCallInit(`${source}-abortActiveCallUi`);
      disarmOutboundCall(source);
      callDialGenerationRef.current += 1;
      callDialLockRef.current = false;
      chatClosedRef.current = true;
      leavingChatRef.current = true;
      outboundCallIdRef.current = null;
      callAttemptRef.current = false;
      setIncomingRing(null);
      setCallFailKind(null);
      stopRingtone();
      closeActiveNotification();
      setCallState('idle');
      mirrorCallState('idle');
      setCallExpanded(false);
      presenceRef.current?.setInCall(false);
      void p2pRef.current?.cancelCall().catch(() => undefined);
    },
    [disarmOutboundCall, mirrorCallState]
  );

  const canPlaceOutboundCall = useCallback(
    (source: string, token?: number): boolean => isOutboundCallArmed(source, token),
    [isOutboundCallArmed]
  );

  const invokeP2PStartCall = useCallback(
    async (source: string, token?: number): Promise<MediaStream | null> => {
      logCallInit(`${source}-invokeP2PStartCall`, { token });
      if (!canPlaceOutboundCall(source, token)) return null;
      const stream = (await p2pRef.current?.startCall()) ?? null;
      disarmOutboundCall(`${source}-p2p-started`);
      return stream;
    },
    [canPlaceOutboundCall, disarmOutboundCall]
  );

  /** Постоянный Auth (никнейм + пароль). Без JWT — AuthScreen, без anonymous. */
  useEffect(() => {
    if (!hasSupabaseConfig()) {
      setAuthGate('ok');
      return;
    }
    let cancelled = false;
    pauseAuthBootstrap(true);
    void (async () => {
      try {
        notePasswordRecoveryFromLocation();
        const session = await peekAuthSession();
        if (cancelled) return;
        if (isPasswordRecoveryPending()) {
          setAuthGate('login');
          return;
        }
        if (!session?.user?.id) {
          setAuthGate('login');
          return;
        }
        pauseAuthBootstrap(false);
        const next = await ensureAuthBoundIdentity();
        if (cancelled) return;
        setIdentity(next);
        identityRef.current = next;
        setAuthGate('ok');
      } catch (err) {
        console.warn('[paranoic auth] session check', err);
        if (!cancelled) setAuthGate('login');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (authGate !== 'ok' || !hasSupabaseConfig()) {
      setAccountHint('');
      return;
    }
    let cancelled = false;
    void peekAuthSession().then((session) => {
      if (cancelled) return;
      const email = session?.user?.email?.trim();
      const phone = session?.user?.phone?.trim();
      setAccountHint(email || phone || '');
    });
    return () => {
      cancelled = true;
    };
  }, [authGate, identity.id]);

  useEffect(() => {
    if (authGate !== 'ok') return;
    void bootstrapPeerRelations().then(({ trusted, blocked }) => {
      setTrustedIds(trusted);
      setBlockedIds(blocked);
    });
  }, [authGate, identity.id]);

  const handleAuthenticated = (next: UserIdentity) => {
    const persisted = forcePersistSession(next);
    applyIdentity(persisted);
    setAuthGate('ok');
    setAppMode('paranoic');
    setMainTab('contacts');
    setScreen('home');
    setSessionEpoch((n) => n + 1);
    void loadContacts().then(setContacts);
    void bootstrapPeerRelations().then(({ trusted, blocked }) => {
      setTrustedIds(trusted);
      setBlockedIds(blocked);
    });
  };

  const onlineIds = useMemo(
    () => new Set(presenceUsers.filter((u) => u.online).map((u) => u.userId)),
    [presenceUsers]
  );

  /** Контакты + собеседники с активными чатами — только они на карте Family Mode. */
  /**
   * Видимость на карте = статус контакта: принят или есть активный чат — виден,
   * заблокирован или удалён из книжки — исчезает и из presence-опроса.
   */
  const mapContactIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of contacts) ids.add(c.id);
    for (const peerId of Object.keys(lastPreviews)) ids.add(peerId);
    ids.delete(identity.id);
    for (const id of blockedIds) ids.delete(id);
    return [...ids];
  }, [contacts, lastPreviews, blockedIds, identity.id]);

  const mapPeople = useMemo((): MapPerson[] => {
    const presenceById = new Map(presenceUsers.map((u) => [u.userId, u]));
    const list: MapPerson[] = [];

    for (const id of mapContactIds) {
      const contact = contacts.find((c) => c.id === id);
      const presence = presenceById.get(id);
      list.push({
        userId: id,
        name: contact?.name || presence?.name || id.slice(0, 8),
        color: contact?.color || presence?.color || '#60a5fa',
        avatarUrl: presence?.avatarUrl || contact?.avatarUrl || '',
        themeFon: presence?.themeFon,
        lat: presence?.lat ?? ANTARCTICA.lat,
        lng: presence?.lng ?? ANTARCTICA.lng,
        online: Boolean(presence?.online),
        status: presence?.status ?? (presence?.online ? 'online' : 'offline'),
        updatedAt: presence?.updatedAt ?? Date.now(),
        hasLocation: presence?.hasLocation ?? false,
        isContact: true,
      });
    }

    const selfGeo = geo ?? { ...ANTARCTICA };
    list.push({
      userId: identity.id,
      name: identity.name,
      color: identity.color,
      avatarUrl: identity.avatarUrl,
      themeFon: identity.themeFon,
      lat: selfGeo.lat,
      lng: selfGeo.lng,
      online: true,
      updatedAt: Date.now(),
      isContact: false,
      isMe: true,
      hasLocation: geo?.source === 'gps',
    });
    return list;
  }, [mapContactIds, presenceUsers, contacts, identity, geo]);

  /** Блокировка / разблокировка в другой вкладке — сразу отражается на карте. */
  useEffect(() => {
    const sync = () => {
      setBlockedIds(loadBlockedIds());
      setTrustedIds(loadTrustedIds());
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

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

  /** После смены auth.uid() storeContacts очищает IndexedDB — подтянуть пустой список в UI. */
  useEffect(() => {
    void loadContacts().then(setContacts);
  }, [identity.id]);

  /** Magic link (?u=): SELECT profiles → контакт → экран гостя до join. */
  useEffect(() => {
    const urlHandle = getMagicTargetFromUrl();
    if (!urlHandle) return;

    const me = identityRef.current;
    if (resolveMagicRoute(me.id, me.username).kind === 'self') return;

    let cancelled = false;
    void (async () => {
      setAppMode('paranoic');
      setScreen('home');
      setMainTab('chats');
      updateLinkWarning('');

      if (!hasSupabaseConfig()) {
        updateLinkWarning('Supabase не настроен — ссылка недоступна');
        return;
      }

      const profile = await resolvePeerProfile(urlHandle);
      if (cancelled) return;

      if (!profile?.id) {
        updateLinkWarning('Пользователь не найден');
        setGuestPeerId(null);
        guestPeerIdRef.current = null;
        setHostingSelf(true);
        setP2pStatus('failed');
        return;
      }

      if (profile.id === me.id) return;

      guestPeerIdRef.current = profile.id;
      setGuestPeerId(profile.id);
      setHostingSelf(false);
      setPeerLabel(profile.name || profile.username || 'Контакт');
      setPeerAvatarUrl(profile.avatar_url || '');
      setPeerColor(profile.color || '#60a5fa');

      const captured = await captureHostFromMagicLink({
        hostId: profile.id,
        myUserId: me.id,
        urlHandle,
        profile,
      });
      if (cancelled) return;
      if (captured) {
        setContacts(await loadContacts());
      }
    })();

    return () => {
      cancelled = true;
    };
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
    appModeRef.current = appMode;
  }, [appMode]);

  const clearLobbyErrors = useCallback(() => {
    setError('');
    setCallAlert('');
    setCallAlertToastOpen(false);
    setLinkWarning('');
    setDismissedLinkWarning('');
    setCallFailKind(null);
  }, []);

  const resetCallFailureUi = useCallback(() => {
    setCallFailKind(null);
    setError((prev) => (classifyCallFailure(prev) ? '' : prev));
    setCallAlert('');
    setCallAlertToastOpen(false);
    setSignalingStatus('');
    mirrorSignalingStatus('');
  }, [mirrorSignalingStatus]);

  const updateLinkWarning = useCallback((next: string) => {
    setLinkWarning(next);
    if (!next) {
      setDismissedLinkWarning('');
      return;
    }
    setDismissedLinkWarning((prev) => (prev === next ? prev : ''));
  }, []);

  /** Экран логина: сброс до отрисовки + блок повторных P2P toast. */
  useLayoutEffect(() => {
    suppressGlobalErrorsRef.current = authGate !== 'ok';
    if (authGate === 'ok') return;
    clearLobbyErrors();
  }, [authGate, clearLobbyErrors]);

  useEffect(() => {
    if (appMode === 'family') setFamilyEntered(true);
  }, [appMode]);

  useEffect(() => {
    if (callState === 'in-call') {
      setCallStartedAt((prev) => prev ?? Date.now());
      return;
    }
    if (callState === 'idle' || callState === 'ending') {
      setCallStartedAt(null);
    }
  }, [callState]);

  useEffect(() => {
    let cancelled = false;
    void loadLastMessagePreviews(identity.id).then((next) => {
      if (!cancelled) setLastPreviews(next);
    });
    return () => {
      cancelled = true;
    };
  }, [identity.id, contacts, messages]);

  useEffect(() => {
    peerMetaRef.current = {
      id: peerId || guestPeerId || '',
      label: peerLabel,
      avatarUrl: peerAvatarUrl,
      color: peerColor,
    };
  }, [peerId, guestPeerId, peerLabel, peerAvatarUrl, peerColor]);

  // Подхватить глобальную сессию после навигации / StrictMode.
  useEffect(() => {
    const existing = getP2PSession();
    if (existing) {
      p2pRef.current = existing;
      setP2pStatus(existing.currentStatus);
      const liveCall = existing.currentCallState;
      if (liveCall === 'ringing' || liveCall === 'in-call') {
        setCallState(liveCall);
      } else if (liveCall === 'calling') {
        logCallInit('mount-resync-calling-without-arm', { liveCall });
        void existing.cancelCall().catch(() => undefined);
        setCallState('idle');
      }
      setSignalingStatus(existing.currentSignalingStatus);
    }
  }, []);

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
        disarmOutboundCall('banned');
        stopRingtone();
        destroyP2PSession();
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

  const applyIncomingCallOffer = useCallback((offer: CallOfferEvent) => {
    if (isBannedRef.current) return;
    if (isBlocked(offer.from.id)) return;
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
  }, []);

  /** Постоянный слушатель call_offer на calls:{myId} — только после Auth JWT. */
  useEffect(() => {
    if (authGate !== 'ok') return;
    if (!hasSupabaseConfig()) return;
    let cancelled = false;
    const inbox = new CallInbox({
      onOffer: (offer) => {
        if (cancelled) return;
        applyIncomingCallOffer(offer);
      },
      onReject: () => {
        if (cancelled) return;
        stopRingtone();
        closeActiveNotification();
        outboundCallIdRef.current = null;
        setCallFailKind('declined');
        setError('');
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
    void (async () => {
      try {
        const session = await waitForRealtimeAuth('app-call-inbox');
        if (cancelled) return;
        await inbox.start(session.user.id);
      } catch (e) {
        console.warn('[P2P Audit] call inbox start failed', e);
      }
    })();
    return () => {
      cancelled = true;
      callInboxRef.current = null;
      void inbox.stop();
    };
  }, [applyIncomingCallOffer, authGate, identity.id]);

  /** Native FCM: permission, token → profiles.fcm_token, incoming-call payloads. */
  useEffect(() => {
    if (authGate !== 'ok') return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void startNativePush({
      userId: identity.id,
      onIncomingCall: applyIncomingCallOffer,
    }).then((cleanup) => {
      if (disposed) cleanup();
      else stop = cleanup;
    });
    return () => {
      disposed = true;
      stop?.();
    };
  }, [authGate, applyIncomingCallOffer, identity.id]);

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

  /** Family Mode: ошибки дозвона — индикатор, не авто-toast. */
  useEffect(() => {
    if (appMode !== 'family' || !error) return;
    if (!isCallFailureUserAlert(error)) return;
    setCallAlert(error);
    setCallAlertToastOpen(false);
    setError('');
  }, [appMode, error]);

  /** Не спамить «контакт не найден», если P2P уже connected. */
  useEffect(() => {
    if (!error) return;
    const live = getP2PSession();
    if (live?.currentStatus !== 'connected') return;
    if (/не найден|неактуален|удалён из записной/i.test(error)) {
      setError('');
    }
  }, [error, p2pStatus]);

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

  /** Ограничить presence-опрос profiles списком контактов / активных чатов. */
  useEffect(() => {
    presenceRef.current?.setContactUserIds(mapContactIds);
  }, [mapContactIds]);

  /** Presence + GPS (или Ghost Mode / Антарктида). */
  useEffect(() => {
    if (authGate !== 'ok') return;
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
        const session = await waitForRealtimeAuth('app-presence');
        if (cancelled) return;
        await presence.start({
          userId: session.user.id,
          name: identityRef.current.name,
          color: identityRef.current.color,
          avatarUrl: identityRef.current.avatarUrl,
          themeFon: identityRef.current.themeFon,
          lat: ANTARCTICA.lat,
          lng: ANTARCTICA.lng,
        });
        presence.setContactUserIds(mapContactIds);
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

      if (ghost || appMode !== 'family') {
        // Messenger / Ghost: no continuous GPS — avoids OS location indicator & battery drain.
        // Family map mode owns the passive watchPosition below.
        setGeo({ ...ANTARCTICA });
        void presence.updateLocation(ANTARCTICA.lat, ANTARCTICA.lng);
      } else {
        const handle = watchGeo(
          (point) => {
            if (cancelled) return;
            setGeo(point);
            void presence.updateLocation(point.lat, point.lng);
          },
          {
            onDenied: () => {
              if (cancelled) return;
              updateLinkWarning(GEO_BLOCKED_MESSAGE);
              alert(GEO_BLOCKED_MESSAGE);
            },
          }
        );
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
  }, [appMode, authGate, identity.id, settings.ghostMode]);

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

  /** Settings → Управление данными: reload open chat after local clears. */
  useEffect(() => {
    const onCleared = () => {
      const conv = conversationIdRef.current;
      if (conv) void hydrateConversation(conv);
      void loadLastMessagePreviews(identityRef.current.id).then((next) => {
        setLastPreviews(next);
      });
    };
    window.addEventListener(STORAGE_CLEARED_EVENT, onCleared);
    return () => window.removeEventListener(STORAGE_CLEARED_EVENT, onCleared);
  }, [hydrateConversation]);

  const attachLocalVideo = useCallback((stream: MediaStream | null) => {
    if (localVideoRef.current) localVideoRef.current.srcObject = stream;
  }, []);

  const ensureP2P = useCallback(() => {
    // Синглтон из p2pSession — не пересоздаём PC при навигации; обновляем handlers.
    p2pRef.current = ensureP2PSession({
        onStatus: (status) => {
          setP2pStatus(status);
          mirrorP2pStatus(status);
          if (status === 'connected') {
            setError('');
            updateLinkWarning('');
            setCallAlert('');
            setCallAlertToastOpen(false);
            setCallFailKind(null);
            setIncomingConnection(false);
            setIncomingRing(null);
            stopRingtone();
            closeActiveNotification();
            // Гость по магической ссылке — сразу в диалог с этим peer.
            if (
              guestPeerIdRef.current &&
              !suppressChatAutoOpenRef.current &&
              !leavingChatRef.current &&
              !chatClosedRef.current
            ) {
              setScreen('chat');
            }
            void flushOutboxRef.current();
            void syncPendingRef.current();
            if (pendingRingAcceptRef.current) {
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
        onSignalingStatus: (status) => {
          setSignalingStatus(status);
          mirrorSignalingStatus(status);
        },
        onCallState: (state) => {
          const chatDismissed =
            chatClosedRef.current ||
            leavingChatRef.current ||
            suppressChatAutoOpenRef.current;

          if (state === 'calling' && (!callUserIntentRef.current || chatDismissed)) {
            logCallInit('onCallState-rogue-calling-abort', {
              chatDismissed,
              intent: callUserIntentRef.current,
              screen: screenRef.current,
            });
            void p2pRef.current?.cancelCall();
            return;
          }

          if ((state === 'calling' || state === 'in-call') && chatDismissed) {
            logCallInit('onCallState-call-while-chat-dismissed-abort', { state });
            void p2pRef.current?.cancelCall();
            setCallState('idle');
            mirrorCallState('idle');
            setCallExpanded(false);
            return;
          }

          setCallState(state);
          mirrorCallState(state);
          callAttemptRef.current =
            state === 'calling' || state === 'in-call' || state === 'ringing';
          if (callAttemptRef.current) {
            setCallFailKind(null);
          }
          if (state === 'calling' || state === 'in-call') {
            presenceRef.current?.setInCall(true);
            const meId = identityRef.current.id;
            const peer =
              peerIdRef.current || guestPeerIdRef.current || peerMetaRef.current.id;
            if (meId && peer) void markParticipantsInCall(meId, peer);
          }
          if (state === 'idle' || state === 'ending') {
            presenceRef.current?.setInCall(false);
            const meId = identityRef.current.id;
            const peer =
              peerIdRef.current || guestPeerIdRef.current || peerMetaRef.current.id;
            void clearParticipantsInCall([meId, peer].filter(Boolean));
          }
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
                  setCallExpanded(true);
                  setScreen('chat');
                } catch (e) {
                  pendingRingAcceptRef.current = false;
                  pendingAcceptCallerRef.current = null;
                  setIncomingRing(null);
                  setCallExpanded(false);
                  setError(mediaErrorMessage(e, 'Не удалось принять звонок'));
                }
              })();
            }
          } else if (state === 'in-call' || state === 'calling') {
            if (chatClosedRef.current || leavingChatRef.current || suppressChatAutoOpenRef.current) {
              setCallExpanded(false);
              return;
            }
            setCallExpanded(true);
            stopRingtone();
            closeActiveNotification();
            if (state === 'in-call') {
              setIncomingRing(null);
              outboundCallIdRef.current = null;
            }
            setScreen((s) => {
              if (suppressChatAutoOpenRef.current || leavingChatRef.current) return s;
              return s === 'call' || s === 'home' ? 'chat' : s;
            });
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
          setCallFailKind(null);
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
          setCallFailKind('declined');
          setError('');
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
          setScreen((s) => {
            if (suppressChatAutoOpenRef.current) return s;
            return s === 'home' ? 'chat' : s;
          });
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
                setCallExpanded(true);
                setScreen('chat');
              } catch (e) {
                pendingRingAcceptRef.current = false;
                pendingAcceptCallerRef.current = null;
                setIncomingRing(null);
                setCallExpanded(false);
                setError(mediaErrorMessage(e, 'Не удалось принять звонок'));
              }
            })();
          }
        },
        onCallDeclined: () => {
          setCallFailKind('declined');
          setError('');
          setCallExpanded(true);
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
              trusted: isTrusted(peer.userId),
              source: 'hello',
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
        onMessageReaction: (id, emoji) => {
          applyHeart(id, emoji === '❤️');
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
        onLinkDegraded: (degraded, message) => {
          if (suppressGlobalErrorsRef.current) return;
          updateLinkWarning(
            degraded
              ? message || 'Слабое соединение. Файлы могут не отправляться.'
              : ''
          );
        },
        onError: (err) => {
          if (suppressGlobalErrorsRef.current) return;
          const msg = err.message;
          const kind = classifyCallFailure(msg);
          if (kind) {
            // Инбокс висит в фоне постоянно, и его ICE-обрывы к пользователю
            // отношения не имеют — сообщаем только про живую попытку дозвона.
            const calling =
              callAttemptRef.current ||
              callUserIntentRef.current ||
              Boolean(guestPeerIdRef.current);
            if (!calling) {
              console.log('[P2P_DEBUG] idle call failure ignored', msg);
              return;
            }
            setCallFailKind(kind);
            if (appModeRef.current === 'family') {
              setCallAlert(msg);
              setCallAlertToastOpen(false);
            }
            return;
          }
          if (appModeRef.current === 'family' && isCallFailureUserAlert(msg)) {
            setCallAlert(msg);
            setCallAlertToastOpen(false);
            return;
          }
          setError(msg);
        },
    });
    p2pRef.current.setLocalIdentity({
      userId: identityRef.current.id,
      name: identityRef.current.name,
      color: identityRef.current.color,
      avatarUrl: identityRef.current.avatarUrl,
    });
    return p2pRef.current;
  }, [addMessage, applyHeart, attachLocalVideo, patchDeliveryStatus, peerLabel, setActivePeer, mirrorP2pStatus, mirrorCallState, mirrorSignalingStatus, invokeP2PStartCall, disarmOutboundCall]);

  ensureP2PRef.current = ensureP2P;

  /** Вход в персональный инбокс / magic link / legacy room.
   * Инбокс держим и на стартовом экране (select), и на карте (family),
   * иначе гости по магической ссылке не достучатся до хоста. */
  useEffect(() => {
    if (authGate !== 'ok') return;
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

        // Активный гостевой peer переживает family/select — не рвём P2P при открытии карты.
        const stickyGuest =
          guestPeerIdRef.current && guestPeerIdRef.current !== me.id
            ? guestPeerIdRef.current
            : null;
        const live = getP2PSession();
        const liveCall = live?.currentCallState ?? 'idle';
        const keepGuestRoom =
          Boolean(stickyGuest) &&
          Boolean(live) &&
          (live!.currentStatus === 'connected' ||
            live!.currentStatus === 'connecting' ||
            live!.currentStatus === 'creating-offer' ||
            live!.currentStatus === 'waiting-answer' ||
            liveCall === 'in-call' ||
            liveCall === 'calling' ||
            liveCall === 'ringing');

        // Резолв ?u=username|id → реальный peer id.
        let urlRoute = resolveMagicRoute(me.id, me.username);
        if (appMode === 'family' && !keepGuestRoom && !stickyGuest) {
          // Фон: свой инбокс-хост, чтобы принимать join/звонки.
          urlRoute = { kind: 'self' };
        } else if (urlRoute.kind === 'guest' && urlHandle) {
          const resolvedId = await resolvePeerHandle(urlHandle);
          if (cancelled) return;
          if (!resolvedId) {
            setGuestPeerId(null);
            guestPeerIdRef.current = null;
            setHostingSelf(true);
            setP2pStatus('failed');
            setSignalingStatus('');
            setJoining(false);
            clearCallSessionResidue();
            updateLinkWarning('Пользователь не найден');
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

        // Sticky guest > URL guest > null (свой инбокс). Не сбрасываем гостя при family/select.
        const guestId =
          stickyGuest ||
          (urlRoute.kind === 'guest' ? urlRoute.peerId : null) ||
          null;

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
          setJoining(false);
          return;
        }

        setMagicLink(buildMagicLink(me));

        if (provisionalPeer) {
          const captured = await captureHostFromMagicLink({
            hostId: provisionalPeer,
            myUserId: me.id,
            urlHandle,
          });
          if (cancelled) return;
          if (captured) {
            setContacts(await loadContacts());
          }
          const known =
            captured || contactsRef.current.find((c) => c.id === provisionalPeer);
          const presence = presenceUsersRef.current.find(
            (u) => u.userId === provisionalPeer
          );
          const label = known?.name || presence?.name || 'Близкий';
          setPeerAvatarUrl(presence?.avatarUrl || known?.avatarUrl || '');
          setPeerColor(presence?.color || known?.color || '#60a5fa');
          setPeerLabel(label);
          await setActivePeer(provisionalPeer, label);
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
          if (!suppressGlobalErrorsRef.current) {
            setError(e instanceof Error ? e.message : 'Не удалось войти');
          }
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
  }, [appMode, authGate, sessionEpoch, guestPeerId, setActivePeer]);

  useEffect(() => {
    if (leavingChatRef.current || chatClosedRef.current) return;
    if (callState !== 'idle' && p2pRef.current) {
      attachLocalVideo(p2pRef.current.getLocalStream());
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = p2pRef.current.getRemoteStream();
      }
    }
  }, [callState, callExpanded, attachLocalVideo]);

  const copyMagicLink = async () => {
    await navigator.clipboard.writeText(magicLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isLiveConnectedTo = (targetId: string) => {
    const live = getP2PSession();
    if (live?.currentStatus !== 'connected') return false;
    return peerIdRef.current === targetId || guestPeerIdRef.current === targetId;
  };

  const openPeerSession = async (
    targetUserId: string,
    label: string,
    contactMeta?: Partial<Pick<Contact, 'username' | 'avatarUrl' | 'color'>>,
    opts?: { openChat?: boolean; rejoin?: boolean }
  ) => {
    const meta = contactMeta ?? {};
    setAppMode('paranoic');
    setMainTab(opts?.openChat !== false ? 'chats' : mainTab);
    if (opts?.openChat !== false) {
      chatClosedRef.current = false;
      leavingChatRef.current = false;
    }
    setScreen(opts?.openChat !== false ? 'chat' : 'home');
    setMessengerSidebarOpen(false);
    setHostingSelf(false);
    setGuestPeerId(targetUserId);
    guestPeerIdRef.current = targetUserId;
    saveCallResidue({ peerId: targetUserId, guestPeerId: targetUserId });
    setMagicUserInUrl(targetUserId);
    const presence = presenceUsers.find((u) => u.userId === targetUserId);
    setPeerAvatarUrl(presence?.avatarUrl || meta.avatarUrl || '');
    setPeerColor(presence?.color || meta.color || '#60a5fa');
    await setActivePeer(targetUserId, label);
    if (opts?.rejoin !== false) {
      destroyP2PSession();
      p2pRef.current = null;
      setSessionEpoch((n) => n + 1);
    }
  };

  const connectToLocalContact = async (
    contact: Contact,
    opts?: { openChat?: boolean }
  ) => {
    if (isBannedRef.current) {
      setError('Ваш аккаунт заблокирован. Связь недоступна.');
      return;
    }

    const me = identityRef.current;
    const targetUserId = contact.id;

    if (targetUserId === me.id) {
      setError(
        'Вы пытаетесь позвонить на это же устройство / аккаунт. Откройте ссылку другого человека или войдите с другого профиля.'
      );
      return;
    }

    if (isBlocked(targetUserId)) {
      setError('Этот контакт заблокирован. Разблокируйте его, чтобы связаться.');
      return;
    }

    setError('');
    const liveConnected = isLiveConnectedTo(targetUserId);

    if (liveConnected && opts?.openChat !== false) {
      setAppMode('paranoic');
      chatClosedRef.current = false;
      leavingChatRef.current = false;
      setMainTab('chats');
      setScreen('chat');
      setMessengerSidebarOpen(false);
      await setActivePeer(targetUserId, contact.name);
      return;
    }

    await openPeerSession(targetUserId, contact.name, contact, {
      openChat: opts?.openChat,
      rejoin: !liveConnected,
    });
  };

  const quickChatContact = (c: Contact) => {
    chatClosedRef.current = false;
    leavingChatRef.current = false;
    void connectToLocalContact(c, { openChat: true });
  };

  const quickCallContact = (c: Contact, source = 'quick-call-contact') => {
    if (callMediaBlocked) {
      setError(MEDIA_ACCESS_DENIED_MESSAGE);
      return;
    }
    const token = armOutboundCallFromButton(source, { fromHome: true });
    if (!token) return;
    if (isLiveConnectedTo(c.id)) {
      void startCall(source, token);
      return;
    }
    chatClosedRef.current = false;
    leavingChatRef.current = false;
    void connectToLocalContact(c, { openChat: true });
    setError('Подключение… Нажмите «Звонок» снова, когда статус «в сети».');
    disarmOutboundCall(`${source}-waiting-p2p`);
  };

  const connectToUser = async (
    targetUserId: string,
    label?: string,
    opts?: { openChat?: boolean }
  ) => {
    const known = contacts.find((c) => c.id === targetUserId);
    if (known) {
      await connectToLocalContact(known, opts);
      return;
    }

    if (isBannedRef.current) {
      setError('Ваш аккаунт заблокирован. Связь недоступна.');
      return;
    }

    const me = identityRef.current;

    if (targetUserId === me.id) {
      setError(
        'Вы пытаетесь позвонить на это же устройство / аккаунт. Откройте ссылку другого человека или войдите с другого профиля.'
      );
      return;
    }

    if (isBlocked(targetUserId)) {
      setError('Этот контакт заблокирован. Разблокируйте его, чтобы связаться.');
      return;
    }

    setError('');
    const validation = await validateContactForCall(targetUserId, me.id, {
      name: label,
      username: label && looksLikeUsername(label) ? label : undefined,
    });

    if (!validation.ok) {
      if (validation.reason === 'self') {
        setError(
          'Вы пытаетесь позвонить на это же устройство / аккаунт. Откройте ссылку другого человека или войдите с другого профиля.'
        );
        return;
      }
      if (validation.reason === 'missing' && isLiveConnectedTo(targetUserId)) {
        await openPeerSession(targetUserId, label || 'Близкий', {}, { openChat: opts?.openChat, rejoin: false });
        return;
      }
      setError(PROFILE_STALE_MESSAGE);
      return;
    }

    const resolvedId = validation.contact.id;
    const resolvedLabel = validation.contact.name || label || 'Близкий';

    if (validation.idChanged) {
      setContacts(await loadContacts());
    } else if (!validation.skipped) {
      setContacts(await loadContacts());
    }

    if (resolvedId === me.id) {
      setError(
        'Вы пытаетесь позвонить на это же устройство / аккаунт. Откройте ссылку другого человека или войдите с другого профиля.'
      );
      return;
    }

    await openPeerSession(resolvedId, resolvedLabel, validation.contact, {
      openChat: opts?.openChat,
    });
  };

  /** Только UI: назад в список — P2P НЕ трогаем (как Telegram). */
  const navigateHome = useCallback(() => {
    setScreen('home');
    setMainTab('chats');
    setMessengerSidebarOpen(false);
    setCallExpanded(false);
  }, []);

  /** Закрыть чат: жёсткий сброс звонка ДО смены экрана. */
  const handleChatBack = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      logCallInit('handleChatBack');
      abortActiveCallUi('handleChatBack');
      screenRef.current = 'home';
      suppressChatAutoOpenRef.current = true;
      setUiNavLock(true);
      setScreen('home');
      setMainTab('chats');
      setMessengerSidebarOpen(false);
      window.setTimeout(() => {
        suppressChatAutoOpenRef.current = false;
        setUiNavLock(false);
      }, 800);
    },
    [abortActiveCallUi]
  );

  /**
   * Явный Hang Up / «Разорвать связь»: закрываем PC и возвращаемся в свой инбокс.
   * Навигация «Назад» сюда не ходит.
   */
  const returnToOwnInbox = () => {
    clearMagicParamFromUrl();
    clearRoomParamFromUrl();
    clearCallSessionResidue();
    clearEphemeralGuestId();
    setGuestPeerId(null);
    guestPeerIdRef.current = null;
    setHostingSelf(true);
    void setActivePeer(null);
    destroyP2PSession();
    p2pRef.current = null;
    setP2pStatus('idle');
    setCallState('idle');
    setScreen('home');
    setMainTab('chats');
    setSessionEpoch((n) => n + 1);
  };

  const disconnect = () => {
    returnToOwnInbox();
  };

  /** Guest UI «Назад»: если уже на связи — только спрятать UI; иначе отменить join. */
  const leaveGuestUi = () => {
    resetCallFailureUi();
    const live = getP2PSession();
    const connectedNow = live?.currentStatus === 'connected';
    const inCall =
      live?.currentCallState === 'in-call' ||
      live?.currentCallState === 'calling' ||
      callState === 'in-call' ||
      callState === 'calling';
    if (connectedNow || inCall) {
      navigateHome();
      if (connectedNow) setScreen('chat');
      return;
    }
    returnToOwnInbox();
  };

  const guestCallHost = async () => {
    resetCallFailureUi();
    setError('');
    void ensureNotifyPermission();
    if (callMediaBlocked) {
      setError(MEDIA_ACCESS_DENIED_MESSAGE);
      return;
    }
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
    const token = armOutboundCallFromButton('guest-direct-call', { fromHome: true });
    if (!token) return;
    if (connected) {
      await startCall('guest-direct-call', token);
    } else {
      disarmOutboundCall('guest-direct-call-waiting-p2p');
      setError('Подключение… Нажмите «Звонок» снова, когда статус «в сети».');
    }
  };

  const startCall = async (source: string, buttonToken?: number) => {
    logCallInit(`${source}-startCall-enter`, { buttonToken, screen: screenRef.current });
    if (callDialLockRef.current) {
      logCallInit(`${source}-startCall-blocked-dial-lock`);
      return;
    }

    const liveCall = p2pRef.current?.currentCallState ?? callState;
    if (liveCall === 'calling' || liveCall === 'in-call') {
      if (isOutboundCallArmed(source, buttonToken)) {
        setCallExpanded(true);
      }
      return;
    }
    if (liveCall === 'ringing') return;

    if (!canPlaceOutboundCall(source, buttonToken)) {
      return;
    }

    callDialLockRef.current = true;
    resetCallFailureUi();
    setError('');
    setMicMuted(false);
    setCameraOff(false);
    void ensureNotifyPermission();
    if (isBannedRef.current) {
      callDialLockRef.current = false;
      setError('Ваш аккаунт заблокирован. Звонки недоступны.');
      return;
    }
    if (callMediaBlocked) {
      disarmOutboundCall(`${source}-media-blocked`);
      callDialLockRef.current = false;
      setError(MEDIA_ACCESS_DENIED_MESSAGE);
      return;
    }

    const liveCallAfterGate = p2pRef.current?.currentCallState ?? callState;
    if (liveCallAfterGate === 'calling' || liveCallAfterGate === 'in-call') {
      if (isOutboundCallArmed(source, buttonToken)) {
        setCallExpanded(true);
      }
      callDialLockRef.current = false;
      return;
    }
    if (liveCallAfterGate === 'ringing') {
      callDialLockRef.current = false;
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

      const confirmOfflineOrBusy = async (callTarget: string): Promise<boolean> => {
        const check = await checkCalleeOnline(callTarget);
        if (check.missingProfile) {
          setError(PROFILE_STALE_MESSAGE);
          return false;
        }
        if (!check.ok) {
          setError('Пользователь сейчас разговаривает. Попробуйте позже.');
          return false;
        }
        // Presence может кратко показывать offline — всё равно шлём offer через call inbox.
        if (check.appearsOffline) {
          console.log('[paranoic] callee appears offline — attempting call via inbox anyway', {
            callTarget,
            lastSeen: check.peer.lastSeen,
          });
        }
        return true;
      };

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
          if (validation.reason === 'missing' && isLiveConnectedTo(target)) {
            if (!(await confirmOfflineOrBusy(target))) {
              clearCallSessionResidue();
              return;
            }
            const callTarget = target;
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
            void markParticipantsInCall(me.id, callTarget);
            presenceRef.current?.setInCall(true);
            if (!canPlaceOutboundCall(`${source}-before-p2p-missing-profile`, buttonToken)) {
              clearCallSessionResidue();
              return;
            }
            setCallExpanded(true);
            setScreen('chat');
            await invokeP2PStartCall(`${source}-missing-profile-connected`, buttonToken);
            attachLocalVideo(null);
            return;
          }
          const title = peerLabel || known?.name || target;
          const shouldRemove = window.confirm(
            `${PROFILE_STALE_MESSAGE}\n\nУдалить «${title}» из записной книжки?`
          );
          if (shouldRemove) {
            const next = await removeContact(target);
            setContacts(next);
            setError(PROFILE_STALE_MESSAGE);
          } else {
            setError(PROFILE_STALE_MESSAGE);
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
        if (!(await confirmOfflineOrBusy(callTarget))) {
          clearCallSessionResidue();
          return;
        }
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
        void markParticipantsInCall(me.id, callTarget);
        presenceRef.current?.setInCall(true);
      }
      if (!canPlaceOutboundCall(`${source}-before-p2p`, buttonToken)) {
        clearCallSessionResidue();
        return;
      }
      setCallExpanded(true);
      setScreen('chat');
      await invokeP2PStartCall(source, buttonToken);
      attachLocalVideo(null);
    } catch (e) {
      disarmOutboundCall(`${source}-error`);
      clearCallSessionResidue();
      setCallExpanded(false);
      presenceRef.current?.setInCall(false);
      setError(mediaErrorMessage(e, 'Не удалось начать звонок'));
    } finally {
      window.setTimeout(() => {
        callDialLockRef.current = false;
      }, 700);
    }
  };

  /** Звонок из шапки чата — only after armOutboundCallFromButton in phone onClick. */
  const dialFromChat = async (source: string, buttonToken: number) => {
    logCallInit(`${source}-dialFromChat-enter`, { buttonToken });
    if (screenRef.current !== 'chat' || chatClosedRef.current || leavingChatRef.current) {
      logCallInit(`${source}-dialFromChat-blocked-screen`);
      return;
    }
    if (!isOutboundCallArmed(source, buttonToken)) {
      return;
    }
    if (callDialLockRef.current) return;
    if (callMediaBlocked) {
      setError(MEDIA_ACCESS_DENIED_MESSAGE);
      disarmOutboundCall(`${source}-media-blocked`);
      return;
    }
    if (isBannedRef.current) {
      setError('Ваш аккаунт заблокирован. Звонки недоступны.');
      disarmOutboundCall(`${source}-banned`);
      return;
    }

    const liveCall = p2pRef.current?.currentCallState ?? callState;
    if (liveCall === 'calling' || liveCall === 'in-call') {
      setCallExpanded(true);
      return;
    }
    if (liveCall === 'ringing') return;

    const target = peerIdRef.current || guestPeerIdRef.current;
    if (!target) {
      setError('Нет собеседника для звонка');
      disarmOutboundCall(`${source}-no-target`);
      return;
    }

    const dialGen = callDialGenerationRef.current + 1;
    callDialGenerationRef.current = dialGen;

    resetCallFailureUi();
    setError('');

    const ready =
      (isLiveConnectedTo(target) || p2pStatus === 'connected') &&
      Boolean(p2pRef.current?.isReady);

    if (ready) {
      if (
        dialGen !== callDialGenerationRef.current ||
        screenRef.current !== 'chat' ||
        chatClosedRef.current ||
        leavingChatRef.current ||
        !isOutboundCallArmed(source, buttonToken)
      ) {
        disarmOutboundCall(`${source}-dial-aborted`);
        return;
      }
      await startCall(source, buttonToken);
      return;
    }

    // P2P ещё не готов — только поднимаем сессию; звонок только повторным нажатием Call.
    setError('Подключение… Нажмите «Звонок» снова, когда статус «в сети».');
    disarmOutboundCall(`${source}-waiting-p2p`);
    const known = contacts.find((c) => c.id === target);
    if (known) {
      await connectToLocalContact(known, { openChat: true });
    } else {
      await connectToUser(target, peerLabel, { openChat: true });
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
    resetCallFailureUi();
    setError('');
    setMicMuted(false);
    setCameraOff(false);
    stopRingtone();
    closeActiveNotification();
    void ensureNotifyPermission();
    if (callMediaBlocked) {
      pendingRingAcceptRef.current = false;
      pendingAcceptCallerRef.current = null;
      setIncomingRing(null);
      setCallExpanded(false);
      setError(MEDIA_ACCESS_DENIED_MESSAGE);
      try {
        await ensureP2P().declineCall();
      } catch {
        /* */
      }
      return;
    }
    const ring = incomingRing;
    if (ring?.callId) {
      void updateCallSessionStatus(ring.callId, 'accepted');
    }
    try {
      const meId = identityRef.current.id;
      const peerId = ring?.from.id || peerIdRef.current || guestPeerIdRef.current;
      if (meId && peerId) {
        void markParticipantsInCall(meId, peerId);
        presenceRef.current?.setInCall(true);
      }
      if (p2pRef.current?.currentCallState === 'ringing') {
        const stream = await ensureP2P().acceptCall();
        attachLocalVideo(stream);
        setIncomingRing(null);
        setIncomingConnection(false);
        pendingRingAcceptRef.current = false;
        pendingAcceptCallerRef.current = null;
        setCallExpanded(true);
        setScreen('chat');
        return;
      }

      if (incomingConnection) {
        await ensureP2P().acceptIncomingConnection();
        setIncomingConnection(false);
        setIncomingRing(null);
        pendingRingAcceptRef.current = false;
        pendingAcceptCallerRef.current = null;
        setCallExpanded(true);
        setScreen('chat');
        return;
      }

      // Realtime offer: звонящий сам заходит в наш inbox — принимаем join и ждём invite.
      if (ring?.from.id) {
        pendingRingAcceptRef.current = true;
        pendingAcceptCallerRef.current = ring.from;
        setIncomingRing(null);
        setCallExpanded(true);
        setScreen('chat');
        return;
      }

      const stream = await ensureP2P().acceptCall();
      attachLocalVideo(stream);
      setIncomingRing(null);
      setIncomingConnection(false);
      setCallExpanded(true);
      setScreen('chat');
    } catch (e) {
      pendingRingAcceptRef.current = false;
      pendingAcceptCallerRef.current = null;
      setIncomingRing(null);
      setIncomingConnection(false);
      setError(mediaErrorMessage(e, 'Не удалось принять звонок'));
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
    clearOutboundCallIntent('cancelCall');
    callDialGenerationRef.current += 1;
    pendingRingAcceptRef.current = false;

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
      void callInboxRef.current?.sendCancel(target, me.id, callId);
      void updateCallSessionStatus(callId, 'cancelled');
    }

    outboundCallIdRef.current = null;
    setIncomingRing(null);

    try {
      await p2pRef.current?.cancelCall();
    } catch {
      /* */
    }

    hangUpSession();
    p2pRef.current = null;
    attachLocalVideo(null);
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    setScreenSharing(false);
    setMicMuted(false);
    setCameraOff(false);
    presenceRef.current?.setInCall(false);
    void clearParticipantsInCall([me.id, target].filter(Boolean) as string[]);
    setNetworkQuality('good');
    setCallExpanded(false);
    setJoining(false);
    setSignalingStatus('');
    mirrorSignalingStatus('');
    setCallState('idle');
    setP2pStatus('idle');
    setCallFailKind(null);

    if (guestPeerIdRef.current) {
      clearMagicParamFromUrl();
      clearCallSessionResidue();
      clearEphemeralGuestId();
      setGuestPeerId(null);
      guestPeerIdRef.current = null;
      setHostingSelf(true);
      void setActivePeer(null);
      setSessionEpoch((n) => n + 1);
    }

    setMainTab('contacts');
    setScreen('home');
  };

  const toggleScreenShare = async () => {
    setError('');
    try {
      if (
        typeof navigator === 'undefined' ||
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getDisplayMedia !== 'function'
      ) {
        setError('Демонстрация экрана доступна только в версии для компьютера');
        return;
      }
      const active = await ensureP2P().toggleScreenShare();
      setScreenSharing(active);
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : 'Не удалось переключить демонстрацию экрана';
      if (/getDisplayMedia is not a function/i.test(msg)) {
        setError('Демонстрация экрана доступна только в версии для компьютера');
        return;
      }
      setError(msg);
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

  const toggleCallMic = () => {
    const nextMuted = !micMuted;
    p2pRef.current?.toggleAudio(!nextMuted);
    setMicMuted(nextMuted);
  };

  const toggleCallCamera = () => {
    const nextOff = !cameraOff;
    p2pRef.current?.toggleVideo(!nextOff);
    setCameraOff(nextOff);
  };

  const switchCallCamera = () => {
    void p2pRef.current?.switchCamera().catch((err) => {
      setError(mediaErrorMessage(err, 'Не удалось переключить камеру'));
    });
  };

  useEffect(() => {
    return () => {
      stopRingtone();
    };
  }, []);

  /** Разрешение на уведомления по первому жесту в приложении. */
  useEffect(() => {
    if (authGate !== 'ok') return;
    const unlock = () => {
      void ensureNotifyPermission();
      window.removeEventListener('pointerdown', unlock);
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, [authGate]);

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
    setMagicLink(buildMagicLink(next));
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

  /** Log Out → экран входа (никнейм + пароль). */
  const handleSignOut = async () => {
    stopRingtone();
    closeActiveNotification();
    clearOutboundCallIntent('handleSignOut');
    callDialGenerationRef.current += 1;
    pendingRingAcceptRef.current = false;
    try {
      await p2pRef.current?.hangUp();
    } catch {
      /* */
    }
    destroyP2PSession();
    p2pRef.current = null;
    hangUpSession();
    void presenceRef.current?.stop();
    presenceRef.current = null;
    void callInboxRef.current?.stop();
    callInboxRef.current = null;

    const next = await signOutAndReset();
    setIdentity(next);
    identityRef.current = next;
    setAuthGate('login');
    setContacts([]);
    setMessages([]);
    setPeerId(null);
    setGuestPeerId(null);
    setIncomingRing(null);
    setCallState('idle');
    setP2pStatus('idle');
    setIsAdmin(false);
    setIsBanned(false);
    isBannedRef.current = false;
    setProfileOpen(false);
    setAdminOpen(false);
    setAppMode('paranoic');
    setMainTab('contacts');
    setScreen('home');
    setSessionEpoch((n) => n + 1);
  };

  /** Сохранённая локальная сессия: после Auth сразу Paranoic → Контакты. */
  useEffect(() => {
    if (authGate !== 'ok') return;
    const session = getSavedLoginSession();
    if (!session) return;

    const current = getOrCreateIdentity();
    if (current.id !== session.userId) {
      void fetchRemoteProfile(session.userId).then((remote) => {
        if (remote) {
          applyIdentity(restoreIdentityFromProfile(remote));
        } else {
          applyIdentity(
            forcePersistSession({
              ...current,
              id: session.userId,
              username: session.username,
            })
          );
        }
      });
    }

    setMainTab('contacts');
    setScreen('home');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authGate]);

  const connected = p2pStatus === 'connected';
  const callLive = callState === 'calling' || callState === 'in-call';
  const showCallBanner = callLive && !callExpanded && !incomingRing && !callFailKind;
  const showErrorToast = Boolean(error) && !classifyCallFailure(error);
  const guestCallScreen = Boolean(guestPeerId) && !connected;
  const overlayFailure = guestCallScreen ? null : callFailKind;
  /** Плашка неудачного дозвона больше не «экран» — интерфейс под ней остаётся живым. */
  const callUiOpen =
    (callExpanded && !overlayFailure) ||
    (callState === 'ringing' && Boolean(incomingRing));
  /** Bottom nav: на главных вкладках; скрыт в открытом чате, звонке и guest direct. */
  const showBottomNav =
    screen !== 'chat' &&
    !callUiOpen &&
    !guestPeerId &&
    !incomingRing;

  const activePeerId = peerId || guestPeerId;
  const peerIsTrusted = Boolean(
    activePeerId &&
      (trustedIds.has(activePeerId) ||
        isTrusted(activePeerId) ||
        contacts.some((c) => c.id === activePeerId && c.trusted))
  );
  const showTrustBanner =
    screen === 'chat' &&
    Boolean(activePeerId) &&
    !peerIsTrusted &&
    messages.some((m) => !m.mine);

  const chatsOrdered = useMemo(() => {
    return [...contacts].sort((a, b) => {
      const ta = lastPreviews[a.id]?.createdAt ?? 0;
      const tb = lastPreviews[b.id]?.createdAt ?? 0;
      if (tb !== ta) return tb - ta;
      return a.name.localeCompare(b.name, 'ru');
    });
  }, [contacts, lastPreviews]);

  const contactsFiltered = useMemo(() => {
    const q = contactsSearchQuery.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        (c.username || '').toLowerCase().includes(q)
    );
  }, [contacts, contactsSearchQuery]);

  const handleContactsSearchQuery = useCallback((query: string) => {
    setContactsSearchQuery(query);
  }, []);

  const handleAddGlobalContact = useCallback(async (profile: RemoteProfile) => {
    if (contactsSearchAdding) return;
    setContactsSearchAdding(profile.id);
    try {
      await upsertContact({
        id: profile.id,
        name: profile.name,
        color: profile.color,
        avatarUrl: profile.avatar_url ?? '',
        username: profile.username ?? undefined,
        source: 'manual',
      });
      setContacts(await loadContacts());
    } finally {
      setContactsSearchAdding(null);
    }
  }, [contactsSearchAdding]);

  const goMainTab = (tab: LiquidNavTab) => {
    setMainTab(tab);
    setScreen('home');
    setMessengerSidebarOpen(false);
    setCallExpanded(false);
    if (appMode === 'family') setAppMode('paranoic');
  };

  const handleTrustPeer = async () => {
    const id = activePeerId;
    if (!id) return;
    const next = await trustAndUpsertContact({
      id,
      name: peerLabel || 'Контакт',
      color: peerColor || '#60a5fa',
      avatarUrl: peerAvatarUrl || '',
      username: looksLikeUsername(peerLabel) ? peerLabel : undefined,
    });
    setContacts(next);
    setTrustedIds(loadTrustedIds());
    setBlockedIds(loadBlockedIds());
  };

  const handleBlockPeer = async () => {
    const id = activePeerId;
    if (!id) return;
    const result = await blockUserSafety(id);
    setTrustedIds(loadTrustedIds());
    setBlockedIds(loadBlockedIds());
    if (!result.ok) {
      setError(result.message || t('safety.blockFailed'));
      return;
    }
    setError(t('safety.blockSuccess', { name: peerLabel }));
    setPeerProfileOpen(false);
    disconnect();
  };

  const shellStyle =
    appMode === 'paranoic'
      ? ({ background: 'var(--app-shell-bg, #0a0b0e)' } as React.CSSProperties)
      : undefined;

  return (
    <>
      {authGate === 'checking' && (
        <div className="auth-screen auth-screen--loading" aria-busy="true">
          <div className="auth-screen__bg" aria-hidden />
          <p className="auth-screen__loading-text">Проверяем сессию…</p>
        </div>
      )}
      {authGate === 'login' && <AuthScreen onAuthenticated={handleAuthenticated} />}
      {authGate === 'ok' && (
    <>
      <ActiveCallBanner
        visible={showCallBanner}
        callState={callState}
        startedAt={callStartedAt}
        onOpen={() => setCallExpanded(true)}
      />
      {familyEntered && (
      <div
        className={`family-app-shell${appMode === 'family' ? ' is-active' : ' is-dormant'}`}
        aria-hidden={appMode !== 'family'}
      >
        <div className="family-map-stage">
          <GlobeLobby
            active={appMode === 'family'}
            onBack={() => goMainTab('contacts')}
            currentUserId={identity.id}
            people={mapPeople}
            geoSource={
              settings.ghostMode ? 'antarctica' : geo ? geo.source : 'pending'
            }
            callAlertActive={Boolean(callAlert)}
            callMediaBlocked={callMediaBlocked}
            onCallAlertReveal={() => {
              if (callAlert) setCallAlertToastOpen(true);
            }}
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
              if (callMediaBlocked) {
                setError(MEDIA_ACCESS_DENIED_MESSAGE);
                return;
              }
              const token = armOutboundCallFromButton('globe-map-call', { fromHome: true });
              if (!token) return;
              setAppMode('paranoic');
              if (isLiveConnectedTo(user.userId)) {
                void startCall('globe-map-call', token);
                return;
              }
              void connectToUser(
                user.userId,
                user.isContact ? user.name : 'Незнакомец',
                { openChat: true }
              );
              disarmOutboundCall('globe-map-call-waiting-p2p');
              setError('Подключение… Нажмите «Звонок» снова, когда статус «в сети».');
            }}
          />
        </div>
        <div className="family-app-overlays" aria-live="polite">
          {showErrorToast && (
            <div
              className={`app-toast app-toast--error app-toast--visible${incomingRing ? '' : ' app-toast--above-nav'}`}
              role="alert"
            >
              <span className="app-toast__text">{error}</span>
              <button
                type="button"
                className="app-toast__close icon-btn"
                onClick={() => setError('')}
                aria-label="Закрыть"
              >
                <X size={16} />
              </button>
            </div>
          )}
          {callAlertToastOpen && callAlert && (
            <div
              className={`app-toast app-toast--error app-toast--visible${incomingRing ? '' : ' app-toast--above-nav'}`}
              role="alert"
            >
              <span className="app-toast__text">{callAlert}</span>
              <button
                type="button"
                className="app-toast__close icon-btn"
                onClick={() => setCallAlertToastOpen(false)}
                aria-label="Закрыть"
              >
                <X size={16} />
              </button>
            </div>
          )}
          {linkWarning && linkWarning !== dismissedLinkWarning && (
            <div className="app-toast app-toast--warning app-toast--top app-toast--visible" role="status">
              <span className="app-toast__text">{linkWarning}</span>
              <button
                type="button"
                className="app-toast__close icon-btn"
                onClick={() => setDismissedLinkWarning(linkWarning)}
                aria-label="Закрыть"
              >
                <X size={16} />
              </button>
            </div>
          )}
          {adminOpen && isSuperAdminUsername(identity.username) && (
            <AdminPanel
              username={identity.username}
              currentUserId={identity.id}
              onClose={() => setAdminOpen(false)}
            />
          )}
          {adminOpen && isAdmin && !isSuperAdminUsername(identity.username) && (
            <AdminDashboard currentUserId={identity.id} onClose={() => setAdminOpen(false)} />
          )}
          {incomingRing && (
            <IncomingCallModal
              caller={incomingRing.from}
              mediaBlocked={callMediaBlocked}
              onAccept={() => {
                setAppMode('paranoic');
                void acceptMediaCall();
              }}
              onReject={() => void declineMediaCall()}
            />
          )}
        </div>
        {!incomingRing && (
          <LiquidNavigationBar
            active={mainTab}
            onChats={() => goMainTab('chats')}
            onContacts={() => goMainTab('contacts')}
            onSettings={() => goMainTab('settings')}
            onProfile={() => goMainTab('profile')}
          />
        )}
      </div>
      )}
    <div
      className={`app-shell themed pt-[max(6px,env(safe-area-inset-top))] px-2${screen === 'chat' ? ' messenger-shell' : ''}${
        showBottomNav ? ' has-liquid-nav' : ''
      }${appMode === 'family' ? ' is-dormant' : ''}`}
      style={shellStyle}
      aria-hidden={appMode === 'family'}
    >
      {profileOpen && (
        <ProfileModal
          identity={identity}
          settings={settings}
          onClose={() => setProfileOpen(false)}
          onSaved={(next) => applyIdentity(next)}
          onSettingsChange={setSettings}
          onSignOut={handleSignOut}
          onOpenAdmin={() => setAdminOpen(true)}
        />
      )}
      {peerProfileOpen && activePeerId && (
        <PeerProfileModal
          peer={{
            id: activePeerId,
            name: peerLabel,
            username: contacts.find((c) => c.id === activePeerId)?.username,
            color: peerColor,
            avatarUrl: peerAvatarUrl,
            online: connected,
            typing: peerTyping,
          }}
          messages={messages}
          isBlocked={blockedIds.has(activePeerId)}
          onBlocked={() => {
            setTrustedIds(loadTrustedIds());
            setBlockedIds(loadBlockedIds());
            setError(t('safety.blockSuccess', { name: peerLabel }));
            setPeerProfileOpen(false);
            disconnect();
          }}
          onClose={() => setPeerProfileOpen(false)}
        />
      )}
      {adminOpen && isSuperAdminUsername(identity.username) && (
        <AdminPanel
          username={identity.username}
          currentUserId={identity.id}
          onClose={() => setAdminOpen(false)}
        />
      )}
      {adminOpen && isAdmin && !isSuperAdminUsername(identity.username) && (
        <AdminDashboard currentUserId={identity.id} onClose={() => setAdminOpen(false)} />
      )}
      <header className="app-header flex items-center">
        <div className="brand">
          <ParanoicLogo size={26} compact className="brand-logo-mark" />
          <div>
            <h1>Paranoic</h1>
          </div>
        </div>
        <div className="app-header-right">
          {(isAdmin || isSuperAdminUsername(identity.username)) && (
            <button
              type="button"
              className="admin-panel-btn"
              onClick={() => setAdminOpen(true)}
            >
              <ShieldCheck size={16} />
              Admin Panel
            </button>
          )}
        </div>
      </header>

      {isBanned && (
        <div className="banner banned" role="alert">
          Ваш аккаунт заблокирован. Звонки и P2P-соединения недоступны.
        </div>
      )}

      {showErrorToast && (
        <div className="banner error" role="alert">
          {error}
          <button type="button" className="icon-btn" onClick={() => setError('')} aria-label="Закрыть">
            <X size={18} />
          </button>
        </div>
      )}

      {linkWarning && linkWarning !== dismissedLinkWarning && (
        <div className="app-toast app-toast--warning app-toast--top app-toast--visible" role="status">
          <span className="app-toast__text">{linkWarning}</span>
          <button
            type="button"
            className="app-toast__close icon-btn"
            onClick={() => setDismissedLinkWarning(linkWarning)}
            aria-label="Закрыть"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {uploadProgress !== null && (
        <div className="banner info">Отправка… {Math.round(uploadProgress * 100)}%</div>
      )}

      <main className="app-main">
        {screen === 'home' && (
          <section className={`home${uiNavLock ? ' ui-nav-lock' : ''}`}>
            {guestPeerId && !connected ? (
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
                failure={callFailKind}
                mediaBlocked={callMediaBlocked}
                onCall={() => {
                  void guestCallHost();
                }}
                onCancel={() => void cancelCall()}
                onBack={leaveGuestUi}
              />
            ) : (
              <>
                {mainTab === 'chats' && (
                  <div className="tab-panel liquid-glass-card contacts-panel">
                    <div className="contacts-head">
                      <h2>{t('chats.title')}</h2>
                      <span className="contacts-count">{contacts.length}</span>
                    </div>
                    <ChatSearchPanel
                      selfId={identity.id}
                      contacts={contacts}
                      onResultsModeChange={setChatsSearchMode}
                      onOpenPeer={(peerId, peerName) => {
                        const known = contacts.find((c) => c.id === peerId);
                        if (known) quickChatContact(known);
                        else void connectToUser(peerId, peerName, { openChat: true });
                      }}
                    />
                    {connected && peerId && !chatsSearchMode && (
                      <div className="active-session-card">
                        <p className="lead" style={{ margin: 0 }}>
                          {t('chats.onCall')}: <strong>{peerLabel}</strong>
                        </p>
                        <div className="mega-grid" style={{ marginTop: 12 }}>
                          <button
                            type="button"
                            className={`mega-btn call${callMediaBlocked ? ' is-media-blocked' : ''}`}
                            title={callMediaBlocked ? MEDIA_ACCESS_DENIED_MESSAGE : undefined}
                            aria-disabled={callMediaBlocked}
                            onClick={() => {
                              if (callMediaBlocked) {
                                setError(MEDIA_ACCESS_DENIED_MESSAGE);
                                return;
                              }
                              const token = armOutboundCallFromButton('active-session-call', {
                                fromHome: true,
                              });
                              if (token) void startCall('active-session-call', token);
                            }}
                          >
                            <Phone size={18} />
                            {t('common.call')}
                          </button>
                          <button
                            type="button"
                            className="mega-btn chat"
                            onClick={() => setScreen('chat')}
                          >
                            <MessageCircle size={18} />
                            {t('chats.openChat')}
                          </button>
                        </div>
                        <button
                          type="button"
                          className="text-link danger"
                          onClick={disconnect}
                          style={{ marginTop: 8 }}
                        >
                          <Unplug size={16} /> {t('chats.disconnect')}
                        </button>
                      </div>
                    )}
                    {chatsSearchMode ? null : contacts.length === 0 ? (
                      <p className="empty-contacts">
                        {t('chats.empty')} {t('chats.emptyHint')}
                      </p>
                    ) : (
                      <ul className="contacts-list">
                        {chatsOrdered.map((c) => {
                          const online = onlineIds.has(c.id);
                          const trusted = c.trusted || trustedIds.has(c.id);
                          return (
                            <ContactListRow
                              key={c.id}
                              contact={c}
                              online={online}
                              trusted={trusted}
                              preview={lastPreviews[c.id]}
                              avatarUrl={
                                c.avatarUrl ||
                                presenceUsers.find((u) => u.userId === c.id)?.avatarUrl
                              }
                              onOpen={() => quickChatContact(c)}
                              onCall={() => quickCallContact(c, 'contacts-row-phone')}
                              mediaBlocked={callMediaBlocked}
                            />
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}

                {mainTab === 'contacts' && (
                  <div className="tab-panel liquid-glass-card contacts-panel">
                    <div className="contacts-head">
                      <h2>{t('contacts.title')}</h2>
                      <span className="contacts-count">{contacts.length}</span>
                    </div>
                    <ContactsSearchPanel
                      selfId={identity.id}
                      contacts={contacts}
                      onQueryChange={handleContactsSearchQuery}
                      addingId={contactsSearchAdding}
                      onStartChat={(profile) => {
                        void connectToUser(profile.id, profile.name, { openChat: true });
                      }}
                      onAddContact={(profile) => handleAddGlobalContact(profile)}
                    />
                    {!contactsSearchQuery.trim() && (
                      <p className="hint contacts-hint">
                        {t('contacts.hint')}
                      </p>
                    )}
                    {contacts.length === 0 ? (
                      <p className="empty-contacts">
                        {t('contacts.empty')}
                      </p>
                    ) : contactsFiltered.length === 0 ? (
                      <p className="empty-contacts">
                        {t('contacts.searchLocalEmpty')}
                      </p>
                    ) : (
                      <ul className="contacts-list">
                        {contactsFiltered.map((c) => {
                          const online = onlineIds.has(c.id);
                          const trusted = c.trusted || trustedIds.has(c.id);
                          const rowDisabled = connected && peerId === c.id;
                          return (
                            <ContactListRow
                              key={c.id}
                              contact={c}
                              online={online}
                              trusted={trusted}
                              disabled={rowDisabled}
                              preview={lastPreviews[c.id]}
                              avatarUrl={
                                c.avatarUrl ||
                                presenceUsers.find((u) => u.userId === c.id)?.avatarUrl
                              }
                              onOpen={() => quickChatContact(c)}
                              onCall={() => quickCallContact(c, 'contacts-row-phone')}
                              mediaBlocked={callMediaBlocked}
                            />
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}

                {mainTab === 'settings' && (
                  <SettingsPanel
                    settings={settings}
                    isAdmin={isAdmin}
                    onSettingsChange={setSettings}
                    onOpenFamilyMap={() => setAppMode('family')}
                    onOpenAdmin={() => setAdminOpen(true)}
                  />
                )}

                {mainTab === 'profile' && (
                  <ProfileHome
                    identity={identity}
                    magicLink={magicLink}
                    accountHint={accountHint}
                    ghostMode={settings.ghostMode}
                    connected={connected}
                    peerLabel={peerLabel}
                    e2eeHint={
                      keyString
                        ? `E2EE активен · ${hostingSelf ? 'свой инбокс' : 'гостевой'}`
                        : undefined
                    }
                    onIdentityChange={(next) => {
                      applyIdentity(next);
                    }}
                    onOpenEditor={() => setProfileOpen(true)}
                    onCopyMagicLink={() => void copyMagicLink()}
                    copiedLink={copied}
                  />
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
                  onClick={handleChatBack}
                >
                  <ArrowLeft size={16} /> {t('chats.title')}
                </button>
                <h2>{t('chats.title')}</h2>
              </div>
              <div className="messenger-sidebar-search">
                <ChatSearchPanel
                  compact
                  selfId={identity.id}
                  contacts={contacts}
                  onResultsModeChange={setSidebarSearchMode}
                  onOpenPeer={(peerId, peerName) => {
                    setMessengerSidebarOpen(false);
                    const known = contacts.find((c) => c.id === peerId);
                    if (known) quickChatContact(known);
                    else void connectToUser(peerId, peerName, { openChat: true });
                  }}
                />
              </div>
              {sidebarSearchMode ? null : (
              <ul className="messenger-contacts">
                {contacts.length === 0 ? (
                  <li className="empty-contacts">{t('chats.noContacts')}</li>
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
                          <span className="contact-info min-w-0 flex-1">
                            <span className="flex min-w-0 items-center justify-between gap-2">
                              <span className="contact-name truncate">{c.name}</span>
                              {lastPreviews[c.id]?.timeLabel ? (
                                <span className="shrink-0 text-xs text-gray-400">
                                  {lastPreviews[c.id]?.timeLabel}
                                </span>
                              ) : null}
                            </span>
                            <span className="truncate text-sm text-gray-400">
                              {lastPreviews[c.id]?.snippet || (online ? 'в сети' : 'не в сети')}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
              )}
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
            <ChatHeader
              backLabel={t('chat.back')}
              peerLabel={peerLabel}
              peerColor={peerColor}
              peerAvatarUrl={peerAvatarUrl}
              peerTyping={peerTyping}
              connected={connected}
              onLinkLabel={t('chat.onLink')}
              offlineLabel={t('chat.offline')}
              typingLabel={t('chat.typing')}
              callLabel={t('chat.call')}
              returnToCallLabel={t('chat.returnToCall')}
              attachLabel={t('chat.attach')}
              contactsToggleLabel="Контакты"
              callLive={callLive}
              callMediaBlocked={callMediaBlocked}
              callMediaBlockedMessage={MEDIA_ACCESS_DENIED_MESSAGE}
              activePeerId={activePeerId}
              onBack={handleChatBack}
              onToggleSidebar={() => setMessengerSidebarOpen((v) => !v)}
              onOpenProfile={() => {
                if (activePeerId) setPeerProfileOpen(true);
              }}
              onCall={() => {
                if (callMediaBlocked) {
                  setError(MEDIA_ACCESS_DENIED_MESSAGE);
                  return;
                }
                if (callLive) {
                  setCallExpanded(true);
                  return;
                }
                const token = armOutboundCallFromButton('chat-header-phone');
                if (token) void dialFromChat('chat-header-phone', token);
              }}
              onAttach={() => fileInputRef.current?.click()}
            />

            {showTrustBanner && (
              <div className="trust-banner" role="status">
                <div className="trust-banner-copy">
                  <Shield size={16} />
                  <p>
                    {t('chat.trustTitle')}
                  </p>
                </div>
                <div className="trust-banner-actions">
                  <button
                    type="button"
                    className="trust-btn trust"
                    onClick={() => void handleTrustPeer()}
                  >
                    <UserCheck size={16} />
                    {t('chat.trust')}
                  </button>
                  <button
                    type="button"
                    className="trust-btn block"
                    onClick={() => void handleBlockPeer()}
                  >
                    <Ban size={16} />
                    {t('chat.block')}
                  </button>
                </div>
              </div>
            )}

            <div className="chat-log">
              {messages.length === 0 ? (
                <p className="empty">{t('chat.empty')}</p>
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

            <div className="chat-compose-bar">
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
                <Paperclip size={17} />
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
                  <Send size={17} />
                </button>
              ) : (
                <ChatRecordButton
                  disabled={!peerId || !secretKey}
                  onSend={(file, mediaKind) => {
                    void sendMedia(file, undefined, { mediaKind });
                  }}
                  onError={(message) => setError(message)}
                />
              )}
            </form>
            </div>
            </div>
          </section>
        )}
      </main>

      {incomingRing && (
        <IncomingCallModal
          caller={incomingRing.from}
          mediaBlocked={callMediaBlocked}
          onAccept={() => void acceptMediaCall()}
          onReject={() => void declineMediaCall()}
        />
      )}

      {showBottomNav && (
        <LiquidNavigationBar
          active={mainTab}
          onChats={() => goMainTab('chats')}
          onContacts={() => goMainTab('contacts')}
          onSettings={() => goMainTab('settings')}
          onProfile={() => goMainTab('profile')}
        />
      )}
    </div>

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
        micMuted={micMuted}
        onToggleMute={toggleCallMic}
        cameraOff={cameraOff}
        onToggleCamera={toggleCallCamera}
        onSwitchCamera={switchCallCamera}
        onAttachFile={() => fileInputRef.current?.click()}
        failure={overlayFailure}
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
    </>
      )}
    </>
  );
}
