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

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const CHUNK_SIZE = 12_000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

type ControlPacket =
  | { t: 'call-offer'; sdp: RTCSessionDescriptionInit }
  | { t: 'call-answer'; sdp: RTCSessionDescriptionInit }
  | { t: 'call-hangup' }
  | { t: 'file-meta'; id: string; name: string; mime: string; size: string; iv: string; chunks: number }
  | { t: 'file-chunk'; id: string; i: number; data: string }
  | { t: 'file-done'; id: string };

type IncomingFile = {
  meta: MediaFileMeta;
  iv: string;
  chunks: string[];
  expected: number;
};

function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', check);
        resolve();
      }
    };
    pc.addEventListener('icegatheringstatechange', check);
  });
}

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

    // Заранее готовим приём A/V
    pc.addTransceiver('audio', { direction: 'recvonly' });
    pc.addTransceiver('video', { direction: 'recvonly' });

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

    const offer = JSON.parse(offerJson) as RTCSessionDescriptionInit;
    await pc.setRemoteDescription(offer);

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitForIceGathering(pc);

    return JSON.stringify(pc.localDescription);
  }

  async acceptAnswer(answerJson: string): Promise<void> {
    if (!this.pc) throw new Error('Сначала создайте приглашение');
    this.setStatus('connecting');
    const answer = JSON.parse(answerJson) as RTCSessionDescriptionInit;
    await this.pc.setRemoteDescription(answer);
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
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
    });
    this.localStream = stream;

    for (const track of stream.getTracks()) {
      const sender = this.pc.getSenders().find((s) => s.track?.kind === track.kind);
      if (sender) await sender.replaceTrack(track);
      else this.pc.addTrack(track, stream);
    }

    // Направление sendrecv
    for (const t of this.pc.getTransceivers()) {
      if (t.receiver.track.kind === 'audio' || t.receiver.track.kind === 'video') {
        t.direction = 'sendrecv';
      }
    }

    await this.renegotiateAsOfferer();
    this.setCallState('in-call');
    return stream;
  }

  async hangUp(): Promise<void> {
    this.setCallState('ending');
    try {
      if (this.isReady) this.sendControl({ t: 'call-hangup' });
    } catch {
      /* ignore */
    }
    this.stopLocalMedia();
    this.clearRemoteStream();
    this.setCallState('idle');
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
      // Даём event loop дышать на больших файлах
      if (i % 8 === 0) await new Promise((r) => setTimeout(r, 0));
    }

    this.sendControl({ t: 'file-done', id });
  }

  close(): void {
    this.stopLocalMedia();
    this.clearRemoteStream();
    this.reset();
    this.setCallState('idle');
    this.setStatus('disconnected');
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

    if (packet.t === 'call-offer') {
      const offerCollision = this.makingOffer || this.pc.signalingState !== 'stable';
      this.ignoreOffer = !this.polite && offerCollision;
      if (this.ignoreOffer) return;

      this.handlers.onIncomingCall?.();
      this.setCallState('calling');

      if (!this.localStream) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        });
        this.localStream = stream;
        for (const track of stream.getTracks()) {
          const sender = this.pc.getSenders().find((s) => s.track?.kind === track.kind);
          if (sender) await sender.replaceTrack(track);
          else this.pc.addTrack(track, stream);
        }
        for (const t of this.pc.getTransceivers()) {
          if (t.receiver.track.kind === 'audio' || t.receiver.track.kind === 'video') {
            t.direction = 'sendrecv';
          }
        }
      }

      await this.pc.setRemoteDescription(packet.sdp);
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      await waitForIceGathering(this.pc);
      this.sendControl({ t: 'call-answer', sdp: this.pc.localDescription! });
      this.setCallState('in-call');
      return;
    }

    if (packet.t === 'call-answer') {
      await this.pc.setRemoteDescription(packet.sdp);
      this.setCallState('in-call');
      return;
    }

    if (packet.t === 'call-hangup') {
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
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.ontrack = (event) => {
      if (!this.remoteStream) {
        this.remoteStream = new MediaStream();
      }
      this.remoteStream.addTrack(event.track);
      this.handlers.onRemoteStream?.(this.remoteStream);
    };

    pc.onconnectionstatechange = () => {
      switch (pc.connectionState) {
        case 'disconnected':
          this.setStatus('disconnected');
          break;
        case 'failed':
          this.setStatus('failed');
          this.handlers.onError?.(new Error('Не удалось связаться'));
          break;
        case 'closed':
          this.setStatus('disconnected');
          break;
      }
    };

    return pc;
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
    this.remoteStream?.getTracks().forEach((t) => t.stop());
    this.remoteStream = null;
    this.handlers.onRemoteStream?.(null);
  }

  private reset(): void {
    this.incomingFiles.clear();
    this.makingOffer = false;
    this.ignoreOffer = false;

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

export { MAX_FILE_BYTES };
