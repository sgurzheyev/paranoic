/** Прямое P2P через WebRTC: DataChannel + MediaStream + Supabase signaling. */

import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase, hasSupabaseConfig } from './lib/supabase';
import {
  ensureCallMediaAccess,
  getUserMediaForCall,
  isMediaAccessError,
  mediaErrorMessage,
  toMediaAccessError,
} from './mediaPermissions';

export type P2PStatus =
  | 'idle'
  | 'creating-offer'
  | 'waiting-answer'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'failed';

export type CallState = 'idle' | 'ringing' | 'calling' | 'in-call' | 'ending';

/** Оценка канала по RTP-статистике (packet loss / RTT). */
export type NetworkQuality = 'good' | 'fair' | 'poor' | 'critical';

type VideoAdaptLevel = 'high' | 'medium' | 'low' | 'audio-only';

export type MediaFileMeta = {
  id: string;
  name: string;
  mime: string;
  size: number;
};

export type SignalingDebugStatus =
  | 'Подключаемся к сокетам...'
  | 'Ожидаем собеседника...'
  | 'Входящий вызов...'
  | 'Собеседник найден, генерируем ключи...'
  | 'Обмен маршрутами (ICE)...'
  | 'Связь установлена!'
  | 'Вызов отклонён'
  | '';

export type PeerIdentity = {
  userId: string;
  name: string;
  color: string;
  avatarUrl?: string;
};

export type P2PHandlers = {
  onStatus?: (status: P2PStatus) => void;
  onSignalingStatus?: (status: SignalingDebugStatus) => void;
  onMessage?: (data: string) => void;
  onError?: (error: Error) => void;
  onRemoteStream?: (stream: MediaStream | null) => void;
  onLocalStream?: (stream: MediaStream | null) => void;
  onCallState?: (state: CallState) => void;
  /** Качество сети во время звонка. */
  onNetworkQuality?: (quality: NetworkQuality) => void;
  /** Демонстрация экрана вкл/выкл. */
  onScreenShare?: (active: boolean) => void;
  /** Входящий медиазвонок — ждём Accept. */
  onIncomingCall?: () => void;
  /** Входящее P2P-подключение по магической ссылке — ждём Accept. */
  onIncomingConnection?: (info: { peerId: string; userId?: string }) => void;
  onConnectionDeclined?: () => void;
  onCallDeclined?: () => void;
  onFileProgress?: (id: string, progress: number) => void;
  /** Метаданные входящего файла до прихода чанков (для прогресса в UI). */
  onFileIncoming?: (meta: MediaFileMeta) => void;
  onEncryptedFile?: (meta: MediaFileMeta, cipher: string, iv: string) => void;
  /** Передача файла сорвалась (обрыв DC / таймаут ACK). */
  onFileTransferFailed?: (id: string, reason: string) => void;
  onPeerHello?: (peer: PeerIdentity) => void;
  /** ACK доставки/прочтения от пира. */
  onMessageDelivery?: (ids: string[], status: 'delivered' | 'read') => void;
  /** Пир печатает / перестал печатать. */
  onTyping?: (active: boolean) => void;
  /** Реакция на сообщение (❤️ и т.д.). */
  onMessageReaction?: (id: string, emoji: string) => void;
  /** Слабая связь / ICE disconnected — UI toast. */
  onLinkDegraded?: (degraded: boolean, message?: string) => void;
};

type SignalJoin = { type: 'join'; peerId: string; userId?: string };
type SignalJoinAck = { type: 'join-ack'; peerId: string; targetPeerId: string };
type SignalOffer = { peerId: string; sdp: RTCSessionDescriptionInit };
type SignalAnswer = { peerId: string; sdp: RTCSessionDescriptionInit };
type SignalIce = { peerId: string; candidate: RTCIceCandidateInit };
type SignalReject = { type: 'reject'; peerId: string; targetPeerId: string };

/**
 * Публичные STUN (Google) + Open Relay TURN — без платных API.
 * iceTransportPolicy: 'all' (host / srflx / relay).
 */
const PUBLIC_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'stun:openrelay.metered.ca:80' },
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turns:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

function p2pDebug(stage: string, detail?: unknown): void {
  if (detail !== undefined) console.log('[P2P_DEBUG]', stage, detail);
  else console.log('[P2P_DEBUG]', stage);
}

/** @deprecated use p2pDebug — kept as alias for older call sites */
function p2pAudit(stage: string, detail?: unknown): void {
  p2pDebug(stage, detail);
}

function iceUrlList(server: RTCIceServer): string[] {
  if (!server.urls) return [];
  return Array.isArray(server.urls) ? server.urls : [server.urls];
}

function classifyIceServers(servers: RTCIceServer[]): { stun: string[]; turn: string[] } {
  const stun: string[] = [];
  const turn: string[] = [];
  for (const server of servers) {
    for (const url of iceUrlList(server)) {
      const lower = url.toLowerCase();
      if (lower.startsWith('turn:') || lower.startsWith('turns:')) turn.push(url);
      else stun.push(url);
    }
  }
  return { stun, turn };
}

function logIceServers(source: string, servers: RTCIceServer[]): void {
  const { stun, turn } = classifyIceServers(servers);
  p2pAudit(`ICE servers (${source})`, {
    iceTransportPolicy: 'all',
    total: servers.length,
    stunCount: stun.length,
    turnCount: turn.length,
    stun,
    turn,
  });
}

const FILE_CHUNK_BYTES = 32 * 1024;
/** Высокий порог: не шлём следующий чанк, пока буфер DC выше. */
const MAX_BUFFERED_AMOUNT = 192 * 1024;
/** Низкий порог для `bufferedamountlow` — возобновление отправки. */
const BUFFERED_AMOUNT_LOW = 64 * 1024;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const FILE_CHUNK_MARKER = 0x01;
/** Подтверждение каждые N чанков (+ обязательно последний). */
const FILE_ACK_EVERY = 4;
const FILE_ACK_TIMEOUT_MS = 45_000;
const FILE_TRANSFER_LOST = 'Связь потеряна';
const ICE_CONNECT_TIMEOUT_MS = 25_000;
/** Быстрее мягкий ICE при кратком обрыве / смене IP. */
const ICE_SOFT_RESTART_DELAY_MS = 700;
/** Гость ждёт offer от хоста; хост ждёт join. */
const WAIT_FOR_PEER_TIMEOUT_MS = 45_000;
const ICE_CONNECT_TIMEOUT_ERROR =
  'Таймаут соединения. VPN или провайдер блокирует трафик.';
export const WAIT_FOR_PEER_TIMEOUT_MESSAGE =
  'Собеседник не ответил. Убедитесь, что он онлайн и открыл приложение.';

const WAIT_FOR_PEER_TIMEOUT_ERROR = WAIT_FOR_PEER_TIMEOUT_MESSAGE;

/** Ошибки дозвона / обрыва — на карте показываем индикатор, не авто-toast. */
export type CallFailKind = 'offline' | 'declined';

export function classifyCallFailure(message: string): CallFailKind | null {
  const m = message.trim();
  if (!m) return null;
  if (m === 'Вызов отклонён' || m === 'Звонок отклонён') return 'declined';
  if (
    m === WAIT_FOR_PEER_TIMEOUT_MESSAGE ||
    m === ICE_CONNECT_TIMEOUT_ERROR ||
    m === 'Не удалось связаться' ||
    m === 'Сигналинг комнаты оборвался. Перезайдите по ссылке.' ||
    /не ответил|таймаут соединения|хост офлайн/i.test(m)
  ) {
    return 'offline';
  }
  return null;
}

export function isCallFailureUserAlert(message: string): boolean {
  const m = message.trim();
  if (!m) return false;
  if (classifyCallFailure(m)) return true;
  if (m === 'Связь оборвалась. Переподключаемся…') return true;
  return /оборвал|не удалось начать звонок|не удалось принять звонок/i.test(m);
}
const MEDIA_WATCH_MS = 2_500;
const MEDIA_STALL_BYTES_THRESHOLD = 500;
const NETWORK_WATCH_MS = 2_000;
const BROADCAST_RETRIES = 4;
const JOIN_RETRY_MS = 1_200;
const CALL_INVITE_RETRY_MS = 1_400;

const VIDEO_LEVEL_CONSTRAINTS: Record<
  Exclude<VideoAdaptLevel, 'audio-only'>,
  MediaTrackConstraints
> = {
  high: {
    facingMode: 'user',
    width: { ideal: 640 },
    height: { ideal: 480 },
    frameRate: { ideal: 24, max: 30 },
  },
  medium: {
    facingMode: 'user',
    width: { ideal: 480 },
    height: { ideal: 360 },
    frameRate: { ideal: 18, max: 24 },
  },
  low: {
    facingMode: 'user',
    width: { ideal: 320 },
    height: { ideal: 240 },
    frameRate: { ideal: 12, max: 15 },
  },
};

type ControlPacket =
  | { t: 'call-invite'; msgId?: string }
  | { t: 'call-accept'; msgId?: string }
  | { t: 'call-offer'; sdp: RTCSessionDescriptionInit; msgId?: string }
  | { t: 'call-answer'; sdp: RTCSessionDescriptionInit; msgId?: string }
  | { t: 'call-decline'; msgId?: string }
  | { t: 'call-hangup'; msgId?: string }
  | { t: 'renegotiate-offer'; sdp: RTCSessionDescriptionInit; msgId?: string }
  | { t: 'renegotiate-answer'; sdp: RTCSessionDescriptionInit; msgId?: string }
  | { t: 'media-refresh'; msgId?: string }
  | { t: 'hello'; userId: string; name: string; color: string; avatarUrl?: string; msgId?: string }
  | { t: 'file-meta'; id: string; name: string; mime: string; size: string; iv: string; chunks: number; msgId?: string }
  | { t: 'file-done'; id: string; msgId?: string }
  | { t: 'file-ack'; id: string; upTo: number; msgId?: string }
  | { t: 'file-abort'; id: string; msgId?: string }
  | { t: 'msg-delivered'; ids: string[]; msgId?: string }
  | { t: 'msg-read'; ids: string[]; msgId?: string }
  | { t: 'typing'; active: boolean; msgId?: string }
  | { t: 'msg-reaction'; id: string; emoji: string; msgId?: string };

/** Звонок через Realtime как запасной канал к DataChannel. */
type SignalCtrl = { peerId: string; packet: ControlPacket; msgId: string };

type IncomingFile = {
  meta: MediaFileMeta;
  iv: string;
  chunks: (Uint8Array | null)[];
  expected: number;
  /** Последний непрерывный индекс с начала (для ACK). */
  contiguous: number;
  /** Последний upTo, отправленный в file-ack. */
  lastAckSent: number;
};

