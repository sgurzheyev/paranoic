/** Прямое P2P-соединение через WebRTC DataChannel (без сервера сообщений). */

export type P2PStatus =
  | 'idle'
  | 'creating-offer'
  | 'waiting-answer'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'failed';

export type P2PHandlers = {
  onStatus?: (status: P2PStatus) => void;
  onMessage?: (data: string) => void;
  onError?: (error: Error) => void;
};

const ICE_SERVERS: RTCIceServer[] = [
  // STUN только для обхода NAT; медиа/сообщения идут напрямую по DataChannel
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') {
    return Promise.resolve();
  }

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

  constructor(handlers: P2PHandlers = {}) {
    this.handlers = handlers;
  }

  get currentStatus(): P2PStatus {
    return this.status;
  }

  get isReady(): boolean {
    return this.channel?.readyState === 'open';
  }

  /** Инициатор: создаёт offer и DataChannel. SDP отдаётся для ручной передачи. */
  async createOffer(): Promise<string> {
    this.reset();
    this.setStatus('creating-offer');

    const pc = this.createPeerConnection();
    this.pc = pc;

    const channel = pc.createDataChannel('paranoic', { ordered: true });
    this.bindChannel(channel);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGathering(pc);

    this.setStatus('waiting-answer');
    return JSON.stringify(pc.localDescription);
  }

  /** Принимающая сторона: принимает offer, возвращает answer. */
  async acceptOffer(offerJson: string): Promise<string> {
    this.reset();
    this.setStatus('connecting');

    const pc = this.createPeerConnection();
    this.pc = pc;

    pc.ondatachannel = (event) => {
      this.bindChannel(event.channel);
    };

    const offer = JSON.parse(offerJson) as RTCSessionDescriptionInit;
    await pc.setRemoteDescription(offer);

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitForIceGathering(pc);

    return JSON.stringify(pc.localDescription);
  }

  /** Инициатор: принимает answer и завершает handshake. */
  async acceptAnswer(answerJson: string): Promise<void> {
    if (!this.pc) {
      throw new Error('Сначала создайте offer');
    }

    this.setStatus('connecting');
    const answer = JSON.parse(answerJson) as RTCSessionDescriptionInit;
    await this.pc.setRemoteDescription(answer);
  }

  /** Отправка уже зашифрованной полезной нагрузки по DataChannel. */
  send(payload: string): void {
    if (!this.channel || this.channel.readyState !== 'open') {
      throw new Error('P2P-канал не готов');
    }
    this.channel.send(payload);
  }

  close(): void {
    this.reset();
    this.setStatus('disconnected');
  }

  private createPeerConnection(): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.onconnectionstatechange = () => {
      switch (pc.connectionState) {
        case 'connected':
          // Статус «connected» ставим по открытию DataChannel
          break;
        case 'disconnected':
          this.setStatus('disconnected');
          break;
        case 'failed':
          this.setStatus('failed');
          this.handlers.onError?.(new Error('WebRTC-соединение не удалось'));
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

    channel.onopen = () => {
      this.setStatus('connected');
    };

    channel.onclose = () => {
      if (this.status === 'connected') {
        this.setStatus('disconnected');
      }
    };

    channel.onerror = () => {
      this.handlers.onError?.(new Error('Ошибка DataChannel'));
      this.setStatus('failed');
    };

    channel.onmessage = (event) => {
      const data =
        typeof event.data === 'string'
          ? event.data
          : new TextDecoder().decode(event.data as ArrayBuffer);
      this.handlers.onMessage?.(data);
    };
  }

  private setStatus(status: P2PStatus): void {
    this.status = status;
    this.handlers.onStatus?.(status);
  }

  private reset(): void {
    if (this.channel) {
      this.channel.onopen = null;
      this.channel.onclose = null;
      this.channel.onerror = null;
      this.channel.onmessage = null;
      try {
        this.channel.close();
      } catch {
        /* already closed */
      }
      this.channel = null;
    }

    if (this.pc) {
      this.pc.onconnectionstatechange = null;
      this.pc.ondatachannel = null;
      try {
        this.pc.close();
      } catch {
        /* already closed */
      }
      this.pc = null;
    }
  }
}
