import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  Users,
} from 'lucide-react';
import ModeSelector, { type AppModeChoice } from './ModeSelector';
import GlobeLobby from './GlobeLobby';
import {
  deriveKeyFromRoom,
  exportKey,
  encryptMessage,
  decryptMessage,
  encryptBytes,
  decryptBytes,
} from './crypto';
import { P2PConnection, type CallState, type P2PStatus } from './p2p';
import { buildRoomShareUrl, getOrCreateRoomId, getRoomIdFromUrl } from './room';
import { hasSupabaseConfig } from './lib/supabase';
import {
  appendStoredMessage,
  formatFileSize,
  loadChatHistory,
  loadMediaBlob,
  mediaStorageKey,
  saveMediaBlob,
  type StoredMessage,
} from './storage';

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
  'waiting-answer': 'Ждём второго участника в комнате…',
  connecting: 'Соединяемся…',
  connected: 'Вы на связи',
  disconnected: 'Связь прервалась',
  failed: 'Не получилось связаться',
};

function nowTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function App() {
  const [appMode, setAppMode] = useState<AppMode>(() =>
    getRoomIdFromUrl() ? 'paranoic' : 'select'
  );
  const [myId, setMyId] = useState('');
  const [secretKey, setSecretKey] = useState<CryptoKey | null>(null);
  const [keyString, setKeyString] = useState('');
  const [p2pStatus, setP2pStatus] = useState<P2PStatus>('idle');
  const [callState, setCallState] = useState<CallState>('idle');
  const [screen, setScreen] = useState<Screen>('home');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [error, setError] = useState('');
  const [roomId, setRoomId] = useState('');
  const [roomUrl, setRoomUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [peerLabel, setPeerLabel] = useState('Близкий');
  const [joining, setJoining] = useState(false);

  const p2pRef = useRef<P2PConnection | null>(null);
  const secretKeyRef = useRef<CryptoKey | null>(null);
  const myIdRef = useRef('');
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingFilesRef = useRef<Map<string, Blob>>(new Map());
  const mediaUrlsRef = useRef<Set<string>>(new Set());

  const addMessage = useCallback(async (message: ChatMessage, persist = true) => {
    setMessages((prev) => [...prev, message]);
    if (persist && message.kind !== 'file-pending') {
      await appendStoredMessage(toStored(message));
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

      void saveMediaBlob(mediaKey, blob).then(() => appendStoredMessage(toStored(updated)));
      return prev.map((m) => (m.id === messageId ? updated : m));
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await loadChatHistory();
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
      if (!cancelled) setMessages(hydrated);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      for (const url of mediaUrlsRef.current) URL.revokeObjectURL(url);
      mediaUrlsRef.current.clear();
      pendingFilesRef.current.clear();
    };
  }, []);

  useEffect(() => {
    secretKeyRef.current = secretKey;
  }, [secretKey]);

  useEffect(() => {
    myIdRef.current = myId;
  }, [myId]);

  const attachLocalVideo = useCallback((stream: MediaStream | null) => {
    if (localVideoRef.current) localVideoRef.current.srcObject = stream;
  }, []);

  const ensureP2P = useCallback(() => {
    if (!p2pRef.current) {
      p2pRef.current = new P2PConnection({
        onStatus: (status) => {
          setP2pStatus(status);
          if (status === 'connected') setError('');
        },
        onCallState: (state) => {
          setCallState(state);
          if (state === 'in-call' || state === 'calling') setScreen('call');
          if (state === 'idle') {
            attachLocalVideo(null);
            setScreen((s) => (s === 'call' ? 'home' : s));
          }
        },
        onIncomingCall: () => setScreen('call'),
        onRemoteStream: (stream) => {
          if (remoteVideoRef.current) remoteVideoRef.current.srcObject = stream;
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
            setPeerLabel(packet.sender || 'Близкий');
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
                sender: 'Близкий',
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
    return p2pRef.current;
  }, [addMessage, attachLocalVideo]);

  /** Вход в комнату: URL ?room= → Supabase signaling → WebRTC. */
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

        const id = 'PRN-' + Math.random().toString(36).substring(2, 9).toUpperCase();
        if (cancelled) return;
        setMyId(id);
        myIdRef.current = id;

        const room = getOrCreateRoomId();
        if (cancelled) return;
        setRoomId(room);
        setRoomUrl(buildRoomShareUrl(room));

        const key = await deriveKeyFromRoom(room);
        if (cancelled) return;
        setSecretKey(key);
        secretKeyRef.current = key;
        const exported = await exportKey(key);
        setKeyString(exported);

        const p2p = ensureP2P();
        await p2p.joinRoom(room);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Не удалось войти в комнату');
          setP2pStatus('failed');
        }
      } finally {
        if (!cancelled) setJoining(false);
      }
    })();

    return () => {
      cancelled = true;
      p2pRef.current?.close();
      p2pRef.current = null;
    };
  }, [appMode, ensureP2P]);

  useEffect(() => {
    if (screen === 'call' && p2pRef.current) {
      attachLocalVideo(p2pRef.current.getLocalStream());
    }
  }, [screen, callState, attachLocalVideo]);

  const copyRoomLink = async () => {
    if (!roomUrl) return;
    await navigator.clipboard.writeText(roomUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const disconnect = () => {
    p2pRef.current?.close();
    p2pRef.current = null;
    setP2pStatus('disconnected');
    setCallState('idle');
    setScreen('home');
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
      sender: myIdRef.current,
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

  const connected = p2pStatus === 'connected';

  if (appMode === 'select') {
    return <ModeSelector onSelect={(mode) => setAppMode(mode)} />;
  }

  if (appMode === 'family') {
    return (
      <GlobeLobby
        onBack={() => setAppMode('select')}
        onCreateConnection={() => {
          setAppMode('paranoic');
          setScreen('home');
        }}
      />
    );
  }

  return (
    <div className="app-shell">
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
          {FRIENDLY_STATUS[p2pStatus]}
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

      <main className="app-main">
        {screen === 'home' && (
          <section className="home">
            {!connected ? (
              <>
                <p className="lead">
                  {joining
                    ? 'Входим в комнату и ждём близкого…'
                    : 'Отправьте ссылку на комнату близкому — соединение установится само.'}
                </p>
                <div className="room-card">
                  <Users size={28} className="room-card-icon" />
                  <p className="room-id-label">Комната</p>
                  <p className="mono-box">{roomId || '…'}</p>
                  <button
                    type="button"
                    className="mega-btn primary compact"
                    onClick={copyRoomLink}
                    disabled={!roomUrl}
                  >
                    {copied ? <Check size={28} /> : <Copy size={28} />}
                    {copied ? 'Скопировано' : 'Скопировать ссылку на комнату'}
                  </button>
                  <p className="hint">
                    Когда второй участник откроет ту же ссылку, WebRTC соединит вас напрямую.
                  </p>
                </div>
              </>
            ) : (
              <>
                <p className="lead">
                  На связи: <strong>{peerLabel}</strong>
                </p>
                <div className="mega-grid">
                  <button type="button" className="mega-btn call" onClick={startCall}>
                    <Phone size={36} />
                    Позвонить
                  </button>
                  <button type="button" className="mega-btn chat" onClick={() => setScreen('chat')}>
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
            {keyString && (
              <p className="hint muted-sep">E2EE ключ комнаты активен · ID: {myId}</p>
            )}
          </section>
        )}

        {screen === 'chat' && (
          <section className="chat">
            <div className="chat-top">
              <button type="button" className="text-link" onClick={() => setScreen('home')}>
                <ArrowLeft size={16} /> Назад
              </button>
              <span>Переписка с {peerLabel}</span>
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
                      {m.kind === 'media' && m.mediaUrl && (
                        m.mediaMime?.startsWith('video/') ? (
                          <video src={m.mediaUrl} controls className="media-preview" />
                        ) : (
                          <img src={m.mediaUrl} alt={m.mediaName || 'фото'} className="media-preview" />
                        )
                      )}
                      <time>{m.time}</time>
                    </div>
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
              {callState === 'calling' ? 'Соединяем…' : callState === 'in-call' ? 'Разговор идёт' : 'Звонок'}
            </p>
            <button type="button" className="mega-btn hangup" onClick={hangUp}>
              <PhoneOff size={32} />
              Завершить
            </button>
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