type FileAckWaiter = {
  upTo: number;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type FileAckState = {
  lastAcked: number;
  waiters: FileAckWaiter[];
};

function encodeFileChunk(id: string, index: number, payload: Uint8Array): ArrayBuffer {
  const idBytes = new TextEncoder().encode(id);
  const headerLen = 1 + 2 + idBytes.length + 4;
  const out = new Uint8Array(headerLen + payload.length);
  out[0] = FILE_CHUNK_MARKER;
  out[1] = (idBytes.length >> 8) & 0xff;
  out[2] = idBytes.length & 0xff;
  out.set(idBytes, 3);
  new DataView(out.buffer).setUint32(3 + idBytes.length, index, false);
  out.set(payload, headerLen);
  return out.buffer.slice(0, out.byteLength);
}

function decodeFileChunk(data: ArrayBuffer): { id: string; index: number; payload: Uint8Array } | null {
  const bytes = new Uint8Array(data);
  if (bytes.length < 7 || bytes[0] !== FILE_CHUNK_MARKER) return null;
  const idLen = (bytes[1] << 8) | bytes[2];
  const headerLen = 1 + 2 + idLen + 4;
  if (bytes.length < headerLen) return null;
  const id = new TextDecoder().decode(bytes.subarray(3, 3 + idLen));
  const index = new DataView(bytes.buffer).getUint32(3 + idLen, false);
  const payload = bytes.subarray(headerLen);
  return { id, index, payload };
}

function concatUint8Arrays(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/**
 * Backpressure: ждём, пока `bufferedAmount` опустится ниже high-water.
 * Возобновление только по `bufferedamountlow` / опросу — без ложного таймаута.
 */
async function waitForBufferDrain(channel: RTCDataChannel): Promise<void> {
  if (channel.readyState !== 'open') {
    throw new Error(FILE_TRANSFER_LOST);
  }
  if (channel.bufferedAmount <= MAX_BUFFERED_AMOUNT) return;

  channel.bufferedAmountLowThreshold = BUFFERED_AMOUNT_LOW;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let poll: ReturnType<typeof setInterval> | null = null;

    const cleanup = () => {
      channel.removeEventListener('bufferedamountlow', onLow);
      channel.removeEventListener('close', onLost);
      channel.removeEventListener('error', onLost);
      if (poll != null) {
        clearInterval(poll);
        poll = null;
      }
    };

    const settleOk = () => {
      if (settled) return;
      if (channel.readyState !== 'open') {
        settleLost();
        return;
      }
      if (channel.bufferedAmount > MAX_BUFFERED_AMOUNT) return;
      settled = true;
      cleanup();
      resolve();
    };

    const settleLost = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(FILE_TRANSFER_LOST));
    };

    const onLow = () => settleOk();
    const onLost = () => settleLost();

    channel.addEventListener('bufferedamountlow', onLow);
    channel.addEventListener('close', onLost);
    channel.addEventListener('error', onLost);

    poll = setInterval(() => {
      if (channel.readyState !== 'open') {
        settleLost();
        return;
      }
      if (channel.bufferedAmount <= BUFFERED_AMOUNT_LOW) {
        settleOk();
      }
    }, 40);
  });
}

const SDP_FORMAT_ERROR = 'Неверный формат SDP от собеседника';

/**
 * SDP из Realtime broadcast обычно уже приходит как RTCSessionDescriptionInit,
 * но на случай не-JS клиента или прокси-сериализации нормализуем сюда же
 * (объект, JSON-строка объекта или «голый» SDP, начинающийся с v=).
 */
export function parseSessionDescription(
  input: unknown,
  fallbackType: RTCSdpType
): RTCSessionDescriptionInit {
  if (input == null) throw new Error(SDP_FORMAT_ERROR);

  if (typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    if (typeof obj.sdp === 'string' && obj.sdp.length > 0) {
      const type =
        obj.type === 'offer' || obj.type === 'answer' || obj.type === 'pranswer' || obj.type === 'rollback'
          ? obj.type
          : fallbackType;
      return { type, sdp: obj.sdp };
    }
    throw new Error(SDP_FORMAT_ERROR);
  }

  if (typeof input !== 'string') throw new Error(SDP_FORMAT_ERROR);

  const trimmed = input.trim();
  if (!trimmed) throw new Error(SDP_FORMAT_ERROR);

  if (trimmed.startsWith('v=')) {
    return { type: fallbackType, sdp: trimmed };
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === 'string') {
      return parseSessionDescription(parsed, fallbackType);
    }
    return parseSessionDescription(parsed, fallbackType);
  } catch (e) {
    if (e instanceof Error && e.message === SDP_FORMAT_ERROR) throw e;
    throw new Error(SDP_FORMAT_ERROR);
  }
}

const MEDIA_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
  video: VIDEO_LEVEL_CONSTRAINTS.high,
};

export class P2PConnection {
  private pc: RTCPeerConnection | null = null;
  /** DataChannel для чата / control / signaling-звонков. */
  private channel: RTCDataChannel | null = null;
  /** Отдельный DataChannel только для бинарных чанков файлов. */
  private fileChannel: RTCDataChannel | null = null;
  /** Supabase Realtime — signaling. */
  private signal: RealtimeChannel | null = null;
  private handlers: P2PHandlers;
  private status: P2PStatus = 'idle';
  private callState: CallState = 'idle';
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private incomingFiles = new Map<string, IncomingFile>();
  /** Чанки, пришедшие до file-meta (гонка каналов). */
  private orphanFileChunks = new Map<string, { index: number; payload: Uint8Array }[]>();
  /** Исходящие передачи: ожидание ACK от получателя. */
  private fileAckState = new Map<string, FileAckState>();
  private outgoingTransfers = new Set<string>();
  private makingOffer = false;
  private ignoreOffer = false;
  private polite = false;
  private mediaWatchTimer: ReturnType<typeof setInterval> | null = null;
  private refreshingMedia = false;
  private lastRemoteVideoBytes = 0;
  private stalledChecks = 0;
  private iceRestarting = false;
  private iceCheckTimer: ReturnType<typeof setTimeout> | null = null;
  private iceSoftRestartTimer: ReturnType<typeof setTimeout> | null = null;
  private waitPeerTimer: ReturnType<typeof setTimeout> | null = null;

  private peerId = '';
  private remotePeerId: string | null = null;
  private roomId: string | null = null;
  private isHost = false;
  private handshakeStarted = false;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private cachedIceServers: RTCIceServer[] | null = null;
  private joinRetryTimer: ReturnType<typeof setInterval> | null = null;
  private callInviteRetryTimer: ReturnType<typeof setInterval> | null = null;
  private signalingStatus: SignalingDebugStatus = '';
  private localIdentity: PeerIdentity | null = null;
  /** Входящий join ждёт Accept на стороне хоста. */
  private pendingJoinPeerId: string | null = null;
  /** Входящий медиа-offer ждёт Accept (после call-invite). */
  private pendingCallOffer: RTCSessionDescriptionInit | null = null;
  /** Калеe принял звонок и ждёт SDP offer. */
  private callAcceptedPendingOffer = false;
  private handledCtrlIds = new Set<string>();

  private networkWatchTimer: ReturnType<typeof setInterval> | null = null;
  private networkQuality: NetworkQuality = 'good';
  private videoAdaptLevel: VideoAdaptLevel = 'high';
  private adaptCooldownUntil = 0;
  private goodNetworkStreak = 0;
  private lastOutboundPacketsLost = 0;
  private lastOutboundPacketsSent = 0;
  private iceRestartAttempts = 0;
  private screenStream: MediaStream | null = null;
  private cameraVideoTrack: MediaStreamTrack | null = null;
  private cameraFacing: 'user' | 'environment' = 'user';
  private sharingScreen = false;
  private netInfoHandler: (() => void) | null = null;

  constructor(handlers: P2PHandlers = {}) {
    this.handlers = handlers;
  }

  /** Обновить колбэки UI без пересоздания RTCPeerConnection. */
  setHandlers(handlers: P2PHandlers): void {
    this.handlers = { ...this.handlers, ...handlers };
  }

  /** Локальная личность для обмена при открытии DataChannel. */
  setLocalIdentity(identity: PeerIdentity): void {
    this.localIdentity = identity;
    if (this.isReady) this.sendHello();
  }

  get currentStatus(): P2PStatus {
    return this.status;
  }

  get currentSignalingStatus(): SignalingDebugStatus {
    return this.signalingStatus;
  }

  get isReady(): boolean {
    return this.channel?.readyState === 'open';
  }

  get isFileChannelReady(): boolean {
    return this.fileChannel?.readyState === 'open' || this.channel?.readyState === 'open';
  }

  get currentCallState(): CallState {
    return this.callState;
  }

  get currentRoomId(): string | null {
    return this.roomId;
  }

  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  getRemoteStream(): MediaStream | null {
    return this.remoteStream;
  }

  /** Включить / выключить локальный микрофон через track.enabled. */
  toggleAudio(enabled: boolean): void {
    for (const track of this.localStream?.getAudioTracks() ?? []) {
      track.enabled = enabled;
    }
  }

  /** Включить / выключить локальную камеру через track.enabled. */
  toggleVideo(enabled: boolean): void {
    for (const track of this.localStream?.getVideoTracks() ?? []) {
      track.enabled = enabled;
    }
    if (this.cameraVideoTrack) this.cameraVideoTrack.enabled = enabled;
  }

  /** Переключить микрофон. Возвращает, включён ли звук. */
  toggleMic(): boolean {
    const tracks = this.localStream?.getAudioTracks() ?? [];
    if (tracks.length === 0) return false;
    const next = !tracks.some((t) => t.enabled);
    this.toggleAudio(next);
    return next;
  }

  isMicEnabled(): boolean {
    const tracks = this.localStream?.getAudioTracks() ?? [];
    return tracks.some((t) => t.enabled);
  }

  isVideoEnabled(): boolean {
    const tracks = this.localStream?.getVideoTracks() ?? [];
    if (tracks.length === 0) return false;
    return tracks.some((t) => t.enabled);
  }

  /**
   * Передняя ↔ задняя камера: новый getUserMedia + RTCRtpSender.replaceTrack.
   */
  async switchCamera(): Promise<void> {
    if (!this.localStream || this.sharingScreen || this.callState !== 'in-call') return;
    if (this.videoAdaptLevel === 'audio-only') return;

    const nextFacing: 'user' | 'environment' =
      this.cameraFacing === 'user' ? 'environment' : 'user';
    const level =
      this.videoAdaptLevel === 'high' || this.videoAdaptLevel === 'medium' || this.videoAdaptLevel === 'low'
        ? this.videoAdaptLevel
        : 'high';
    const wasEnabled = this.isVideoEnabled();

    let fresh: MediaStream;
    try {
      fresh = await getUserMediaForCall({
        audio: false,
        video: {
          ...VIDEO_LEVEL_CONSTRAINTS[level],
          facingMode: { ideal: nextFacing },
        },
      });
    } catch (e) {
      throw toMediaAccessError(e);
    }

    const newTrack = fresh.getVideoTracks()[0];
    if (!newTrack) {
      fresh.getTracks().forEach((t) => t.stop());
      return;
    }
    newTrack.enabled = wasEnabled;

    const oldTrack =
      this.localStream.getVideoTracks()[0] ?? this.cameraVideoTrack ?? null;
    const videoSender =
      this.pc?.getSenders().find((s) => s.track?.kind === 'video') ??
      this.pc?.getSenders().find((s) => s.track === oldTrack) ??
      null;

    if (videoSender) {
      await videoSender.replaceTrack(newTrack);
    }

    if (oldTrack) {
      this.localStream.removeTrack(oldTrack);
      if (oldTrack !== newTrack) oldTrack.stop();
    }
    this.localStream.addTrack(newTrack);
    this.cameraVideoTrack = newTrack;
    this.cameraFacing = nextFacing;

    // Остальные треки из fresh (если есть) не нужны.
    for (const t of fresh.getTracks()) {
      if (t !== newTrack) t.stop();
    }

    newTrack.addEventListener('ended', () => {
      if (this.callState === 'in-call' && !this.sharingScreen) {
        void this.refreshLocalTracks();
      }
    });

    this.handlers.onLocalStream?.(this.localStream);
  }

  get isSharingScreen(): boolean {
    return this.sharingScreen;
  }

  get currentNetworkQuality(): NetworkQuality {
    return this.networkQuality;
  }

  private setSignalingStatus(status: SignalingDebugStatus): void {
    this.signalingStatus = status;
    this.handlers.onSignalingStatus?.(status);
  }

