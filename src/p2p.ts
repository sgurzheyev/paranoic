/** Прямое P2P через WebRTC: DataChannel + MediaStream + Supabase signaling. */

import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase, hasSupabaseConfig } from './lib/supabase';

export type P2PStatus =
  | 'idle'
  | 'creating-offer'
  | 'waiting-answer'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'failed';

export type CallState = 'idle' | 'ringing' | 'calling' | 'in-call' | 'ending';

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
  onCallState?: (state: CallState) => void;
  /** Входящий медиазвонок — ждём Accept. */
  onIncomingCall?: () => void;
  /** Входящее P2P-подключение по магической ссылке — ждём Accept. */
  onIncomingConnection?: (info: { peerId: string }) => void;
  onConnectionDeclined?: () => void;
  onCallDeclined?: () => void;
  onFileProgress?: (id: string, progress: number) => void;
  onEncryptedFile?: (meta: MediaFileMeta, cipher: string, iv: string) => void;
  onPeerHello?: (peer: PeerIdentity) => void;
};

type SignalJoin = { type: 'join'; peerId: string };
type SignalOffer = { peerId: string; sdp: RTCSessionDescriptionInit };
type SignalAnswer = { peerId: string; sdp: RTCSessionDescriptionInit };
type SignalIce = { peerId: string; candidate: RTCIceCandidateInit };
type SignalReject = { type: 'reject'; peerId: string; targetPeerId: string };

/**
 * Публичные STUN/TURN (Open Relay) — без платных API.
 * iceTransportPolicy по умолчанию 'all'.
 */
const PUBLIC_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
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
];

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
  console.log(`[paranoic ICE] ${source}`, {
    iceTransportPolicy: 'all',
    total: servers.length,
    stunCount: stun.length,
    turnCount: turn.length,
    stun,
    turn,
  });
}

const FILE_CHUNK_BYTES = 128 * 1024;
const MAX_BUFFERED_AMOUNT = 256 * 1024;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const FILE_CHUNK_MARKER = 0x01;
const ICE_CONNECT_TIMEOUT_MS = 25_000;
const ICE_CONNECT_TIMEOUT_ERROR =
  'Таймаут соединения. VPN или провайдер блокирует трафик.';
const MEDIA_WATCH_MS = 3_500;
const MEDIA_STALL_BYTES_THRESHOLD = 500;

type ControlPacket =
  | { t: 'call-offer'; sdp: RTCSessionDescriptionInit }
  | { t: 'call-answer'; sdp: RTCSessionDescriptionInit }
  | { t: 'call-decline' }
  | { t: 'call-hangup' }
  | { t: 'renegotiate-offer'; sdp: RTCSessionDescriptionInit }
  | { t: 'renegotiate-answer'; sdp: RTCSessionDescriptionInit }
  | { t: 'media-refresh' }
  | { t: 'hello'; userId: string; name: string; color: string; avatarUrl?: string }
  | { t: 'file-meta'; id: string; name: string; mime: string; size: string; iv: string; chunks: number }
  | { t: 'file-done'; id: string };

