/** PBKDF2-SHA256 для локального хэширования пароля профиля. */

const SALT_BYTES = 16;
const PBKDF2_ITERATIONS = 120_000;
const HASH_BYTES = 32;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function deriveHash(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const saltCopy = Uint8Array.from(salt);
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltCopy,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    HASH_BYTES * 8
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const trimmed = password.trim();
  if (trimmed.length < 4) {
    throw new Error('Пароль: минимум 4 символа');
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await deriveHash(trimmed, salt);
  const packed = new Uint8Array(salt.length + hash.length);
  packed.set(salt);
  packed.set(hash, salt.length);
  return toBase64(packed);
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored?.trim()) {
    console.error('[paranoic login] verifyPassword: empty stored hash');
    return false;
  }
  try {
    const packed = fromBase64(stored);
    if (packed.length !== SALT_BYTES + HASH_BYTES) {
      console.error('[paranoic login] verifyPassword: invalid hash length', packed.length);
      return false;
    }
    const salt = packed.slice(0, SALT_BYTES);
    const expected = packed.slice(SALT_BYTES);
    const actual = await deriveHash(password.trim(), salt);
    if (actual.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < actual.length; i++) diff |= actual[i]! ^ expected[i]!;
    return diff === 0;
  } catch (e) {
    console.error('[paranoic login] verifyPassword: decode/derive failed', e);
    return false;
  }
}
