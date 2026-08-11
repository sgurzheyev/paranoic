/**
 * Context Injection для ИИ-телохранителя:
 * локация, контакты, статус P2P → блок «СИСТЕМНЫЕ ДАННЫЕ В РЕАЛЬНОМ ВРЕМЕНИ».
 */

import { getMapboxToken } from './lib/mapbox';
import type { CallState, P2PStatus } from './p2p';
import { getP2PSession } from './p2pSession';
import { isTrusted } from './trust';

export type AiContactSnapshot = {
  id: string;
  name: string;
  online: boolean;
  trusted?: boolean;
};

export type AiRealtimeContextInput = {
  lat?: number | null;
  lng?: number | null;
  geoSource: 'gps' | 'antarctica' | 'pending';
  ghostMode: boolean;
  placeLabel?: string | null;
  contacts: AiContactSnapshot[];
  /** Уже собранный текст капсул на карте (опционально). */
  gemsContext?: string;
  p2pStatus?: P2PStatus | null;
  callState?: CallState | null;
  peerLabel?: string | null;
};

const FRIENDLY_P2P: Record<P2PStatus, string> = {
  idle: 'нет активного P2P-соединения',
  'creating-offer': 'создаём соединение',
  'waiting-answer': 'ожидание собеседника по ссылке',
  connecting: 'подключаемся',
  connected: 'на связи (P2P установлен)',
  disconnected: 'связь прервалась, идёт переподключение',
  failed: 'не удалось связаться',
};

const FRIENDLY_CALL: Record<CallState, string> = {
  idle: 'звонка нет',
  ringing: 'входящий звонок',
  calling: 'исходящий звонок',
  'in-call': 'активный медиазвонок',
  ending: 'завершение звонка',
};

let geocodeCache: { key: string; label: string; at: number } | null = null;
const GEOCODE_TTL_MS = 5 * 60_000;

function roundCoord(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Быстрый reverse geocoding через Mapbox (если есть токен). */
export async function reverseGeocodeLabel(
  lat: number,
  lng: number
): Promise<string | null> {
  const token = getMapboxToken();
  if (!token) return null;

  const key = `${roundCoord(lat)},${roundCoord(lng)}`;
  if (geocodeCache && geocodeCache.key === key && Date.now() - geocodeCache.at < GEOCODE_TTL_MS) {
    return geocodeCache.label;
  }

  try {
    const url =
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json` +
      `?access_token=${encodeURIComponent(token)}&language=ru&types=place,locality,region,country&limit=1`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      features?: Array<{ place_name?: string }>;
    };
    const label = data.features?.[0]?.place_name?.trim();
    if (!label) return null;
    geocodeCache = { key, label, at: Date.now() };
    return label;
  } catch {
    return null;
  }
}

function formatLocation(input: AiRealtimeContextInput): string {
  if (input.ghostMode || input.geoSource === 'antarctica') {
    return 'Ghost Mode — реальный GPS скрыт (условная Антарктида). Не раскрывай истинное местоположение.';
  }
  if (input.geoSource === 'pending' || input.lat == null || input.lng == null) {
    return 'геолокация ещё не получена';
  }
  const coords = `${input.lat.toFixed(5)}, ${input.lng.toFixed(5)}`;
  if (input.placeLabel) {
    return `${input.placeLabel} (координаты: ${coords})`;
  }
  return `координаты: ${coords}`;
}

function formatContacts(contacts: AiContactSnapshot[]): string {
  if (contacts.length === 0) {
    return '(записная книжка пуста — доверенных / сохранённых контактов нет)';
  }
  return contacts
    .slice(0, 40)
    .map((c) => {
      const trust = c.trusted || isTrusted(c.id) ? 'доверенный' : 'контакт';
      const net = c.online ? 'в сети' : 'не в сети';
      return `- ${c.name} [${trust}, ${net}, id:${c.id.slice(0, 8)}…]`;
    })
    .join('\n');
}

function formatConnection(input: AiRealtimeContextInput): string {
  const live = getP2PSession();
  const status = input.p2pStatus ?? live?.currentStatus ?? 'idle';
  const call = input.callState ?? live?.currentCallState ?? 'idle';
  const peer = input.peerLabel?.trim();
  const parts = [
    FRIENDLY_P2P[status] || status,
    `медиа: ${FRIENDLY_CALL[call] || call}`,
  ];
  if (peer && (status === 'connected' || call !== 'idle')) {
    parts.push(`собеседник: ${peer}`);
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    parts.push('устройство: нет сети (navigator.onLine=false)');
  }
  return parts.join('; ');
}

/** Текстовый блок для system prompt (без роли/характера). */
export function buildRealtimeSystemBlock(input: AiRealtimeContextInput): string {
  const lines = [
    'СИСТЕМНЫЕ ДАННЫЕ В РЕАЛЬНОМ ВРЕМЕНИ (Используй их для ответов, не фантазируй):',
    `Локация пользователя: ${formatLocation(input)}`,
    'Доверенные / сохранённые контакты:',
    formatContacts(input.contacts),
    `Статус связи: ${formatConnection(input)}`,
  ];
  if (input.gemsContext?.trim()) {
    lines.push('Капсулы памяти в текущем обзоре карты:', input.gemsContext.trim());
  }
  return lines.join('\n');
}

/** Склеить характер + realtime-данные в один system message. */
export function buildBodyguardSystemPrompt(
  basePrompt: string,
  realtimeBlock?: string | null
): string {
  const base = basePrompt.trim();
  const block = realtimeBlock?.trim();
  if (!block) return base;
  return `${base}\n\n---\n${block}`;
}