  /**
   * Вход в комнату.
   * isHost (создал URL) ждёт `join` и шлёт offer.
   * Гость (открыл ссылку) шлёт `join` после подписки на канал.
   */
  async joinRoom(roomId: string, options: { isHost: boolean }): Promise<void> {
    if (!hasSupabaseConfig()) {
      throw new Error(
        'Supabase не настроен. Добавьте VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY.'
      );
    }

    this.reset();
    this.roomId = roomId;
    this.isHost = options.isHost;
    this.peerId = crypto.randomUUID();
    this.remotePeerId = null;
    this.handshakeStarted = false;
    this.pendingCandidates = [];
    this.cachedIceServers = PUBLIC_ICE_SERVERS;
    logIceServers('public Google STUN + Open Relay', this.cachedIceServers);
    this.setStatus(options.isHost ? 'waiting-answer' : 'connecting');
    this.setSignalingStatus('Подключаемся к сокетам...');
    p2pAudit('joinRoom start', { roomId, isHost: options.isHost, peerId: this.peerId });

    const sb = getSupabase();
    const signal = sb.channel(`room:${roomId}`, {
      config: { broadcast: { self: false } },
    });

    signal.on('broadcast', { event: 'join' }, ({ payload }) => {
      void this.onSignalJoin(payload as SignalJoin);
    });
    signal.on('broadcast', { event: 'join-ack' }, ({ payload }) => {
      this.onSignalJoinAck(payload as SignalJoinAck);
    });
    signal.on('broadcast', { event: 'offer' }, ({ payload }) => {
      void this.onSignalOffer(payload as SignalOffer);
    });
    signal.on('broadcast', { event: 'answer' }, ({ payload }) => {
      void this.onSignalAnswer(payload as SignalAnswer);
    });
    signal.on('broadcast', { event: 'ice-candidate' }, ({ payload }) => {
      void this.onSignalIce(payload as SignalIce);
    });
    signal.on('broadcast', { event: 'reject' }, ({ payload }) => {
      this.onSignalReject(payload as SignalReject);
    });
    signal.on('broadcast', { event: 'ctrl' }, ({ payload }) => {
      void this.onSignalCtrl(payload as SignalCtrl);
    });

    await new Promise<void>((resolve, reject) => {
      signal.subscribe((status) => {
        p2pAudit('room signal subscribe', { roomId, status });
        if (status === 'SUBSCRIBED') resolve();
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          // Если уже в комнате — помечаем сбой; иначе reject на старте.
          if (this.signal === signal) {
            p2pAudit('room signal lost', { roomId, status });
            this.handlers.onError?.(
              new Error('Сигналинг комнаты оборвался. Перезайдите по ссылке.')
            );
            if (this.callState === 'in-call' || this.callState === 'calling') {
              void this.tryIceRestart();
            } else {
              this.setStatus('failed');
            }
          } else {
            reject(new Error('Не удалось подключиться к комнате (signaling)'));
          }
        }
      });
    });

    this.signal = signal;
    p2pAudit('joined room', {
      roomId,
      peerId: this.peerId,
      isHost: this.isHost,
    });

