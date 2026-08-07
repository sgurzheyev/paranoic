// Локальное шифрование для Paranoic (AES-GCM)

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function sanitizePastedKey(input: string): string {
  let text = input.trim().replace(/^['"]+|['"]+$/g, '');
  if (!text) return '';

  const keyParam = text.match(/[?&#](?:key|k|secret)=([^&#\s]+)/i);
  if (keyParam?.[1]) {
    try {
      return decodeURIComponent(keyParam[1]).replace(/\s+/g, '');
    } catch {
      return keyParam[1].replace(/\s+/g, '');
    }
  }

  return text.replace(/\s+/g, '');
}

export async function resolveKeyMaterial(input: string): Promise<string> {
  const cleaned = sanitizePastedKey(input);
  if (!cleaned) throw new Error('Пустой ключ');
  return cleaned;
}

/** Общий AES-ключ комнаты: оба пира с одним roomId получают один ключ. */
export async function deriveKeyFromRoom(roomId: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const material = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(`paranoic-room:${roomId}`),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode('paranoic-e2ee-v1'),
      iterations: 120_000,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

export async function generateSecretKey(): Promise<CryptoKey> {
  return await window.crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

export async function exportKey(key: CryptoKey): Promise<string> {
  const exported = await window.crypto.subtle.exportKey('raw', key);
  return bytesToBase64(new Uint8Array(exported));
}

export async function importKey(keyBase64: string): Promise<CryptoKey> {
  const cleaned = await resolveKeyMaterial(keyBase64);
  const raw = base64ToBytes(cleaned);
  if (raw.byteLength !== 32) {
    throw new Error('Ключ не подходит');
  }
  return await window.crypto.subtle.importKey(
    'raw',
    raw.buffer as ArrayBuffer,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

export async function encryptMessage(
  text: string,
  key: CryptoKey
): Promise<{ cipher: string; iv: string }> {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(text);

  const encrypted = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);

  return {
    cipher: bytesToBase64(new Uint8Array(encrypted)),
    iv: bytesToBase64(iv),
  };
}

export async function decryptMessage(
  cipherBase64: string,
  ivBase64: string,
  key: CryptoKey
): Promise<string> {
  const cipher = base64ToBytes(cipherBase64);
  const iv = base64ToBytes(ivBase64);

  const decrypted = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    key,
    cipher.buffer as ArrayBuffer
  );

  return new TextDecoder().decode(decrypted);
}

/** Шифрование бинарных данных (фото, короткое видео). */
export async function encryptBytes(
  data: ArrayBuffer,
  key: CryptoKey
): Promise<{ cipher: string; iv: string }> {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );

  return {
    cipher: bytesToBase64(new Uint8Array(encrypted)),
    iv: bytesToBase64(iv),
  };
}

export async function decryptBytes(
  cipherBase64: string,
  ivBase64: string,
  key: CryptoKey
): Promise<ArrayBuffer> {
  const cipher = base64ToBytes(cipherBase64);
  const iv = base64ToBytes(ivBase64);

  return await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    key,
    cipher.buffer as ArrayBuffer
  );
}

export { bytesToBase64, base64ToBytes };
