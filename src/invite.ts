/** Инвайт-ссылки и QR для однокликового рукопожатия без сервера. */

import QRCode from 'qrcode';

export type InvitePayload = {
  v: 1;
  role: 'offer' | 'answer';
  sdp: string;
  key: string;
  from: string;
  name?: string;
};

const HASH_PREFIX = '#paranoic=';

export async function compressPayload(payload: InvitePayload): Promise<string> {
  const json = JSON.stringify(payload);
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
  const buffer = await new Response(stream).arrayBuffer();
  return bytesToBase64Url(new Uint8Array(buffer));
}

export async function decompressPayload(encoded: string): Promise<InvitePayload> {
  const bytes = base64UrlToBytes(encoded);
  const stream = new Blob([bytes.buffer as ArrayBuffer])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  const json = await new Response(stream).text();
  return JSON.parse(json) as InvitePayload;
}

export async function buildInviteUrl(payload: InvitePayload): Promise<string> {
  const encoded = await compressPayload(payload);
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}${HASH_PREFIX}${encoded}`;
}

export async function parseInviteFromLocation(
  hash = window.location.hash
): Promise<InvitePayload | null> {
  if (!hash.startsWith(HASH_PREFIX)) return null;
  const encoded = hash.slice(HASH_PREFIX.length);
  if (!encoded) return null;
  try {
    return await decompressPayload(encoded);
  } catch {
    return null;
  }
}

export function clearInviteHash(): void {
  if (window.location.hash.startsWith(HASH_PREFIX)) {
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}

export async function makeQrDataUrl(text: string, size = 280): Promise<string> {
  return QRCode.toDataURL(text, {
    width: size,
    margin: 2,
    color: { dark: '#0f1117', light: '#ffffff' },
    errorCorrectionLevel: 'M',
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
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export const SIGNAL_CHANNEL = 'paranoic-signal-v1';

export type SignalMessage =
  | { kind: 'answer'; payload: InvitePayload; to: string }
  | { kind: 'ping'; from: string };
