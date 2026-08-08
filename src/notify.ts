/**
 * Лёгкие звуки (Web Audio) + Web Notifications при скрытой вкладке.
 */

let audioCtx: AudioContext | null = null;
let ringTimer: ReturnType<typeof setInterval> | null = null;
let permissionAsked = false;

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

function playRingPulse(): void {
  tone(440, 0.16, { type: 'sine', gain: 0.05 });
  tone(554, 0.18, { type: 'sine', gain: 0.045, delaySec: 0.14 });
}

/** Повтор мелодии входящего звонка. */
export function startRingtone(): void {
  stopRingtone();
  playRingPulse();
  ringTimer = setInterval(playRingPulse, 1800);
}

export function stopRingtone(): void {
  if (ringTimer != null) {
    clearInterval(ringTimer);
    ringTimer = null;
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

/** Показать системное уведомление, только если вкладка неактивна. */
export function notifyIfHidden(
  title: string,
  options?: { body?: string; tag?: string }
): void {
  if (typeof document === 'undefined') return;
  if (!document.hidden && document.visibilityState === 'visible') return;
  if (!canNotify()) return;
  try {
    const n = new Notification(title, {
      body: options?.body,
      tag: options?.tag ?? 'paranoic',
      silent: true, // свой звук уже проигран
    icon: undefined,
  });
    n.onclick = () => {
      window.focus();
      n.close();
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
