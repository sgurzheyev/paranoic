import { Capacitor } from '@capacitor/core';
import {
  PushNotifications,
  type ActionPerformed,
  type PushNotificationSchema,
  type Token,
} from '@capacitor/push-notifications';
import {
  newCallId,
  type CallOfferEvent,
  type CallerInfo,
} from './callSignaling';
import { saveFcmToken } from './profile';

const CALL_CHANNEL_ID = 'paranoic-calls';

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Flatten FCM data (strings) plus optional nested JSON `from`. */
function parseIncomingCallPayload(raw: unknown): CallOfferEvent | null {
  const data = asRecord(raw);
  if (!data) return null;

  const type = str(data.type || data.event || data.kind);
  const callId = str(data.callId) || str(data.call_id);
  if (type) {
    if (!/call_offer|incoming[_-]?call|incomingcall/i.test(type)) return null;
  } else if (!callId) {
    return null;
  }

  const nested = asRecord(data.from) ?? asRecord(data.caller);
  const fromId =
    str(data.fromUserId) ||
    str(data.from_user_id) ||
    str(data.from_id) ||
    str(data.callerId) ||
    str(data.caller_id) ||
    str(nested?.id);
  if (!fromId) return null;

  const from: CallerInfo = {
    id: fromId,
    name:
      str(data.fromName) ||
      str(data.from_name) ||
      str(data.callerName) ||
      str(nested?.name) ||
      'Звонок',
    username:
      str(data.fromUsername) ||
      str(data.from_username) ||
      str(nested?.username),
    avatarUrl:
      str(data.fromAvatarUrl) ||
      str(data.from_avatar_url) ||
      str(nested?.avatarUrl) ||
      str(nested?.avatar_url),
    color:
      str(data.fromColor) ||
      str(data.from_color) ||
      str(nested?.color) ||
      '#34d399',
  };

  return {
    type: 'call_offer',
    callId: callId || newCallId(),
    toUserId: str(data.toUserId) || str(data.to_user_id),
    from,
    at: Number(data.at) || Date.now(),
  };
}

function offerFromNotification(notification: PushNotificationSchema): CallOfferEvent | null {
  return parseIncomingCallPayload(notification.data);
}

export function isNativePushAvailable(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Request permission, register for FCM, persist the token on `profiles.fcm_token`.
 * Incoming call data-payloads invoke `onIncomingCall`.
 * Returns a disposer that removes listeners.
 */
export async function startNativePush(opts: {
  userId: string;
  onIncomingCall: (offer: CallOfferEvent) => void;
}): Promise<() => void> {
  if (!isNativePushAvailable() || !opts.userId) {
    return () => undefined;
  }

  const handles: Array<{ remove: () => Promise<void> }> = [];
  const add = async (
    handle: Promise<{ remove: () => Promise<void> }>
  ): Promise<void> => {
    handles.push(await handle);
  };

  try {
    await add(
      PushNotifications.addListener('registration', (token: Token) => {
        if (!token?.value) return;
        console.info('[paranoic push] FCM token', token.value.slice(0, 12) + '…');
        void saveFcmToken(opts.userId, token.value);
      })
    );
    await add(
      PushNotifications.addListener('registrationError', (err) => {
        console.warn('[paranoic push] registration error', err.error);
      })
    );
    await add(
      PushNotifications.addListener(
        'pushNotificationReceived',
        (notification: PushNotificationSchema) => {
          const offer = offerFromNotification(notification);
          if (offer) opts.onIncomingCall(offer);
        }
      )
    );
    await add(
      PushNotifications.addListener(
        'pushNotificationActionPerformed',
        (event: ActionPerformed) => {
          const offer = offerFromNotification(event.notification);
          if (offer) opts.onIncomingCall(offer);
        }
      )
    );

    try {
      await PushNotifications.createChannel({
        id: CALL_CHANNEL_ID,
        name: 'Звонки',
        description: 'Входящие звонки Paranoic',
        importance: 5,
        visibility: 1,
        sound: 'default',
        vibration: true,
        lights: true,
      });
    } catch {
      /* web / older Android */
    }

    const perm = await PushNotifications.requestPermissions();
    if (perm.receive !== 'granted') {
      console.warn('[paranoic push] permission not granted', perm.receive);
      return async () => {
        await Promise.all(handles.map((h) => h.remove()));
      };
    }

    await PushNotifications.register();
  } catch (e) {
    console.warn('[paranoic push] start failed', e);
  }

  return async () => {
    await Promise.all(handles.map((h) => h.remove()));
  };
}
