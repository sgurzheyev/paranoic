/**
 * WebRTC mesh for small group calls.
 * One RTCPeerConnection per remote participant, signaled over group:{id} Realtime.
 */
import { newCallId } from './callSignaling';
import { broadcastGroupEvent } from './groups';
import { ensureCallMediaAccess, getUserMediaForCall } from './mediaPermissions';
import { buildIceServers, parseSessionDescription } from './p2p';

export const MAX_GROUP_CALL_PEERS = 6;

export const GROUP_CALL_EVENTS = [
  'group-call-invite',
  'group-call-join',
  'group-call-leave',
  'group-call-end',
  'group-call-offer',
  'group-call-answer',
  'group-call-ice',
] as const;

export type GroupCallEventName = (typeof GROUP_CALL_EVENTS)[number];

export type GroupCallSignal = {
  t: GroupCallEventName;
  callId: string;
  groupId: string;
  fromUserId: string;
  fromName?: string;
  toUserId?: string;
  video?: boolean;
  peers?: string[];
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

export type RemoteGroupStream = {
  userId: string;
  name: string;
  stream: MediaStream;
};

export type GroupCallHandlers = {
  onLocalStream?: (stream: MediaStream | null) => void;
  onRemotes?: (remotes: RemoteGroupStream[]) => void;
  onIncoming?: (signal: GroupCallSignal) => void;
  onEnded?: () => void;
  onError?: (message: string) => void;
};

type MeshPeer = {
  userId: string;
  name: string;
  pc: RTCPeerConnection;
  pendingIce: RTCIceCandidateInit[];
  makingOffer: boolean;
  remoteStream: MediaStream;
};

function shouldOffer(selfId: string, remoteId: string): boolean {
  return selfId < remoteId;
}

export class GroupCallMesh {
  private selfId = '';
  private selfName = '';
  private groupId = '';
  private callId = '';
  private video = true;
  private localStream: MediaStream | null = null;
  private peers = new Map<string, MeshPeer>();
  private handlers: GroupCallHandlers = {};
  private active = false;

  setHandlers(h: GroupCallHandlers): void {
    this.handlers = h;
  }

  isActive(): boolean {
    return this.active;
  }

  getCallId(): string {
    return this.callId;
  }

  getGroupId(): string {
    return this.groupId;
  }

  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  async start(opts: {
    selfId: string;
    selfName: string;
    groupId: string;
    video: boolean;
    memberCount: number;
  }): Promise<void> {
    await this.prepareMedia(opts);
    this.callId = newCallId();
    this.active = true;
    await this.send('group-call-invite', {
      fromName: this.selfName,
      video: this.video,
    });
    await this.send('group-call-join', {
      fromName: this.selfName,
      video: this.video,
      peers: [this.selfId],
    });
  }

  async accept(opts: {
    selfId: string;
    selfName: string;
    groupId: string;
    callId: string;
    video: boolean;
    hostId: string;
    hostName?: string;
  }): Promise<void> {
    await this.prepareMedia({
      selfId: opts.selfId,
      selfName: opts.selfName,
      groupId: opts.groupId,
      video: opts.video,
      memberCount: 2,
    });
    this.callId = opts.callId;
    this.active = true;
    if (opts.hostId && opts.hostId !== this.selfId) {
      await this.ensurePeer(opts.hostId, opts.hostName || opts.hostId);
    }
    await this.send('group-call-join', {
      fromName: this.selfName,
      video: this.video,
      peers: [this.selfId, ...this.peers.keys()],
    });
  }

  async hangUp(endForAll = false): Promise<void> {
    if (this.groupId && this.callId && this.selfId) {
      try {
        await this.send(endForAll ? 'group-call-end' : 'group-call-leave', {});
      } catch {
        /* */
      }
    }
    this.teardown();
  }

  toggleMic(): boolean {
    const next = !this.localStream?.getAudioTracks().every((t) => t.enabled);
    this.localStream?.getAudioTracks().forEach((t) => {
      t.enabled = next;
    });
    return !next;
  }

  toggleCamera(): boolean {
    const next = !this.localStream?.getVideoTracks().every((t) => t.enabled);
    this.localStream?.getVideoTracks().forEach((t) => {
      t.enabled = next;
    });
    return !next;
  }

  async handleSignal(event: string, raw: unknown): Promise<void> {
    const payload = raw as GroupCallSignal | null;
    if (!payload?.fromUserId || !payload.groupId) return;
    if (payload.fromUserId === this.selfId) return;

    if (event === 'group-call-invite') {
      if (this.active) return;
      this.handlers.onIncoming?.(payload);
      return;
    }

    if (!this.active && event !== 'group-call-end') return;
    if (this.callId && payload.callId && payload.callId !== this.callId) return;
    if (this.groupId && payload.groupId !== this.groupId && event !== 'group-call-invite') {
      return;
    }

    switch (event) {
      case 'group-call-join':
        await this.onJoin(payload);
        break;
      case 'group-call-leave':
        this.removePeer(payload.fromUserId);
        break;
      case 'group-call-end':
        this.teardown();
        this.handlers.onEnded?.();
        break;
      case 'group-call-offer':
        if (payload.toUserId !== this.selfId || !payload.sdp) return;
        await this.onOffer(payload.fromUserId, payload.fromName, payload.sdp);
        break;
      case 'group-call-answer':
        if (payload.toUserId !== this.selfId || !payload.sdp) return;
        await this.onAnswer(payload.fromUserId, payload.sdp);
        break;
      case 'group-call-ice':
        if (payload.toUserId !== this.selfId || !payload.candidate) return;
        await this.onIce(payload.fromUserId, payload.candidate);
        break;
      default:
        break;
    }
  }

  private async prepareMedia(opts: {
    selfId: string;
    selfName: string;
    groupId: string;
    video: boolean;
    memberCount: number;
  }): Promise<void> {
    this.selfId = opts.selfId;
    this.selfName = opts.selfName;
    this.groupId = opts.groupId;
    this.video = opts.video;
    await ensureCallMediaAccess();
    this.localStream = await getUserMediaForCall({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: opts.video
        ? { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } }
        : false,
    });
    this.handlers.onLocalStream?.(this.localStream);
  }

  private async onJoin(payload: GroupCallSignal): Promise<void> {
    const ids = new Set<string>([payload.fromUserId, ...(payload.peers ?? [])]);
    for (const id of ids) {
      if (!id || id === this.selfId) continue;
      await this.ensurePeer(id, id === payload.fromUserId ? payload.fromName : undefined);
    }
  }

  private async ensurePeer(userId: string, name?: string): Promise<MeshPeer> {
    const existing = this.peers.get(userId);
    if (existing) {
      if (name) existing.name = name;
      return existing;
    }
    if (this.peers.size + 1 >= MAX_GROUP_CALL_PEERS) {
      this.handlers.onError?.(`Group calls support up to ${MAX_GROUP_CALL_PEERS} people`);
      throw new Error('group call full');
    }

    const pc = new RTCPeerConnection({
      iceServers: buildIceServers(),
      iceCandidatePoolSize: 8,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
      iceTransportPolicy: 'all',
    });
    const peer: MeshPeer = {
      userId,
      name: name || userId.slice(0, 8),
      pc,
      pendingIce: [],
      makingOffer: false,
      remoteStream: new MediaStream(),
    };
    this.peers.set(userId, peer);

    this.localStream?.getTracks().forEach((track) => {
      pc.addTrack(track, this.localStream!);
    });

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      void this.send('group-call-ice', {
        toUserId: userId,
        candidate: event.candidate.toJSON(),
      });
    };
    pc.ontrack = (event) => {
      for (const track of event.streams[0]?.getTracks() ?? [event.track]) {
        if (!peer.remoteStream.getTracks().some((t) => t.id === track.id)) {
          peer.remoteStream.addTrack(track);
        }
      }
      this.emitRemotes();
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.removePeer(userId);
      }
    };

    if (shouldOffer(this.selfId, userId)) {
      await this.createOffer(peer);
    }
    this.emitRemotes();
    return peer;
  }

  private async createOffer(peer: MeshPeer): Promise<void> {
    peer.makingOffer = true;
    try {
      const offer = await peer.pc.createOffer();
      await peer.pc.setLocalDescription(offer);
      await this.send('group-call-offer', {
        toUserId: peer.userId,
        sdp: peer.pc.localDescription ?? offer,
      });
    } finally {
      peer.makingOffer = false;
    }
  }

  private async onOffer(
    fromUserId: string,
    fromName: string | undefined,
    sdp: RTCSessionDescriptionInit
  ): Promise<void> {
    const peer = await this.ensurePeer(fromUserId, fromName);
    const desc = parseSessionDescription(sdp, 'offer');
    const glare = peer.makingOffer || peer.pc.signalingState !== 'stable';
    if (glare && shouldOffer(this.selfId, fromUserId)) {
      return;
    }
    if (glare) {
      try {
        await peer.pc.setLocalDescription({ type: 'rollback' });
      } catch {
        /* rollback not supported */
      }
    }
    await peer.pc.setRemoteDescription(desc);
    await this.flushIce(peer);
    const answer = await peer.pc.createAnswer();
    await peer.pc.setLocalDescription(answer);
    await this.send('group-call-answer', {
      toUserId: fromUserId,
      sdp: peer.pc.localDescription ?? answer,
    });
  }

  private async onAnswer(fromUserId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    const peer = this.peers.get(fromUserId);
    if (!peer) return;
    await peer.pc.setRemoteDescription(parseSessionDescription(sdp, 'answer'));
    await this.flushIce(peer);
  }

  private async onIce(fromUserId: string, candidate: RTCIceCandidateInit): Promise<void> {
    const peer = this.peers.get(fromUserId);
    if (!peer) return;
    if (!peer.pc.remoteDescription) {
      peer.pendingIce.push(candidate);
      return;
    }
    try {
      await peer.pc.addIceCandidate(candidate);
    } catch {
      /* */
    }
  }

  private async flushIce(peer: MeshPeer): Promise<void> {
    const queued = peer.pendingIce.splice(0);
    for (const c of queued) {
      try {
        await peer.pc.addIceCandidate(c);
      } catch {
        /* */
      }
    }
  }

  private removePeer(userId: string): void {
    const peer = this.peers.get(userId);
    if (!peer) return;
    peer.pc.onicecandidate = null;
    peer.pc.ontrack = null;
    peer.pc.onconnectionstatechange = null;
    try {
      peer.pc.close();
    } catch {
      /* */
    }
    this.peers.delete(userId);
    this.emitRemotes();
  }

  private emitRemotes(): void {
    this.handlers.onRemotes?.(
      [...this.peers.values()].map((p) => ({
        userId: p.userId,
        name: p.name,
        stream: p.remoteStream,
      }))
    );
  }

  private async send(
    event: GroupCallEventName,
    extra: Partial<GroupCallSignal>
  ): Promise<void> {
    if (!this.groupId || !this.selfId) return;
    const payload: GroupCallSignal = {
      t: event,
      callId: this.callId,
      groupId: this.groupId,
      fromUserId: this.selfId,
      fromName: this.selfName,
      ...extra,
    };
    await broadcastGroupEvent(this.groupId, event, payload);
  }

  private teardown(): void {
    for (const id of [...this.peers.keys()]) this.removePeer(id);
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.handlers.onLocalStream?.(null);
    this.handlers.onRemotes?.([]);
    this.active = false;
    this.callId = '';
    this.groupId = '';
  }
}

export const groupCallMesh = new GroupCallMesh();
