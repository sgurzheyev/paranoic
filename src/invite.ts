/** Инвайт-ссылки и QR для однокликового рукопожатия без сервера. */

import QRCode from 'qrcode';
import { zlibSync, unzlibSync, strToU8, strFromU8 } from 'fflate';

export type InvitePayload = {
  v: 1 | 2;
  role: 'offer' | 'answer';
  sdp: string;
  key: string;
  from: string;
  name?: string;
};

/** Компактный wire-формат (короче JSON до сжатия). */
type WireInvite = {
  v: 2;
  r: 'o' | 'a';
  s: string;
  k: string;
  f: string;
  n?: string;
};

const HASH_PREFIX = '#paranoic=';
const FORMAT_TAG = '2';

export const INVITE_TRUNCATED_MESSAGE =
  'Ссылка повреждена при передаче, скопируйте её полностью';

export class InviteTruncatedError extends Error {
  constructor(message = INVITE_TRUNCATED_MESSAGE) {
    super(message);
    this.name = 'InviteTruncatedError';
  }
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toWire(payload: InvitePayload): WireInvite {
  const wire: WireInvite = {
    v: 2,
    r: payload.role === 'offer' ? 'o' : 'a',
    s: payload.sdp,
    k: payload.key,
    f: payload.from,
  };
  if (payload.name) wire.n = payload.name;
  return wire;
}

function fromWire(wire: WireInvite): InvitePayload {
  if (wire.v !== 2 || (wire.r !== 'o' && wire.r !== 'a') || !wire.s || !wire.k || !wire.f) {
    throw new InviteTruncatedError();
  }
  return {
    v: 2,
    role: wire.r === 'o' ? 'offer' : 'answer',
    sdp: wire.s,
    key: wire.k,
    from: wire.f,
    name: wire.n,
  };
}

function looksTruncatedBase64Url(body: string): boolean {
  // Обрезанный payload часто обрывается на середине алфавита / без CRC-хвоста
  if (body.length < 32) return true;
  if (/[.+\s]/.test(body) && !body.includes('.')) return true;
  return false;
}

/** Максимальное сжатие (fflate zlib level 9) + CRC для детекта обрезки мессенджером. */
export function compressPayload(payload: InvitePayload): string {
  const json = JSON.stringify(toWire({ ...payload, v: 2 }));
  const compressed = zlibSync(strToU8(json), { level: 9 });
  const body = bytesToBase64Url(compressed);
  const sum = crc32(strToU8(body)).toString(36);
  return `${FORMAT_TAG}.${body}.${sum}`;
}

export async function decompressPayload(encoded: string): Promise<InvitePayload> {
  const trimmed = encoded.trim();
  if (!trimmed) throw new InviteTruncatedError();

  // Новый формат: 2.<body>.<crc36>
  if (trimmed.startsWith(`${FORMAT_TAG}.`)) {
    const parts = trimmed.split('.');
    if (parts.length < 3) throw new InviteTruncatedError();
    const body = parts.slice(1, -1).join('.');
    const sum = parts[parts.length - 1];
    if (!body || !sum || !/^[0-9a-z]+$/i.test(sum)) throw new InviteTruncatedError();
    if (looksTruncatedBase64Url(body)) throw new InviteTruncatedError();

    const expected = crc32(strToU8(body)).toString(36);
    if (expected !== sum) throw new InviteTruncatedError();

    try {
      const bytes = base64UrlToBytes(body);
      const json = strFromU8(unzlibSync(bytes));
      return fromWire(JSON.parse(json) as WireInvite);
    } catch (e) {
      if (e instanceof InviteTruncatedError) throw e;
      throw new InviteTruncatedError();
    }
  }

  // Legacy gzip (v1)
  try {
    return await decompressLegacyGzip(trimmed);
  } catch {
    throw new InviteTruncatedError();
  }
}

async function decompressLegacyGzip(encoded: string): Promise<InvitePayload> {
  const bytes = base64UrlToBytes(encoded);
  const stream = new Blob([bytes.buffer as ArrayBuffer])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  const json = await new Response(stream).text();
  const parsed = JSON.parse(json) as InvitePayload;
  if (!parsed?.sdp || !parsed?.key || !parsed?.role) throw new InviteTruncatedError();
  return parsed;
}

export async function buildInviteUrl(payload: InvitePayload): Promise<string> {
  const encoded = compressPayload(payload);
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}${HASH_PREFIX}${encoded}`;
}

export async function parseInviteFromLocation(
  hash = window.location.hash
): Promise<InvitePayload | null> {
  if (!hash.startsWith(HASH_PREFIX)) return null;
  const encoded = hash.slice(HASH_PREFIX.length);
  if (!encoded) throw new InviteTruncatedError();
  return decompressPayload(encoded);
}

/** Достаёт инвайт из полной ссылки, hash или «голого» payload. */
export async function parseInviteFromPastedText(raw: string): Promise<InvitePayload | null> {
  const text = raw.trim();
  if (!text) return null;

  const hashIdx = text.indexOf(HASH_PREFIX);
  if (hashIdx >= 0) {
    const encoded = text.slice(hashIdx + HASH_PREFIX.length);
    // Мессенджер обрезал CRC / хвост
    if (!encoded || (encoded.startsWith(`${FORMAT_TAG}.`) && encoded.split('.').length < 3)) {
      throw new InviteTruncatedError();
    }
    return parseInviteFromLocation(text.slice(hashIdx));
  }

  if (text.startsWith('http://') || text.startsWith('https://')) {
    try {
      const url = new URL(text);
      if (url.hash.startsWith(HASH_PREFIX)) {
        return parseInviteFromLocation(url.hash);
      }
      // В ссылке есть намёк на инвайт, но hash пустой/битый
      if (text.includes('paranoic=') || url.hash.includes('paranoic')) {
        throw new InviteTruncatedError();
      }
      return null;
    } catch (e) {
      if (e instanceof InviteTruncatedError) throw e;
      throw new InviteTruncatedError();
    }
  }

  if (/^(2\.)?[A-Za-z0-9_.-]{20,}$/.test(text)) {
    return decompressPayload(text);
  }

  return null;
}

/** SDP из ответа: инвайт-ссылка, JSON SDP или «сырой» сигнал. */
export async function extractSdpFromPaste(raw: string): Promise<string> {
  const text = raw.trim();
  try {
    const invite = await parseInviteFromPastedText(text);
    if (invite?.sdp) return invite.sdp;
  } catch (e) {
    if (e instanceof InviteTruncatedError) throw e;
  }

  if (text.startsWith('{')) return text;

  const jsonStart = text.indexOf('{');
  if (jsonStart >= 0) {
    const maybe = text.slice(jsonStart);
    JSON.parse(maybe);
    return maybe;
  }

  return text;
}

export function clearInviteHash(): void {
  if (window.location.hash.startsWith(HASH_PREFIX)) {
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}

export async function makeQrDataUrl(text: string, size = 320): Promise<string> {
  return QRCode.toDataURL(text, {
    width: size,
    margin: 0,
    color: { dark: '#0f1117', light: '#ffffff' },
    errorCorrectionLevel: 'L',
  });
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  try {
    const binary = atob(padded + pad);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    throw new InviteTruncatedError();
  }
}

export const SIGNAL_CHANNEL = 'paranoic-signal-v1';

export type SignalMessage =
  | { kind: 'answer'; payload: InvitePayload; to: string }
  | { kind: 'ping'; from: string };