type IncomingFile = {
  meta: MediaFileMeta;
  iv: string;
  chunks: (Uint8Array | null)[];
  expected: number;
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
  return out.buffer;
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

async function waitForBufferDrain(channel: RTCDataChannel): Promise<void> {
  if (channel.bufferedAmount <= MAX_BUFFERED_AMOUNT) return;
  channel.bufferedAmountLowThreshold = MAX_BUFFERED_AMOUNT / 2;
  await new Promise<void>((resolve) => {
    const done = () => {
      channel.removeEventListener('bufferedamountlow', done);
      resolve();
    };
    channel.addEventListener('bufferedamountlow', done);
    setTimeout(done, 100);
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
  },
  video: {
    facingMode: 'user',
    width: { ideal: 640 },
    height: { ideal: 480 },
    frameRate: { ideal: 24, max: 30 },
  },
};

export class P2PConnection {
  private pc: RTCPeerConnection | null = null;
  /** DataChannel для чата/файлов/звонков. */
  private channel: RTCDataChannel | null = null;
  /** Supabase Realtime — signaling. */
  private signal: RealtimeChannel | null = null;
  private handlers: P2PHandlers;
  private status: P2PStatus = 'idle';
  private callState: CallState = 'idle';
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private incomingFiles = new Map<string, IncomingFile>();
  private makingOffer = false;
  private ignoreOffer = false;
  private polite = false;
  private mediaWatchTimer: ReturnType<typeof setInterval> | null = null;
  private refreshingMedia = false;
  private lastRemoteVideoBytes = 0;
  private stalledChecks = 0;
  private iceRestarting = false;
  private iceCheckTimer: ReturnType<typeof setTimeout> | null = null;

  private peerId = '';
  private remotePeerId: string | null = null;
  private roomId: string | null = null;
  private isHost = false;
  private handshakeStarted = false;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private cachedIceServers: RTCIceServer[] | null = null;
  private joinRetryTimer: ReturnType<typeof setInterval> | null = null;
  private signalingStatus: SignalingDebugStatus = '';
  private localIdentity: PeerIdentity | null = null;
  /** Входящий join ждёт Accept на стороне хоста. */
  private pendingJoinPeerId: string | null = null;
  /** Входящий медиа-offer ждёт Accept. */
  private pendingCallOffer: RTCSessionDescriptionInit | null = null;

  constructor(handlers: P2PHandlers = {}) {
    this.handlers = handlers;
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

  get currentCallState(): CallState {
    return this.callState;
  }

  get currentRoomId(): string | null {
    return this.roomId;
  }

  getLocalStream(): MediaStream | null {
    return this.localStream;
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
    logIceServers('public Open Relay', this.cachedIceServers);
    this.setStatus(options.isHost ? 'waiting-answer' : 'connecting');
    this.setSignalingStatus('Подключаемся к сокетам...');

    const sb = getSupabase();
    const signal = sb.channel(`room:${roomId}`, {
      config: { broadcast: { self: false } },
    });

    signal.on('broadcast', { event: 'join' }, ({ payload }) => {
      void this.onSignalJoin(payload as SignalJoin);
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

    await new Promise<void>((resolve, reject) => {
      signal.subscribe((status) => {
        if (status === 'SUBSCRIBED') resolve();
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          reject(new Error('Не удалось подключиться к комнате (signaling)'));
        }
      });
    });

    this.signal = signal;
    console.log('[paranoic signal] joined room', roomId, {
      peerId: this.peerId,
      isHost: this.isHost,
    });

    if (this.isHost) {
      this.setSignalingStatus('Ожидаем собеседника...');
      this.setStatus('waiting-answer');
    } else {
      // Гость: join после SUBSCRIBED
      await this.sendJoin();
      this.startJoinRetry();
      this.setSignalingStatus('Ожидаем собеседника...');
    }
  }

  private async sendJoin(): Promise<void> {
    if (!this.cachedIceServers) {
      console.warn('[paranoic signal] join blocked: no ICE servers');
      return;
    }
    await this.broadcast('join', { type: 'join', peerId: this.peerId });
  }

  private startJoinRetry(): void {
    this.clearJoinRetry();
    this.joinRetryTimer = setInterval(() => {
      if (this.handshakeStarted || this.pc || this.status === 'connected') {
        this.clearJoinRetry();
        return;
      }
      void this.sendJoin();
    }, 2500);
  }

  private clearJoinRetry(): void {
    if (this.joinRetryTimer) {
      clearInterval(this.joinRetryTimer);
      this.joinRetryTimer = null;
    }
  }

  send(payload: string): void {
    if (!this.channel || this.channel.readyState !== 'open') {
      throw new Error('Соединение ещё не готово');
    }
    this.channel.send(payload);
  }

  async startCall(): Promise<MediaStream> {
    if (!this.pc || !this.isReady) throw new Error('Сначала подключитесь к близкому');
    if (this.callState === 'in-call' || this.callState === 'calling') {
      return this.localStream!;
    }
    if (this.callState === 'ringing') {
      throw new Error('Сначала ответьте на входящий звонок');
    }

    this.setCallState('calling');
    try {
      const stream = await this.acquireLocalMedia();
      await this.attachLocalTracks(stream);
      await this.renegotiateAsOfferer();
      // in-call только после call-answer — иначе «ложный» ответ на мобильных
      return stream;
    } catch (e) {
      this.stopLocalMedia();
      this.setCallState('idle');
      throw e;
    }
  }

  /** Хост принимает входящее подключение по магической ссылке. */
  async acceptIncomingConnection(): Promise<void> {
    if (!this.isHost || !this.pendingJoinPeerId) return;
    this.remotePeerId = this.pendingJoinPeerId;
    this.pendingJoinPeerId = null;
    this.setSignalingStatus('Собеседник найден, генерируем ключи...');
    await this.startAsOfferer();
  }

  /** Хост отклоняет входящее подключение. */
  async declineIncomingConnection(): Promise<void> {
    if (!this.pendingJoinPeerId) return;
    const target = this.pendingJoinPeerId;
    this.pendingJoinPeerId = null;
    await this.broadcast('reject', {
      type: 'reject',
      peerId: this.peerId,
      targetPeerId: target,
    });
    if (this.remotePeerId === target) this.remotePeerId = null;
    this.setSignalingStatus('Ожидаем собеседника...');
    this.setStatus('waiting-answer');
  }

  /** Калеe принимает медиазвонок (после user gesture — важно для мобильных). */
  async acceptCall(): Promise<MediaStream> {
    if (!this.pc || !this.pendingCallOffer) {
      throw new Error('Нет входящего звонка');
    }
    const offer = this.pendingCallOffer;
    this.pendingCallOffer = null;

    try {
      const stream = await this.acquireLocalMedia();
      await this.attachLocalTracks(stream);

      const offerCollision = this.makingOffer || this.pc.signalingState !== 'stable';
      this.ignoreOffer = !this.polite && offerCollision;
      if (this.ignoreOffer) {
        throw new Error('Конфликт сигналинга звонка, попробуйте ещё раз');
      }

      await this.pc.setRemoteDescription(offer);
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      this.sendControl({ t: 'call-answer', sdp: this.pc.localDescription! });
      this.setCallState('in-call');
      this.startMediaWatchdog();
      return stream;
    } catch (e) {
      this.stopLocalMedia();
      this.setCallState('idle');
      try {
        if (this.isReady) this.sendControl({ t: 'call-decline' });
      } catch {
        /* */
      }
      throw e;
    }
  }

  async declineCall(): Promise<void> {
    this.pendingCallOffer = null;
    try {
      if (this.isReady) this.sendControl({ t: 'call-decline' });
    } catch {
      /* */
    }
    this.stopLocalMedia();
    this.clearRemoteStream();
    this.setCallState('idle');
  }

  async hangUp(): Promise<void> {
    this.setCallState('ending');
    this.stopMediaWatchdog();
    try {
      if (this.isReady) this.sendControl({ t: 'call-hangup' });
    } catch {
      /* ignore */
    }
    this.stopLocalMedia();
    this.clearRemoteStream();
    this.setCallState('idle');
  }

  async refreshLocalTracks(): Promise<MediaStream | null> {
    if (!this.pc || this.callState !== 'in-call') return this.localStream;
    if (this.refreshingMedia) return this.localStream;

    this.refreshingMedia = true;
    try {
      const stream = await this.acquireLocalMedia();
      await this.attachLocalTracks(stream);
      this.handlers.onRemoteStream?.(this.remoteStream);
      return stream;
    } catch (e) {
      this.handlers.onError?.(e instanceof Error ? e : new Error('Не удалось обновить камеру'));
      return this.localStream;
    } finally {
      this.refreshingMedia = false;
    }
  }

  async sendFile(
    file: File,
    encrypt: (data: ArrayBuffer) => Promise<{ cipher: string; iv: string }>
  ): Promise<void> {
    if (!this.isReady || !this.channel) throw new Error('Соединение ещё не готово');
    if (file.size > MAX_FILE_BYTES) {
      throw new Error('Файл слишком большой (макс. 16 МБ)');
    }

    const buffer = await file.arrayBuffer();
    const { cipher, iv } = await encrypt(buffer);
    const cipherBytes = Uint8Array.from(atob(cipher), (c) => c.charCodeAt(0));
    const id = `f-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const chunkCount = Math.ceil(cipherBytes.length / FILE_CHUNK_BYTES) || 1;

    this.sendControl({
      t: 'file-meta',
      id,
      name: file.name,
      mime: file.type || 'application/octet-stream',
      size: String(file.size),
      iv,
      chunks: chunkCount,
    });

    for (let i = 0; i < chunkCount; i++) {
      const start = i * FILE_CHUNK_BYTES;
      const slice = cipherBytes.subarray(start, start + FILE_CHUNK_BYTES);
      await waitForBufferDrain(this.channel);
      this.channel.send(encodeFileChunk(id, i, slice));
      this.handlers.onFileProgress?.(id, (i + 1) / chunkCount);
    }

    await waitForBufferDrain(this.channel);
    this.sendControl({ t: 'file-done', id });
  }

  close(): void {
    this.detachSignal();
    this.stopMediaWatchdog();
    this.stopLocalMedia();
    this.clearRemoteStream();
    this.reset();
    this.setCallState('idle');
    this.setStatus('disconnected');
  }

  private async broadcast(event: string, payload: object): Promise<void> {
    if (!this.signal) return;
    try {
      const result = await this.signal.send({
        type: 'broadcast',
        event,
        payload,
      });
      if (result === 'timed out' || result === 'error') {
        console.warn('[paranoic signal] broadcast failed', event, result);
      }
    } catch (e) {
      console.warn('[paranoic signal] broadcast failed', event, e);
    }
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

    // Уже на связи — занято.
    if (this.status === 'connected') {
      await this.broadcast('reject', {
        type: 'reject',
        peerId: this.peerId,
        targetPeerId: payload.peerId,
      });
      return;
    }

    // Handshake уже идёт: тот же гость (retry join) — игнор; другой — busy.
    if (this.handshakeStarted || this.pc) {
      if (payload.peerId === this.remotePeerId) return;
      await this.broadcast('reject', {
        type: 'reject',
        peerId: this.peerId,
        targetPeerId: payload.peerId,
      });
      return;
    }

    // Повторный join того же гостя, пока ждём Accept — игнор.
    if (this.pendingJoinPeerId === payload.peerId) return;

    // Другой гость, пока висит Accept — отклоняем нового.
    if (this.pendingJoinPeerId && this.pendingJoinPeerId !== payload.peerId) {
      await this.broadcast('reject', {
        type: 'reject',
        peerId: this.peerId,
        targetPeerId: payload.peerId,
      });
      return;
    }

    this.pendingJoinPeerId = payload.peerId;
    this.remotePeerId = payload.peerId;
    console.log('[paranoic signal] incoming join, awaiting accept', payload.peerId);
    this.setSignalingStatus('Входящий вызов...');
    this.handlers.onIncomingConnection?.({ peerId: payload.peerId });
  }

  private onSignalReject(payload: SignalReject): void {
    if (!payload?.targetPeerId || payload.targetPeerId !== this.peerId) return;
    if (this.isHost) return;

    this.clearJoinRetry();
    this.setSignalingStatus('Вызов отклонён');
    this.setStatus('failed');
    this.handlers.onConnectionDeclined?.();
    this.handlers.onError?.(new Error('Вызов отклонён'));
  }

  private async startAsOfferer(): Promise<void> {
    if (this.handshakeStarted || this.pc) return;
    if (!this.cachedIceServers) {
      this.handlers.onError?.(new Error('Offer заблокирован: нет ICE-серверов'));
      return;
    }
    this.handshakeStarted = true;
    this.polite = false;
    this.setStatus('creating-offer');
    this.setSignalingStatus('Собеседник найден, генерируем ключи...');

    try {
      const pc = await this.createPeerConnection();
      this.pc = pc;
      const dc = pc.createDataChannel('paranoic', { ordered: true });
      this.bindChannel(dc);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.setStatus('connecting');
      this.setSignalingStatus('Обмен маршрутами (ICE)...');
      await this.broadcast('offer', {
        peerId: this.peerId,
        sdp: pc.localDescription!,
      });
    } catch (e) {
      this.handshakeStarted = false;
      this.setStatus('failed');
      this.handlers.onError?.(e instanceof Error ? e : new Error('Не удалось создать offer'));
    }
  }

  private async onSignalOffer(payload: SignalOffer): Promise<void> {
    if (!payload?.peerId || payload.peerId === this.peerId || !payload.sdp) return;
    // Хост не принимает чужой offer (он сам инициатор).
    if (this.isHost) return;

    this.clearJoinRetry();
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
        pc.ondatachannel = (event) => this.bindChannel(event.channel);
      }

      const offer = parseSessionDescription(payload.sdp, 'offer');
      await this.pc.setRemoteDescription(offer);
      await this.flushPendingCandidates();

      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      this.setSignalingStatus('Обмен маршрутами (ICE)...');
      await this.broadcast('answer', {
        peerId: this.peerId,
        sdp: this.pc.localDescription!,
      });
    } catch (e) {
      this.setStatus('failed');
      this.handlers.onError?.(e instanceof Error ? e : new Error('Не удалось ответить на offer'));
    }
  }

  private async onSignalAnswer(payload: SignalAnswer): Promise<void> {
    if (!payload?.sdp || !this.pc) return;
    if (payload.peerId === this.peerId) return;
    try {
      if (!this.pc.currentRemoteDescription) {
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
      return;
    }
    try {
      await this.pc.addIceCandidate(payload.candidate);
    } catch (e) {
      console.warn('[paranoic ICE] addIceCandidate failed', e);
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

  private async acquireLocalMedia(): Promise<MediaStream> {
    const prev = this.localStream;
    const stream = await navigator.mediaDevices.getUserMedia(MEDIA_CONSTRAINTS);
    this.localStream = stream;
    prev?.getTracks().forEach((t) => t.stop());

    for (const track of stream.getTracks()) {
      track.addEventListener('ended', () => {
        if (this.callState === 'in-call') {
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
    }

    for (const t of this.pc.getTransceivers()) {
      if (t.receiver.track.kind === 'audio' || t.receiver.track.kind === 'video') {
        t.direction = 'sendrecv';
      }
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
      this.sendControl({ t: 'call-offer', sdp: this.pc.localDescription! });
    } finally {
      this.makingOffer = false;
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

    if (packet.t === 'call-offer') {
      const offerCollision = this.makingOffer || this.pc.signalingState !== 'stable';
      this.ignoreOffer = !this.polite && offerCollision;
      if (this.ignoreOffer) return;

      // Не отвечаем автоматически — ждём Accept (user gesture для getUserMedia).
      this.pendingCallOffer = packet.sdp;
      this.setCallState('ringing');
      this.handlers.onIncomingCall?.();
      return;
    }

    if (packet.t === 'call-answer') {
      if (this.callState !== 'calling' && this.callState !== 'in-call') return;
      await this.pc.setRemoteDescription(packet.sdp);
      this.setCallState('in-call');
      this.startMediaWatchdog();
      return;
    }

    if (packet.t === 'call-decline') {
      this.pendingCallOffer = null;
      this.stopMediaWatchdog();
      this.stopLocalMedia();
      this.clearRemoteStream();
      this.setCallState('idle');
      this.handlers.onCallDeclined?.();
      return;
    }

    if (packet.t === 'renegotiate-offer') {
      try {
        await this.pc.setRemoteDescription(packet.sdp);
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        this.sendControl({ t: 'renegotiate-answer', sdp: this.pc.localDescription! });
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
      this.pendingCallOffer = null;
      this.stopMediaWatchdog();
      this.stopLocalMedia();
      this.clearRemoteStream();
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
      });
      return;
    }

    if (packet.t === 'file-done') {
      const file = this.incomingFiles.get(packet.id);
      if (!file) return;
      const parts = file.chunks.filter((c): c is Uint8Array => c !== null);
      if (parts.length !== file.expected) {
        this.incomingFiles.delete(packet.id);
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
    }
  }

  private async createPeerConnection(): Promise<RTCPeerConnection> {
    const iceServers = this.cachedIceServers ?? PUBLIC_ICE_SERVERS;
    this.cachedIceServers = iceServers;
    const pc = new RTCPeerConnection({
      iceServers,
      iceCandidatePoolSize: 8,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    });

    // Trickle ICE — кандидаты сразу в Supabase, без ожидания complete
    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      void this.broadcast('ice-candidate', {
        peerId: this.peerId,
        candidate: event.candidate.toJSON(),
      });
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
      switch (pc.connectionState) {
        case 'connected':
          this.iceRestarting = false;
          this.clearIceCheckTimeout();
          break;
        case 'disconnected':
          void this.tryIceRestart();
          break;
        case 'failed':
          void this.tryIceRestart().then((ok) => {
            if (!ok) {
              this.clearIceCheckTimeout();
              this.setStatus('failed');
              this.handlers.onError?.(new Error('Не удалось связаться'));
            }
          });
          break;
        case 'closed':
          this.clearIceCheckTimeout();
          this.setStatus('disconnected');
          break;
      }
    };

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      if (state === 'checking') {
        this.armIceCheckTimeout(pc);
      } else if (state === 'connected' || state === 'completed') {
        this.clearIceCheckTimeout();
      } else if (state === 'failed' || state === 'disconnected') {
        if (state === 'failed') this.clearIceCheckTimeout();
        void this.tryIceRestart();
      } else if (state === 'closed') {
        this.clearIceCheckTimeout();
      }
    };

    return pc;
  }

  private clearIceCheckTimeout(): void {
    if (this.iceCheckTimer) {
      clearTimeout(this.iceCheckTimer);
      this.iceCheckTimer = null;
    }
  }

  private armIceCheckTimeout(pc: RTCPeerConnection): void {
    this.clearIceCheckTimeout();
    this.iceCheckTimer = setTimeout(() => {
      this.iceCheckTimer = null;
      if (this.pc !== pc) return;
      if (pc.iceConnectionState !== 'checking') return;

      this.setStatus('failed');
      this.handlers.onError?.(new Error(ICE_CONNECT_TIMEOUT_ERROR));
      // Не рвём signaling-комнату — иначе хост инбокса «умирает» и магическая ссылка ломается.
      this.softResetPeer();
    }, ICE_CONNECT_TIMEOUT_MS);
  }

  private async tryIceRestart(): Promise<boolean> {
    if (!this.pc || this.iceRestarting) return false;
    if (this.pc.signalingState === 'closed') return false;
    // Пока DataChannel не открыт — ICE restart через control бесполезен.
    if (!this.isReady && this.status !== 'connected') return false;

    this.iceRestarting = true;
    try {
      if (typeof this.pc.restartIce === 'function') {
        this.pc.restartIce();
      }
      // Отдельный тип — не путаем с входящим медиазвонком (call-offer).
      this.makingOffer = true;
      try {
        const offer = await this.pc.createOffer({ iceRestart: true });
        await this.pc.setLocalDescription(offer);
        if (this.isReady) {
          this.sendControl({ t: 'renegotiate-offer', sdp: this.pc.localDescription! });
        }
      } finally {
        this.makingOffer = false;
      }
      return true;
    } catch {
      this.iceRestarting = false;
      return false;
    }
  }

  /** Закрывает PC/канал, но сохраняет Supabase signaling (инбокс хоста жив). */
  private softResetPeer(): void {
    this.clearJoinRetry();
    this.clearIceCheckTimeout();
    this.stopMediaWatchdog();
    this.incomingFiles.clear();
    this.makingOffer = false;
    this.ignoreOffer = false;
    this.iceRestarting = false;
    this.refreshingMedia = false;
    this.lastRemoteVideoBytes = 0;
    this.stalledChecks = 0;
    this.handshakeStarted = false;
    this.pendingCandidates = [];
    this.pendingJoinPeerId = null;
    this.pendingCallOffer = null;
    this.remotePeerId = null;
    this.setCallState('idle');

    if (this.channel) {
      this.channel.onopen = null;
      this.channel.onclose = null;
      this.channel.onerror = null;
      this.channel.onmessage = null;
      try {
        this.channel.close();
      } catch {
        /* */
      }
      this.channel = null;
    }

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

  private async checkMediaHealth(): Promise<void> {
    if (!this.pc || this.callState !== 'in-call' || this.refreshingMedia) return;

    const localVideo = this.localStream?.getVideoTracks()[0];
    if (!localVideo || localVideo.readyState === 'ended' || localVideo.muted) {
      await this.refreshLocalTracks();
      return;
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
      if (this.status === 'connected') {
        this.setStatus('disconnected');
        // Хост остаётся в инбоксе и готов принять следующий join.
        if (this.isHost && this.signal) {
          this.softResetPeer();
        }
      }
    };

    channel.onerror = () => {
      this.handlers.onError?.(new Error('Сбой канала связи'));
      this.setStatus('failed');
    };

    channel.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        const chunk = decodeFileChunk(event.data);
        if (chunk) {
          const file = this.incomingFiles.get(chunk.id);
          if (file && chunk.index < file.expected) {
            file.chunks[chunk.index] = chunk.payload;
            const got = file.chunks.filter(Boolean).length;
            this.handlers.onFileProgress?.(chunk.id, got / file.expected);
          }
          return;
        }
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
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
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
    this.clearIceCheckTimeout();
    this.stopMediaWatchdog();
    this.incomingFiles.clear();
    this.makingOffer = false;
    this.ignoreOffer = false;
    this.iceRestarting = false;
    this.refreshingMedia = false;
    this.lastRemoteVideoBytes = 0;
    this.stalledChecks = 0;
    this.handshakeStarted = false;
    this.pendingCandidates = [];
    this.pendingJoinPeerId = null;
    this.pendingCallOffer = null;
    this.remotePeerId = null;
    this.cachedIceServers = null;
    this.isHost = false;
    this.setSignalingStatus('');

    if (this.channel) {
      this.channel.onopen = null;
      this.channel.onclose = null;
      this.channel.onerror = null;
      this.channel.onmessage = null;
      try {
        this.channel.close();
      } catch {
        /* */
      }
      this.channel = null;
    }

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
