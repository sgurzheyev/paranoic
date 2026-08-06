// Простой и надежный модуль локального шифрования для Paranoic

// Генерация ключа шифрования для сессии с близким человеком
export async function generateSecretKey(): Promise<CryptoKey> {
    return await window.crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
  }
  
  // Экспорт ключа в строку для передачи близким по защищенному каналу
  export async function exportKey(key: CryptoKey): Promise<string> {
    const exported = await window.crypto.subtle.exportKey("raw", key);
    return btoa(String.fromCharCode(...new Uint8Array(exported)));
  }

  // Импорт ключа, полученного от близкого по защищенному каналу
  export async function importKey(keyBase64: string): Promise<CryptoKey> {
    const raw = Uint8Array.from(atob(keyBase64), (c) => c.charCodeAt(0));
    return await window.crypto.subtle.importKey(
      "raw",
      raw,
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
  }
  
  // Шифрование сообщения перед отправкой
  export async function encryptMessage(text: string, key: CryptoKey): Promise<{ cipher: string; iv: string }> {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(text);
    
    const encrypted = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      encoded
    );
  
    return {
      cipher: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
      iv: btoa(String.fromCharCode(...iv))
    };
  }
  
  // Расшифровка входящего сообщения
  export async function decryptMessage(cipherBase64: string, ivBase64: string, key: CryptoKey): Promise<string> {
    const cipher = Uint8Array.from(atob(cipherBase64), c => c.charCodeAt(0));
    const iv = Uint8Array.from(atob(ivBase64), c => c.charCodeAt(0));
  
    const decrypted = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      cipher
    );
  
    return new TextDecoder().decode(decrypted);
  }