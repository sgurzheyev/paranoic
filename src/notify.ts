/**
 * Звуки + Web Notifications.
 * Рингтон: HTMLAudioElement.loop + unlock после первого жеста (autoplay policy).
 */

let audioCtx: AudioContext | null = null;
let ringAudio: HTMLAudioElement | null = null;
let ringDataUrl: string | null = null;
let ringTimer: ReturnType<typeof setInterval> | null = null;
let permissionAsked = false;
let pendingRingtone = false;
let unlockBound = false;
let activeNotify: Notification | null = null;

function ctx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AC) return null;
  if (!audioCtx) audioCtx = new AC();
  if (audioCtx.state === 'suspended') void audioCtx.resume();
  return audioCtx;
}

function tone(
  frequency: number,
  durationSec: number,
  options?: {
    type?: OscillatorType;
    gain?: number;
    delaySec?: number;
    slideTo?: number;
  }
): void {
  const ac = ctx();
  if (!ac) return;
  const start = ac.currentTime + (options?.delaySec ?? 0);
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = options?.type ?? 'sine';
  osc.frequency.setValueAtTime(frequency, start);
  if (options?.slideTo != null) {
    osc.frequency.linearRampToValueAtTime(options.slideTo, start + durationSec);
  }
  const peak = options?.gain ?? 0.045;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.018);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + durationSec);
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.start(start);
  osc.stop(start + durationSec + 0.02);
}

/** Короткий WAV-рингтон (два тона) → data URL для HTMLAudioElement.loop. */
function buildRingtoneDataUrl(): string {
  const sampleRate = 22050;
  const seconds = 1.6;
  const n = Math.floor(sampleRate * seconds);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const env =
      t < 0.55
        ? Math.min(1, t / 0.04) * Math.max(0, 1 - (t - 0.35) / 0.2)
        : t < 1.15
          ? Math.min(1, (t - 0.6) / 0.04) * Math.max(0, 1 - (t - 0.95) / 0.2)
          : 0;
    const f = t < 0.6 ? 440 : 554.37;
    samples[i] = Math.sin(2 * Math.PI * f * t) * env * 0.35;
  }

  const dataLength = n * 2;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataLength, true);
  let offset = 44;
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(offset, (s * 0x7fff) | 0, true);
    offset += 2;
  }
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return `data:audio/wav;base64,${btoa(binary)}`;
}

function getRingAudio(): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null;
  if (!ringDataUrl) ringDataUrl = buildRingtoneDataUrl();
  if (!ringAudio) {
    ringAudio = new Audio(ringDataUrl);
    ringAudio.loop = true;
    ringAudio.preload = 'auto';
    ringAudio.volume = 0.7;
  }
  return ringAudio;
}

function playRingPulseFallback(): void {
  tone(440, 0.16, { type: 'sine', gain: 0.05 });
  tone(554, 0.18, { type: 'sine', gain: 0.045, delaySec: 0.14 });
}

/** Разблокировка автоплея после первого клика / тапа / клавиши. */
export function unlockAudio(): void {
  const ac = ctx();
  if (ac?.state === 'suspended') void ac.resume();
  const audio = getRingAudio();
  if (audio) {
    const prev = audio.volume;
    audio.volume = 0.001;
    const p = audio.play();
    if (p) {
      void p
        .then(() => {
          audio.pause();
          audio.currentTime = 0;
          audio.volume = prev;
        })
        .catch(() => {
          audio.volume = prev;
        });
    } else {
      audio.volume = prev;
    }
  }
  if (pendingRingtone) {
    pendingRingtone = false;
    startRingtone();
  }
}

/** Подписка на первый жест пользователя (один раз на сессию). */
export function bindAudioUnlock(): () => void {
  if (typeof window === 'undefined' || unlockBound) return () => undefined;
  unlockBound = true;
  const unlock = () => {
    unlockAudio();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
    window.removeEventListener('touchend', unlock);
  };
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock);
  window.addEventListener('touchend', unlock, { passive: true });
  return () => {
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
    window.removeEventListener('touchend', unlock);
  };
}

/** Короткий щелчок отправки. */
export function playSendSound(): void {
  tone(660, 0.07, { type: 'triangle', gain: 0.04 });
  tone(880, 0.06, { type: 'sine', gain: 0.03, delaySec: 0.05 });
}

/** Мягкий тон входящего сообщения. */
export function playReceiveSound(): void {
  tone(520, 0.09, { type: 'sine', gain: 0.04 });
  tone(690, 0.11, { type: 'sine', gain: 0.035, delaySec: 0.08 });
}

/** Зацикленный рингтон входящего звонка. */
export function startRingtone(): void {
  stopRingtone();
  const audio = getRingAudio();
  if (audio) {
    audio.loop = true;
    audio.currentTime = 0;
    const play = audio.play();
    if (play) {
      void play.catch(() => {
        // Autoplay blocked — ждём первый жест.
        pendingRingtone = true;
        playRingPulseFallback();
        ringTimer = setInterval(playRingPulseFallback, 1800);
      });
      return;
    }
  }
  // Fallback без HTMLAudio.
  playRingPulseFallback();
  ringTimer = setInterval(playRingPulseFallback, 1800);
}

export function stopRingtone(): void {
  pendingRingtone = false;
  if (ringTimer != null) {
    clearInterval(ringTimer);
    ringTimer = null;
  }
  if (ringAudio) {
    try {
      ringAudio.pause();
      ringAudio.currentTime = 0;
    } catch {
      /* */
    }
  }
}

/** Запросить разрешение на уведомления (один раз, по жесту). */
export async function ensureNotifyPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  if (permissionAsked) return false;
  permissionAsked = true;
  try {
    const result = await Notification.requestPermission();
    return result === 'granted';
  } catch {
    return false;
  }
}

export function canNotify(): boolean {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    Notification.permission === 'granted'
  );
}

export function closeActiveNotification(): void {
  try {
    activeNotify?.close();
  } catch {
    /* */
  }
  activeNotify = null;
}

/** Системное уведомление, если вкладка скрыта. Клик → focus вкладки. */
export function notifyIfHidden(
  title: string,
  options?: { body?: string; tag?: string }
): void {
  if (typeof document === 'undefined') return;
  if (!document.hidden && document.visibilityState === 'visible') return;
  if (!canNotify()) return;
  try {
    closeActiveNotification();
    const n = new Notification(title, {
      body: options?.body,
      tag: options?.tag ?? 'paranoic',
      silent: true,
      requireInteraction: options?.tag === 'paranoic-call',
    });
    activeNotify = n;
    n.onclick = () => {
      try {
        window.focus();
      } catch {
        /* */
      }
      n.close();
      if (activeNotify === n) activeNotify = null;
    };
  } catch {
    /* */
  }
}

export const DELIVERY_LABELS = {
  sending: 'Сохранено локально',
  delivered: 'Отправлено',
  read: 'Прочитано',
} as const;