    if (this.isHost) {
      this.setSignalingStatus('Ожидаем собеседника...');
      this.setStatus('waiting-answer');
      this.armWaitForPeerTimeout('host');
    } else {
      // Гость: join после SUBSCRIBED
      await this.sendJoin();
      this.startJoinRetry();
      this.setSignalingStatus('Ожидаем собеседника...');
      this.armWaitForPeerTimeout('guest');
    }
  }

  private async sendJoin(): Promise<void> {
    if (!this.cachedIceServers) {
      console.warn('[P2P_DEBUG] join blocked: no ICE servers');
      return;
    }
    // Identity могла ещё не успеть — подтянем из замыкания перед join.
    const payload: SignalJoin = {
      type: 'join',
      peerId: this.peerId,
      userId: this.localIdentity?.userId,
    };
    p2pDebug('send join', {
      roomId: this.roomId,
      peerId: this.peerId,
      userId: payload.userId,
    });
    await this.broadcastReliable('join', payload);
  }

  private startJoinRetry(): void {
    this.clearJoinRetry();
    // Сразу ещё раз + короткий интервал — меньше потерь первого join на Realtime.
    void this.sendJoin();
    this.joinRetryTimer = setInterval(() => {
      // Не останавливаем на join-ack — только когда получили offer / PC / connected.
      if (this.handshakeStarted || this.pc || this.status === 'connected') {
        this.clearJoinRetry();
        return;
      }
      p2pDebug('join retry', { roomId: this.roomId, peerId: this.peerId });
      void this.sendJoin();
    }, JOIN_RETRY_MS);
  }

  private clearJoinRetry(): void {
    if (this.joinRetryTimer) {
      clearInterval(this.joinRetryTimer);
      this.joinRetryTimer = null;
    }
  }

  private clearWaitForPeerTimeout(): void {
    if (this.waitPeerTimer) {
      clearTimeout(this.waitPeerTimer);
      this.waitPeerTimer = null;
    }
  }

  private armWaitForPeerTimeout(role: 'host' | 'guest'): void {
    this.clearWaitForPeerTimeout();
    p2pDebug('arm wait-for-peer timeout', { role, ms: WAIT_FOR_PEER_TIMEOUT_MS });
    this.waitPeerTimer = setTimeout(() => {
      this.waitPeerTimer = null;
      if (this.status === 'connected' || this.handshakeStarted || this.pc) return;
      if (this.callState === 'in-call' || this.callState === 'calling') return;
      p2pDebug('wait-for-peer timeout fired', {
        role,
        status: this.status,
        callState: this.callState,
        roomId: this.roomId,
      });
      this.clearJoinRetry();
      this.clearCallInviteRetry();
      this.pendingJoinPeerId = null;
      this.handshakeStarted = false;
      this.setSignalingStatus('');
      this.setStatus('failed');
      this.handlers.onError?.(new Error(WAIT_FOR_PEER_TIMEOUT_ERROR));
      // PC ещё нет (ждём offer/join) — только стопаем ретраи и каналы.
      this.teardownDataChannels();
    }, WAIT_FOR_PEER_TIMEOUT_MS);
  }

  private clearCallInviteRetry(): void {
    if (this.callInviteRetryTimer) {
      clearInterval(this.callInviteRetryTimer);
      this.callInviteRetryTimer = null;
    }
  }

  send(payload: string): void {
    if (!this.channel || this.channel.readyState !== 'open') {
      throw new Error('Соединение ещё не готово');
    }
    this.channel.send(payload);
  }

  /** Подтверждение доставки / прочтения текстовых сообщений. */
  sendMessageAck(ids: string[], status: 'delivered' | 'read'): void {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0 || !this.isReady) return;
    this.sendControl({
      t: status === 'delivered' ? 'msg-delivered' : 'msg-read',
      ids: unique,
      msgId: this.newMsgId(),
    });
  }

  /** Лёгкий пинг «печатает…» по DataChannel. */
  sendTyping(active: boolean): void {
    if (!this.isReady) return;
    this.sendControl({
      t: 'typing',
      active: Boolean(active),
      msgId: this.newMsgId(),
    });
  }

  /** Реакция на сообщение (двойной тап → ❤️). */
  sendReaction(id: string, emoji = '❤️'): void {
    if (!id || !this.isReady) return;
    this.sendControl({
      t: 'msg-reaction',
      id,
      emoji: emoji || '❤️',
      msgId: this.newMsgId(),
    });
  }

  /**
   * Исходящий звонок: сначала только invite (без getUserMedia).
   * Камера/мик открываются после Accept на другой стороне.
   */
  async startCall(): Promise<MediaStream | null> {
    if (!this.pc || !this.isReady) throw new Error('Сначала подключитесь к близкому');
    if (this.callState === 'in-call' || this.callState === 'calling') {
      return this.localStream;
    }
    if (this.callState === 'ringing') {
      throw new Error('Сначала ответьте на входящий звонок');
    }

    try {
      await ensureCallMediaAccess();
    } catch (e) {
      this.setCallState('idle');
      throw toMediaAccessError(e);
    }

    this.setSignalingStatus('');
    this.setCallState('calling');
    const msgId = crypto.randomUUID();
    this.sendCallControl({ t: 'call-invite', msgId });
    this.clearCallInviteRetry();
    this.callInviteRetryTimer = setInterval(() => {
      if (this.callState !== 'calling') {
        this.clearCallInviteRetry();
        return;
      }
      this.sendCallControl({ t: 'call-invite', msgId });
    }, CALL_INVITE_RETRY_MS);
    return null;
  }

  /** Хост принимает входящее подключение по магической ссылке. */
  async acceptIncomingConnection(): Promise<void> {
    if (!this.isHost || !this.pendingJoinPeerId) {
      p2pDebug('acceptIncomingConnection skipped', {
        isHost: this.isHost,
        pending: this.pendingJoinPeerId,
      });
      return;
    }
    this.remotePeerId = this.pendingJoinPeerId;
    this.pendingJoinPeerId = null;
    this.clearWaitForPeerTimeout();
    this.setSignalingStatus('Собеседник найден, генерируем ключи...');
    p2pDebug('acceptIncomingConnection → offer', { remotePeerId: this.remotePeerId });
    await this.startAsOfferer();
  }

  /** Хост отклоняет входящее подключение. */
  async declineIncomingConnection(): Promise<void> {
    if (!this.pendingJoinPeerId) return;
    const target = this.pendingJoinPeerId;
    this.pendingJoinPeerId = null;
    await this.broadcastReliable('reject', {
      type: 'reject',
      peerId: this.peerId,
      targetPeerId: target,
    });
    if (this.remotePeerId === target) this.remotePeerId = null;
    this.setSignalingStatus('Ожидаем собеседника...');
    this.setStatus('waiting-answer');
  }

  /** Калеe принимает медиазвонок — только здесь открываем getUserMedia. */
  async acceptCall(): Promise<MediaStream> {
    if (!this.pc || this.callState !== 'ringing') {
      throw new Error('Нет входящего звонка');
    }

    try {
      this.callAcceptedPendingOffer = true;
      this.sendCallControl({ t: 'call-accept', msgId: crypto.randomUUID() });
      const stream = await this.acquireLocalMedia();
      await this.attachLocalTracks(stream);
      this.handlers.onLocalStream?.(stream);

      // Если offer уже успел прийти до Accept — отвечаем сразу.
      if (this.pendingCallOffer) {
        await this.answerPendingCallOffer();
      }
      return stream;
    } catch (e) {
      this.callAcceptedPendingOffer = false;
      this.stopLocalMedia();
      this.handlers.onLocalStream?.(null);
      this.setCallState('idle');
      try {
        this.sendCallControl({ t: 'call-decline', msgId: crypto.randomUUID() });
      } catch {
        /* */
      }
      throw isMediaAccessError(e) ? toMediaAccessError(e) : e;
    }
  }

  async declineCall(): Promise<void> {
    this.pendingCallOffer = null;
    this.callAcceptedPendingOffer = false;
    this.sendCallControl({ t: 'call-decline', msgId: crypto.randomUUID() });
    this.stopLocalMedia();
    this.handlers.onLocalStream?.(null);
    this.clearRemoteStream();
    this.setCallState('idle');
  }

  async cancelCall(): Promise<void> {
    p2pAudit('cancelCall', { callState: this.callState, status: this.status });
    this.clearCallInviteRetry();
    this.clearJoinRetry();

    if (this.callState === 'calling') {
      try {
        this.sendCallControl({ t: 'call-decline', msgId: crypto.randomUUID() });
      } catch {
        /* */
      }
      this.stopLocalMedia();
      this.handlers.onLocalStream?.(null);
      this.clearRemoteStream();
      this.resetAdaptState();
      this.setCallState('idle');
      return;
    }

    if (this.callState === 'ringing') {
      await this.declineCall();
      return;
    }

    if (this.callState === 'in-call' || this.callState === 'ending') {
      await this.hangUp();
      return;
    }

    // Явная отмена — закрыть PC, остановить медиа, не перезапускать join.
    if (
      this.status === 'connecting' ||
      this.status === 'creating-offer' ||
      this.status === 'waiting-answer' ||
      this.status === 'connected' ||
      this.status === 'disconnected' ||
      this.status === 'failed'
    ) {
      this.abortPendingConnection();
    }
  }

  async hangUp(): Promise<void> {
    this.clearCallInviteRetry();
    this.callAcceptedPendingOffer = false;
    this.pendingCallOffer = null;
    this.setCallState('ending');
    this.stopMediaWatchdog();
    this.stopNetworkWatch();
    await this.stopScreenShareInternal(false);
    try {
      this.sendCallControl({ t: 'call-hangup', msgId: crypto.randomUUID() });
    } catch {
      /* ignore */
    }
    this.stopLocalMedia();
    this.handlers.onLocalStream?.(null);
    this.clearRemoteStream();
    this.resetAdaptState();
    this.setCallState('idle');
  }

  async refreshLocalTracks(): Promise<MediaStream | null> {
    if (!this.pc || this.callState !== 'in-call') return this.localStream;
    if (this.refreshingMedia || this.sharingScreen) return this.localStream;

    this.refreshingMedia = true;
    try {
      const stream = await this.acquireLocalMedia();
      await this.attachLocalTracks(stream);
      this.handlers.onLocalStream?.(stream);
      this.handlers.onRemoteStream?.(this.remoteStream);
      return stream;
    } catch (e) {
      this.handlers.onError?.(
        new Error(mediaErrorMessage(e, 'Не удалось обновить камеру'))
      );
      return this.localStream;
    } finally {
      this.refreshingMedia = false;
    }
  }

  /** Демонстрация экрана через replaceTrack (без разрыва PC). */
  async startScreenShare(): Promise<void> {
    if (!this.pc || this.callState !== 'in-call') {
      throw new Error('Сначала начните звонок');
    }
    if (this.sharingScreen) return;

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getDisplayMedia !== 'function'
    ) {
      throw new Error('Демонстрация экрана доступна только в версии для компьютера');
    }

    const display = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: { ideal: 15, max: 30 },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
    const screenTrack = display.getVideoTracks()[0];
    if (!screenTrack) {
      display.getTracks().forEach((t) => t.stop());
      throw new Error('Не удалось получить поток экрана');
    }

    const videoSender =
      this.pc.getSenders().find((s) => s.track?.kind === 'video') ??
      this.pc.getTransceivers().find((tr) => tr.receiver.track.kind === 'video')?.sender;

    if (!videoSender) {
      display.getTracks().forEach((t) => t.stop());
      throw new Error('Нет видео-отправителя для replaceTrack');
    }

    // Сохраняем камеру (не стопаем — вернёмся через replaceTrack).
    const currentCam = this.localStream?.getVideoTracks()[0] ?? null;
    if (currentCam && currentCam !== screenTrack) {
      this.cameraVideoTrack = currentCam;
      currentCam.enabled = false;
    }

    await videoSender.replaceTrack(screenTrack);
    await this.applySenderDegradation(videoSender, 'balanced');

    this.screenStream = display;
    this.sharingScreen = true;

    const audioTracks = this.localStream?.getAudioTracks() ?? [];
    const preview = new MediaStream([...audioTracks, screenTrack]);
    this.handlers.onLocalStream?.(preview);
    this.handlers.onScreenShare?.(true);

    screenTrack.addEventListener('ended', () => {
      void this.stopScreenShare();
    });
  }

  async stopScreenShare(): Promise<void> {
    await this.stopScreenShareInternal(true);
  }

  async toggleScreenShare(): Promise<boolean> {
    if (this.sharingScreen) {
      await this.stopScreenShare();
      return false;
    }
    await this.startScreenShare();
    return true;
  }

  private async stopScreenShareInternal(restoreCamera: boolean): Promise<void> {
    const wasSharing = this.sharingScreen;
    this.screenStream?.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch {
        /* */
      }
    });
    this.screenStream = null;
    this.sharingScreen = false;
    if (wasSharing) this.handlers.onScreenShare?.(false);

    if (!restoreCamera || !this.pc || this.callState !== 'in-call') {
      this.cameraVideoTrack = null;
      return;
    }

    const videoSender =
      this.pc.getSenders().find((s) => s.track?.kind === 'video') ??
      this.pc.getTransceivers().find((tr) => tr.receiver.track.kind === 'video')?.sender;

    let cam = this.cameraVideoTrack;
    if (!cam || cam.readyState === 'ended') {
      try {
        const stream = await this.acquireLocalMedia(this.videoAdaptLevel === 'audio-only' ? 'low' : this.videoAdaptLevel);
        cam = stream.getVideoTracks()[0] ?? null;
        this.cameraVideoTrack = cam;
      } catch (e) {
        this.handlers.onError?.(
          new Error(mediaErrorMessage(e, 'Не удалось вернуть камеру'))
        );
        return;
      }
    } else {
      cam.enabled = true;
      if (this.localStream && !this.localStream.getVideoTracks().includes(cam)) {
        this.localStream.getVideoTracks().forEach((t) => this.localStream?.removeTrack(t));
        this.localStream.addTrack(cam);
      }
    }

    if (videoSender && cam) {
      await videoSender.replaceTrack(this.videoAdaptLevel === 'audio-only' ? null : cam);
      await this.applySenderDegradation(videoSender, 'balanced');
    }

    if (this.localStream) {
      this.handlers.onLocalStream?.(this.localStream);
    }
    this.cameraVideoTrack = cam;
  }

  async sendFile(
    file: File,
    encrypt: (data: ArrayBuffer) => Promise<{ cipher: string; iv: string }>,
    options?: { transferId?: string }
  ): Promise<string> {
    if (!this.isFileChannelReady) {
      await this.ensureFileChannel();
    }
    if (!this.isReady || !this.channel) throw new Error('Соединение ещё не готово');
    if (file.size > MAX_FILE_BYTES) {
      throw new Error('Файл слишком большой (макс. 16 МБ)');
    }

    await this.ensureFileChannel();
    const pipe = this.filePipe();
    if (!pipe) throw new Error('Файловый канал ещё не готов');

    pipe.bufferedAmountLowThreshold = BUFFERED_AMOUNT_LOW;

    const id = options?.transferId || `f-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const buffer = await file.arrayBuffer();
    this.handlers.onFileProgress?.(id, 0.01);
    const { cipher, iv } = await encrypt(buffer);
    const cipherBytes = Uint8Array.from(atob(cipher), (c) => c.charCodeAt(0));
    const chunkCount = Math.ceil(cipherBytes.length / FILE_CHUNK_BYTES) || 1;

    this.outgoingTransfers.add(id);
    this.fileAckState.set(id, { lastAcked: -1, waiters: [] });

    try {
      this.sendControl({
        t: 'file-meta',
        id,
        name: file.name,
        mime: file.type || 'application/octet-stream',
        size: String(file.size),
        iv,
        chunks: chunkCount,
      });
      this.handlers.onFileProgress?.(id, 0);

      for (let i = 0; i < chunkCount; i++) {
        const pipe = this.filePipe();
        if (!pipe || pipe.readyState !== 'open' || !this.isReady) {
          throw new Error(FILE_TRANSFER_LOST);
        }

        await waitForBufferDrain(pipe);

        const start = i * FILE_CHUNK_BYTES;
        const slice = cipherBytes.subarray(start, start + FILE_CHUNK_BYTES);
        try {
          pipe.send(encodeFileChunk(id, i, slice));
        } catch {
          throw new Error(FILE_TRANSFER_LOST);
        }

        const sentRatio = (i + 1) / chunkCount;
        this.handlers.onFileProgress?.(id, sentRatio);

        const needAck = (i + 1) % FILE_ACK_EVERY === 0 || i === chunkCount - 1;
        if (needAck) {
          await this.waitForFileAck(id, i);
        }
      }

      const finalPipe = this.filePipe();
      if (finalPipe) await waitForBufferDrain(finalPipe);
      if (!this.isReady) throw new Error(FILE_TRANSFER_LOST);
      this.sendControl({ t: 'file-done', id });
      this.handlers.onFileProgress?.(id, 1);
      return id;
    } catch (e) {
      this.rejectFileAckWaiters(id, e instanceof Error ? e : new Error(FILE_TRANSFER_LOST));
      try {
        if (this.isReady) this.sendControl({ t: 'file-abort', id, msgId: this.newMsgId() });
      } catch {
        /* */
      }
      throw e instanceof Error ? e : new Error(FILE_TRANSFER_LOST);
    } finally {
      this.outgoingTransfers.delete(id);
      this.clearFileAckState(id);
    }
  }

  private waitForFileAck(id: string, upTo: number): Promise<void> {
    const state = this.fileAckState.get(id) ?? { lastAcked: -1, waiters: [] };
    this.fileAckState.set(id, state);
    if (state.lastAcked >= upTo) return Promise.resolve();

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = state.waiters.findIndex((w) => w.timer === timer);
        if (idx >= 0) state.waiters.splice(idx, 1);
        reject(new Error(FILE_TRANSFER_LOST));
      }, FILE_ACK_TIMEOUT_MS);

      state.waiters.push({
        upTo,
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
        timer,
      });
    });
  }

  private applyFileAck(id: string, upTo: number): void {
    const state = this.fileAckState.get(id);
    if (!state) return;
    if (!Number.isFinite(upTo) || upTo < 0) return;
    state.lastAcked = Math.max(state.lastAcked, Math.floor(upTo));
    const remaining: FileAckWaiter[] = [];
    for (const waiter of state.waiters) {
      if (state.lastAcked >= waiter.upTo) waiter.resolve();
      else remaining.push(waiter);
    }
    state.waiters = remaining;
  }

  private rejectFileAckWaiters(id: string, error: Error): void {
    const state = this.fileAckState.get(id);
    if (!state) return;
    for (const waiter of state.waiters) waiter.reject(error);
    state.waiters = [];
  }

  private clearFileAckState(id: string): void {
    const state = this.fileAckState.get(id);
    if (state) {
      for (const waiter of state.waiters) clearTimeout(waiter.timer);
    }
    this.fileAckState.delete(id);
  }

  /** Обрыв DC / soft-reset: сорвать активные передачи файлов. */
  private failActiveFileTransfers(reason = FILE_TRANSFER_LOST): void {
    const notifyIds = new Set<string>([
      ...this.outgoingTransfers,
      ...this.incomingFiles.keys(),
    ]);

    for (const id of [...this.fileAckState.keys()]) {
      this.rejectFileAckWaiters(id, new Error(reason));
      this.clearFileAckState(id);
    }
    this.outgoingTransfers.clear();
    this.incomingFiles.clear();

    for (const id of notifyIds) {
      this.handlers.onFileTransferFailed?.(id, reason);
    }
  }

  /** Канал для бинарных чанков: отдельный files DC, иначе fallback на chat. */
  private filePipe(): RTCDataChannel | null {
    if (this.fileChannel?.readyState === 'open') return this.fileChannel;
    if (this.channel?.readyState === 'open') return this.channel;
    return null;
  }

  private ensureFileChannel(): Promise<void> {
    if (this.fileChannel?.readyState === 'open' || this.channel?.readyState === 'open') {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (this.fileChannel?.readyState === 'open' || this.channel?.readyState === 'open') {
          clearInterval(timer);
          resolve();
        } else if (Date.now() - started > 8_000) {
          clearInterval(timer);
          reject(new Error('Файловый DataChannel не открылся'));
        }
      }, 80);
    });
  }

  close(): void {
    this.detachSignal();
    this.stopMediaWatchdog();
    this.stopNetworkWatch();
    this.stopLocalMedia();
    this.clearRemoteStream();
    this.resetAdaptState();
    this.reset();
    this.setCallState('idle');
    this.setStatus('disconnected');
  }

  /** Повторная отправка критичных Realtime-событий (join/offer/answer/ICE/ctrl). */
  private async broadcastReliable(event: string, payload: object): Promise<void> {
    if (!this.signal) return;
    for (let attempt = 0; attempt < BROADCAST_RETRIES; attempt++) {
      try {
        const result = await this.signal.send({
          type: 'broadcast',
          event,
          payload,
        });
        if (result !== 'timed out' && result !== 'error') return;
        console.warn('[P2P Audit] broadcast retry', event, result, attempt + 1);
      } catch (e) {
        console.warn('[P2P Audit] broadcast retry error', event, e);
      }
      await new Promise((r) => setTimeout(r, 180 * (attempt + 1)));
    }
    console.warn('[P2P Audit] broadcast exhausted', event);
  }

  private newMsgId(): string {
    return crypto.randomUUID();
  }

  /** DataChannel + Realtime backup для сигналов звонка. */
  private sendCallControl(packet: ControlPacket): void {
    const msgId = packet.msgId || this.newMsgId();
    const withId = { ...packet, msgId } as ControlPacket;
    try {
      if (this.isReady) this.sendControl(withId);
    } catch (e) {
      console.warn('[paranoic] call ctrl dc failed', e);
    }
    void this.broadcastReliable('ctrl', {
      peerId: this.peerId,
      packet: withId,
      msgId,
    } satisfies SignalCtrl);
  }

  private onSignalCtrl(payload: SignalCtrl): void {
    if (!payload?.packet || payload.peerId === this.peerId) return;
    const msgId = payload.msgId || payload.packet.msgId;
    if (msgId && this.handledCtrlIds.has(msgId)) return;
    // Dedup делает handleControl; здесь только быстрый skip дублей Realtime.
    const packet =
      msgId && !payload.packet.msgId
        ? ({ ...payload.packet, msgId } as ControlPacket)
        : payload.packet;
    void this.handleControl(packet);
  }

  private onSignalJoinAck(payload: SignalJoinAck): void {
    if (!payload?.targetPeerId || payload.targetPeerId !== this.peerId) return;
    // Не останавливаем join-retry здесь: ack ≠ offer. Хост мог ещё не принять.
    p2pDebug('join-ack received (keep retrying until offer)', {
      from: payload.peerId,
      peerId: this.peerId,
    });
  }

  private detachSignal(): void {
    const ch = this.signal;
    this.signal = null;
    if (ch) {
      void ch.unsubscribe();
      try {
        getSupabase().removeChannel(ch);
      } catch {
        /* */
      }
    }
  }

  private async onSignalJoin(payload: SignalJoin): Promise<void> {
    if (!payload?.peerId || payload.peerId === this.peerId) return;
    // Только хост отвечает на join оффером — исключаем glare.
    if (!this.isHost) return;

    p2pDebug('incoming join', {
      fromPeerId: payload.peerId,
      fromUserId: payload.userId,
      status: this.status,
      pending: this.pendingJoinPeerId,
    });

    // Уже на связи — занято.
    if (this.status === 'connected') {
      await this.broadcastReliable('reject', {
        type: 'reject',
        peerId: this.peerId,
        targetPeerId: payload.peerId,
      });
      return;
    }

    // Handshake уже идёт: тот же гость (retry join) — игнор; другой — busy.
    if (this.handshakeStarted || this.pc) {
      if (payload.peerId === this.remotePeerId) {
        void this.broadcastReliable('join-ack', {
          type: 'join-ack',
          peerId: this.peerId,
          targetPeerId: payload.peerId,
        });
        return;
      }
      await this.broadcastReliable('reject', {
        type: 'reject',
        peerId: this.peerId,
        targetPeerId: payload.peerId,
      });
      return;
    }

    // Повторный join того же гостя, пока ждём Accept — игнор.
    if (this.pendingJoinPeerId === payload.peerId) {
      void this.broadcastReliable('join-ack', {
        type: 'join-ack',
        peerId: this.peerId,
        targetPeerId: payload.peerId,
      });
      return;
    }

    // Другой гость, пока висит Accept — отклоняем нового.
    if (this.pendingJoinPeerId && this.pendingJoinPeerId !== payload.peerId) {
      await this.broadcastReliable('reject', {
        type: 'reject',
        peerId: this.peerId,
        targetPeerId: payload.peerId,
      });
      return;
    }

    this.pendingJoinPeerId = payload.peerId;
    this.remotePeerId = payload.peerId;
    this.clearWaitForPeerTimeout();
    this.setSignalingStatus('Входящий вызов...');
    void this.broadcastReliable('join-ack', {
      type: 'join-ack',
      peerId: this.peerId,
      targetPeerId: payload.peerId,
    });
    this.handlers.onIncomingConnection?.({
      peerId: payload.peerId,
      userId: payload.userId,
    });
  }

  private onSignalReject(payload: SignalReject): void {
    if (!payload?.targetPeerId || payload.targetPeerId !== this.peerId) return;
    if (this.isHost) return;

    this.clearJoinRetry();
    this.setSignalingStatus('');
    this.setStatus('failed');
    this.handlers.onConnectionDeclined?.();
  }

  private async startAsOfferer(): Promise<void> {
    if (this.handshakeStarted || this.pc) return;
    if (!this.cachedIceServers) {
      this.handlers.onError?.(new Error('Offer заблокирован: нет ICE-серверов'));
      return;
    }
    this.handshakeStarted = true;
    this.clearWaitForPeerTimeout();
    this.polite = false;
    this.setStatus('creating-offer');
    this.setSignalingStatus('Собеседник найден, генерируем ключи...');
    p2pDebug('create offer (startAsOfferer)', {
      roomId: this.roomId,
      remotePeerId: this.remotePeerId,
    });

    try {
      const pc = await this.createPeerConnection();
      this.pc = pc;
      const dc = pc.createDataChannel('paranoic', { ordered: true });
      this.bindChannel(dc);
      const files = pc.createDataChannel('paranoic-files', {
        ordered: true,
        // Надёжная доставка чанков (без partial reliability).
      });
      this.bindFileChannel(files);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.setStatus('connecting');
      this.setSignalingStatus('Обмен маршрутами (ICE)...');
      p2pDebug('broadcast offer', { peerId: this.peerId, sdpType: pc.localDescription?.type });
      await this.broadcastReliable('offer', {
        peerId: this.peerId,
        sdp: pc.localDescription!,
      });
    } catch (e) {
      this.handshakeStarted = false;
      this.setStatus('failed');
      p2pDebug('offer failed', e);
      this.handlers.onError?.(e instanceof Error ? e : new Error('Не удалось создать offer'));
    }
  }

  private async onSignalOffer(payload: SignalOffer): Promise<void> {
    if (!payload?.peerId || payload.peerId === this.peerId || !payload.sdp) return;
    // Хост не принимает чужой offer (он сам инициатор).
    if (this.isHost) return;

    p2pDebug('offer received', { from: payload.peerId });
    this.clearJoinRetry();
    this.clearWaitForPeerTimeout();
    this.remotePeerId = payload.peerId;
    this.polite = true;
    this.handshakeStarted = true;
    this.setStatus('connecting');
    this.setSignalingStatus('Собеседник найден, генерируем ключи...');

    try {
      if (!this.cachedIceServers) {
        this.cachedIceServers = PUBLIC_ICE_SERVERS;
      }
      if (!this.pc) {
        const pc = await this.createPeerConnection();
        this.pc = pc;
        pc.ondatachannel = (event) => {
          if (event.channel.label === 'paranoic-files') this.bindFileChannel(event.channel);
          else this.bindChannel(event.channel);
        };
      }

      const offer = parseSessionDescription(payload.sdp, 'offer');
      await this.pc.setRemoteDescription(offer);
      await this.flushPendingCandidates();

      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      this.setSignalingStatus('Обмен маршрутами (ICE)...');
      p2pDebug('broadcast answer', { peerId: this.peerId });
      await this.broadcastReliable('answer', {
        peerId: this.peerId,
        sdp: this.pc.localDescription!,
      });
    } catch (e) {
      this.handshakeStarted = false;
      this.setStatus('failed');
      p2pDebug('answer failed', e);
      this.handlers.onError?.(e instanceof Error ? e : new Error('Не удалось принять offer'));
    }
  }

  private async onSignalAnswer(payload: SignalAnswer): Promise<void> {
    if (!payload?.sdp || !this.pc) return;
    if (payload.peerId === this.peerId) return;
    try {
      if (!this.pc.currentRemoteDescription) {
        p2pDebug('answer received', { from: payload.peerId });
        const answer = parseSessionDescription(payload.sdp, 'answer');
        await this.pc.setRemoteDescription(answer);
        await this.flushPendingCandidates();
        this.setSignalingStatus('Обмен маршрутами (ICE)...');
      }
    } catch (e) {
      this.handlers.onError?.(e instanceof Error ? e : new Error('Не удалось принять answer'));
    }
  }

  private async onSignalIce(payload: SignalIce): Promise<void> {
    if (!payload?.candidate || payload.peerId === this.peerId) return;
    if (this.status === 'connecting' || this.status === 'creating-offer') {
      this.setSignalingStatus('Обмен маршрутами (ICE)...');
    }
    if (!this.pc || !this.pc.remoteDescription) {
      this.pendingCandidates.push(payload.candidate);
      p2pAudit('ICE candidate queued', { pending: this.pendingCandidates.length });
      return;
    }
    try {
      await this.pc.addIceCandidate(payload.candidate);
      p2pAudit('ICE candidate applied');
    } catch (e) {
      console.warn('[P2P Audit] addIceCandidate failed', e);
    }
  }

  private async flushPendingCandidates(): Promise<void> {
    if (!this.pc) return;
    const queued = this.pendingCandidates.splice(0);
    for (const candidate of queued) {
      try {
        await this.pc.addIceCandidate(candidate);
      } catch (e) {
        console.warn('[paranoic ICE] flush candidate failed', e);
      }
    }
  }

  private async acquireLocalMedia(
    level: Exclude<VideoAdaptLevel, 'audio-only'> = 'high'
  ): Promise<MediaStream> {
    const prev = this.localStream;
    let stream: MediaStream;
    try {
      stream = await getUserMediaForCall({
        audio: MEDIA_CONSTRAINTS.audio,
        video: {
          ...VIDEO_LEVEL_CONSTRAINTS[level],
          facingMode: { ideal: this.cameraFacing },
        },
      });
    } catch (e) {
      throw toMediaAccessError(e);
    }
    this.localStream = stream;
    this.cameraVideoTrack = stream.getVideoTracks()[0] ?? null;
    prev?.getTracks().forEach((t) => {
      if (t !== this.cameraVideoTrack) t.stop();
    });

    for (const track of stream.getTracks()) {
      track.addEventListener('ended', () => {
        if (this.callState === 'in-call' && !this.sharingScreen) {
          void this.refreshLocalTracks();
        }
      });
    }

    return stream;
  }

  private async attachLocalTracks(stream: MediaStream): Promise<void> {
    if (!this.pc) return;

    for (const track of stream.getTracks()) {
      const sender =
        this.pc.getSenders().find((s) => s.track?.kind === track.kind) ??
        this.pc.getTransceivers().find((tr) => tr.receiver.track.kind === track.kind)?.sender;

      if (sender) await sender.replaceTrack(track);
      else this.pc.addTrack(track, stream);

      if (track.kind === 'video') {
        const videoSender =
          this.pc.getSenders().find((s) => s.track?.kind === 'video') ?? sender;
        if (videoSender) await this.applySenderDegradation(videoSender, 'balanced');
      }
    }

    for (const t of this.pc.getTransceivers()) {
      if (t.receiver.track.kind === 'audio' || t.receiver.track.kind === 'video') {
        t.direction = 'sendrecv';
      }
    }
  }

  private async applySenderDegradation(
    sender: RTCRtpSender,
    preference: 'balanced' | 'maintain-framerate' | 'maintain-resolution'
  ): Promise<void> {
    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      (params as RTCRtpSendParameters & { degradationPreference?: string }).degradationPreference =
        preference;
      // При слабой сети сильнее режем maxBitrate на нижних уровнях.
      const enc = params.encodings[0]!;
      if (this.videoAdaptLevel === 'medium') enc.maxBitrate = 450_000;
      else if (this.videoAdaptLevel === 'low') enc.maxBitrate = 180_000;
      else if (this.videoAdaptLevel === 'high') enc.maxBitrate = 900_000;
      await sender.setParameters(params);
    } catch (e) {
      console.warn('[paranoic] setParameters/degradationPreference failed', e);
    }
  }

  private sendControl(packet: ControlPacket): void {
    this.send(JSON.stringify({ __ctrl: true, ...packet }));
  }

  private async renegotiateAsOfferer(): Promise<void> {
    if (!this.pc) return;
    this.makingOffer = true;
    try {
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      this.sendCallControl({
        t: 'call-offer',
        sdp: this.pc.localDescription!,
        msgId: this.newMsgId(),
      });
    } finally {
      this.makingOffer = false;
    }
  }

  private async answerPendingCallOffer(): Promise<void> {
    if (!this.pc || !this.pendingCallOffer) return;
    const offer = this.pendingCallOffer;
    this.pendingCallOffer = null;
    this.callAcceptedPendingOffer = false;

    const offerCollision = this.makingOffer || this.pc.signalingState !== 'stable';
    this.ignoreOffer = !this.polite && offerCollision;
    if (this.ignoreOffer) {
      throw new Error('Конфликт сигналинга звонка, попробуйте ещё раз');
    }

    await this.pc.setRemoteDescription(offer);
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    this.sendCallControl({
      t: 'call-answer',
      sdp: this.pc.localDescription!,
      msgId: this.newMsgId(),
    });
    this.setCallState('in-call');
    this.startMediaWatchdog();
    this.startNetworkWatch();
  }

  private async beginCallAsOffererAfterAccept(): Promise<void> {
    if (!this.pc || this.callState !== 'calling') return;
    this.clearCallInviteRetry();
    try {
      const stream = await this.acquireLocalMedia('high');
      await this.attachLocalTracks(stream);
      this.handlers.onLocalStream?.(stream);
      await this.renegotiateAsOfferer();
    } catch (e) {
      this.stopLocalMedia();
      this.handlers.onLocalStream?.(null);
      this.setCallState('idle');
      this.handlers.onError?.(
        new Error(mediaErrorMessage(e, 'Не удалось начать звонок'))
      );
    }
  }

  private sendHello(): void {
    if (!this.localIdentity || !this.isReady) return;
    this.sendControl({
      t: 'hello',
      userId: this.localIdentity.userId,
      name: this.localIdentity.name,
      color: this.localIdentity.color,
      avatarUrl: this.localIdentity.avatarUrl || '',
    });
  }

  private async handleControl(packet: ControlPacket): Promise<void> {
    if (packet.msgId) {
      if (this.handledCtrlIds.has(packet.msgId)) return;
      this.handledCtrlIds.add(packet.msgId);
      if (this.handledCtrlIds.size > 80) {
        const first = this.handledCtrlIds.values().next().value;
        if (first) this.handledCtrlIds.delete(first);
      }
    }

    if (packet.t === 'hello') {
      this.handlers.onPeerHello?.({
        userId: packet.userId,
        name: packet.name,
        color: packet.color,
        avatarUrl: packet.avatarUrl || '',
      });
      return;
    }

    if (!this.pc) return;

    if (packet.t === 'media-refresh') {
      await this.refreshLocalTracks();
      return;
    }

    if (packet.t === 'call-invite') {
      if (this.callState === 'in-call' || this.callState === 'calling') return;
      // Только invite — без авто-getUserMedia.
      this.setCallState('ringing');
      this.handlers.onIncomingCall?.();
      return;
    }

    if (packet.t === 'call-accept') {
      // Калеe принял — теперь caller открывает медиа и шлёт offer.
      if (this.callState !== 'calling') return;
      await this.beginCallAsOffererAfterAccept();
      return;
    }

    if (packet.t === 'call-offer') {
      const offerCollision = this.makingOffer || this.pc.signalingState !== 'stable';
      this.ignoreOffer = !this.polite && offerCollision;
      if (this.ignoreOffer) return;

      this.pendingCallOffer = packet.sdp;
      if (this.callAcceptedPendingOffer && this.localStream) {
        try {
          await this.answerPendingCallOffer();
        } catch (e) {
          console.warn('[paranoic] answer after accept failed', e);
        }
        return;
      }
      if (this.callState !== 'ringing') {
        this.setCallState('ringing');
        this.handlers.onIncomingCall?.();
      }
      return;
    }

    if (packet.t === 'call-answer') {
      if (this.callState !== 'calling' && this.callState !== 'in-call') return;
      await this.pc.setRemoteDescription(packet.sdp);
      this.setCallState('in-call');
      this.startMediaWatchdog();
      this.startNetworkWatch();
      return;
    }

    if (packet.t === 'call-decline') {
      this.clearCallInviteRetry();
      this.pendingCallOffer = null;
      this.callAcceptedPendingOffer = false;
      this.stopMediaWatchdog();
      this.stopNetworkWatch();
      void this.stopScreenShareInternal(false);
      this.stopLocalMedia();
      this.handlers.onLocalStream?.(null);
      this.clearRemoteStream();
      this.resetAdaptState();
      this.setCallState('idle');
      this.handlers.onCallDeclined?.();
      return;
    }

    if (packet.t === 'renegotiate-offer') {
      try {
        await this.pc.setRemoteDescription(packet.sdp);
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        this.sendCallControl({
          t: 'renegotiate-answer',
          sdp: this.pc.localDescription!,
          msgId: this.newMsgId(),
        });
        this.iceRestarting = false;
      } catch (e) {
        console.warn('[paranoic] renegotiate-offer failed', e);
      }
      return;
    }

    if (packet.t === 'renegotiate-answer') {
      try {
        if (this.pc.signalingState === 'have-local-offer') {
          await this.pc.setRemoteDescription(packet.sdp);
        }
        this.iceRestarting = false;
      } catch (e) {
        console.warn('[paranoic] renegotiate-answer failed', e);
      }
      return;
    }

    if (packet.t === 'call-hangup') {
      this.clearCallInviteRetry();
      this.pendingCallOffer = null;
      this.callAcceptedPendingOffer = false;
      this.stopMediaWatchdog();
      this.stopNetworkWatch();
      void this.stopScreenShareInternal(false);
      this.stopLocalMedia();
      this.handlers.onLocalStream?.(null);
      this.clearRemoteStream();
      this.resetAdaptState();
      this.setCallState('idle');
      return;
    }

    if (packet.t === 'file-meta') {
      this.incomingFiles.set(packet.id, {
        meta: {
          id: packet.id,
          name: packet.name,
          mime: packet.mime,
          size: Number(packet.size),
        },
        iv: packet.iv,
        chunks: new Array(packet.chunks).fill(null),
        expected: packet.chunks,
        contiguous: -1,
        lastAckSent: -1,
      });
      this.handlers.onFileIncoming?.({
        id: packet.id,
        name: packet.name,
        mime: packet.mime,
        size: Number(packet.size),
      });
      this.handlers.onFileProgress?.(packet.id, 0);
      this.flushOrphanChunks(packet.id);
      return;
    }

    if (packet.t === 'file-ack') {
      this.applyFileAck(packet.id, packet.upTo);
      return;
    }

    if (packet.t === 'file-abort') {
      if (this.incomingFiles.has(packet.id)) {
        this.incomingFiles.delete(packet.id);
        this.handlers.onFileTransferFailed?.(packet.id, FILE_TRANSFER_LOST);
      }
      return;
    }

    if (packet.t === 'file-done') {
      const file = this.incomingFiles.get(packet.id);
      if (!file) return;
      const parts = file.chunks.filter((c): c is Uint8Array => c !== null);
      if (parts.length !== file.expected) {
        this.incomingFiles.delete(packet.id);
        this.handlers.onFileTransferFailed?.(packet.id, 'Файл получен не полностью');
        this.handlers.onError?.(new Error('Файл получен не полностью'));
        return;
      }
      const assembled = concatUint8Arrays(parts);
      this.incomingFiles.delete(packet.id);
      let binary = '';
      const step = 0x8000;
      for (let i = 0; i < assembled.length; i += step) {
        binary += String.fromCharCode(...assembled.subarray(i, i + step));
      }
      const cipherBase64 = btoa(binary);
      this.handlers.onEncryptedFile?.(file.meta, cipherBase64, file.iv);
      return;
    }

    if (packet.t === 'msg-delivered' || packet.t === 'msg-read') {
      const ids = packet.ids?.filter(Boolean) ?? [];
      if (ids.length === 0) return;
      this.handlers.onMessageDelivery?.(
        ids,
        packet.t === 'msg-delivered' ? 'delivered' : 'read'
      );
      return;
    }

    if (packet.t === 'typing') {
      this.handlers.onTyping?.(Boolean(packet.active));
      return;
    }

    if (packet.t === 'msg-reaction') {
      if (!packet.id) return;
      this.handlers.onMessageReaction?.(packet.id, packet.emoji || '❤️');
      return;
    }
  }

  private async createPeerConnection(): Promise<RTCPeerConnection> {
    const iceServers = this.cachedIceServers ?? PUBLIC_ICE_SERVERS;
    this.cachedIceServers = iceServers;
    p2pAudit('createPeerConnection', {
      peerId: this.peerId,
      iceServerCount: iceServers.length,
      callState: this.callState,
      status: this.status,
    });
    const pc = new RTCPeerConnection({
      iceServers,
      iceCandidatePoolSize: 16,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
      iceTransportPolicy: 'all',
    });

    // Trickle ICE — кандидаты с ретраями (Realtime часто теряет одиночные broadcast).
    pc.onicecandidate = (event) => {
      if (!event.candidate) {
        p2pAudit('ICE gathering complete', { peerId: this.peerId });
        return;
      }
      const candidate = event.candidate.toJSON();
      p2pAudit('ICE candidate local', {
        type: event.candidate.type,
        protocol: event.candidate.protocol,
        address: event.candidate.address,
      });
      void this.broadcastReliable('ice-candidate', {
        peerId: this.peerId,
        candidate,
      });
    };

    pc.onicecandidateerror = (event) => {
      console.warn('[P2P Audit] ICE candidate error', event.errorCode, event.errorText);
    };

    pc.ontrack = (event) => {
      if (!this.remoteStream) {
        this.remoteStream = new MediaStream();
      }

      const existing = this.remoteStream.getTracks().find((t) => t.id === event.track.id);
      if (!existing) {
        this.remoteStream.addTrack(event.track);
      }

      event.track.addEventListener('mute', () => {
        if (this.callState === 'in-call') this.stalledChecks += 1;
      });

      event.track.addEventListener('unmute', () => {
        this.stalledChecks = 0;
        this.handlers.onRemoteStream?.(this.remoteStream);
      });

      event.track.addEventListener('ended', () => {
        if (this.callState === 'in-call') {
          void this.requestPeerMediaRefresh();
        }
      });

      this.handlers.onRemoteStream?.(this.remoteStream);
    };

    pc.onconnectionstatechange = () => {
      p2pAudit('connectionState', {
        state: pc.connectionState,
        ice: pc.iceConnectionState,
        callState: this.callState,
      });
      switch (pc.connectionState) {
        case 'connected':
          this.iceRestarting = false;
          this.iceRestartAttempts = 0;
          this.clearIceCheckTimeout();
          this.clearIceSoftRestartTimer();
          this.setSignalingStatus('Связь установлена!');
          this.setLinkDegraded(false);
          break;
        case 'disconnected':
          this.setLinkDegraded(
            true,
            'Слабое соединение. Файлы могут не отправляться.'
          );
          this.scheduleIceSoftRestart();
          break;
        case 'failed':
          void this.handleIceFailure('connectionState=failed');
          break;
        case 'closed':
          this.clearIceCheckTimeout();
          if (this.callState === 'idle') this.setStatus('disconnected');
          break;
      }
    };

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      p2pAudit('iceConnectionState', { state, callState: this.callState });
      if (state === 'checking') {
        this.armIceCheckTimeout(pc);
        this.setSignalingStatus('Обмен маршрутами (ICE)...');
      } else if (state === 'connected' || state === 'completed') {
        this.clearIceCheckTimeout();
        this.clearIceSoftRestartTimer();
        this.iceRestarting = false;
        this.iceRestartAttempts = 0;
        this.setLinkDegraded(false);
      } else if (state === 'disconnected') {
        this.setLinkDegraded(
          true,
          'Слабое соединение. Файлы могут не отправляться.'
        );
        this.scheduleIceSoftRestart();
      } else if (state === 'failed') {
        this.clearIceCheckTimeout();
        void this.handleIceFailure('iceConnectionState=failed');
      } else if (state === 'closed') {
        this.clearIceCheckTimeout();
      }
    };

    return pc;
  }

  /** failed / длительный disconnected → ICE restart, иначе silent soft reset. */
  private async handleIceFailure(reason: string): Promise<void> {
    p2pAudit('ICE failure', {
      reason,
      attempts: this.iceRestartAttempts,
      callState: this.callState,
      status: this.status,
    });
    const ok = await this.tryIceRestart();
    if (ok) return;

    const inMediaCall =
      this.callState === 'in-call' || this.callState === 'calling' || this.callState === 'ringing';
    const keepSession = Boolean(this.signal) && (inMediaCall || this.status === 'connected' || this.status === 'disconnected');

    if (keepSession) {
      if (this.iceRestartAttempts < 5) {
        window.setTimeout(() => void this.tryIceRestart(), 900);
        return;
      }
      p2pAudit('ICE exhausted — silent soft reset', { reason });
      this.handlers.onError?.(new Error('Связь оборвалась. Переподключаемся…'));
      this.softResetPeer();
      return;
    }

    this.clearIceCheckTimeout();
    this.setStatus('failed');
    this.handlers.onError?.(new Error('Не удалось связаться'));
    this.softResetPeer();
  }

  private clearIceCheckTimeout(): void {
    if (this.iceCheckTimer) {
      clearTimeout(this.iceCheckTimer);
      this.iceCheckTimer = null;
    }
  }

  private clearIceSoftRestartTimer(): void {
    if (this.iceSoftRestartTimer) {
      clearTimeout(this.iceSoftRestartTimer);
      this.iceSoftRestartTimer = null;
    }
  }

  private scheduleIceSoftRestart(): void {
    if (this.iceSoftRestartTimer || this.iceRestarting) return;
    p2pAudit('ICE soft restart scheduled', { delayMs: ICE_SOFT_RESTART_DELAY_MS });
    this.iceSoftRestartTimer = setTimeout(() => {
      this.iceSoftRestartTimer = null;
      if (!this.pc) return;
      const ice = this.pc.iceConnectionState;
      const conn = this.pc.connectionState;
      if (ice === 'connected' || ice === 'completed' || conn === 'connected') return;
      void this.tryIceRestart();
    }, ICE_SOFT_RESTART_DELAY_MS);
  }

  private armIceCheckTimeout(pc: RTCPeerConnection): void {
    this.clearIceCheckTimeout();
    this.iceCheckTimer = setTimeout(() => {
      this.iceCheckTimer = null;
      if (this.pc !== pc) return;
      if (pc.iceConnectionState !== 'checking') return;

      // Во время активного звонка — ещё одна попытка ICE, без сброса UI.
      if (this.callState === 'in-call' || this.callState === 'calling' || this.callState === 'ringing') {
        void this.tryIceRestart();
        return;
      }

      this.setStatus('failed');
      this.handlers.onError?.(new Error(ICE_CONNECT_TIMEOUT_ERROR));
      this.softResetPeer();
    }, ICE_CONNECT_TIMEOUT_MS);
  }

  private async tryIceRestart(): Promise<boolean> {
    if (!this.pc || this.iceRestarting) return false;
    if (this.pc.signalingState === 'closed') return false;
    // Разрешаем restart после обмена SDP (не только когда DC уже open).
    const hasRemote = Boolean(this.pc.remoteDescription);
    if (!this.isReady && this.status !== 'connected' && !hasRemote) return false;
    if (this.iceRestartAttempts >= 5) {
      p2pAudit('ICE restart capped', { attempts: this.iceRestartAttempts });
      return false;
    }

    this.iceRestarting = true;
    this.iceRestartAttempts += 1;
    const preservedCall = this.callState;
    p2pAudit('ICE restart attempt', {
      attempt: this.iceRestartAttempts,
      callState: preservedCall,
      status: this.status,
      hasRemote,
    });
    try {
      if (typeof this.pc.restartIce === 'function') {
        this.pc.restartIce();
      }
      this.makingOffer = true;
      try {
        const offer = await this.pc.createOffer({ iceRestart: true });
        await this.pc.setLocalDescription(offer);
        // DC может быть кратко мёртв — дублируем через Realtime.
        this.sendCallControl({
          t: 'renegotiate-offer',
          sdp: this.pc.localDescription!,
          msgId: this.newMsgId(),
        });
      } finally {
        this.makingOffer = false;
      }
      // Не трогаем callState / экран звонка.
      if (preservedCall !== 'idle') this.callState = preservedCall;
      return true;
    } catch (e) {
      p2pAudit('ICE restart failed', e);
      this.iceRestarting = false;
      return false;
    }
  }

  /** Явная отмена пользователем — закрыть PC и НЕ перезапускать join. */
  private abortPendingConnection(): void {
    this.clearJoinRetry();
    this.clearCallInviteRetry();
    this.clearIceCheckTimeout();
    this.clearIceSoftRestartTimer();
    this.clearWaitForPeerTimeout();
    this.stopMediaWatchdog();
    this.stopNetworkWatch();
    void this.stopScreenShareInternal(false);
    this.stopLocalMedia();
    this.clearRemoteStream();
    this.failActiveFileTransfers(FILE_TRANSFER_LOST);
    this.makingOffer = false;
    this.ignoreOffer = false;
    this.iceRestarting = false;
    this.iceRestartAttempts = 0;
    this.refreshingMedia = false;
    this.handshakeStarted = false;
    this.pendingCandidates = [];
    this.pendingJoinPeerId = null;
    this.pendingCallOffer = null;
    this.callAcceptedPendingOffer = false;
    this.remotePeerId = null;
    this.handledCtrlIds.clear();
    this.resetAdaptState();
    this.setCallState('idle');
    this.teardownDataChannels();

    if (this.pc) {
      this.pc.onicecandidate = null;
      this.pc.onconnectionstatechange = null;
      this.pc.oniceconnectionstatechange = null;
      this.pc.ondatachannel = null;
      this.pc.ontrack = null;
      try {
        this.pc.close();
      } catch {
        /* */
      }
      this.pc = null;
    }

    this.setStatus('idle');
    this.setSignalingStatus('');
  }

  /** Закрывает PC/канал, но сохраняет Supabase signaling (инбокс хоста жив). */
  private softResetPeer(): void {
    this.clearJoinRetry();
    this.clearCallInviteRetry();
    this.clearIceCheckTimeout();
    this.clearIceSoftRestartTimer();
    this.clearWaitForPeerTimeout();
    this.stopMediaWatchdog();
    this.stopNetworkWatch();
    void this.stopScreenShareInternal(false);
    this.failActiveFileTransfers(FILE_TRANSFER_LOST);
    this.makingOffer = false;
    this.ignoreOffer = false;
    this.iceRestarting = false;
    this.iceRestartAttempts = 0;
    this.refreshingMedia = false;
    this.lastRemoteVideoBytes = 0;
    this.stalledChecks = 0;
    this.handshakeStarted = false;
    this.pendingCandidates = [];
    this.pendingJoinPeerId = null;
    this.pendingCallOffer = null;
    this.callAcceptedPendingOffer = false;
    this.remotePeerId = null;
    this.handledCtrlIds.clear();
    this.resetAdaptState();
    this.setCallState('idle');
    this.handlers.onLocalStream?.(null);

    this.teardownDataChannels();

    if (this.pc) {
      this.pc.onicecandidate = null;
      this.pc.onconnectionstatechange = null;
      this.pc.oniceconnectionstatechange = null;
      this.pc.ondatachannel = null;
      this.pc.ontrack = null;
      try {
        this.pc.close();
      } catch {
        /* */
      }
      this.pc = null;
    }

    if (this.isHost && this.signal) {
      this.setStatus('waiting-answer');
      this.setSignalingStatus('Ожидаем собеседника...');
    } else if (!this.isHost && this.signal) {
      this.setStatus('connecting');
      this.setSignalingStatus('Ожидаем собеседника...');
      void this.sendJoin();
      this.startJoinRetry();
    }
  }

  private teardownDataChannels(): void {
    for (const ch of [this.fileChannel, this.channel]) {
      if (!ch) continue;
      ch.onopen = null;
      ch.onclose = null;
      ch.onerror = null;
      ch.onmessage = null;
      try {
        ch.close();
      } catch {
        /* */
      }
    }
    this.fileChannel = null;
    this.channel = null;
  }

  private startMediaWatchdog(): void {
    this.stopMediaWatchdog();
    this.lastRemoteVideoBytes = 0;
    this.stalledChecks = 0;
    this.mediaWatchTimer = setInterval(() => {
      void this.checkMediaHealth();
    }, MEDIA_WATCH_MS);
  }

  private stopMediaWatchdog(): void {
    if (this.mediaWatchTimer) {
      clearInterval(this.mediaWatchTimer);
      this.mediaWatchTimer = null;
    }
  }

  private startNetworkWatch(): void {
    this.stopNetworkWatch();
    this.networkWatchTimer = setInterval(() => {
      void this.checkNetworkQuality();
    }, NETWORK_WATCH_MS);

    // Network Information API (если есть) — доп. сигнал о слабом канале.
    const conn = (navigator as Navigator & { connection?: EventTarget }).connection;
    if (conn && 'addEventListener' in conn) {
      this.netInfoHandler = () => {
        const c = conn as { downlink?: number; effectiveType?: string; saveData?: boolean };
        if (c.saveData || c.effectiveType === '2g' || (c.downlink != null && c.downlink < 0.5)) {
          void this.applyVideoAdaptLevel('low');
          this.setNetworkQuality('poor');
        }
      };
      conn.addEventListener('change', this.netInfoHandler);
    }
  }

  private stopNetworkWatch(): void {
    if (this.networkWatchTimer) {
      clearInterval(this.networkWatchTimer);
      this.networkWatchTimer = null;
    }
    const conn = (navigator as Navigator & { connection?: EventTarget }).connection;
    if (conn && this.netInfoHandler) {
      conn.removeEventListener('change', this.netInfoHandler);
      this.netInfoHandler = null;
    }
  }

  private resetAdaptState(): void {
    this.networkQuality = 'good';
    this.videoAdaptLevel = 'high';
    this.adaptCooldownUntil = 0;
    this.goodNetworkStreak = 0;
    this.lastOutboundPacketsLost = 0;
    this.lastOutboundPacketsSent = 0;
    this.iceRestartAttempts = 0;
  }

  private setNetworkQuality(quality: NetworkQuality): void {
    if (this.networkQuality === quality) return;
    this.networkQuality = quality;
    this.handlers.onNetworkQuality?.(quality);
    if (quality === 'poor' || quality === 'critical') {
      this.setLinkDegraded(true, 'Слабое соединение. Файлы могут не отправляться.');
    }
  }

  private linkWarningActive = false;

  private setLinkDegraded(active: boolean, message?: string): void {
    if (!active && !this.linkWarningActive) return;
    this.linkWarningActive = active;
    this.handlers.onLinkDegraded?.(
      active,
      message || 'Слабое соединение. Файлы могут не отправляться.'
    );
  }

  private queueOrphanChunk(id: string, index: number, payload: Uint8Array): void {
    const list = this.orphanFileChunks.get(id) ?? [];
    list.push({ index, payload });
    if (list.length > 2048) list.splice(0, list.length - 2048);
    this.orphanFileChunks.set(id, list);
  }

  private flushOrphanChunks(id: string): void {
    const pending = this.orphanFileChunks.get(id);
    if (!pending?.length) return;
    this.orphanFileChunks.delete(id);
    for (const chunk of pending.sort((a, b) => a.index - b.index)) {
      this.applyIncomingChunk(id, chunk.index, chunk.payload);
    }
  }

  private applyIncomingChunk(id: string, index: number, payload: Uint8Array): void {
    const file = this.incomingFiles.get(id);
    if (!file || index >= file.expected) return;
    if (!file.chunks[index]) {
      file.chunks[index] = payload;
    }

    while (
      file.contiguous + 1 < file.expected &&
      file.chunks[file.contiguous + 1]
    ) {
      file.contiguous += 1;
    }

    const got = file.contiguous + 1;
    this.handlers.onFileProgress?.(id, got / file.expected);

    const dueAck =
      file.contiguous >= 0 &&
      file.contiguous > file.lastAckSent &&
      (file.contiguous === file.expected - 1 ||
        file.contiguous - file.lastAckSent >= FILE_ACK_EVERY);
    if (dueAck && this.isReady) {
      file.lastAckSent = file.contiguous;
      try {
        this.sendControl({
          t: 'file-ack',
          id,
          upTo: file.contiguous,
          msgId: this.newMsgId(),
        });
      } catch {
        /* канал мог закрыться */
      }
    }
  }

  private async checkNetworkQuality(): Promise<void> {
    if (!this.pc || this.callState !== 'in-call' || this.sharingScreen) return;

    try {
      const stats = await this.pc.getStats();
      let rtt = 0;
      let packetsLost = 0;
      let packetsSent = 0;
      let sawOutbound = false;

      stats.forEach((report) => {
        if (report.type === 'candidate-pair') {
          const pair = report as RTCIceCandidatePairStats;
          if (pair.state === 'succeeded' && typeof pair.currentRoundTripTime === 'number') {
            rtt = Math.max(rtt, pair.currentRoundTripTime);
          }
        }
        if (report.type === 'outbound-rtp') {
          const out = report as RTCOutboundRtpStreamStats & { packetsLost?: number };
          if (out.kind === 'video' || (out as { mediaType?: string }).mediaType === 'video') {
            sawOutbound = true;
            packetsLost = Math.max(packetsLost, out.packetsLost ?? 0);
            packetsSent = Math.max(packetsSent, out.packetsSent ?? 0);
          }
        }
        if (report.type === 'remote-inbound-rtp') {
          const remote = report as { kind?: string; packetsLost?: number; roundTripTime?: number };
          if (remote.kind === 'video') {
            packetsLost = Math.max(packetsLost, remote.packetsLost ?? 0);
            if (typeof remote.roundTripTime === 'number') {
              rtt = Math.max(rtt, remote.roundTripTime);
            }
          }
        }
        if (report.type === 'inbound-rtp') {
          const inn = report as RTCInboundRtpStreamStats;
          if (inn.kind === 'video') {
            const loss = inn.packetsLost ?? 0;
            const received = inn.packetsReceived ?? 0;
            if (received + loss > 0) {
              const ratio = loss / (received + loss);
              if (ratio > 0.15) this.goodNetworkStreak = 0;
            }
          }
        }
      });

      let lossRatio = 0;
      if (sawOutbound && packetsSent > this.lastOutboundPacketsSent) {
        const dLost = Math.max(0, packetsLost - this.lastOutboundPacketsLost);
        const dSent = Math.max(1, packetsSent - this.lastOutboundPacketsSent);
        lossRatio = dLost / dSent;
      }
      this.lastOutboundPacketsLost = packetsLost;
      this.lastOutboundPacketsSent = packetsSent;

      let quality: NetworkQuality = 'good';
      if (rtt > 0.8 || lossRatio > 0.18) quality = 'critical';
      else if (rtt > 0.45 || lossRatio > 0.1) quality = 'poor';
      else if (rtt > 0.25 || lossRatio > 0.04) quality = 'fair';

      this.setNetworkQuality(quality);

      if (Date.now() < this.adaptCooldownUntil) return;

      if (quality === 'critical') {
        this.goodNetworkStreak = 0;
        await this.applyVideoAdaptLevel('audio-only');
      } else if (quality === 'poor') {
        this.goodNetworkStreak = 0;
        await this.applyVideoAdaptLevel('low');
      } else if (quality === 'fair') {
        this.goodNetworkStreak = 0;
        if (this.videoAdaptLevel === 'high') await this.applyVideoAdaptLevel('medium');
      } else {
        this.goodNetworkStreak += 1;
        if (this.goodNetworkStreak >= 3) {
          if (this.videoAdaptLevel === 'audio-only') await this.applyVideoAdaptLevel('low');
          else if (this.videoAdaptLevel === 'low') await this.applyVideoAdaptLevel('medium');
          else if (this.videoAdaptLevel === 'medium') await this.applyVideoAdaptLevel('high');
          this.goodNetworkStreak = 0;
        }
      }
    } catch {
      /* */
    }
  }

  private async applyVideoAdaptLevel(level: VideoAdaptLevel): Promise<void> {
    if (!this.pc || this.callState !== 'in-call' || this.sharingScreen) return;
    if (this.videoAdaptLevel === level) return;

    this.videoAdaptLevel = level;
    this.adaptCooldownUntil = Date.now() + 4_500;

    const videoSender =
      this.pc.getSenders().find((s) => s.track?.kind === 'video') ??
      this.pc.getTransceivers().find((tr) => tr.receiver.track.kind === 'video')?.sender;

    if (level === 'audio-only') {
      const cam = this.localStream?.getVideoTracks()[0];
      if (cam) cam.enabled = false;
      if (videoSender) {
        await videoSender.replaceTrack(null);
        await this.applySenderDegradation(videoSender, 'maintain-framerate');
      }
      console.info('[paranoic] adaptive: audio-only (weak network)');
      return;
    }

    let cam = this.cameraVideoTrack ?? this.localStream?.getVideoTracks()[0] ?? null;
    if (!cam || cam.readyState === 'ended') {
      try {
        const stream = await this.acquireLocalMedia(level);
        await this.attachLocalTracks(stream);
        this.handlers.onLocalStream?.(stream);
        cam = stream.getVideoTracks()[0] ?? null;
      } catch {
        return;
      }
    } else {
      cam.enabled = true;
      try {
        await cam.applyConstraints(VIDEO_LEVEL_CONSTRAINTS[level]);
      } catch {
        /* constraints may be unsupported */
      }
      if (videoSender) {
        await videoSender.replaceTrack(cam);
        await this.applySenderDegradation(
          videoSender,
          level === 'high' ? 'balanced' : 'maintain-framerate'
        );
      }
      if (this.localStream) this.handlers.onLocalStream?.(this.localStream);
    }

    console.info('[paranoic] adaptive video level:', level);
  }

  private async checkMediaHealth(): Promise<void> {
    if (!this.pc || this.callState !== 'in-call' || this.refreshingMedia || this.sharingScreen) return;

    const localVideo = this.localStream?.getVideoTracks()[0];
    if (this.videoAdaptLevel !== 'audio-only') {
      if (!localVideo || localVideo.readyState === 'ended') {
        await this.refreshLocalTracks();
        return;
      }
    }

    try {
      const stats = await this.pc.getStats();
      let videoBytes = 0;
      let sawInboundVideo = false;

      stats.forEach((report) => {
        if (report.type === 'inbound-rtp' && (report as RTCInboundRtpStreamStats).kind === 'video') {
          sawInboundVideo = true;
          videoBytes = (report as RTCInboundRtpStreamStats).bytesReceived ?? 0;
        }
      });

      if (!sawInboundVideo) {
        this.stalledChecks += 1;
      } else if (videoBytes <= this.lastRemoteVideoBytes + MEDIA_STALL_BYTES_THRESHOLD) {
        this.stalledChecks += 1;
      } else {
        this.stalledChecks = 0;
        this.lastRemoteVideoBytes = videoBytes;
      }

      if (this.stalledChecks >= 2) {
        this.stalledChecks = 0;
        await this.refreshLocalTracks();
        await this.requestPeerMediaRefresh();
        if (this.remoteStream) {
          this.handlers.onRemoteStream?.(new MediaStream(this.remoteStream.getTracks()));
        }
      }
    } catch {
      /* */
    }
  }

  private async requestPeerMediaRefresh(): Promise<void> {
    try {
      if (this.isReady) this.sendControl({ t: 'media-refresh' });
    } catch {
      /* */
    }
  }

  private bindFileChannel(channel: RTCDataChannel): void {
    this.fileChannel = channel;
    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = BUFFERED_AMOUNT_LOW;

    channel.onopen = () => {
      channel.bufferedAmountLowThreshold = BUFFERED_AMOUNT_LOW;
      console.info('[paranoic] file DataChannel open');
    };

    channel.onerror = () => {
      console.warn('[paranoic] file DataChannel error (soft)');
      if (this.outgoingTransfers.size > 0 || this.incomingFiles.size > 0) {
        this.failActiveFileTransfers(FILE_TRANSFER_LOST);
      }
    };

    channel.onclose = () => {
      if (this.fileChannel === channel) this.fileChannel = null;
      if (this.outgoingTransfers.size > 0 || this.incomingFiles.size > 0) {
        // Chat-канал может ещё жить — но файловый pipe оборван.
        if (!this.filePipe()) {
          this.failActiveFileTransfers(FILE_TRANSFER_LOST);
        }
      }
    };

    channel.onmessage = (event) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      this.ingestFileChunk(event.data);
    };
  }

  private ingestFileChunk(data: ArrayBuffer): void {
    const chunk = decodeFileChunk(data);
    if (!chunk) return;
    const file = this.incomingFiles.get(chunk.id);
    if (!file) {
      this.queueOrphanChunk(chunk.id, chunk.index, chunk.payload);
      return;
    }
    this.applyIncomingChunk(chunk.id, chunk.index, chunk.payload);
  }

  private bindChannel(channel: RTCDataChannel): void {
    this.channel = channel;
    channel.binaryType = 'arraybuffer';

    channel.onopen = () => {
      this.clearIceCheckTimeout();
      this.clearJoinRetry();
      this.setStatus('connected');
      this.setSignalingStatus('Связь установлена!');
      this.sendHello();
    };

    channel.onclose = () => {
      // Во время звонка краткий close часто ложный — пробуем ICE, не сбрасываем UI сразу.
      if (this.callState === 'in-call' || this.callState === 'calling' || this.callState === 'ringing') {
        if (this.outgoingTransfers.size > 0 || this.incomingFiles.size > 0) {
          this.failActiveFileTransfers(FILE_TRANSFER_LOST);
        }
        this.scheduleIceSoftRestart();
        return;
      }
      if (this.outgoingTransfers.size > 0 || this.incomingFiles.size > 0) {
        this.failActiveFileTransfers(FILE_TRANSFER_LOST);
      }
      if (this.status === 'connected') {
        this.setStatus('disconnected');
        // Silent reconnect: и хост, и гость — signaling жив, PC пересобираем.
        if (this.signal) {
          p2pAudit('DC closed — silent softResetPeer');
          this.softResetPeer();
        }
      }
    };

    channel.onerror = () => {
      // Не показываем «Сбой канала связи» на кратковременных ошибках DC.
      console.warn('[paranoic] datachannel error (soft)');
      if (this.callState === 'in-call' || this.callState === 'calling' || this.status === 'connected') {
        this.scheduleIceSoftRestart();
        return;
      }
    };

    channel.onmessage = (event) => {
      // Fallback: чанки могут прийти по chat-каналу (старые клиенты).
      if (event.data instanceof ArrayBuffer) {
        this.ingestFileChunk(event.data);
        return;
      }

      const data =
        typeof event.data === 'string'
          ? event.data
          : new TextDecoder().decode(event.data as ArrayBuffer);

      try {
        const parsed = JSON.parse(data) as Record<string, unknown>;
        if (parsed.__ctrl) {
          void this.handleControl(parsed as unknown as ControlPacket);
          return;
        }
      } catch {
        /* обычное сообщение */
      }

      this.handlers.onMessage?.(data);
    };
  }

  private setStatus(status: P2PStatus): void {
    this.status = status;
    this.handlers.onStatus?.(status);
  }

  private setCallState(state: CallState): void {
    this.callState = state;
    this.handlers.onCallState?.(state);
  }

  private stopLocalMedia(): void {
    void this.stopScreenShareInternal(false);
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.cameraVideoTrack = null;
    this.cameraFacing = 'user';
    if (this.pc) {
      for (const sender of this.pc.getSenders()) {
        if (sender.track) void sender.replaceTrack(null);
      }
    }
  }

  private clearRemoteStream(): void {
    this.remoteStream?.getTracks().forEach((t) => {
      try {
        this.remoteStream?.removeTrack(t);
      } catch {
        /* */
      }
    });
    this.remoteStream = null;
    this.handlers.onRemoteStream?.(null);
  }

  private reset(): void {
    this.detachSignal();
    this.clearJoinRetry();
    this.clearCallInviteRetry();
    this.clearIceCheckTimeout();
    this.clearIceSoftRestartTimer();
    this.clearWaitForPeerTimeout();
    this.stopMediaWatchdog();
    this.stopNetworkWatch();
    void this.stopScreenShareInternal(false);
    this.failActiveFileTransfers(FILE_TRANSFER_LOST);
    this.makingOffer = false;
    this.ignoreOffer = false;
    this.iceRestarting = false;
    this.iceRestartAttempts = 0;
    this.refreshingMedia = false;
    this.lastRemoteVideoBytes = 0;
    this.stalledChecks = 0;
    this.handshakeStarted = false;
    this.pendingCandidates = [];
    this.pendingJoinPeerId = null;
    this.pendingCallOffer = null;
    this.callAcceptedPendingOffer = false;
    this.handledCtrlIds.clear();
    this.remotePeerId = null;
    this.cachedIceServers = null;
    this.isHost = false;
    this.resetAdaptState();
    this.setSignalingStatus('');
    this.handlers.onLocalStream?.(null);

    this.teardownDataChannels();

    if (this.pc) {
      this.pc.onicecandidate = null;
      this.pc.onconnectionstatechange = null;
      this.pc.oniceconnectionstatechange = null;
      this.pc.ondatachannel = null;
      this.pc.ontrack = null;
      try {
        this.pc.close();
      } catch {
        /* */
      }
      this.pc = null;
    }
  }
}

export { MAX_FILE_BYTES, PUBLIC_ICE_SERVERS as ICE_SERVERS };
