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

/**
 * Очищает вставленный текст: полная https-ссылка, hash, кавычки, пробелы.
 * Возвращает «голый» ключ (base64), если удалось вытащить без асинхронного парсинга инвайта.
 */
export function sanitizePastedKey(input: string): string {
  let text = input.trim().replace(/^['"]+|['"]+$/g, '');
  if (!text) return '';

  // query ?key= / &key=
  const keyParam = text.match(/[?&#](?:key|k|secret)=([^&#\s]+)/i);
  if (keyParam?.[1]) {
    try {
      return decodeURIComponent(keyParam[1]).replace(/\s+/g, '');
    } catch {
      return keyParam[1].replace(/\s+/g, '');
    }
  }

  // Полный URL — берём hash, если это не инвайт Paranoic (его разберёт resolveKeyMaterial)
  if (/^https?:\/\//i.test(text) || text.includes('://')) {
    try {
      const url = new URL(text);
      if (url.hash && !url.hash.includes('paranoic=')) {
        return decodeURIComponent(url.hash.replace(/^#/, '')).replace(/\s+/g, '');
      }
      const pathTail = url.pathname.split('/').filter(Boolean).pop();
      if (pathTail && /^[A-Za-z0-9+/=_-]{32,}$/.test(pathTail)) {
        return pathTail;
      }
    } catch {
      /* keep going */
    }
  }

  // Убрать переносы/пробелы из base64-ключа
  if (!text.includes('paranoic=')) {
    text = text.replace(/\s+/g, '');
  }

  return text;
}

/** Достаёт ключ из чистой строки или из полной invite-ссылки. */
export async function resolveKeyMaterial(input: string): Promise<string> {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Пустой ключ');

  if (
    trimmed.includes('paranoic=') ||
    /^https?:\/\//i.test(trimmed) ||
    trimmed.includes('#paranoic')
  ) {
    const { parseInviteFromPastedText } = await import('./invite');
    const invite = await parseInviteFromPastedText(trimmed);
    if (invite?.key) return invite.key;
  }

  const cleaned = sanitizePastedKey(trimmed);
  if (!cleaned || cleaned.includes('paranoic=') || /^https?:\/\//i.test(cleaned)) {
    const { parseInviteFromPastedText } = await import('./invite');
    const invite = await parseInviteFromPastedText(trimmed);
    if (invite?.key) return invite.key;
  }

  return cleaned;
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
