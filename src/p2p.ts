/** Прямое P2P через WebRTC: DataChannel + MediaStream. */

export type P2PStatus =
  | 'idle'
  | 'creating-offer'
  | 'waiting-answer'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'failed';

export type CallState = 'idle' | 'calling' | 'in-call' | 'ending';

export type MediaFileMeta = {
  id: string;
  name: string;
  mime: string;
  size: number;
};

export type P2PHandlers = {
  onStatus?: (status: P2PStatus) => void;
  onMessage?: (data: string) => void;
  onError?: (error: Error) => void;
  onRemoteStream?: (stream: MediaStream | null) => void;
  onCallState?: (state: CallState) => void;
  onIncomingCall?: () => void;
  onFileProgress?: (id: string, progress: number) => void;
  /** Зашифрованный файл целиком — расшифровка на стороне UI. */
  onEncryptedFile?: (meta: MediaFileMeta, cipher: string, iv: string) => void;
};

/**
 * STUN для прямого ICE + публичные TURN для обхода симметричного NAT (4G ↔ Wi‑Fi).
 * Open Relay / ExpressTURN — резервный релей, когда hole-punching не проходит.
 */
const ICE_SERVERS: RTCIceServer[] = [
  {
    urls: [
      'stun:stun.l.google.com:19302',
      'stun:stun1.l.google.com:19302',
      'stun:stun2.l.google.com:19302',
      'stun:stun3.l.google.com:19302',
      'stun:stun4.l.google.com:19302',
    ],
  },
  // Open Relay TURN: UDP — основной релей для мобильного NAT
  {
    urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443'],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  // Резерв: TCP / TLS — когда UDP режется оператором 4G
  {
    urls: [
      'turn:openrelay.metered.ca:80?transport=tcp',
      'turn:openrelay.metered.ca:443?transport=tcp',
      'turns:openrelay.metered.ca:443',
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

const CHUNK_SIZE = 12_000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
/** Для инвайт-ссылки ждём complete или 2с — иначе в SDP нет STUN/TURN кандидатов. */
const ICE_GATHER_TIMEOUT_MS = 2_000;
const MEDIA_WATCH_MS = 3_500;
const MEDIA_STALL_BYTES_THRESHOLD = 500;

type ControlPacket =
  | { t: 'call-offer'; sdp: RTCSessionDescriptionInit }
  | { t: 'call-answer'; sdp: RTCSessionDescriptionInit }
  | { t: 'call-hangup' }
  | { t: 'media-refresh' }
  | { t: 'file-meta'; id: string; name: string; mime: string; size: string; iv: string; chunks: number }
  | { t: 'file-chunk'; id: string; i: number; data: string }
  | { t: 'file-done'; id: string };

type IncomingFile = {
  meta: MediaFileMeta;
  iv: string;
  chunks: string[];
  expected: number;
};

function waitForIceGathering(pc: RTCPeerConnection, timeoutMs = ICE_GATHER_TIMEOUT_MS): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      pc.removeEventListener('icegatheringstatechange', onState);
      pc.removeEventListener('icecandidate', onCandidate);
      clearTimeout(timer);
      resolve();
    };
    const onState = () => {
      if (pc.iceGatheringState === 'complete') finish();
    };
    // null candidate = конец сбора (надёжнее на части мобильных браузеров)
    const onCandidate = (event: RTCPeerConnectionIceEvent) => {
      if (event.candidate === null) finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    pc.addEventListener('icegatheringstatechange', onState);
    pc.addEventListener('icecandidate', onCandidate);
    // Гонка: complete мог наступить между проверкой и подпиской
    if (pc.iceGatheringState === 'complete') finish();
  });
}

const SDP_FORMAT_ERROR = 'Неверный формат ответа (ошибка декомпрессии)';

/**
 * После fflate SDP может прийти как JSON-объект, JSON-строка объекта,
 * дважды сериализованная строка или «голый» SDP (v=0…). Нормализуем в RTCSessionDescriptionInit.
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
    // Двойная сериализация: JSON.parse вернул строку
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
  private channel: RTCDataChannel | null = null;
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

  constructor(handlers: P2PHandlers = {}) {
    this.handlers = handlers;
  }

  get currentStatus(): P2PStatus {
    return this.status;
  }

  get isReady(): boolean {
    return this.channel?.readyState === 'open';
  }

  get currentCallState(): CallState {
    return this.callState;
  }

  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  /** Инициатор приглашения (не polite). */
  async createOffer(): Promise<string> {
    this.reset();
    this.polite = false;
    this.setStatus('creating-offer');

    const pc = this.createPeerConnection();
    this.pc = pc;

    const channel = pc.createDataChannel('paranoic', { ordered: true });
    this.bindChannel(channel);

    // Только DataChannel в инвайт-SDP — A/V добавляется при звонке (иначе URL не влезает в мессенджеры)
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGathering(pc);

    this.setStatus('waiting-answer');
    return JSON.stringify(pc.localDescription);
  }

  /** Принимающая сторона (polite). */
  async acceptOffer(offerJson: string): Promise<string> {
    this.reset();
    this.polite = true;
    this.setStatus('connecting');

    const pc = this.createPeerConnection();
    this.pc = pc;

    pc.ondatachannel = (event) => this.bindChannel(event.channel);

    try {
      const offer = parseSessionDescription(offerJson, 'offer');
      await pc.setRemoteDescription(offer);
    } catch (e) {
      this.setStatus('failed');
      const err =
        e instanceof Error && e.message === SDP_FORMAT_ERROR
          ? e
          : new Error(SDP_FORMAT_ERROR);
      this.handlers.onError?.(err);
      throw err;
    }

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitForIceGathering(pc);

    return JSON.stringify(pc.localDescription);
  }

  async acceptAnswer(answerJson: string): Promise<void> {
    if (!this.pc) throw new Error('Сначала создайте приглашение');
    this.setStatus('connecting');

    try {
      const answer = parseSessionDescription(answerJson, 'answer');
      await this.pc.setRemoteDescription(answer);
    } catch (e) {
      this.setStatus('failed');
      const err =
        e instanceof Error && e.message === SDP_FORMAT_ERROR
          ? e
          : new Error(SDP_FORMAT_ERROR);
      this.handlers.onError?.(err);
      throw err;
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

    this.setCallState('calling');
    const stream = await this.acquireLocalMedia();
    await this.attachLocalTracks(stream);
    await this.renegotiateAsOfferer();
    this.setCallState('in-call');
    this.startMediaWatchdog();
    return stream;
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

  /** Перезахват камеры/микрофона и replaceTrack без разрыва DataChannel. */
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

  async sendFile(file: File, encrypt: (data: ArrayBuffer) => Promise<{ cipher: string; iv: string }>): Promise<void> {
    if (!this.isReady) throw new Error('Соединение ещё не готово');
    if (file.size > MAX_FILE_BYTES) {
      throw new Error('Файл слишком большой (макс. 8 МБ)');
    }

    const buffer = await file.arrayBuffer();
    const { cipher, iv } = await encrypt(buffer);
    const id = `f-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const chunks: string[] = [];
    for (let i = 0; i < cipher.length; i += CHUNK_SIZE) {
      chunks.push(cipher.slice(i, i + CHUNK_SIZE));
    }

    this.sendControl({
      t: 'file-meta',
      id,
      name: file.name,
      mime: file.type || 'application/octet-stream',
      size: String(file.size),
      iv,
      chunks: chunks.length,
    });

    for (let i = 0; i < chunks.length; i++) {
      this.sendControl({ t: 'file-chunk', id, i, data: chunks[i] });
      this.handlers.onFileProgress?.(id, (i + 1) / chunks.length);
      if (i % 8 === 0) await new Promise((r) => setTimeout(r, 0));
    }

    this.sendControl({ t: 'file-done', id });
  }

  close(): void {
    this.stopMediaWatchdog();
    this.stopLocalMedia();
    this.clearRemoteStream();
    this.reset();
    this.setCallState('idle');
    this.setStatus('disconnected');
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
      await waitForIceGathering(this.pc);
      this.sendControl({ t: 'call-offer', sdp: this.pc.localDescription! });
    } finally {
      this.makingOffer = false;
    }
  }

  private async handleControl(packet: ControlPacket): Promise<void> {
    if (!this.pc) return;

    if (packet.t === 'media-refresh') {
      await this.refreshLocalTracks();
      return;
    }

    if (packet.t === 'call-offer') {
      const offerCollision = this.makingOffer || this.pc.signalingState !== 'stable';
      this.ignoreOffer = !this.polite && offerCollision;
      if (this.ignoreOffer) return;

      this.handlers.onIncomingCall?.();
      this.setCallState('calling');

      if (!this.localStream) {
        const stream = await this.acquireLocalMedia();
        await this.attachLocalTracks(stream);
      }

      await this.pc.setRemoteDescription(packet.sdp);
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      await waitForIceGathering(this.pc);
      this.sendControl({ t: 'call-answer', sdp: this.pc.localDescription! });
      this.setCallState('in-call');
      this.startMediaWatchdog();
      return;
    }

    if (packet.t === 'call-answer') {
      await this.pc.setRemoteDescription(packet.sdp);
      this.setCallState('in-call');
      this.startMediaWatchdog();
      return;
    }

    if (packet.t === 'call-hangup') {
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
        chunks: new Array(packet.chunks).fill(''),
        expected: packet.chunks,
      });
      return;
    }

    if (packet.t === 'file-chunk') {
      const file = this.incomingFiles.get(packet.id);
      if (!file) return;
      file.chunks[packet.i] = packet.data;
      const got = file.chunks.filter(Boolean).length;
      this.handlers.onFileProgress?.(packet.id, got / file.expected);
      return;
    }

    if (packet.t === 'file-done') {
      const file = this.incomingFiles.get(packet.id);
      if (!file) return;
      const cipher = file.chunks.join('');
      this.incomingFiles.delete(packet.id);
      this.handlers.onEncryptedFile?.(file.meta, cipher, file.iv);
    }
  }

  private createPeerConnection(): RTCPeerConnection {
    const pc = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
      iceCandidatePoolSize: 8,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    });

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
          break;
        case 'disconnected':
          void this.tryIceRestart();
          break;
        case 'failed':
          void this.tryIceRestart().then((ok) => {
            if (!ok) {
              this.setStatus('failed');
              this.handlers.onError?.(new Error('Не удалось связаться'));
            }
          });
          break;
        case 'closed':
          this.setStatus('disconnected');
          break;
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
        void this.tryIceRestart();
      }
    };

    return pc;
  }

  private async tryIceRestart(): Promise<boolean> {
    if (!this.pc || this.iceRestarting || !this.isReady) return false;
    if (this.pc.signalingState === 'closed') return false;

    this.iceRestarting = true;
    try {
      if (typeof this.pc.restartIce === 'function') {
        this.pc.restartIce();
      }
      if (this.callState === 'in-call' || this.status === 'connected') {
        this.makingOffer = true;
        try {
          const offer = await this.pc.createOffer({ iceRestart: true });
          await this.pc.setLocalDescription(offer);
          await waitForIceGathering(this.pc);
          this.sendControl({ t: 'call-offer', sdp: this.pc.localDescription! });
        } finally {
          this.makingOffer = false;
        }
      }
      return true;
    } catch {
      this.iceRestarting = false;
      return false;
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
        // Мягко переподтянуть remote stream в UI
        if (this.remoteStream) {
          this.handlers.onRemoteStream?.(new MediaStream(this.remoteStream.getTracks()));
        }
      }
    } catch {
      /* stats may fail mid-restart */
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

    channel.onopen = () => this.setStatus('connected');

    channel.onclose = () => {
      if (this.status === 'connected') this.setStatus('disconnected');
    };

    channel.onerror = () => {
      this.handlers.onError?.(new Error('Сбой канала связи'));
      this.setStatus('failed');
    };

    channel.onmessage = (event) => {
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
    this.stopMediaWatchdog();
    this.incomingFiles.clear();
    this.makingOffer = false;
    this.ignoreOffer = false;
    this.iceRestarting = false;
    this.refreshingMedia = false;
    this.lastRemoteVideoBytes = 0;
    this.stalledChecks = 0;

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

export { MAX_FILE_BYTES, ICE_SERVERS };
