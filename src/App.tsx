import React, { useState, useEffect, useRef } from 'react';
import { Shield, Lock, Send, Key, Radio, Link2, Copy, Unplug } from 'lucide-react';
import {
  generateSecretKey,
  exportKey,
  importKey,
  encryptMessage,
  decryptMessage,
} from './crypto';
import { P2PConnection, type P2PStatus } from './p2p';

type ChatMessage = {
  sender: string;
  text: string;
  time: string;
  mine: boolean;
};

const STATUS_LABELS: Record<P2PStatus, string> = {
  idle: 'Ожидание P2P-соединения',
  'creating-offer': 'Создание offer…',
  'waiting-answer': 'Ожидание answer от пира',
  connecting: 'Установка WebRTC…',
  connected: 'P2P DataChannel активен',
  disconnected: 'Соединение разорвано',
  failed: 'Ошибка соединения',
};

export default function App() {
  const [myId, setMyId] = useState<string>('');
  const [secretKey, setSecretKey] = useState<CryptoKey | null>(null);
  const [keyString, setKeyString] = useState<string>('');
  const [importKeyInput, setImportKeyInput] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState<string>('');
  const [p2pStatus, setP2pStatus] = useState<P2PStatus>('idle');
  const [localSignal, setLocalSignal] = useState<string>('');
  const [remoteSignal, setRemoteSignal] = useState<string>('');
  const [error, setError] = useState<string>('');

  const p2pRef = useRef<P2PConnection | null>(null);
  const secretKeyRef = useRef<CryptoKey | null>(null);
  const myIdRef = useRef<string>('');

  useEffect(() => {
    secretKeyRef.current = secretKey;
  }, [secretKey]);

  useEffect(() => {
    myIdRef.current = myId;
  }, [myId]);

  useEffect(() => {
    async function initCrypto() {
      const generatedId = 'PRN-' + Math.random().toString(36).substring(2, 9).toUpperCase();
      setMyId(generatedId);
      myIdRef.current = generatedId;

      const key = await generateSecretKey();
      setSecretKey(key);
      secretKeyRef.current = key;
      const exported = await exportKey(key);
      setKeyString(exported);
    }
    initCrypto();

    return () => {
      p2pRef.current?.close();
    };
  }, []);

  const ensureP2P = () => {
    if (!p2pRef.current) {
      p2pRef.current = new P2PConnection({
        onStatus: (status) => {
          setP2pStatus(status);
          if (status === 'connected') setError('');
        },
        onMessage: async (payload) => {
          const key = secretKeyRef.current;
          if (!key) return;
          try {
            const packet = JSON.parse(payload) as {
              cipher: string;
              iv: string;
              sender: string;
            };
            const text = await decryptMessage(packet.cipher, packet.iv, key);
            setMessages((prev) => [
              ...prev,
              {
                sender: packet.sender || 'Пир',
                text,
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                mine: false,
              },
            ]);
          } catch {
            setError('Не удалось расшифровать входящее сообщение (проверьте общий ключ)');
          }
        },
        onError: (err) => setError(err.message),
      });
    }
    return p2pRef.current;
  };

  const handleCreateOffer = async () => {
    setError('');
    try {
      const p2p = ensureP2P();
      const offer = await p2p.createOffer();
      setLocalSignal(offer);
      setRemoteSignal('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось создать offer');
    }
  };

  const handleAcceptOffer = async () => {
    if (!remoteSignal.trim()) return;
    setError('');
    try {
      const p2p = ensureP2P();
      const answer = await p2p.acceptOffer(remoteSignal.trim());
      setLocalSignal(answer);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось принять offer');
    }
  };

  const handleAcceptAnswer = async () => {
    if (!remoteSignal.trim()) return;
    setError('');
    try {
      const p2p = ensureP2P();
      await p2p.acceptAnswer(remoteSignal.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось принять answer');
    }
  };

  const handleDisconnect = () => {
    p2pRef.current?.close();
    p2pRef.current = null;
    setLocalSignal('');
    setRemoteSignal('');
    setP2pStatus('disconnected');
  };

  const handleImportKey = async () => {
    if (!importKeyInput.trim()) return;
    setError('');
    try {
      const key = await importKey(importKeyInput.trim());
      setSecretKey(key);
      secretKeyRef.current = key;
      setKeyString(importKeyInput.trim());
      setImportKeyInput('');
    } catch {
      setError('Неверный формат ключа');
    }
  };

  const copySignal = async () => {
    if (!localSignal) return;
    await navigator.clipboard.writeText(localSignal);
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !secretKey) return;

    const encrypted = await encryptMessage(inputText, secretKey);
    const packet = JSON.stringify({
      cipher: encrypted.cipher,
      iv: encrypted.iv,
      sender: myIdRef.current,
    });

    const p2p = p2pRef.current;
    if (!p2p?.isReady) {
      setError('Сначала установите P2P-соединение');
      return;
    }

    try {
      p2p.send(packet);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка отправки');
      return;
    }

    setMessages((prev) => [
      ...prev,
      {
        sender: 'Я',
        text: inputText,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        mine: true,
      },
    ]);
    setInputText('');
    setError('');
  };

  const connected = p2pStatus === 'connected';

  return (
    <div className="min-h-screen bg-[#16171d] text-[#9ca3af] flex flex-col font-sans">
      <header className="border-b border-[#2e303a] bg-[#16171d]/80 backdrop-blur p-4 flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <Shield className="w-7 h-7 text-[#c084fc] animate-pulse" />
          <div>
            <h1 className="text-xl font-medium tracking-tight text-[#f3f4f6] m-0 flex items-center gap-2">
              PARANOIC{' '}
              <span className="text-xs bg-[rgba(192,132,252,0.15)] text-[#c084fc] px-2 py-0.5 rounded border border-[rgba(192,132,252,0.5)]">
                E2EE · WebRTC P2P
              </span>
            </h1>
            <p className="text-xs text-[#9ca3af]">
              ID: <span className="font-mono text-[#c084fc]">{myId || 'Инициализация...'}</span>
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2 bg-[rgba(47,48,58,0.5)] px-3 py-1.5 rounded-md border border-[#2e303a] text-xs text-[#f3f4f6]">
          <Radio className={`w-3.5 h-3.5 ${connected ? 'text-emerald-400' : 'text-amber-400'}`} />
          <span>{STATUS_LABELS[p2pStatus]}</span>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <div className="w-80 border-r border-[#2e303a] bg-[rgba(23,24,31,0.5)] p-4 flex flex-col gap-4 overflow-y-auto">
          <div className="bg-[#1f2028] p-3 rounded-md border border-[#2e303a]">
            <h2 className="text-xs font-medium text-[#f3f4f6] uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Key className="w-3.5 h-3.5 text-[#c084fc]" /> Сессионный ключ семьи
            </h2>
            <p className="text-xs text-[#9ca3af] mb-2">Передайте этот ключ близким по защищенному каналу:</p>
            <div className="bg-[#16171d] p-2 rounded border border-[#2e303a] text-[11px] font-mono text-[#c084fc] break-all select-all">
              {keyString || 'Генерация ключа...'}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                type="text"
                placeholder="Вставить чужой ключ…"
                value={importKeyInput}
                onChange={(e) => setImportKeyInput(e.target.value)}
                className="flex-1 bg-[#16171d] border border-[#2e303a] rounded-md px-2 py-1.5 text-[11px] font-mono text-[#f3f4f6] focus:outline-none focus:border-[#c084fc]"
              />
              <button
                type="button"
                onClick={handleImportKey}
                className="text-xs px-2 py-1.5 rounded-md border border-[rgba(192,132,252,0.5)] bg-[rgba(192,132,252,0.15)] text-[#f3f4f6] hover:bg-[rgba(192,132,252,0.25)]"
              >
                Импорт
              </button>
            </div>
          </div>

          <div className="bg-[#1f2028] p-3 rounded-md border border-[#2e303a] flex flex-col gap-3">
            <h2 className="text-xs font-medium text-[#f3f4f6] uppercase tracking-wider flex items-center gap-1.5">
              <Link2 className="w-3.5 h-3.5 text-[#c084fc]" /> WebRTC P2P
            </h2>
            <p className="text-xs text-[#9ca3af]">
              Обменяйтесь SDP вручную. Сообщения идут напрямую через DataChannel — без сервера чата.
            </p>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleCreateOffer}
                disabled={connected}
                className="text-xs px-2.5 py-1.5 rounded-md border border-[rgba(192,132,252,0.5)] bg-[rgba(192,132,252,0.15)] text-[#f3f4f6] hover:bg-[rgba(192,132,252,0.25)] disabled:opacity-40"
              >
                Создать offer
              </button>
              <button
                type="button"
                onClick={handleAcceptOffer}
                disabled={connected || !remoteSignal.trim()}
                className="text-xs px-2.5 py-1.5 rounded-md border border-[#2e303a] bg-[#16171d] text-[#f3f4f6] hover:border-[#c084fc] disabled:opacity-40"
              >
                Принять offer
              </button>
              <button
                type="button"
                onClick={handleAcceptAnswer}
                disabled={connected || !remoteSignal.trim()}
                className="text-xs px-2.5 py-1.5 rounded-md border border-[#2e303a] bg-[#16171d] text-[#f3f4f6] hover:border-[#c084fc] disabled:opacity-40"
              >
                Принять answer
              </button>
              {p2pStatus !== 'idle' && (
                <button
                  type="button"
                  onClick={handleDisconnect}
                  className="text-xs px-2.5 py-1.5 rounded-md border border-red-900/50 bg-red-950/30 text-red-300 hover:bg-red-950/50 flex items-center gap-1"
                >
                  <Unplug className="w-3 h-3" /> Отключить
                </button>
              )}
            </div>

            {localSignal && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] uppercase tracking-wider text-[#9ca3af]">Ваш сигнал (скопируйте)</span>
                  <button
                    type="button"
                    onClick={copySignal}
                    className="text-[10px] flex items-center gap-1 text-[#c084fc] hover:underline"
                  >
                    <Copy className="w-3 h-3" /> Копировать
                  </button>
                </div>
                <textarea
                  readOnly
                  value={localSignal}
                  className="w-full h-20 bg-[#16171d] border border-[#2e303a] rounded-md p-2 text-[10px] font-mono text-[#c084fc] resize-none"
                />
              </div>
            )}

            <div>
              <span className="text-[10px] uppercase tracking-wider text-[#9ca3af] block mb-1">
                Сигнал пира (вставьте offer или answer)
              </span>
              <textarea
                value={remoteSignal}
                onChange={(e) => setRemoteSignal(e.target.value)}
                placeholder='{"type":"offer"|"answer",...}'
                className="w-full h-20 bg-[#16171d] border border-[#2e303a] rounded-md p-2 text-[10px] font-mono text-[#f3f4f6] resize-none focus:outline-none focus:border-[#c084fc]"
              />
            </div>
          </div>

          {error && (
            <div className="text-xs text-red-300 bg-red-950/40 border border-red-900/50 rounded-md p-2">
              {error}
            </div>
          )}
        </div>

        <div className="flex-1 flex flex-col bg-[#16171d]">
          <div className="p-4 border-b border-[#2e303a] bg-[rgba(23,24,31,0.3)] flex items-center gap-2 text-xs text-[#f3f4f6]">
            <Lock className="w-4 h-4 text-[#c084fc]" />
            <span>
              AES-GCM на клиенте + WebRTC DataChannel. Шифротекст уходит напрямую пиру, минуя сторонние серверы
              сообщений.
            </span>
          </div>

          <div className="flex-1 p-4 overflow-y-auto space-y-4">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-[#9ca3af] text-sm">
                <Shield className="w-12 h-12 mb-2 opacity-20 text-[#c084fc]" />
                <p>Установите P2P и обменяйтесь ключом — история только в RAM сессии.</p>
              </div>
            ) : (
              messages.map((m, idx) => (
                <div key={idx} className={`flex flex-col ${m.mine ? 'items-end' : 'items-start'}`}>
                  <span className="text-[10px] text-[#9ca3af] mb-1 font-mono">{m.sender}</span>
                  <div
                    className={`max-w-md border rounded-md p-3 text-sm ${
                      m.mine
                        ? 'bg-[#1f2028] border-[#2e303a]'
                        : 'bg-[rgba(192,132,252,0.08)] border-[rgba(192,132,252,0.35)]'
                    }`}
                  >
                    <p className="text-[#f3f4f6]">{m.text}</p>
                    <span className="text-[10px] text-[#9ca3af] mt-1 block text-right">{m.time}</span>
                  </div>
                </div>
              ))
            )}
          </div>

          <form onSubmit={sendMessage} className="p-4 border-t border-[#2e303a] bg-[rgba(23,24,31,0.3)] flex gap-2">
            <input
              type="text"
              placeholder={connected ? 'Введите защищенное сообщение...' : 'Сначала подключите P2P…'}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              disabled={!connected}
              className="flex-1 bg-[#1f2028] border border-[#2e303a] rounded-md px-4 py-2.5 text-sm text-[#f3f4f6] focus:outline-none focus:border-[#c084fc] disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!connected || !inputText.trim()}
              className="bg-[rgba(192,132,252,0.15)] hover:bg-[rgba(192,132,252,0.25)] border border-[rgba(192,132,252,0.5)] text-[#f3f4f6] font-medium px-5 py-2.5 rounded-md flex items-center gap-2 transition-colors text-sm disabled:opacity-40"
            >
              <Send className="w-4 h-4" /> Отправить
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
