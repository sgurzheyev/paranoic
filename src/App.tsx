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
  Settings2,
  Link2,
  Unplug,
  Send,
  ArrowLeft,
  Camera,
  FileDown,
} from 'lucide-react';
import QrScannerModal from './QrScannerModal';
import ModeSelector, { type AppModeChoice } from './ModeSelector';
import GlobeLobby from './GlobeLobby';
import {
  generateSecretKey,
  exportKey,
  importKey,
  encryptMessage,
  decryptMessage,
  encryptBytes,
  decryptBytes,
  resolveKeyMaterial,
} from './crypto';
import { P2PConnection, type CallState, type P2PStatus } from './p2p';
import {
  buildInviteUrl,
  clearInviteHash,
  extractSdpFromPaste,
  InviteTruncatedError,
  INVITE_TRUNCATED_MESSAGE,
  makeQrDataUrl,
  parseInviteFromLocation,
  parseInviteFromPastedText,
  SIGNAL_CHANNEL,
  type InvitePayload,
  type SignalMessage,
} from './invite';
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
type Screen = 'home' | 'invite' | 'chat' | 'call';

type ChatMessage = StoredMessage & {
  mediaUrl?: string;
};

function toStored(message: ChatMessage): StoredMessage {
  const { mediaUrl: _url, ...stored } = message;
  return stored;
}

const FRIENDLY_STATUS: Record<P2PStatus, string> = {
  idle: 'Пока никого нет',
  'creating-offer': 'Готовим приглашение…',
  'waiting-answer': 'Ждём, пока близкий откроет ссылку',
  connecting: 'Соединяемся…',
  connected: 'Вы на связи',
  disconnected: 'Связь прервалась',
  failed: 'Не получилось связаться',
};

function nowTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function App() {
  const [appMode, setAppMode] = useState<AppMode>('select');
  const [myId, setMyId] = useState('');
  const [myName] = useState('Я');
  const [secretKey, setSecretKey] = useState<CryptoKey | null>(null);
  const [keyString, setKeyString] = useState('');
  const [p2pStatus, setP2pStatus] = useState<P2PStatus>('idle');
  const [callState, setCallState] = useState<CallState>('idle');
  const [screen, setScreen] = useState<Screen>('home');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [error, setError] = useState('');
  const [inviteUrl, setInviteUrl] = useState('');
  const [qrUrl, setQrUrl] = useState('');
  const [inviteHint, setInviteHint] = useState('');
  const [copied, setCopied] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [remoteSignal, setRemoteSignal] = useState('');
  const [importKeyInput, setImportKeyInput] = useState('');
  const [localSignal, setLocalSignal] = useState('');
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [peerLabel, setPeerLabel] = useState('Близкий');
  const [routeBusy, setRouteBusy] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [connectingAnswer, setConnectingAnswer] = useState(false);

  const p2pRef = useRef<P2PConnection | null>(null);
  const secretKeyRef = useRef<CryptoKey | null>(null);
  const myIdRef = useRef('');
  const keyStringRef = useRef('');
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const answerInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bcRef = useRef<BroadcastChannel | null>(null);
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
      for (const url of mediaUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
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

  useEffect(() => {
    keyStringRef.current = keyString;
  }, [keyString]);

  const attachLocalVideo = useCallback((stream: MediaStream | null) => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
    }
  }, []);

  const ensureP2P = useCallback(() => {
    if (!p2pRef.current) {
      p2pRef.current = new P2PConnection({
        onStatus: (status) => {
          setP2pStatus(status);
          if (status === 'connected') {
            setError('');
            setScreen((s) => (s === 'invite' ? 'home' : s));
          }
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
            const message: ChatMessage = {
              id: `m-${Date.now()}`,
              sender: packet.sender || 'Близкий',
              text,
              time: nowTime(),
              mine: false,
              kind: 'text',
            };
            await addMessage(message);
            setPeerLabel(packet.sender || 'Близкий');
          } catch {
            setError('Сообщение не удалось прочитать. Проверьте общий ключ.');
          }
        },
        onEncryptedFile: async (meta, cipher, iv) => {
          const key = secretKeyRef.current;
          if (!key) return;
          try {
            const plain = await decryptBytes(cipher, iv, key);
            const blob = new Blob([plain], { type: meta.mime });
            pendingFilesRef.current.set(meta.id, blob);
            const message: ChatMessage = {
              id: meta.id,
              sender: 'Близкий',
              time: nowTime(),
              mine: false,
              kind: 'file-pending',
              mediaMime: meta.mime,
              mediaName: meta.name,
              mediaSize: meta.size,
            };
            setMessages((prev) => [...prev, message]);
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

  const publishAnswer = useCallback(
    async (answerSdp: string, key: string, to: string) => {
      const payload: InvitePayload = {
        v: 2,
        role: 'answer',
        sdp: answerSdp,
        key,
        from: myIdRef.current,
        name: myName,
      };
      const url = await buildInviteUrl(payload);
      setInviteUrl(url);
      try {
        setQrUrl(await makeQrDataUrl(url));
      } catch {
        setQrUrl('');
      }
      setInviteHint('Покажите этот код тому, кто вас пригласил — или отправьте ссылку обратно');
      setScreen('invite');

      try {
        bcRef.current?.postMessage({ kind: 'answer', payload, to } satisfies SignalMessage);
      } catch {
        /* */
      }
    },
    [myName]
  );

  const handleIncomingInvite = useCallback(
    async (invite: InvitePayload) => {
      setError('');
      setRouteBusy(true);
      try {
        const key = await importKey(invite.key);
        setSecretKey(key);
        secretKeyRef.current = key;
        setKeyString(invite.key);
        keyStringRef.current = invite.key;
        if (invite.name) setPeerLabel(invite.name);

        const p2p = ensureP2P();

        if (invite.role === 'offer') {
          const answer = await p2p.acceptOffer(invite.sdp);
          setLocalSignal(answer);
          await publishAnswer(answer, invite.key, invite.from);
        } else if (invite.role === 'answer') {
          await p2p.acceptAnswer(invite.sdp);
        }

        clearInviteHash();
      } catch (e) {
        if (e instanceof InviteTruncatedError) {
          setError(INVITE_TRUNCATED_MESSAGE);
        } else {
          setError(e instanceof Error ? e.message : 'Не удалось принять приглашение');
        }
      } finally {
        setRouteBusy(false);
      }
    },
    [ensureP2P, publishAnswer]
  );

  useEffect(() => {
    let cancelled = false;
    const bc = new BroadcastChannel(SIGNAL_CHANNEL);
    bcRef.current = bc;

    async function init() {
      const id = 'PRN-' + Math.random().toString(36).substring(2, 9).toUpperCase();
      if (cancelled) return;
      setMyId(id);
      myIdRef.current = id;

      const key = await generateSecretKey();
      if (cancelled) return;
      setSecretKey(key);
      secretKeyRef.current = key;
      const exported = await exportKey(key);
      setKeyString(exported);
      keyStringRef.current = exported;

      try {
        const invite = await parseInviteFromLocation();
        if (!cancelled && invite) {
          setAppMode('paranoic');
          await handleIncomingInvite(invite);
        }
      } catch (e) {
        if (cancelled) return;
        setAppMode('paranoic');
        if (e instanceof InviteTruncatedError) {
          setError(INVITE_TRUNCATED_MESSAGE);
        } else {
          setError(e instanceof Error ? e.message : 'Не удалось прочитать ссылку');
        }
      }
    }

    bc.onmessage = (event: MessageEvent<SignalMessage>) => {
      const msg = event.data;
      if (msg.kind === 'answer' && msg.to === myIdRef.current) {
        void (async () => {
          try {
            const p2p = ensureP2P();
            await p2p.acceptAnswer(msg.payload.sdp);
            setInviteHint('');
            setScreen('home');
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Ответ не принят');
          }
        })();
      }
    };

    void init();

    return () => {
      cancelled = true;
      bc.close();
      bcRef.current = null;
      p2pRef.current?.close();
      p2pRef.current = null;
    };
    // Инициализация сессии один раз при монтировании
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (screen === 'call' && p2pRef.current) {
      attachLocalVideo(p2pRef.current.getLocalStream());
    }
  }, [screen, callState, attachLocalVideo]);

  const createInvite = async () => {
    setError('');
    setCopied(false);
    setRouteBusy(true);
    try {
      const p2p = ensureP2P();
      const offer = await p2p.createOffer();
      setLocalSignal(offer);
      const payload: InvitePayload = {
        v: 2,
        role: 'offer',
        sdp: offer,
        key: keyStringRef.current,
        from: myIdRef.current,
        name: myName,
      };
      const url = await buildInviteUrl(payload);
      setInviteUrl(url);
      try {
        setQrUrl(await makeQrDataUrl(url));
      } catch {
        setQrUrl('');
      }
      setInviteHint('Отправьте ссылку близкому или покажите QR-код');
      setScreen('invite');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось создать приглашение');
    } finally {
      setRouteBusy(false);
    }
  };

  const copyInvite = async () => {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const disconnect = () => {
    p2pRef.current?.close();
    p2pRef.current = null;
    setP2pStatus('disconnected');
    setCallState('idle');
    setInviteUrl('');
    setQrUrl('');
    setScannerOpen(false);
    setConnectingAnswer(false);
    setScreen('home');
  };

  const applyAnswerFromText = useCallback(
    async (raw: string) => {
      setError('');
      setConnectingAnswer(true);
      try {
        const invite = await parseInviteFromPastedText(raw);
        if (invite?.role === 'answer') {
          await ensureP2P().acceptAnswer(invite.sdp);
        } else if (invite?.role === 'offer') {
          throw new Error('Это ссылка-приглашение, нужен QR ответа от близкого');
        } else {
          const sdp = await extractSdpFromPaste(raw);
          await ensureP2P().acceptAnswer(sdp);
        }
        setRemoteSignal('');
        setScannerOpen(false);
        setInviteHint('');
        setScreen('home');
      } catch (e) {
        const msg =
          e instanceof InviteTruncatedError
            ? INVITE_TRUNCATED_MESSAGE
            : e instanceof Error
              ? e.message
              : 'Не удалось принять ответ';
        setError(msg);
        throw e;
      } finally {
        setConnectingAnswer(false);
      }
    },
    [ensureP2P]
  );

  const onQrScanned = useCallback(
    async (text: string) => {
      setError('');
      setConnectingAnswer(true);
      setInviteHint('Код прочитан, устанавливаем связь...');
      setScannerOpen(false);

      try {
        let payload = text.trim();
        try {
          const hashIdx = payload.indexOf('#paranoic=');
          if (hashIdx >= 0) {
            payload = payload.slice(hashIdx);
          } else if (payload.startsWith('http://') || payload.startsWith('https://')) {
            try {
              const url = new URL(payload);
              if (url.hash.includes('paranoic=')) {
                payload = url.hash.startsWith('#') ? url.hash : `#${url.hash}`;
              }
            } catch {
              /* оставляем исходную строку */
            }
          }
        } catch {
          /* безопасный fallback: передаём сырую строку в applyAnswerFromText */
        }

        await applyAnswerFromText(payload);
      } catch {
        /* ошибка уже в setError из applyAnswerFromText */
      } finally {
        setInviteHint((prev) =>
          prev === 'Код прочитан, устанавливаем связь...' ? '' : prev
        );
      }
    },
    [applyAnswerFromText]
  );

  const startCall = async () => {
    setError('');
    try {
      const p2p = ensureP2P();
      const stream = await p2p.startCall();
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
      const message: ChatMessage = {
        id: `m-${Date.now()}`,
        sender: 'Я',
        text: inputText,
        time: nowTime(),
        mine: true,
        kind: 'text',
      };
      await addMessage(message);
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
      const message: ChatMessage = {
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
      };
      await addMessage(message);
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
                  Один клик — и вы на прямой защищённой связи с близким. Без регистрации и без облака.
                </p>
                <button
                  type="button"
                  className="mega-btn primary"
                  onClick={createInvite}
                  disabled={routeBusy}
                >
                  {routeBusy ? (
                    <>
                      <span className="btn-spinner" aria-hidden />
                      Шифруем маршрут...
                    </>
                  ) : (
                    <>
                      <Link2 size={32} />
                      Пригласить близкого
                    </>
                  )}
                </button>
                <p className="hint">
                  {routeBusy
                    ? 'Собираем защищённый маршрут через сеть…'
                    : 'Появится ссылка и QR-код — отправьте их маме или папе'}
                </p>
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

            <button
              type="button"
              className="text-link muted advanced-toggle"
              onClick={() => setShowAdvanced((v) => !v)}
            >
              <Settings2 size={16} /> {showAdvanced ? 'Скрыть' : 'Для продвинутых'}
            </button>

            {showAdvanced && (
              <div className="advanced">
                <p className="adv-label">Ваш ключ (оставьте как есть, если пользуетесь ссылкой)</p>
                <div className="mono-box">{keyString || '…'}</div>
                <div className="adv-row">
                  <input
                    value={importKeyInput}
                    onChange={(e) => setImportKeyInput(e.target.value)}
                    placeholder="Вставить чужой ключ"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const material = await resolveKeyMaterial(importKeyInput);
                        const key = await importKey(material);
                        setSecretKey(key);
                        setKeyString(material);
                        setImportKeyInput('');
                      } catch (e) {
                        setError(
                          e instanceof InviteTruncatedError
                            ? INVITE_TRUNCATED_MESSAGE
                            : 'Ключ не подходит'
                        );
                      }
                    }}
                  >
                    Импорт
                  </button>
                </div>
                <p className="adv-label">Ручной ответ (если QR не сработал)</p>
                <textarea
                  value={remoteSignal}
                  onChange={(e) => setRemoteSignal(e.target.value)}
                  placeholder="Вставьте ответный код"
                  rows={3}
                />
                <div className="adv-row">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const sdp = await extractSdpFromPaste(remoteSignal);
                        await ensureP2P().acceptAnswer(sdp);
                        setRemoteSignal('');
                      } catch (e) {
                        setError(
                          e instanceof InviteTruncatedError
                            ? INVITE_TRUNCATED_MESSAGE
                            : e instanceof Error
                              ? e.message
                              : 'Ошибка'
                        );
                      }
                    }}
                  >
                    Принять ответ
                  </button>
                  {localSignal && (
                    <button type="button" onClick={() => navigator.clipboard.writeText(localSignal)}>
                      Копировать мой сигнал
                    </button>
                  )}
                </div>
                <p className="hint">ID: {myId}</p>
              </div>
            )}
          </section>
        )}

        {screen === 'invite' && (
          <section className="invite">
            <button type="button" className="text-link" onClick={() => setScreen('home')}>
              <ArrowLeft size={16} /> Назад
            </button>
            <h2>Почти готово</h2>
            <p className="lead">{inviteHint}</p>
            {qrUrl && <img src={qrUrl} alt="QR-код приглашения" className="qr" />}
            <button type="button" className="mega-btn primary compact" onClick={copyInvite}>
              {copied ? <Check size={28} /> : <Copy size={28} />}
              {copied ? 'Скопировано' : 'Скопировать ссылку'}
            </button>
            <p className="mono-box small">{inviteUrl}</p>

            {p2pStatus === 'waiting-answer' && (
              <div className="answer-paste">
                <p className="hint">Когда близкий покажет QR ответа — отсканируйте его камерой:</p>
                <button
                  type="button"
                  className="mega-btn primary compact scan-btn"
                  onClick={() => {
                    setError('');
                    setScannerOpen(true);
                  }}
                  disabled={connectingAnswer}
                >
                  {connectingAnswer ? (
                    <>
                      <span className="btn-spinner" aria-hidden />
                      {inviteHint === 'Код прочитан, устанавливаем связь...'
                        ? 'Код прочитан, устанавливаем связь...'
                        : 'Подключаем…'}
                    </>
                  ) : (
                    <>
                      <Camera size={28} />
                      Сканировать QR-код ответа
                    </>
                  )}
                </button>
                <p className="hint muted-sep">или вставьте ответную ссылку вручную</p>
                <div className="adv-row">
                  <input
                    ref={answerInputRef}
                    value={remoteSignal}
                    onChange={(e) => setRemoteSignal(e.target.value)}
                    placeholder="Вставьте ответную ссылку"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void applyAnswerFromText(remoteSignal).catch(() => undefined);
                    }}
                    disabled={connectingAnswer || !remoteSignal.trim()}
                  >
                    Подключить
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        <QrScannerModal
          open={scannerOpen}
          onClose={() => setScannerOpen(false)}
          onScan={onQrScanned}
          onManualEntry={() => {
            setScannerOpen(false);
            requestAnimationFrame(() => {
              answerInputRef.current?.focus();
              answerInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            });
          }}
        />
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
